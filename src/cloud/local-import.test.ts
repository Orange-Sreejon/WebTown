// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakePng } from '../personal-spaces/artwork-storage/artwork-repository.contract'
import { MemoryArtworkRepository } from '../personal-spaces/artwork-storage/memory-artwork-repository'
import { MemoryProjectRepository } from '../personal-spaces/site-project-storage/memory-project-repository'
import { blankProject } from '../personal-spaces/site-project/templates'
import { PNG_1PX } from '../personal-spaces/site-project/test-images.test-support'
import type { SiteAsset } from '../personal-spaces/site-project/types'
import { CloudArtworkRepository } from './cloud-artworks'
import { CloudWebsiteRepository } from './cloud-websites'
import { FileStore, testBackend } from './database/test-backend.test-support'
import { TestDatabase } from './database/test-database.test-support'
import { importLocalData, type DeviceMarker, type LocalSources } from './local-import'
import { bootstrapPlayer } from './player'

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

const files = new FileStore()
const NOW = '2026-11-01T10:00:00.000Z'

/** A device with a website (with one image) and two drawings in house-a, as Phase 3a left them. */
async function device(): Promise<LocalSources & { marker: { value: DeviceMarker | null } & LocalSources['marker'] }> {
  const projects = new MemoryProjectRepository()
  const pic: SiteAsset = { id: crypto.randomUUID(), name: 'cat.png', mimeType: 'image/png', size: PNG_1PX().byteLength, houseId: 'house-a', bytes: PNG_1PX() }
  const project = { ...blankProject('house-a', NOW), title: 'My old site', css: 'p{color:red}', assets: [{ id: pic.id, name: pic.name, mimeType: pic.mimeType, size: pic.size }] }
  await projects.save({ project, baseRevision: 0, putAssets: [pic], deleteAssetIds: [] })
  let n = 0
  const artworks = new MemoryArtworkRepository({ newId: () => `local-${++n}` })
  await artworks.save({ id: null, houseId: 'house-a', title: 'Cat', width: 20, height: 10, transparent: false, png: fakePng(20, 10, 1) })
  await artworks.save({ id: null, houseId: 'house-a', title: 'Dog', width: 30, height: 10, transparent: true, png: fakePng(30, 10, 2) })
  const marker = {
    value: null as DeviceMarker | null,
    async get() { return marker.value },
    async set(m: DeviceMarker) { marker.value = { ...m } },
  }
  return { projects, artworks, marker }
}

async function account(options: { anonymous?: boolean } = { anonymous: true }) {
  const me = await db.createUser(options)
  const backend = testBackend(db, me, files)
  const player = await bootstrapPlayer(backend, me.id)
  return { me, backend, player, websites: new CloudWebsiteRepository(backend, player), artworks: new CloudArtworkRepository(backend, player) }
}

const count = async (userId: string): Promise<{ sites: number; drawings: number; receipts: number }> =>
  (await db.superuser<{ sites: number; drawings: number; receipts: number }>(
    `select (select count(*)::int from public.websites w join public.houses h on h.id = w.house_id where h.owner_id = $1) sites,
            (select count(*)::int from public.artworks a join public.houses h on h.id = a.house_id where h.owner_id = $1) drawings,
            (select count(*)::int from public.local_imports where user_id = $1) receipts`, [userId]))[0]!

