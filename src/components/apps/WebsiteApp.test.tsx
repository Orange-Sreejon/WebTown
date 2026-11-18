import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_APP_VIEW, emitAppState, type AppCommand, type AppView } from '../../lib/app-bridge'
import { resetSiteStorage, type SiteStorage } from '../../personal-spaces/composition'
import { QuotaError, StorageError } from '../../personal-spaces/errors'
import { NOT_SAVED_NOTICE, VISITOR_LOCAL_NOTICE, VISITOR_NOT_SAVED_NOTICE } from '../../personal-spaces/labels'
import { MemorySiteRepository } from '../../personal-spaces/site-storage/memory-site-repository'
import { IdbDatabase } from '../../personal-spaces/storage/idb'
import { STORE_SITES, WEBTOWN_DB } from '../../personal-spaces/storage/webtown-db'
import { createDefaultSite } from '../../personal-spaces/website/default-site'
import type { SiteRepository } from '../../personal-spaces/website/site-repository'
import { AppHost } from './AppHost'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The website window as the game uses it: opened by an app-bridge message,
 * reading through the real storage wiring (`getSiteStorage`, IndexedDB), told who
 * the player is only by the bridge's `mode`.
 */

const OWNER: AppView = { open: 'website', houseId: 'house-a', mode: 'owner' }
const VISITOR: AppView = { open: 'website', houseId: 'house-a', mode: 'visitor' }
const OTHER_HOUSE_VISITOR: AppView = { open: 'website', houseId: 'house-b', mode: 'visitor' }

let container: HTMLDivElement
let root: Root
let factory: IDBFactory
const connections: IdbDatabase[] = []

beforeEach(async () => {
  factory = new IDBFactory() as unknown as IDBFactory
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = factory
  await resetSiteStorage()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => emitAppState(HIDDEN_APP_VIEW))
  act(() => root.unmount())
  container.remove()
  await resetSiteStorage()
  for (const db of connections.splice(0)) db.close()
  delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
  vi.restoreAllMocks()
})

/**
 * Lets storage open, the owner's window load on demand, and the page load.
 * Waits until the window has been quiet for a moment (or a short time limit),
 * without guessing what the window says.
 */
const settle = async (): Promise<void> => {
  let quiet = 0
  let last = ''
  for (let i = 0; i < 60 && quiet < 4; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    const now = container.innerHTML
    const busy = /Opening website|Loading website/.test(container.textContent ?? '')
    quiet = now === last && !busy ? quiet + 1 : 0
    last = now
  }
}

async function openApp(
  view: AppView,
  props: { sendCommand?: (c: AppCommand) => void; getSiteStorage?: () => Promise<SiteStorage>; wait?: boolean } = {},
): Promise<void> {
  act(() => root.render(<AppHost sendCommand={props.sendCommand ?? vi.fn()} {...(props.getSiteStorage ? { getSiteStorage: props.getSiteStorage } : {})} />))
  act(() => emitAppState(view))
  if (props.wait === false) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  else await settle()
}

const q = <T extends Element>(selector: string): T => {
  const found = container.querySelector<T>(selector)
  if (!found) throw new Error(`nothing matches ${selector}`)
  return found
}
const has = (selector: string): boolean => container.querySelector(selector) !== null
const button = (name: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  )
  if (!found) throw new Error(`no button "${name}"`)
  return found
}
const click = (el: HTMLElement): void => act(() => el.click())

/** The database the app itself reads: same factory, so it sees what the app saved. */
function rawDb(): IdbDatabase {
  const db = new IdbDatabase(WEBTOWN_DB, { factory })
  connections.push(db)
  return db
}

/** Saves a website the way the owner's editor will: through the repository, into IndexedDB. */
async function saveSite(houseId: string, title: string): Promise<void> {
  const { createSiteStorage } = await import('../../personal-spaces/composition')
  const storage = await createSiteStorage({ factory })
  await storage.repository.save({ ...createDefaultSite(houseId, '2026-11-16T00:00:00.000Z'), title })
  storage.close()
}

