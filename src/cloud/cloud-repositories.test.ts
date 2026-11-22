// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEMPLATE, createDefaultLayout } from '../game/maps/house/default-interior'
import { removeItem } from '../game/maps/house/layout-edits'
import { fakePng } from '../personal-spaces/artwork-storage/artwork-repository.contract'
import { ConflictError, PermissionError, StorageError, ValidationError } from '../personal-spaces/errors'
import { blankProject, classicProject } from '../personal-spaces/site-project/templates'
import { GIF_ANIMATED, PNG_1PX } from '../personal-spaces/site-project/test-images.test-support'
import type { SiteAsset, SiteSave } from '../personal-spaces/site-project/types'
import { OFFLINE_MESSAGE } from './backend'
import { CloudArtworkRepository } from './cloud-artworks'
import { CloudLayoutStore } from './cloud-layouts'
import { CloudWebsiteRepository } from './cloud-websites'
import { FileStore, testBackend, type TestBackend } from './database/test-backend.test-support'
import { TestDatabase, type Caller } from './database/test-database.test-support'
import { bootstrapPlayer, type PlayerContext } from './player'

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

interface Player { me: Caller & { kind: 'user' }; backend: TestBackend; player: PlayerContext }
const files = new FileStore()
async function signUp(options: { anonymous?: boolean } = {}): Promise<Player> {
  const me = await db.createUser(options)
  const backend = testBackend(db, me, files)
  return { me, backend, player: await bootstrapPlayer(backend, me.id) }
}
/** Another session of the same user (another tab or device). */
const secondSession = (p: Player): Player => ({ ...p, backend: testBackend(db, p.me, files) })

const asset = (id: string, name: string, bytes: ArrayBuffer): SiteAsset =>
  ({ id, name, mimeType: name.endsWith('.gif') ? 'image/gif' : 'image/png', size: bytes.byteLength, houseId: 'house-a', bytes })
const meta = (a: SiteAsset) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size })
const NOW = '2026-11-21T10:00:00.000Z'
const draw = (change: Record<string, unknown> = {}) => ({
  id: null, houseId: 'house-a', title: 'Sunset', width: 640, height: 480, transparent: false, png: fakePng(640, 480, 1), ...change,
})

describe('bootstrapPlayer', () => {
  it('gives the player their world, its houses and their own house, the same on every start', async () => {
    const p = await signUp({ anonymous: true })
    expect(p.player.ownedSlot).toBe('house-a')
    expect(p.player.world.role).toBe('owner')
    expect(p.player.houses).toHaveLength(7)
    const again = await bootstrapPlayer(p.backend, p.me.id)
    expect(again).toEqual(p.player)
  })

  it('says so when the network is down', async () => {
    const p = await signUp()
    p.backend.offline = true
    await expect(bootstrapPlayer(p.backend, p.me.id)).rejects.toThrow(OFFLINE_MESSAGE)
  })
})

