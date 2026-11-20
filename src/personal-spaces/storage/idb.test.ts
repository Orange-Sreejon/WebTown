import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PersonalSpacesError,
  QuotaError,
  StorageBlockedError,
  StorageError,
  StorageUnavailableError,
} from '../errors'
import { IdbDatabase, mapIdbError, type DatabaseSpec } from './idb'
import { domError, faultyFactory } from './fault-injection.test-support'
import {
  DB_NAME,
  DB_VERSION,
  INDEX_ARTWORKS_BY_HOUSE,
  INDEX_SITE_ASSETS_BY_HOUSE,
  STORE_ARTWORKS,
  STORE_SITE_ASSETS,
  STORE_SITE_PROJECTS,
  STORE_SITES,
  WEBTOWN_DB,
} from './webtown-db'

const newFactory = (): IDBFactory => new IDBFactory() as unknown as IDBFactory

const opened: IdbDatabase[] = []
function database(factory: IDBFactory, spec: DatabaseSpec = WEBTOWN_DB, blockedTimeoutMs = 30): IdbDatabase {
  const db = new IdbDatabase(spec, { factory, blockedTimeoutMs })
  opened.push(db)
  return db
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close()
  vi.restoreAllMocks()
})

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

describe('the WebTown database', () => {
  it('creates the site and drawing stores, and the per-house drawing index', async () => {
    const factory = newFactory()
    await database(factory).ready()

    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION)
      request.onsuccess = (): void => resolve(request.result)
      request.onerror = (): void => reject(request.error)
    })
    expect([...raw.objectStoreNames].sort()).toEqual([STORE_ARTWORKS, STORE_SITES, STORE_SITE_PROJECTS, STORE_SITE_ASSETS].sort())
    const transaction = raw.transaction(STORE_ARTWORKS)
    expect([...transaction.objectStore(STORE_ARTWORKS).indexNames]).toEqual([INDEX_ARTWORKS_BY_HOUSE])
    expect(transaction.objectStore(STORE_ARTWORKS).keyPath).toBe('id')
    expect(raw.transaction(STORE_SITES).objectStore(STORE_SITES).keyPath).toBe('houseId')
    raw.close()
  })
})

describe('reading and writing', () => {
  it('stores, reads, replaces and deletes a record', async () => {
    const db = database(newFactory())
    expect(await db.get(STORE_SITES, 'house-a')).toBeUndefined()

    await db.put(STORE_SITES, { houseId: 'house-a', title: 'One' })
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'One' })

    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Two' })
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Two' })

    await db.delete(STORE_SITES, 'house-a')
    expect(await db.get(STORE_SITES, 'house-a')).toBeUndefined()
  })

  it('returns every record from a store', async () => {
    const db = database(newFactory())
    await db.put(STORE_SITES, { houseId: 'house-a' })
    await db.put(STORE_SITES, { houseId: 'house-b' })
    const all = (await db.getAll(STORE_SITES)) as Array<{ houseId: string }>
    expect(all.map(r => r.houseId).sort()).toEqual(['house-a', 'house-b'])
  })

  it('keeps data across a reload (a new connection to the same database)', async () => {
    const factory = newFactory()
    const first = database(factory)
    await first.put(STORE_SITES, { houseId: 'house-a', title: 'Saved' })
    first.close()

    const second = database(factory)
    expect(await second.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Saved' })
  })

  it('does not share data between separate browsers (separate factories)', async () => {
    const one = database(newFactory())
    const other = database(newFactory())
    await one.put(STORE_SITES, { houseId: 'house-a' })
    expect(await other.get(STORE_SITES, 'house-a')).toBeUndefined()
  })

  it('hands back copies, so changing a result never changes the store', async () => {
    const db = database(newFactory())
    await db.put(STORE_SITES, { houseId: 'house-a', list: [1] })
    const got = (await db.get(STORE_SITES, 'house-a')) as { list: number[] }
    got.list.push(2)
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', list: [1] })
  })

  it('opens one connection for many calls made at once', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await Promise.all([db.get(STORE_SITES, 'a'), db.get(STORE_SITES, 'b'), db.put(STORE_SITES, { houseId: 'c' })])
    expect(faulty.openCalls()).toBe(1)
  })

  it('serialises writes in the order they were made', async () => {
    const db = database(newFactory())
    await Promise.all([
      db.put(STORE_SITES, { houseId: 'house-a', n: 1 }),
      db.put(STORE_SITES, { houseId: 'house-a', n: 2 }),
      db.put(STORE_SITES, { houseId: 'house-a', n: 3 }),
    ])
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', n: 3 })
  })

  it('refuses a write to a store that does not exist, without hanging', async () => {
    const db = database(newFactory())
    const error = await rejection(db.put('nope', { houseId: 'x' }))
    expect(error).toBeInstanceOf(StorageError)
  })

  it('refuses a record that cannot be stored, such as a function', async () => {
    const db = database(newFactory())
    const error = await rejection(db.put(STORE_SITES, { houseId: 'x', fn: () => 1 }))
    expect(error).toBeInstanceOf(StorageError)
  })
})

