import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSiteStorage, paintAccessFor, type SiteStorage } from '../composition'
import { PermissionError, QuotaError } from '../errors'
import { domError, faultyFactory } from '../storage/fault-injection.test-support'
import { IdbDatabase } from '../storage/idb'
import { STORE_ARTWORKS, STORE_SITES, WEBTOWN_DB } from '../storage/webtown-db'
import { pngSize } from './artwork'
import { describeArtworkRepositoryContract, drawing, fakePng } from './artwork-repository.contract'
import { guardArtworkWriter } from './guarded-artwork-writer'
import { IndexedDbArtworkRepository } from './indexeddb-artwork-repository'
import { MemoryArtworkRepository } from './memory-artwork-repository'

const newFactory = (): IDBFactory => new IDBFactory() as unknown as IDBFactory
const open: IdbDatabase[] = []
const storages: SiteStorage[] = []
function connect(factory: IDBFactory): IdbDatabase {
  const db = new IdbDatabase(WEBTOWN_DB, { factory, blockedTimeoutMs: 30 })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const s of storages.splice(0)) s.close()
  vi.restoreAllMocks()
})

describeArtworkRepositoryContract('MemoryArtworkRepository', {
  async create(now, newId) {
    const repository = new MemoryArtworkRepository({ now, newId })
    return { repository, seedUnchecked: async record => repository.seedRaw(record) }
  },
})

describeArtworkRepositoryContract('IndexedDbArtworkRepository', {
  async create(now, newId) {
    const db = connect(newFactory())
    return { repository: new IndexedDbArtworkRepository(db, { now, newId }), seedUnchecked: record => db.put(STORE_ARTWORKS, record) }
  },
})

describe('pngSize', () => {
  it('reads the size of a real PNG and refuses anything else', () => {
    const png1px = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
    expect(pngSize(png1px.buffer)).toEqual({ width: 1, height: 1 })
    expect(pngSize(fakePng(640, 480))).toEqual({ width: 640, height: 480 })
    expect(pngSize(new ArrayBuffer(40))).toBeNull()
  })
})

describe('IndexedDbArtworkRepository', () => {
  it('survives a reload: a new connection sees the drawing', async () => {
    const factory = newFactory()
    await new IndexedDbArtworkRepository(connect(factory), { newId: () => 'd1' }).save(drawing('house-a'))
    const got = await new IndexedDbArtworkRepository(connect(factory)).get('house-a', 'd1')
    expect(got?.title).toBe('Sunset')
  })

  it('keeps the earlier save when the device is full', async () => {
    const faulty = faultyFactory(newFactory())
    const repo = new IndexedDbArtworkRepository(connect(faulty.factory), { newId: () => 'd1' })
    await repo.save(drawing('house-a', { title: 'Kept' }))
    faulty.faults.nextTransaction = { kind: 'fail', error: domError('QuotaExceededError') }
    await expect(repo.save(drawing('house-a', { id: 'd1', title: 'Lost' }))).rejects.toBeInstanceOf(QuotaError)
    expect((await repo.get('house-a', 'd1'))!.title).toBe('Kept')
  })

  it('never touches the website stores', async () => {
    const db = connect(newFactory())
    await db.put(STORE_SITES, { houseId: 'house-a', title: 'Site' })
    await new IndexedDbArtworkRepository(db).save(drawing('house-a'))
    expect(await db.get(STORE_SITES, 'house-a')).toEqual({ houseId: 'house-a', title: 'Site' })
  })
})

describe('guardArtworkWriter', () => {
  it('refuses anything but exactly owner, and other houses', async () => {
    for (const mode of ['visitor', 'OWNER', undefined]) {
      const writer = guardArtworkWriter(new MemoryArtworkRepository(), { houseId: 'house-a', mode: mode as never })
      await expect(writer.save(drawing('house-a'))).rejects.toBeInstanceOf(PermissionError)
      await expect(writer.delete('house-a', 'x')).rejects.toBeInstanceOf(PermissionError)
    }
    const owner = guardArtworkWriter(new MemoryArtworkRepository(), { houseId: 'house-a', mode: 'owner' })
    await expect(owner.save(drawing('house-b'))).rejects.toBeInstanceOf(PermissionError)
    await expect(owner.delete('house-b', 'x')).rejects.toBeInstanceOf(PermissionError)
    await expect(owner.save(drawing('house-a'))).resolves.toMatchObject({ houseId: 'house-a' })
  })
})

describe('paintAccessFor', () => {
  it('gives a visitor a reader and nothing that can write', async () => {
    const s = await createSiteStorage({ factory: newFactory() })
    storages.push(s)
    const access = paintAccessFor({ houseId: 'house-a', mode: 'visitor' }, s)
    expect(access.mode).toBe('visitor')
    expect('writer' in access).toBe(false)
    expect(Object.keys(access.reader).sort()).toEqual(['get', 'list'])
    expect(access.reader).not.toBe(s.artworks)
  })

  it('treats anything but exactly owner as a visitor', () => {
    expect(paintAccessFor({ houseId: 'house-a', mode: 'admin' as never }, { artworks: new MemoryArtworkRepository() }).mode).toBe('visitor')
  })

  it("lets the owner save only their own house's drawings, and a visitor then sees them", async () => {
    const s = await createSiteStorage({ factory: newFactory() })
    storages.push(s)
    const owner = paintAccessFor({ houseId: 'house-a', mode: 'owner' }, s)
    if (owner.mode !== 'owner') throw new Error('expected owner access')
    await expect(owner.writer.save(drawing('house-b'))).rejects.toBeInstanceOf(PermissionError)
    await owner.writer.save(drawing('house-a', { title: 'Mine' }))
    const visitor = paintAccessFor({ houseId: 'house-a', mode: 'visitor' }, s)
    expect((await visitor.reader.list('house-a')).items.map(i => i.title)).toEqual(['Mine'])
  })

  it('falls back to memory when the browser has no storage', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const s = await createSiteStorage({ factory: undefined })
    expect(s.persistent).toBe(false)
    await s.artworks.save(drawing('house-a'))
    expect((await s.artworks.list('house-a')).items).toHaveLength(1)
  })
})