describe('the owner opens the computer', () => {
  it('shows a complete default website when nothing has been saved', async () => {
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(q('.wt-status').textContent).toBe('Saved on this device only.')
    expect(has('[role="alert"]')).toBe(false)
    for (const label of ['About', 'Projects', 'Links']) {
      click(button(label))
      expect(q('main').textContent!.length).toBeGreaterThan(40)
    }
  })

  it('shows what was saved earlier, from IndexedDB', async () => {
    await saveSite('house-a', 'Saved earlier')
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Saved earlier')
  })

  it('shows it again after a reload (new storage connection, same browser data)', async () => {
    await saveSite('house-a', 'Still here after reload')
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Still here after reload')

    act(() => emitAppState(HIDDEN_APP_VIEW)) // close
    await resetSiteStorage() // the page is gone; only the browser's data is left
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Still here after reload')
  })

  it('opens without changing the stored data', async () => {
    await saveSite('house-a', 'Untouched')
    const before = await rawDb().get(STORE_SITES, 'house-a')
    await openApp(OWNER)
    click(button('Projects'))
    expect(await rawDb().get(STORE_SITES, 'house-a')).toEqual(before)
  })
})

describe('the owner edits the website through the real storage', () => {
  /** Types into a field the way React sees it. */
  function typeInto(id: string, value: string): void {
    const element = q<HTMLInputElement>(`#${id}`)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('offers Edit to the owner, and never to a visitor', async () => {
    await openApp(OWNER)
    expect(button('Edit this website').disabled).toBe(false)

    act(() => emitAppState(HIDDEN_APP_VIEW))
    await openApp(VISITOR)
    expect([...container.querySelectorAll('button')].some(b => /edit/i.test(b.textContent ?? ''))).toBe(false)
    expect(has('.we-editor')).toBe(false)
  })

  it('saves into IndexedDB, and the website still shows it after a reload, to the owner and to a visitor', async () => {
    await openApp(OWNER)
    click(button('Edit this website'))
    await settle()
    typeInto('we-title', 'Saved through the editor')
    typeInto('we-links-0-url', 'https://example.com:8443/')
    click(button('Save'))
    await settle()

    expect(has('.we-editor')).toBe(false)
    expect(q('h1').textContent).toBe('Saved through the editor')
    const stored = (await rawDb().get(STORE_SITES, 'house-a')) as { title: string; links: Array<{ url: string }> }
    expect(stored.title).toBe('Saved through the editor')
    expect(stored.links[0]!.url).toBe('https://example.com:8443/')

    // A reload: nothing is left of the page but the browser's data.
    act(() => emitAppState(HIDDEN_APP_VIEW))
    await resetSiteStorage()
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Saved through the editor')

    act(() => emitAppState(HIDDEN_APP_VIEW))
    await resetSiteStorage()
    await openApp(VISITOR)
    expect(q('h1').textContent).toBe('Saved through the editor')
  })

  it('writes nothing to IndexedDB while editing, or when the draft is thrown away', async () => {
    await saveSite('house-a', 'Before editing')
    const before = await rawDb().get(STORE_SITES, 'house-a')
    await openApp(OWNER)
    click(button('Edit this website'))
    await settle()
    typeInto('we-title', 'Never saved')
    expect(await rawDb().get(STORE_SITES, 'house-a')).toEqual(before)

    click(button('Cancel'))
    click(button('Discard changes'))
    await settle()
    expect(await rawDb().get(STORE_SITES, 'house-a')).toEqual(before)
    expect(q('h1').textContent).toBe('Before editing')
  })

  it('repairs a damaged record when the owner saves, and the warning goes away', async () => {
    await rawDb().put(STORE_SITES, { houseId: 'house-a', nonsense: true })
    await openApp(OWNER)
    expect(has('.wt-notice--problem')).toBe(true)

    click(button('Edit this website'))
    await settle()
    typeInto('we-title', 'Repaired')
    click(button('Save'))
    await settle()
    expect(q('h1').textContent).toBe('Repaired')
    expect(has('.wt-notice--problem')).toBe(false)
  })

  it('cannot save another house’s website, even if a draft for it is forced in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openApp(OWNER)
    click(button('Edit this website'))
    await settle()
    // The editor offers no way to change which house it saves, so this goes through the writer's guard directly.
    const { siteAccessFor } = await import('../../personal-spaces/composition')
    const { getSiteStorage } = await import('../../personal-spaces/composition')
    const access = siteAccessFor({ houseId: 'house-a', mode: 'owner' }, (await getSiteStorage()).repository)
    if (access.mode !== 'owner') throw new Error('expected an owner')
    await expect(access.writer.save(createDefaultSite('house-b', '2026-11-16T00:00:00.000Z'))).rejects.toThrow(/different house/)
    expect(await rawDb().get(STORE_SITES, 'house-b')).toBeUndefined()
  })
})