describe('CloudLayoutStore', () => {
  it('opens the standard room for a house never furnished, and keeps an edit across sessions', async () => {
    const p = await signUp()
    const store = new CloudLayoutStore(p.backend, p.player)
    const start = await store.load('house-a')
    expect(start).toEqual(createDefaultLayout('house-a'))
    // A real edit: the first piece of furniture the rules allow to be taken out.
    const edits = start.items.map(item => removeItem(DEFAULT_TEMPLATE, start, item.id)).filter(r => r.ok)
    expect(edits.length).toBeGreaterThan(0)
    const layout = (edits[0] as { ok: true; layout: typeof start }).layout
    expect(layout.items.length).toBe(start.items.length - 1)
    await store.save(layout)
    await store.save(layout) // a second save from the same session: its revision moved on with it

    const later = new CloudLayoutStore(secondSession(p).backend, p.player)
    expect(await later.load('house-a')).toEqual(layout)
  })

  it('refuses a save from a session that read an older revision', async () => {
    const p = await signUp()
    const tabOne = new CloudLayoutStore(p.backend, p.player)
    const tabTwo = new CloudLayoutStore(secondSession(p).backend, p.player)
    const layout = await tabOne.load('house-a')
    await tabTwo.load('house-a')
    await tabOne.save(layout)
    await expect(tabTwo.save(layout)).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a layout that breaks the rules before sending it', async () => {
    const p = await signUp()
    const store = new CloudLayoutStore(p.backend, p.player)
    const layout = await store.load('house-a')
    const broken = { ...layout, items: [...layout.items, { ...layout.items[0]! }] }
    await expect(store.save(broken)).rejects.toThrow(/Layout rejected/)
    expect(p.backend.calls.filter(c => c === 'rpc:save_house_layout')).toEqual([])
  })

  it("cannot read or change another player's furniture", async () => {
    const a = await signUp()
    const b = await signUp({ anonymous: true })
    // b's client pointed at a's house (a forged context): the database says no.
    const forged = new CloudLayoutStore(b.backend, a.player)
    await expect(forged.load('house-a')).rejects.toBeInstanceOf(PermissionError)
    await expect(forged.save(createDefaultLayout('house-a'))).rejects.toBeInstanceOf(PermissionError)
  })

  it('keeps unowned houses read-only', async () => {
    const p = await signUp()
    const store = new CloudLayoutStore(p.backend, p.player)
    expect(await store.load('house-b')).toEqual(createDefaultLayout('house-b'))
    await expect(store.save(createDefaultLayout('house-b'))).rejects.toBeInstanceOf(PermissionError)
  })

  it('leaves a stored layout it cannot use untouched, and opens the standard room', async () => {
    const p = await signUp()
    const house = p.player.houses.find(h => h.slot === 'house-a')!.id
    await db.rpc(p.me, 'save_house_layout', { p_house: house, p_base_revision: 0, p_template_id: 'no-such-room', p_schema_version: 1, p_items: [] })
    const store = new CloudLayoutStore(p.backend, p.player)
    const loaded = await store.loadWithRecovery('house-a')
    expect(loaded.layout).toEqual(createDefaultLayout('house-a'))
    expect(loaded.recovered?.problems.join(' ')).toContain('no-such-room')
    expect((await db.rpc<{ templateId: string }>(p.me, 'get_house_layout', { p_house: house })).templateId).toBe('no-such-room')
  })

  it('reports a network failure without losing anything', async () => {
    const p = await signUp()
    const store = new CloudLayoutStore(p.backend, p.player)
    const layout = await store.load('house-a')
    p.backend.offline = true
    await expect(store.save(layout)).rejects.toBeInstanceOf(StorageError)
    p.backend.offline = false
    await store.save(layout)
  })
})