describe('storage that is not there', () => {
  it('reports a browser with no IndexedDB', async () => {
    expect(typeof indexedDB).toBe('undefined')
    const error = await rejection(new IdbDatabase(WEBTOWN_DB).ready())
    expect(error).toBeInstanceOf(StorageUnavailableError)
    expect((error as Error).message).toContain("doesn't support")
  })

  it('reports a browser that refuses to open it (private browsing)', async () => {
    const faulty = faultyFactory(newFactory())
    faulty.faults.openThrows = domError('SecurityError', 'The operation is insecure.')
    const error = await rejection(database(faulty.factory).ready())
    expect(error).toBeInstanceOf(StorageUnavailableError)
    expect((error as Error).message).toContain('private browsing')
    expect((error as PersonalSpacesError).cause).toBeInstanceOf(Error)
  })

  it('reports an open that fails with an error event', async () => {
    const faulty = faultyFactory(newFactory())
    faulty.faults.openError = domError('UnknownError', 'disk I/O')
    const error = await rejection(database(faulty.factory).ready())
    expect(error).toBeInstanceOf(StorageError)
  })

  it('says so when the saved data comes from a newer version', async () => {
    const factory = newFactory()
    await database(factory, { ...WEBTOWN_DB, version: DB_VERSION + 1, upgrade: WEBTOWN_DB.upgrade }).ready()
    const error = await rejection(database(factory).ready())
    expect(error).toBeInstanceOf(StorageUnavailableError)
    expect((error as Error).message).toContain('newer version')
  })

  it('can try again after a failed open', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    faulty.faults.openError = domError('UnknownError')
    await rejection(db.ready())

    faulty.faults.openError = undefined
    await db.put(STORE_SITES, { houseId: 'house-a' })
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a' })
  })
})

describe('blocked upgrades', () => {
  it('gives up with a clear message when another tab never lets go', async () => {
    const faulty = faultyFactory(newFactory())
    faulty.faults.blocked = { thenOpenAfterMs: null }
    const error = await rejection(database(faulty.factory, WEBTOWN_DB, 20).ready())
    expect(error).toBeInstanceOf(StorageBlockedError)
    expect((error as Error).message).toContain('other tab')
  })

  it('waits, and succeeds, if the other tab lets go in time', async () => {
    const faulty = faultyFactory(newFactory())
    faulty.faults.blocked = { thenOpenAfterMs: 10 }
    const db = database(faulty.factory, WEBTOWN_DB, 500)
    await db.ready()
    await db.put(STORE_SITES, { houseId: 'house-a' })
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a' })
  })

  it('closes a connection that arrives after it already gave up', async () => {
    const faulty = faultyFactory(newFactory())
    faulty.faults.blocked = { thenOpenAfterMs: 60 }
    const db = database(faulty.factory, WEBTOWN_DB, 15)
    expect(await rejection(db.ready())).toBeInstanceOf(StorageBlockedError)

    await new Promise(resolve => setTimeout(resolve, 120))
    // The late connection was opened and then closed again, not kept.
    expect(faulty.opened).toHaveLength(1)
    expect(() => faulty.opened[0]!.transaction(STORE_SITES)).toThrow()
  })
})

