import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_ONLY_LABEL,
  NOT_SAVED_NOTICE,
  createSiteStorage,
  getSiteStorage,
  resetSiteStorage,
} from './composition'
import { domError, faultyFactory } from './storage/fault-injection.test-support'
import { MemorySiteRepository } from './site-storage/memory-site-repository'
import { createDefaultSite } from './website/default-site'
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
