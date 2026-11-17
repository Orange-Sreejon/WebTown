import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalSpacesError, QuotaError, StorageError, ValidationError } from '../errors'
import { domError, faultyFactory } from '../storage/fault-injection.test-support'
import { IdbDatabase } from '../storage/idb'
import { STORE_SITES, WEBTOWN_DB } from '../storage/webtown-db'
import { createDefaultSite } from '../website/default-site'
import { IndexedDbSiteRepository } from './indexeddb-site-repository'
import type { SiteLoadReport } from './site-record'
import { describeSiteRepositoryContract, steppingClock } from './site-repository.contract'

const newFactory = (): IDBFactory => new IDBFactory() as unknown as IDBFactory

const open: IdbDatabase[] = []
function connect(factory: IDBFactory): IdbDatabase {
  const db = new IdbDatabase(WEBTOWN_DB, { factory, blockedTimeoutMs: 30 })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

const site = (houseId: string, title: string) => ({ ...createDefaultSite(houseId, '2026-11-16T00:00:00.000Z'), title })

describeSiteRepositoryContract('IndexedDbSiteRepository', {
  async create(now) {
    const reports: SiteLoadReport[] = []
    const db = connect(newFactory())
    const repository = new IndexedDbSiteRepository(db, { now, onLoad: report => reports.push(report) })
    return { repository, reports, seedUnchecked: (houseId, raw) => db.put(STORE_SITES, raw === undefined ? { houseId } : withKey(houseId, raw)) }
  },
})

/** Puts a raw value in the store under `houseId`, even when it is not an object that can carry the key. */
function withKey(houseId: string, raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return { ...(raw as object), houseId }
  // The store's key comes from the record's `houseId`; a non-object cannot hold one.
  // Wrap it so the damaged value is still what the repository finds under that key.
  return { houseId, __damaged: raw }
}

describe('IndexedDbSiteRepository: persistence', () => {
  it('keeps a website across a reload', async () => {
    const factory = newFactory()
    const before = new IndexedDbSiteRepository(connect(factory), { now: steppingClock() })
    const saved = await before.save(site('house-a', 'Still here'))
    open.splice(0).forEach(db => db.close()) // the page is gone

    const after = new IndexedDbSiteRepository(connect(factory), { now: steppingClock() })
    expect(await after.load('house-a')).toEqual(saved)
  })

  it('keeps every house’s website across a reload, independently', async () => {
    const factory = newFactory()
    const before = new IndexedDbSiteRepository(connect(factory), { now: steppingClock() })
    await before.save(site('house-a', 'Alpha'))
    await before.save(site('house-b', 'Beta'))
    open.splice(0).forEach(db => db.close())

    const after = new IndexedDbSiteRepository(connect(factory), { now: steppingClock() })
    expect((await after.load('house-a')).title).toBe('Alpha')
    expect((await after.load('house-b')).title).toBe('Beta')
    expect((await after.load('house-c')).title).toBe('Welcome to House C!')
  })

  it('shows an update after a reload, not the older version', async () => {
    const factory = newFactory()
    const first = new IndexedDbSiteRepository(connect(factory), { now: steppingClock() })
    await first.save(site('house-a', 'One'))
    await first.save(site('house-a', 'Two'))
    open.splice(0).forEach(db => db.close())
    expect((await new IndexedDbSiteRepository(connect(factory)).load('house-a')).title).toBe('Two')
  })

  it('is a different store from a different browser: nothing is shared', async () => {
    const here = new IndexedDbSiteRepository(connect(newFactory()), { now: steppingClock() })
    const elsewhere = new IndexedDbSiteRepository(connect(newFactory()), { now: steppingClock() })
    await here.save(site('house-a', 'Only here'))
    expect((await elsewhere.load('house-a')).title).toBe('Welcome to House A!')
  })

  it('writes the cleaned record to the store, not the caller’s object', async () => {
    const db = connect(newFactory())
    const repository = new IndexedDbSiteRepository(db, { now: steppingClock() })
    const input = site('house-a', '  padded  ')
    await repository.save(input)

    const raw = (await db.get(STORE_SITES, 'house-a')) as { title: string; updatedAt: string; houseId: string }
    expect(raw.title).toBe('padded')
    expect(raw.houseId).toBe('house-a')
    expect(raw.updatedAt.startsWith('2026-11-16T12:00:')).toBe(true)
    expect(input.title).toBe('  padded  ') // the caller's object is untouched
  })
})

describe('IndexedDbSiteRepository: errors and recovery', () => {
  it('reports a full disk, keeps the previous website, and recovers', async () => {
    const faulty = faultyFactory(newFactory())
    const repository = new IndexedDbSiteRepository(connect(faulty.factory), { now: steppingClock() })
    await repository.save(site('house-a', 'Old'))

    faulty.faults.nextTransaction = { kind: 'fail', error: domError('QuotaExceededError') }
    const error = await repository.save(site('house-a', 'New')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(QuotaError)

    expect((await repository.load('house-a')).title).toBe('Old')
    await repository.save(site('house-a', 'Newer'))
    expect((await repository.load('house-a')).title).toBe('Newer')
  })

  it('reports a failed load as a storage error', async () => {
    const faulty = faultyFactory(newFactory())
    const repository = new IndexedDbSiteRepository(connect(faulty.factory), { now: steppingClock() })
    await repository.load('house-a')

    faulty.faults.nextTransaction = { kind: 'fail', error: domError('UnknownError') }
    const error = await repository.load('house-a').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect((await repository.load('house-a')).houseId).toBe('house-a')
  })

  it('refuses invalid data before touching the database', async () => {
    const faulty = faultyFactory(newFactory())
    const repository = new IndexedDbSiteRepository(connect(faulty.factory), { now: steppingClock() })
    faulty.faults.nextTransaction = { kind: 'throw', error: domError('UnknownError') } // would fail any write
    const error = await repository.save({ ...site('house-a', ''), title: '' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    // The fault was never used, so it is still waiting for the next real database call.
    expect(faulty.faults.nextTransaction).toBeDefined()
  })

  it('reopens by itself when the browser closed the connection', async () => {
    const faulty = faultyFactory(newFactory())
    const repository = new IndexedDbSiteRepository(connect(faulty.factory), { now: steppingClock() })
    await repository.save(site('house-a', 'Saved'))
    faulty.opened[0]!.close()
    expect((await repository.load('house-a')).title).toBe('Saved')
    await repository.save(site('house-a', 'Saved again'))
    expect((await repository.load('house-a')).title).toBe('Saved again')
  })

  it('rejects with errors the interface can read, never a raw browser error', async () => {
    const faulty = faultyFactory(newFactory())
    const repository = new IndexedDbSiteRepository(connect(faulty.factory), { now: steppingClock() })
    for (const name of ['QuotaExceededError', 'AbortError', 'UnknownError', 'DataError']) {
      faulty.faults.nextTransaction = { kind: 'fail', error: domError(name) }
      const error = await repository.save(site('house-a', 'x')).catch((e: unknown) => e)
      expect(error, name).toBeInstanceOf(PersonalSpacesError)
      expect((error as PersonalSpacesError).message.length).toBeGreaterThan(10)
    }
  })
})
