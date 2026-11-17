import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { HIDDEN_APP_VIEW, emitAppState, onAppState, type AppView } from '../lib/app-bridge'
import { PermissionError } from './errors'
import {
  LOCAL_ONLY_LABEL,
  NOT_SAVED_NOTICE,
  createSiteStorage,
  getSiteStorage,
  resetSiteStorage,
  siteAccessFor,
  type OwnerSiteAccess,
  type SiteAccess,
  type VisitorSiteAccess,
} from './composition'
import { domError, faultyFactory } from './storage/fault-injection.test-support'
import { MemorySiteRepository } from './site-storage/memory-site-repository'
import { createDefaultSite } from './website/default-site'
import type { SiteReader, SiteWriter } from './website/site-repository'
import type { SiteContent } from './website/site-types'

const newFactory = (): IDBFactory => new IDBFactory() as unknown as IDBFactory
const site = (houseId: string, title = 'T'): SiteContent => ({
  ...createDefaultSite(houseId, '2026-11-16T00:00:00.000Z'),
  title,
})

afterEach(async () => {
  await resetSiteStorage()
  vi.restoreAllMocks()
})

describe('createSiteStorage', () => {
  it('uses IndexedDB when it works, and says nothing is wrong', async () => {
    const storage = await createSiteStorage({ factory: newFactory() })
    expect(storage.persistent).toBe(true)
    expect(storage.notice).toBeNull()
    expect(storage.reason).toBeNull()
    storage.close()
  })

  it('saves and reloads through it', async () => {
    const factory = newFactory()
    const first = await createSiteStorage({ factory })
    await first.repository.save(site('house-a', 'Kept'))
    first.close()

    const second = await createSiteStorage({ factory })
    expect((await second.repository.load('house-a')).title).toBe('Kept')
    second.close()
  })

  it('falls back to memory, and says content is not saved, when the browser has no IndexedDB', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const storage = await createSiteStorage() // jsdom has none
    expect(storage.persistent).toBe(false)
    expect(storage.notice).toBe(NOT_SAVED_NOTICE)
    expect(storage.notice).toContain('lost')
    expect(storage.reason).toBeInstanceOf(Error)

    await storage.repository.save(site('house-a', 'Session only'))
    expect((await storage.repository.load('house-a')).title).toBe('Session only')
  })

  it('falls back when the browser refuses storage (private browsing)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const faulty = faultyFactory(newFactory())
    faulty.faults.openThrows = domError('SecurityError')
    const storage = await createSiteStorage({ factory: faulty.factory })
    expect(storage.persistent).toBe(false)
    expect(storage.reason?.message).toContain('private browsing')
    expect(storage.repository).toBeInstanceOf(MemorySiteRepository)
  })

  it('falls back when another tab blocks the database for too long', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const faulty = faultyFactory(newFactory())
    faulty.faults.blocked = { thenOpenAfterMs: null }
    const storage = await createSiteStorage({ factory: faulty.factory, blockedTimeoutMs: 15 })
    expect(storage.persistent).toBe(false)
    expect(storage.reason?.message).toContain('other tab')
  })

  it('logs why it fell back, so a developer can see it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await createSiteStorage()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('passes the clock and the load observer to the repository', async () => {
    const reports: string[] = []
    const storage = await createSiteStorage({
      factory: newFactory(),
      now: () => '2030-01-01T00:00:00.000Z',
      onLoad: report => reports.push(report.origin),
    })
    const loaded = await storage.repository.load('house-z')
    expect(loaded.updatedAt).toBe('2030-01-01T00:00:00.000Z')
    expect(reports).toEqual(['default'])
    storage.close()
  })

  it('opens the shared storage once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const [a, b] = await Promise.all([getSiteStorage(), getSiteStorage()])
    expect(a).toBe(b)
  })

  it('states honestly that saved content is local to this device', () => {
    expect(LOCAL_ONLY_LABEL).toBe('Saved on this device only')
  })
})