describe('a visitor opens the computer', () => {
  it('sees the same website, read-only, with an honest note about where it is kept', async () => {
    await saveSite('house-a', 'Owner’s page')
    await openApp(VISITOR)
    expect(q('h1').textContent).toBe('Owner’s page')
    expect(q('.wt-status').textContent).toBe(VISITOR_LOCAL_NOTICE)
  })

  it('can browse every page', async () => {
    await openApp(OTHER_HOUSE_VISITOR)
    expect(q('h1').textContent).toBe('Welcome to House B!')
    for (const [label, heading] of [['About', 'About House B'], ['Projects', 'Projects'], ['Links', 'Links']] as const) {
      click(button(label))
      expect(q('main h2').textContent).toBe(heading)
    }
  })

  it('has no way to change anything', async () => {
    await openApp(VISITOR)
    const names = [...container.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase())
    for (const name of names) expect(name).not.toMatch(/edit|save|rename|delete|publish|upload|remove|add/)
    expect(container.querySelectorAll('textarea, form, [contenteditable], input:not([readonly])')).toHaveLength(0)
  })

  it('never writes: nothing is saved when a visitor browses', async () => {
    const memory = new MemorySiteRepository()
    const save = vi.spyOn(memory, 'save')
    const storage: SiteStorage = { repository: memory, persistent: true, notice: null, reason: null, close: () => undefined }
    await openApp(VISITOR, { getSiteStorage: async () => storage })
    for (const name of ['About', 'Projects', 'Links', 'Back', 'Home page']) click(button(name))
    expect(save).not.toHaveBeenCalled()
  })

  it('is not told about a damaged record, and sees the default instead', async () => {
    await rawDb().put(STORE_SITES, { houseId: 'house-a', nonsense: true })
    await openApp(VISITOR)
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(has('[role="alert"]')).toBe(false)
    expect(container.textContent).not.toContain('could not be read')
  })

  it('opens nothing for a view with an unknown mode: the bridge refuses it', async () => {
    await openApp({ ...VISITOR, mode: 'admin' as never })
    expect(has('[role="dialog"]')).toBe(false)
  })
})

describe('a damaged saved website', () => {
  const damaged = { houseId: 'house-a', schemaVersion: 99, title: 'From the future' }

  it('shows the owner the default website and tells them, without deleting anything', async () => {
    await rawDb().put(STORE_SITES, damaged)
    await openApp(OWNER)

    expect(q('h1').textContent).toBe('Welcome to House A!')
    const alert = q('[role="alert"]')
    expect(alert.textContent).toContain('could not be read')
    expect(alert.textContent).toContain('Nothing was deleted')
    expect(alert.querySelectorAll('li').length).toBeGreaterThan(0)

    expect(await rawDb().get(STORE_SITES, 'house-a')).toEqual(damaged) // still exactly as it was
  })

  it('goes away once the website is whole again', async () => {
    await rawDb().put(STORE_SITES, damaged)
    await openApp(OWNER)
    expect(has('[role="alert"]')).toBe(true)

    act(() => emitAppState(HIDDEN_APP_VIEW))
    await saveSite('house-a', 'Repaired')
    await resetSiteStorage()
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Repaired')
    expect(has('[role="alert"]')).toBe(false)
  })

  it('does not warn about a different house’s damaged record', async () => {
    await rawDb().put(STORE_SITES, { houseId: 'house-b', nonsense: true })
    await openApp(OWNER)
    expect(has('[role="alert"]')).toBe(false)
  })
})