describe('a failed upgrade', () => {
  it('rejects and leaves no half-built database behind', async () => {
    const factory = newFactory()
    const broken: DatabaseSpec = {
      name: DB_NAME,
      version: 1,
      upgrade(db): void {
        db.createObjectStore(STORE_SITES, { keyPath: 'houseId' })
        throw new Error('upgrade bug')
      },
    }
    const error = await rejection(database(factory, broken).ready())
    expect(error).toBeInstanceOf(PersonalSpacesError)

    // A corrected version can still create the database from scratch.
    const good = database(factory)
    await good.put(STORE_SITES, { houseId: 'house-a' })
    expect(await good.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a' })
  })
})

describe('failed transactions', () => {
  it('reports a full disk as a quota error and keeps the old data', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Old' })

    faulty.faults.nextTransaction = { kind: 'fail', error: domError('QuotaExceededError') }
    const error = await rejection(db.put(STORE_SITES, { houseId: 'house-a', title: 'New' }))
    expect(error).toBeInstanceOf(QuotaError)
    expect((error as Error).message).toContain('storage space')

    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Old' })
  })

  it('also recognises Firefox’s name for a full disk', () => {
    expect(mapIdbError(domError('NS_ERROR_DOM_QUOTA_REACHED'))).toBeInstanceOf(QuotaError)
  })

  it('reports any other failed or aborted transaction as a storage error', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    faulty.faults.nextTransaction = { kind: 'fail', error: domError('AbortError') }
    const error = await rejection(db.put(STORE_SITES, { houseId: 'house-a' }))
    expect(error).toBeInstanceOf(StorageError)
    expect(error).not.toBeInstanceOf(QuotaError)
    expect((error as Error).message).toContain('try again')
  })

  it('recovers: a failed save does not stop later ones', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    faulty.faults.nextTransaction = { kind: 'fail', error: domError('QuotaExceededError') }
    await rejection(db.put(STORE_SITES, { houseId: 'house-a', title: 'Lost' }))

    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Kept' })
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Kept' })
  })

  it('keeps the browser’s original error for the console', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    const original = domError('QuotaExceededError', 'the disk is full')
    faulty.faults.nextTransaction = { kind: 'fail', error: original }
    const error = (await rejection(db.put(STORE_SITES, { houseId: 'x' }))) as PersonalSpacesError
    expect(error.cause).toBe(original)
  })

  it('refuses to hang if a transaction cannot even be started for another reason', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    faulty.faults.nextTransaction = { kind: 'throw', error: domError('NotFoundError') }
    expect(await rejection(db.get(STORE_SITES, 'x'))).toBeInstanceOf(StorageError)
  })
})

describe('a connection that goes away', () => {
  it('reopens once when the browser closed the connection', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Saved' })
    expect(faulty.openCalls()).toBe(1)

    faulty.opened[0]!.close() // the browser dropped it behind our back

    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Saved' })
    expect(faulty.openCalls()).toBe(2)
  })

  it('retries once on a closing connection', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Saved' })

    faulty.faults.nextTransaction = { kind: 'throw', error: domError('InvalidStateError') }
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Saved' })
    expect(faulty.openCalls()).toBe(2)
  })

  it('does not retry forever: a second closing connection is reported', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.ready()

    faulty.faults.transactionThrows = domError('InvalidStateError')
    const error = await rejection(db.get(STORE_SITES, 'house-a'))
    expect(error).toBeInstanceOf(StorageError)
    expect(faulty.openCalls()).toBe(2) // the first open, and exactly one retry

    faulty.faults.transactionThrows = undefined
    expect(await db.get(STORE_SITES, 'house-a')).toBeUndefined() // and it recovers afterwards
  })
  it('lets go when another tab wants to upgrade, and reopens afterwards', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Saved' })

    // The browser tells our connection another tab is upgrading.
    faulty.opened[0]!.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent)
    expect(() => faulty.opened[0]!.transaction(STORE_SITES)).toThrow() // we closed it

    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Saved' })
    expect(faulty.openCalls()).toBe(2)
  })

  it('reopens after an explicit close', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.put(STORE_SITES, { houseId: 'house-a' })
    db.close()
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a' })
    expect(faulty.openCalls()).toBe(2)
  })
})

describe('mapIdbError', () => {
  it('passes our own errors through unchanged', () => {
    const own = new QuotaError()
    expect(mapIdbError(own)).toBe(own)
  })

  it('maps unknown things to a storage error with the original attached', () => {
    const original = new Error('weird')
    const mapped = mapIdbError(original)
    expect(mapped).toBeInstanceOf(StorageError)
    expect(mapped.cause).toBe(original)
    expect(mapIdbError(null)).toBeInstanceOf(StorageError)
    expect(mapIdbError('text')).toBeInstanceOf(StorageError)
  })
})

