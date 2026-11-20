import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it } from 'vitest'
import { QuotaError, StorageError } from '../errors'
import { domError, faultyFactory } from '../storage/fault-injection.test-support'
import { IdbDatabase } from '../storage/idb'
import { STORE_SITE_ASSETS, STORE_SITE_PROJECTS, STORE_SITES, WEBTOWN_DB } from '../storage/webtown-db'
import { IndexedDbProjectRepository } from './indexeddb-project-repository'
import { asset, describeProjectRepositoryContract, projectWith, saveOf, steppingClock } from './project-repository.contract'

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

describeProjectRepositoryContract('IndexedDbProjectRepository', {
  async create(now) {
    const db = connect(newFactory())
    return {
      repository: new IndexedDbProjectRepository(db, { now }),
      async seedUnchecked(houseId, project, assets = []) {
        await db.put(STORE_SITE_PROJECTS, { ...(project as object), houseId })
        for (const record of assets) await db.put(STORE_SITE_ASSETS, record)
      },
    }
  },
})

describe('IndexedDbProjectRepository', () => {
  it('survives a reload: a new connection sees the saved website', async () => {
    const factory = newFactory()
    const pic = asset('house-a', 'id-1', 'pic.png')
    await new IndexedDbProjectRepository(connect(factory)).save(saveOf(projectWith('house-a', [pic]), 0, [pic]))
    const load = await new IndexedDbProjectRepository(connect(factory)).load('house-a')
    expect(load.kind).toBe('saved')
    if (load.kind === 'saved') expect(load.snapshot.assets.map(a => a.name)).toEqual(['pic.png'])
  })

  it('never touches the old structured websites', async () => {
    const db = connect(newFactory())
    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Legacy' })
    await new IndexedDbProjectRepository(db).save(saveOf(projectWith('house-a'), 0))
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Legacy' })
  })

  it('writes nothing when the device is full, and keeps the last save', async () => {
    const faulty = faultyFactory(newFactory())
    const db = connect(faulty.factory)
    const repo = new IndexedDbProjectRepository(db, { now: steppingClock() })
    const first = await repo.save(saveOf(projectWith('house-a', [], { css: 'kept' }), 0))

    faulty.faults.nextTransaction = { kind: 'fail', error: domError('QuotaExceededError') }
    const pic = asset('house-a', 'id-1', 'pic.png')
    await expect(repo.save(saveOf({ ...first, css: 'lost', assets: [{ id: pic.id, name: pic.name, mimeType: pic.mimeType, size: pic.size }] }, 1, [pic])))
      .rejects.toBeInstanceOf(QuotaError)

    const load = await repo.load('house-a')
    expect(load.kind === 'saved' && load.snapshot.project.css).toBe('kept')
    expect(await db.get(STORE_SITE_ASSETS, 'id-1')).toBeUndefined()
  })

  it('reports a transaction that cannot start', async () => {
    const faulty = faultyFactory(newFactory())
    const repo = new IndexedDbProjectRepository(connect(faulty.factory))
    await repo.load('house-a')
    faulty.faults.transactionThrows = domError('UnknownError')
    await expect(repo.save(saveOf(projectWith('house-a'), 0))).rejects.toBeInstanceOf(StorageError)
  })
})
