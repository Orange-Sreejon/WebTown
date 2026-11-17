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

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function openApp(
  view: AppView,
  props: { sendCommand?: (c: AppCommand) => void; getSiteStorage?: () => Promise<SiteStorage> } = {},
): Promise<void> {
  act(() => root.render(<AppHost sendCommand={props.sendCommand ?? vi.fn()} {...(props.getSiteStorage ? { getSiteStorage: props.getSiteStorage } : {})} />))
  act(() => emitAppState(view))
  await settle()
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
    await openApp(OWNER, { getSiteStorage: () => new Promise(resolve => { finish = resolve }) })
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