describe('the version 2 upgrade', () => {
  it('adds the website project and asset stores and keeps version 1 data exactly', async () => {
    const factory = newFactory()
    // The schema exactly as version 1 shipped it.
    const v1 = database(factory, {
      name: DB_NAME,
      version: 1,
      upgrade(raw): void {
        raw.createObjectStore(STORE_SITES, { keyPath: 'houseId' })
        raw.createObjectStore(STORE_ARTWORKS, { keyPath: 'id' }).createIndex(INDEX_ARTWORKS_BY_HOUSE, 'houseId')
      },
    })
    await v1.put(STORE_SITES, { houseId: 'house-a', title: 'Old site' })
    await v1.put(STORE_ARTWORKS, { id: 'art-1', houseId: 'house-a' })
    v1.close()

    const v2 = database(factory)
    expect(await v2.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Old site' })
    expect(await v2.getAll(STORE_ARTWORKS)).toEqual([{ id: 'art-1', houseId: 'house-a' }])
    expect(await v2.getAll(STORE_SITE_PROJECTS)).toEqual([])
    await v2.put(STORE_SITE_ASSETS, { id: 'a1', houseId: 'house-a' })
    await v2.put(STORE_SITE_ASSETS, { id: 'b1', houseId: 'house-b' })
    expect(await v2.getAllByIndex(STORE_SITE_ASSETS, INDEX_SITE_ASSETS_BY_HOUSE, 'house-a')).toEqual([
      { id: 'a1', houseId: 'house-a' },
    ])
  })
})

describe('atomic transactions', () => {
  it('commits every write together and resolves with the value', async () => {
    const db = database(newFactory())
    const value = await db.atomic<string>([STORE_SITE_PROJECTS, STORE_SITE_ASSETS], (tx, done) => {
      tx.objectStore(STORE_SITE_PROJECTS).put({ houseId: 'house-a', revision: 1 })
      tx.objectStore(STORE_SITE_ASSETS).put({ id: 'a1', houseId: 'house-a' })
      done('ok')
    })
    expect(value).toBe('ok')
    expect(await db.get(STORE_SITE_PROJECTS, 'house-a')).toEqual({ houseId: 'house-a', revision: 1 })
    expect(await db.get(STORE_SITE_ASSETS, 'a1')).toEqual({ id: 'a1', houseId: 'house-a' })
  })

  it('rolls everything back when the body aborts', async () => {
    const db = database(newFactory())
    const error = await rejection(
      db.atomic([STORE_SITE_PROJECTS, STORE_SITE_ASSETS], (tx, _done, abort) => {
        tx.objectStore(STORE_SITE_ASSETS).put({ id: 'a1', houseId: 'house-a' })
        const read = tx.objectStore(STORE_SITE_PROJECTS).get('house-a')
        read.onsuccess = (): void => abort(new StorageError('stop'))
      }),
    )
    expect(error).toBeInstanceOf(StorageError)
    expect((error as Error).message).toBe('stop')
    expect(await db.get(STORE_SITE_ASSETS, 'a1')).toBeUndefined()
  })

  it('rolls everything back when one request fails', async () => {
    const db = database(newFactory())
    await db.put(STORE_SITE_ASSETS, { id: 'kept', houseId: 'house-a' })
    const error = await rejection(
      db.atomic([STORE_SITE_PROJECTS, STORE_SITE_ASSETS], (tx, done) => {
        tx.objectStore(STORE_SITE_PROJECTS).put({ houseId: 'house-a' })
        tx.objectStore(STORE_SITE_ASSETS).delete('kept')
        // `add` of an existing key fails with ConstraintError.
        tx.objectStore(STORE_SITE_PROJECTS).add({ houseId: 'house-a' })
        done(undefined)
      }),
    )
    expect(error).toBeInstanceOf(PersonalSpacesError)
    expect(await db.get(STORE_SITE_PROJECTS, 'house-a')).toBeUndefined()
    expect(await db.get(STORE_SITE_ASSETS, 'kept')).toEqual({ id: 'kept', houseId: 'house-a' })
  })

  it('reports a transaction that cannot start', async () => {
    const faulty = faultyFactory(newFactory())
    const db = database(faulty.factory)
    await db.ready()
    faulty.faults.transactionThrows = domError('UnknownError')
    const error = await rejection(db.atomic([STORE_SITE_PROJECTS], (_tx, done) => done(1)))
    expect(error).toBeInstanceOf(StorageError)
  })

  it('reports a body that throws, and writes nothing', async () => {
    const db = database(newFactory())
    const error = await rejection(
      db.atomic([STORE_SITE_ASSETS], tx => {
        tx.objectStore(STORE_SITE_ASSETS).put({ id: 'a1', houseId: 'house-a' })
        throw new Error('bug')
      }),
    )
    expect(error).toBeInstanceOf(StorageError)
    expect(await db.get(STORE_SITE_ASSETS, 'a1')).toBeUndefined()
  })
})