describe('siteAccessFor: what each kind of player is handed', () => {
  const repository = (): MemorySiteRepository => new MemorySiteRepository()

  it('gives a visitor a reader and nothing that can write', async () => {
    const access = siteAccessFor({ houseId: 'house-b', mode: 'visitor' }, repository())
    expect(access.mode).toBe('visitor')
    expect(Object.keys(access).sort()).toEqual(['mode', 'reader'])
    expect('writer' in access).toBe(false)

    expect(Object.keys(access.reader)).toEqual(['load'])
    expect('save' in access.reader).toBe(false)
    expect((access.reader as unknown as { save?: unknown }).save).toBeUndefined()
  })

  it('lets a visitor read any house, including the owner’s', async () => {
    const repo = repository()
    await repo.save(site('house-a', 'Owner’s page'))
    const access = siteAccessFor({ houseId: 'house-b', mode: 'visitor' }, repo)
    expect((await access.reader.load('house-a')).title).toBe('Owner’s page')
    expect((await access.reader.load('house-b')).houseId).toBe('house-b')
  })

  it('hands a visitor read-only data', async () => {
    const access = siteAccessFor({ houseId: 'house-b', mode: 'visitor' }, repository())
    const loaded = await access.reader.load('house-a')
    expect(() => { (loaded as unknown as { title: string }).title = 'x' }).toThrow(TypeError)
  })

  it('does not hand a visitor the repository itself', () => {
    const repo = repository()
    const access = siteAccessFor({ houseId: 'house-b', mode: 'visitor' }, repo)
    expect(access.reader).not.toBe(repo)
    expect(Object.values(access)).not.toContain(repo)
  })

  it('gives an owner a writer that saves their own house', async () => {
    const repo = repository()
    const access = siteAccessFor({ houseId: 'house-a', mode: 'owner' }, repo)
    expect(access.mode).toBe('owner')
    if (access.mode !== 'owner') throw new Error('expected an owner')

    await access.writer.save(site('house-a', 'Saved by owner'))
    expect((await access.reader.load('house-a')).title).toBe('Saved by owner')
    expect((await repo.load('house-a')).title).toBe('Saved by owner')
  })

  it('stops an owner saving into a different house', async () => {
    const repo = repository()
    const access = siteAccessFor({ houseId: 'house-a', mode: 'owner' }, repo)
    if (access.mode !== 'owner') throw new Error('expected an owner')

    await expect(access.writer.save(site('house-b', 'Not yours'))).rejects.toBeInstanceOf(PermissionError)
    expect((await repo.load('house-b')).title).toBe('Welcome to House B!')
  })

  it('lets an owner read other houses, read-only', async () => {
    const repo = repository()
    await repo.save(site('house-b', 'Neighbour'))
    const access = siteAccessFor({ houseId: 'house-a', mode: 'owner' }, repo)
    expect((await access.reader.load('house-b')).title).toBe('Neighbour')
    expect('save' in access.reader).toBe(false)
  })

  it.each(['admin', 'OWNER', '', undefined, null])('treats the unknown mode %j as a visitor', mode => {
    const access = siteAccessFor({ houseId: 'house-a', mode: mode as never }, repository())
    expect(access.mode).toBe('visitor')
    expect('writer' in access).toBe(false)
  })

  it('takes the mode straight from the app bridge, with no second ownership check', async () => {
    const received: AppView[] = []
    const stop = onAppState(view => received.push(view))
    emitAppState({ open: 'website', houseId: 'house-b', mode: 'visitor' })
    emitAppState({ open: 'website', houseId: 'house-a', mode: 'owner' })
    emitAppState(HIDDEN_APP_VIEW)
    stop()

    const [asVisitor, asOwner, hidden] = received.map(view => siteAccessFor(view, repository()))
    expect(asVisitor!.mode).toBe('visitor')
    expect(asOwner!.mode).toBe('owner')
    expect(hidden!.mode).toBe('visitor') // the bridge's hidden view grants nothing
  })

  it('is typed so a visitor has no way to write', () => {
    expectTypeOf<VisitorSiteAccess>().toEqualTypeOf<{ mode: 'visitor'; reader: SiteReader }>()
    expectTypeOf<OwnerSiteAccess>().toEqualTypeOf<{ mode: 'owner'; reader: SiteReader; writer: SiteWriter }>()
    expectTypeOf<keyof VisitorSiteAccess>().not.toExtend<'writer'>()
    expectTypeOf<SiteAccess>().toEqualTypeOf<VisitorSiteAccess | OwnerSiteAccess>()

    // Narrowing on `mode` is what separates the two.
    const check = (access: SiteAccess): SiteWriter | null => (access.mode === 'owner' ? access.writer : null)
    expect(typeof check).toBe('function')
  })
})