describe("copying this device's work into the account", () => {
  it('copies the website, its image and every drawing, and remembers it did', async () => {
    const local = await device()
    const a = await account()
    const report = await importLocalData({ local, ...a })
    expect(report).toEqual({ website: 'copied', drawings: 2, skipped: [], failed: null, idle: false })
    expect(local.marker.value).toEqual({ userId: a.me.id, complete: true })

    const site = await a.websites.load('house-a')
    expect(site.kind === 'saved' && [site.snapshot.project.title, site.snapshot.project.css, site.snapshot.assets.map(x => x.name)])
      .toEqual(['My old site', 'p{color:red}', ['cat.png']])
    const drawings = await a.artworks.list('house-a')
    expect(drawings.items.map(d => [d.title, d.width, d.transparent]).sort()).toEqual([['Cat', 20, false], ['Dog', 30, true]])
    expect(await count(a.me.id)).toEqual({ sites: 1, drawings: 2, receipts: 3 })
  })

  it('does nothing the second time', async () => {
    const local = await device()
    const a = await account()
    await importLocalData({ local, ...a })
    const again = await importLocalData({ local, ...a })
    expect(again.idle).toBe(true)
    expect(await count(a.me.id)).toEqual({ sites: 1, drawings: 2, receipts: 3 })
  })

  it('never duplicates, even when the device forgot it had finished', async () => {
    const local = await device()
    const a = await account()
    await importLocalData({ local, ...a })
    local.marker.value = { userId: a.me.id, complete: false }
    const again = await importLocalData({ local, ...a })
    expect(again).toMatchObject({ website: 'none', drawings: 0, failed: null })
    expect(await count(a.me.id)).toEqual({ sites: 1, drawings: 2, receipts: 3 })
  })

  it('stops on a network failure, keeps the device untouched, and finishes on the next start without duplicates', async () => {
    const local = await device()
    const a = await account()
    const realRpc = a.backend.rpc.bind(a.backend)
    let saves = 0
    a.backend.rpc = async (fn, args) => {
      if (fn === 'save_artwork' && ++saves === 2) throw new (await import('./backend')).CloudError('network', 'Failed to fetch')
      return realRpc(fn, args)
    }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = await importLocalData({ local, ...a })
    vi.restoreAllMocks()
    expect(first.failed).toMatch(/reach WebTown/)
    expect(local.marker.value).toEqual({ userId: a.me.id, complete: false })
    expect((await local.artworks.list('house-a')).items).toHaveLength(2)

    a.backend.rpc = realRpc
    const second = await importLocalData({ local, ...a })
    expect(second).toMatchObject({ drawings: 1, failed: null })
    expect(await count(a.me.id)).toEqual({ sites: 1, drawings: 2, receipts: 3 })
  })

  it("keeps the account's website when it already has one, and leaves the device's copy alone", async () => {
    const local = await device()
    const a = await account()
    await a.websites.save({ project: { ...blankProject('house-a', NOW), title: 'Account site' }, baseRevision: 0, putAssets: [], deleteAssetIds: [] })
    const report = await importLocalData({ local, ...a })
    expect(report.website).toBe('kept-account')
    const site = await a.websites.load('house-a')
    expect(site.kind === 'saved' && site.snapshot.project.title).toBe('Account site')
    const kept = await local.projects.load('house-a')
    expect(kept.kind === 'saved' && kept.snapshot.project.title).toBe('My old site')
  })

  it("does not copy a device's work into a second account", async () => {
    const local = await device()
    const first = await account()
    await importLocalData({ local, ...first })
    const second = await account({ anonymous: false })
    expect((await importLocalData({ local, ...second })).idle).toBe(true)
    expect(await count(second.me.id)).toEqual({ sites: 0, drawings: 0, receipts: 0 })
  })

  it('does not hand the rest of an unfinished copy to a different account', async () => {
    const local = await device()
    const first = await account()
    local.marker.value = { userId: first.me.id, complete: false }
    const other = await account()
    expect((await importLocalData({ local, ...other })).idle).toBe(true)
    expect(await count(other.me.id)).toEqual({ sites: 0, drawings: 0, receipts: 0 })
  })

  it('stops copying drawings at the Sketchbook limit and says which were left on the device', async () => {
    const local = await device()
    const a = await account()
    for (let i = 0; i < 49; i++) await a.artworks.save({ id: null, houseId: 'house-a', title: `D${i}`, width: 1, height: 1, transparent: false, png: fakePng(1, 1) })
    const report = await importLocalData({ local, ...a })
    expect(report.drawings).toBe(1)
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]).toContain('50')
  })
})
