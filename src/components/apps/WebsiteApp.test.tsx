import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_APP_VIEW, emitAppState, type AppCommand, type AppView } from '../../lib/app-bridge'
import { createSiteStorage, resetSiteStorage, type SiteStorage } from '../../personal-spaces/composition'
import { StorageError } from '../../personal-spaces/errors'
import { NOT_SAVED_NOTICE, VISITOR_LOCAL_NOTICE, VISITOR_NOT_SAVED_NOTICE } from '../../personal-spaces/labels'
import { blankProject } from '../../personal-spaces/site-project/templates'
import { IdbDatabase } from '../../personal-spaces/storage/idb'
import { STORE_SITE_PROJECTS, STORE_SITES, WEBTOWN_DB } from '../../personal-spaces/storage/webtown-db'
import { createDefaultSite } from '../../personal-spaces/website/default-site'
import '../website-studio/codemirror-jsdom.test-support'
import { AppHost } from './AppHost'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The website window as the game uses it: opened by an app-bridge message,
 * through the real storage wiring (`getSiteStorage`, IndexedDB), told who the
 * player is only by the bridge's `mode`. jsdom does not load the sandbox host
 * page, so what the page looks like is checked in the browser tests
 * (tests/e2e); here it is the window, the data and who may do what.
 */

const OWNER: AppView = { open: 'website', houseId: 'house-a', mode: 'owner' }
const VISITOR: AppView = { open: 'website', houseId: 'house-a', mode: 'visitor' }

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

/** Lets storage open, the owner's window load on demand, and the website load. */
const settle = async (): Promise<void> => {
  let quiet = 0
  let last = ''
  for (let i = 0; i < 100 && quiet < 4; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    const now = container.innerHTML
    const busy = /Opening website|Loading website|Saving\.\.\./.test(container.textContent ?? '')
    quiet = now === last && !busy ? quiet + 1 : 0
    last = now
  }
}

async function openApp(view: AppView, props: { sendCommand?: (c: AppCommand) => void; getSiteStorage?: () => Promise<SiteStorage> } = {}): Promise<void> {
  act(() => root.render(<AppHost sendCommand={props.sendCommand ?? vi.fn()} {...(props.getSiteStorage ? { getSiteStorage: props.getSiteStorage } : {})} />))
  act(() => emitAppState(view))
  await settle()
}