describe('CloudWebsiteRepository', () => {
  const firstSave = (_p: Player, assets: SiteAsset[] = []): SiteSave => ({
    project: { ...blankProject('house-a', NOW), title: 'Zine', css: 'body{display:grid}', assets: assets.map(meta) },
    baseRevision: 0, putAssets: assets, deleteAssetIds: [],
  })

  it('saves pages, stylesheet and images, and loads them back exactly', async () => {
    const p = await signUp({ anonymous: true })
    const repo = new CloudWebsiteRepository(p.backend, p.player)
    const banner = asset(crypto.randomUUID(), 'my-banner.gif', GIF_ANIMATED())
    const saved = await repo.save(firstSave(p, [banner]))
    expect(saved.revision).toBe(1)

    const load = await new CloudWebsiteRepository(secondSession(p).backend, p.player).load('house-a')
    expect(load.kind).toBe('saved')
    if (load.kind !== 'saved') return
    expect(load.skipped).toEqual([])
    expect(load.snapshot.project).toMatchObject({ title: 'Zine', css: 'body{display:grid}', homePage: 'index.html', revision: 1 })
    expect(load.snapshot.project.pages).toEqual(saved.pages)
    expect(Array.from(new Uint8Array(load.snapshot.assets[0]!.bytes))).toEqual(Array.from(new Uint8Array(GIF_ANIMATED())))
  })

  it('replaces pages and removes images that are no longer used, from the database and Storage', async () => {
    const p = await signUp()
    const repo = new CloudWebsiteRepository(p.backend, p.player)
    const [a, b] = [asset(crypto.randomUUID(), 'a.png', PNG_1PX()), asset(crypto.randomUUID(), 'b.gif', GIF_ANIMATED())]
    const first = await repo.save(firstSave(p, [a, b]))
    const classic = classicProject('house-a', NOW)
    const second = await repo.save({
      project: { ...first, pages: classic.pages, homePage: classic.homePage, assets: [meta(a)] },
      baseRevision: first.revision, putAssets: [], deleteAssetIds: [b.id],
    })
    expect(second.revision).toBe(2)
    await vi.waitFor(() => expect([...files.bytes.keys()].some(k => k.endsWith(b.id))).toBe(false))
    const load = await repo.load('house-a')
    expect(load.kind === 'saved' && load.snapshot.project.pages.map(x => x.name)).toEqual(['index.html', 'about.html', 'projects.html', 'links.html'])
    expect(load.kind === 'saved' && load.snapshot.assets.map(x => x.name)).toEqual(['a.png'])
  })

  it('refuses a save from a tab that started from an older version, and keeps the newer one', async () => {
    const p = await signUp()
    const tabOne = new CloudWebsiteRepository(p.backend, p.player)
    const first = await tabOne.save(firstSave(p))
    await tabOne.save({ project: { ...first, css: 'from tab one' }, baseRevision: 1, putAssets: [], deleteAssetIds: [] })
    const tabTwo = new CloudWebsiteRepository(secondSession(p).backend, p.player)
    await expect(tabTwo.save({ project: { ...first, css: 'from tab two' }, baseRevision: 1, putAssets: [], deleteAssetIds: [] }))
      .rejects.toBeInstanceOf(ConflictError)
    const load = await tabTwo.load('house-a')
    expect(load.kind === 'saved' && load.snapshot.project.css).toBe('from tab one')
  })

  it('takes back new images when the save is refused', async () => {
    const p = await signUp()
    const repo = new CloudWebsiteRepository(p.backend, p.player)
    await repo.save(firstSave(p))
    const late = asset(crypto.randomUUID(), 'late.png', PNG_1PX())
    await expect(repo.save({ ...firstSave(p, [late]), baseRevision: 0 })).rejects.toBeInstanceOf(ConflictError)
    await vi.waitFor(() => expect([...files.bytes.keys()].some(k => k.endsWith(late.id))).toBe(false))
  })

  it('can retry a save whose images were uploaded but whose database step failed', async () => {
    const p = await signUp()
    const repo = new CloudWebsiteRepository(p.backend, p.player)
    const pic = asset(crypto.randomUUID(), 'pic.png', PNG_1PX())
    const realRpc = p.backend.rpc.bind(p.backend)
    p.backend.rpc = async (fn, args) => {
      if (fn === 'save_website') throw new (await import('./backend')).CloudError('network', 'Failed to fetch')
      return realRpc(fn, args)
    }
    // The failed attempt leaves its image only if removal also fails; make removal fail too.
    const realRemove = p.backend.remove.bind(p.backend)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    p.backend.remove = async () => { throw new Error('offline') }
    await expect(repo.save(firstSave(p, [pic]))).rejects.toBeInstanceOf(StorageError)
    p.backend.rpc = realRpc
    p.backend.remove = realRemove
    warn.mockRestore()
    expect((await repo.save(firstSave(p, [pic]))).revision).toBe(1)
  })

  it('leaves out an image whose bytes are missing, says so, and loads the rest', async () => {
    const p = await signUp()
    const repo = new CloudWebsiteRepository(p.backend, p.player)
    const pic = asset(crypto.randomUUID(), 'pic.png', PNG_1PX())
    await repo.save(firstSave(p, [pic]))
    for (const k of [...files.bytes.keys()]) if (k.endsWith(pic.id)) files.bytes.delete(k)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const load = await repo.load('house-a')
    expect(load.kind === 'saved' && load.skipped.join(' ')).toContain('pic.png')
    vi.restoreAllMocks()
  })

  it("cannot read or change another player's website", async () => {
    const a = await signUp()
    const b = await signUp({ anonymous: true })
    await new CloudWebsiteRepository(a.backend, a.player).save(firstSave(a))
    const forged = new CloudWebsiteRepository(b.backend, a.player)
    await expect(forged.load('house-a')).rejects.toBeInstanceOf(PermissionError)
    await expect(forged.save({ ...firstSave(b), baseRevision: 1 })).rejects.toBeInstanceOf(PermissionError)
    expect((await new CloudWebsiteRepository(b.backend, b.player).load('house-a')).kind).toBe('none')
  })

  it('refuses images with ids the account cannot use, before uploading anything', async () => {
    const p = await signUp()
    const odd = asset('not-a-uuid', 'odd.png', PNG_1PX())
    await expect(new CloudWebsiteRepository(p.backend, p.player).save(firstSave(p, [odd]))).rejects.toBeInstanceOf(ValidationError)
    expect(p.backend.calls.some(c => c.startsWith('upload'))).toBe(false)
  })
})