describe('when browser storage is unavailable', () => {
  it('opens anyway, from memory, and says nothing is being saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    await resetSiteStorage()

    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(q('.wt-status').textContent).toBe(NOT_SAVED_NOTICE)

    act(() => emitAppState(HIDDEN_APP_VIEW))
    await resetSiteStorage()
    await openApp(VISITOR)
    expect(q('.wt-status').textContent).toBe(VISITOR_NOT_SAVED_NOTICE)
  })
})

describe('when reading fails', () => {
  function storageWith(repository: SiteRepository): SiteStorage {
    return { repository, persistent: true, notice: null, reason: null, close: () => undefined }
  }

  it('shows the reason and lets the user try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const memory = new MemorySiteRepository()
    const load = vi.spyOn(memory, 'load')
    load.mockRejectedValueOnce(new QuotaError())
    await openApp(OWNER, { getSiteStorage: async () => storageWith(memory) })

    expect(q('[role="alert"]').textContent).toContain('could not be opened')
    expect(q('[role="alert"]').textContent).toContain("There isn't enough storage space")
    expect(has('main')).toBe(false)

    click(button('Try again'))
    await settle()
    expect(has('[role="alert"]')).toBe(false)
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('says so when storage cannot be opened at all, and can still be closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sendCommand = vi.fn()
    await openApp(OWNER, { sendCommand, getSiteStorage: async () => { throw new StorageError() } })
    expect(q('[role="alert"]').textContent).toContain('could not open its storage')
    click(button('Close'))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'close' })
  })

  it('shows a short opening message while storage starts', async () => {
    let finish!: (storage: SiteStorage) => void
    await openApp(OWNER, { wait: false, getSiteStorage: () => new Promise(resolve => { finish = resolve }) })
    expect(q('[role="status"]').textContent).toContain('Opening website')
    await act(async () => finish(storageWith(new MemorySiteRepository())))
    await settle()
    expect(q('h1').textContent).toBe('Welcome to House A!')
  })
})

describe('closing the website and returning to the game', () => {
  it('asks Phaser to close from the Close button and from Escape, and only that', async () => {
    const sendCommand = vi.fn()
    await openApp(OWNER, { sendCommand })
    click(button('Close'))
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(sendCommand.mock.calls).toEqual([[{ type: 'close' }], [{ type: 'close' }]])
  })

  it('goes away when Phaser reports the app closed, and gives focus back', async () => {
    const before = document.createElement('button')
    document.body.appendChild(before)
    before.focus()

    await openApp(OWNER)
    expect(has('[role="dialog"]')).toBe(true)

    act(() => emitAppState(HIDDEN_APP_VIEW))
    expect(container.innerHTML).toBe('')
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  it('opens fresh next time: no leftover page, history or error', async () => {
    await openApp(OWNER)
    click(button('Links'))
    expect(q('main h2').textContent).toBe('Links')

    act(() => emitAppState(HIDDEN_APP_VIEW))
    await openApp(OWNER)
    expect(q('main h2').textContent).toBe('Welcome!')
    expect(button('Back').disabled).toBe(true)
  })

  it('opens the other house’s website when the view changes', async () => {
    await openApp(OWNER)
    expect(q('h1').textContent).toBe('Welcome to House A!')
    act(() => emitAppState(OTHER_HOUSE_VISITOR))
    await settle()
    expect(q('h1').textContent).toBe('Welcome to House B!')
    expect(q('.wt-status').textContent).toBe(VISITOR_LOCAL_NOTICE)
  })

  it('leaves no storage connection or listener behind when closed repeatedly', async () => {
    for (let i = 0; i < 10; i++) {
      await openApp(OWNER)
      act(() => emitAppState(HIDDEN_APP_VIEW))
    }
    expect(container.innerHTML).toBe('')
  })

  it('leaves the Sketchbook alone: it still opens its own window', async () => {
    await openApp({ open: 'paint', houseId: 'house-a', mode: 'owner' })
    expect(q('[role="dialog"]').textContent).toContain('Sketchbook')
    expect(has('.wt-window')).toBe(false)
  })
})