const text = (): string => container.textContent ?? ''
const findButton = (name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(b =>
    b.getAttribute('aria-label') === name || b.textContent?.trim() === name || b.querySelector('strong')?.textContent === name)
const button = (name: string): HTMLButtonElement => {
  const found = findButton(name)
  if (!found) throw new Error(`no button "${name}" in: ${text().slice(0, 300)}`)
  return found
}
const click = async (el: HTMLElement): Promise<void> => {
  act(() => el.click())
  await settle()
}

function rawDb(): IdbDatabase {
  const db = new IdbDatabase(WEBTOWN_DB, { factory })
  connections.push(db)
  return db
}

async function seedProject(houseId: string, change: Record<string, unknown> = {}): Promise<void> {
  const storage = await createSiteStorage({ factory })
  await storage.projects.save({ project: { ...blankProject(houseId, '2026-11-16T00:00:00.000Z'), ...change }, baseRevision: 0, putAssets: [], deleteAssetIds: [] })
  storage.close()
}

async function seedLegacy(houseId: string, title: string): Promise<void> {
  const storage = await createSiteStorage({ factory })
  await storage.repository.save({ ...createDefaultSite(houseId, '2026-11-01T00:00:00.000Z'), title })
  storage.close()
}

describe('a visitor', () => {
  it('sees "nothing here yet" when the owner has not made a website, and nothing that builds one', async () => {
    await openApp(VISITOR)
    expect(text()).toContain('Nothing here yet')
    expect(findButton('Blank website')).toBeUndefined()
    expect(findButton('Open Site Studio')).toBeUndefined()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('sees the saved website in the sandboxed frame, with a display-only address', async () => {
    await seedProject('house-a', { title: 'Zine' })
    await openApp(VISITOR)
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toMatch(/\/site-host\.html$/)
    const address = container.querySelector<HTMLInputElement>('#wt-address-field')!
    expect(address.value).toBe('webtown://house-a/index.html')
    expect(address.readOnly).toBe(true)
    expect(findButton('Open Site Studio')).toBeUndefined()
    expect(container.querySelector('.wt-status')!.textContent).toBe(VISITOR_LOCAL_NOTICE)
  })

  it("sees an owner's earlier website, converted, without anything being written", async () => {
    await seedLegacy('house-a', 'Old corner')
    await openApp(VISITOR)
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(text()).not.toContain('turned into HTML')
    expect(await rawDb().getAll(STORE_SITE_PROJECTS)).toEqual([])
  })

  it('is told when browser storage is unavailable and the website is only in memory', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    // The owner builds a website in this tab; it lives in memory only.
    await openApp(OWNER)
    await click(button('Blank website'))
    await click(button('Save'))
    act(() => emitAppState(HIDDEN_APP_VIEW))
    await openApp(VISITOR)
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.querySelector('.wt-status')!.textContent).toBe(VISITOR_NOT_SAVED_NOTICE)
  })
})
describe('the owner', () => {
  it('is offered Blank or Classic when there is nothing yet, and builds and saves a website', async () => {
    await openApp(OWNER)
    expect(text()).toContain('Nothing here yet')
    expect(text()).toContain('Build your website')
    await click(button('Blank website'))

    expect(text()).toContain('Site Studio')
    expect(text()).toContain('Not saved yet')
    expect(text()).toContain('index.html')
    expect(text()).toContain('style.css')
    await click(button('Save'))
    expect(text()).toContain('Saved on this device only.')

    const stored = await rawDb().get(STORE_SITE_PROJECTS, 'house-a') as { revision: number; origin: { kind: string } }
    expect(stored.revision).toBe(1)
    expect(stored.origin.kind).toBe('blank')

    await click(button('Exit'))
    expect(findButton('Open Site Studio')).toBeDefined()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('can start from the classic homepage', async () => {
    await openApp(OWNER)
    await click(button('Classic personal homepage'))
    for (const page of ['index.html', 'about.html', 'projects.html', 'links.html']) expect(text()).toContain(page)
  })

  it('opens an earlier website converted, and saving keeps the earlier record untouched', async () => {
    await seedLegacy('house-a', 'Old corner')
    const before = await rawDb().get(STORE_SITES, 'house-a')
    await openApp(OWNER)
    expect(text()).toContain('turned into HTML and CSS')
    await click(button('Open Site Studio'))
    expect(text()).toContain('Not saved yet')
    expect(container.querySelector<HTMLInputElement>('.ws-field input')!.value).toBe('Old corner')
    await click(button('Save'))
    const stored = await rawDb().get(STORE_SITE_PROJECTS, 'house-a') as { origin: { kind: string }; pages: unknown[] }
    expect(stored.origin.kind).toBe('migrated')
    expect(stored.pages).toHaveLength(4)
    expect(await rawDb().get(STORE_SITES, 'house-a')).toEqual(before)
  })

  it('reopens a saved website in the Studio, clean', async () => {
    await seedProject('house-a', { css: 'body { display: grid }' })
    await openApp(OWNER)
    await click(button('Open Site Studio'))
    expect(text()).toContain('Saved')
    expect(button('Save').disabled).toBe(true)
  })

  it('asks before closing the Studio with unsaved changes', async () => {
    const sendCommand = vi.fn()
    await openApp(OWNER, { sendCommand })
    await click(button('Blank website'))
    await click(button('Close'))
    expect(text()).toContain('Leave without saving?')
    expect(sendCommand).not.toHaveBeenCalled()
    await click(button('Keep editing'))
    expect(text()).toContain('Site Studio')
    await click(button('Close'))
    await click(button('Leave without saving'))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'close' })
  })

  it('is told saves last only for this tab when storage is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    await openApp(OWNER)
    await click(button('Blank website'))
    expect(text()).toContain(NOT_SAVED_NOTICE)
    await click(button('Save'))
    expect(text()).toContain('Saved for this tab only')
  })

  it("never sees another house's website as theirs", async () => {
    await seedProject('house-b', { title: 'B site' })
    await openApp(OWNER)
    expect(text()).toContain('Nothing here yet')
  })
})

describe('when storage cannot be opened at all', () => {
  it('says so and does not crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openApp(OWNER, { getSiteStorage: () => Promise.reject(new StorageError()) })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('could not open its storage')
  })
})