describe('CloudArtworkRepository', () => {
  it('creates, updates, lists and deletes drawings, keeping only the current image in Storage', async () => {
    const p = await signUp({ anonymous: true })
    const repo = new CloudArtworkRepository(p.backend, p.player)
    const created = await repo.save(draw())
    expect(created).toMatchObject({ houseId: 'house-a', title: 'Sunset', width: 640, height: 480, byteSize: 33 })
    const updated = await repo.save(draw({ id: created.id, title: ' Night ', png: fakePng(640, 480, 2) }))
    expect(updated.id).toBe(created.id)
    await vi.waitFor(() => expect([...files.bytes.keys()].filter(k => k.includes(p.player.world.id))).toHaveLength(1))

    const { items, skipped } = await new CloudArtworkRepository(secondSession(p).backend, p.player).list('house-a')
    expect(skipped).toEqual([])
    expect(items.map(i => [i.id, i.title, new Uint8Array(i.png)[32]])).toEqual([[created.id, 'Night', 2]])
    expect((await repo.get('house-a', created.id))?.title).toBe('Night')

    await repo.delete('house-a', created.id)
    expect((await repo.list('house-a')).items).toEqual([])
    await vi.waitFor(() => expect([...files.bytes.keys()].filter(k => k.includes(p.player.world.id))).toHaveLength(0))
  })

  it('refuses a stale save from another tab, and keeps the newer drawing', async () => {
    const p = await signUp()
    const tabOne = new CloudArtworkRepository(p.backend, p.player)
    const created = await tabOne.save(draw())
    const tabTwo = new CloudArtworkRepository(secondSession(p).backend, p.player)
    await tabTwo.list('house-a')
    await tabOne.save(draw({ id: created.id, title: 'Newer' }))
    await expect(tabTwo.save(draw({ id: created.id, title: 'Stale' }))).rejects.toBeInstanceOf(ConflictError)
    expect((await tabOne.get('house-a', created.id))?.title).toBe('Newer')
  })

  it("cannot read, change or delete another player's drawings", async () => {
    const a = await signUp()
    const b = await signUp({ anonymous: true })
    const art = await new CloudArtworkRepository(a.backend, a.player).save(draw())
    const forged = new CloudArtworkRepository(b.backend, a.player)
    await expect(forged.list('house-a')).rejects.toBeInstanceOf(PermissionError)
    await expect(forged.save(draw({ id: art.id }))).rejects.toBeInstanceOf(PermissionError)
    await expect(forged.delete('house-a', art.id)).rejects.toBeInstanceOf(PermissionError)
    const own = new CloudArtworkRepository(b.backend, b.player)
    expect((await own.list('house-a')).items).toEqual([])
    expect(await own.get('house-a', art.id)).toBeNull()
  })

  it('says so when the network is down, and the next save works', async () => {
    const p = await signUp()
    const repo = new CloudArtworkRepository(p.backend, p.player)
    p.backend.offline = true
    await expect(repo.save(draw())).rejects.toThrow(OFFLINE_MESSAGE)
    p.backend.offline = false
    await repo.save(draw())
    expect((await repo.list('house-a')).items).toHaveLength(1)
  })

  it('skips a drawing whose image is damaged, and says which', async () => {
    const p = await signUp()
    const repo = new CloudArtworkRepository(p.backend, p.player)
    const art = await repo.save(draw({ title: 'Broken' }))
    for (const k of [...files.bytes.keys()]) if (k.includes(p.player.world.id)) files.bytes.set(k, new TextEncoder().encode('not a png').buffer as ArrayBuffer)
    const { items, skipped } = await repo.list('house-a')
    expect(items).toEqual([])
    expect(skipped.join(' ')).toContain('Broken')
    expect(art.id).toBeTruthy()
  })
})
