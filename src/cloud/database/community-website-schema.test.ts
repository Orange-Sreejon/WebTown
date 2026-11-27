import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rejection, TestDatabase, type Caller } from './test-database.test-support'
import { FileStore, testBackend } from './test-backend.test-support'
import {
  COMMUNITY_BUCKET, CommunityDraftWriter, listCommunityRevisions, loadCommunityWebsite, parseWebsiteAnnouncement,
  publishCommunityWebsite,
} from '../community-website'
import { ConflictError, PermissionError, ValidationError } from '../../personal-spaces/errors'
import { COMMUNITY_SITE_KEY } from '../../personal-spaces/site-project/site-target'
import { blankProject } from '../../personal-spaces/site-project/templates'
import { PNG_1PX } from '../../personal-spaces/site-project/test-images.test-support'
import type { SiteAsset, SiteSave } from '../../personal-spaces/site-project/types'

/**
 * The Community Website (CH-05) on real PostgreSQL: the shared draft and its compare-and-swap, revisions and what is
 * kept, publishing and rollback, the draft lock, images in `community-assets` under the real Storage policies, the
 * announcements, and the client calls (src/cloud/community-website.ts).
 */

type User = Caller & { kind: 'user' }
const ANON: Caller = { kind: 'anon' }

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

async function player(name: string): Promise<{ me: User; world: string }> {
  const me = await db.createUser()
  const boot = await db.rpc<{ world: { id: string } }>(me, 'bootstrap_player', { p_display_name: name })
  return { me, world: boot.world.id }
}
async function town(): Promise<{ owner: User; a: User; b: User; world: string }> {
  const { me: owner, world } = await player('Owner')
  const { me: a } = await player('Ada')
  const { me: b } = await player('Bo')
  const inv = await db.rpc<{ code: string }>(owner, 'create_world_invite', { p_world: world, p_days: 1 })
  await db.rpc(a, 'join_world', { p_code: inv.code })
  await db.rpc(b, 'join_world', { p_code: inv.code })
  return { owner, a, b, world }
}

type Site = Record<string, unknown>
const site = (over: Site = {}): Site => ({
  title: 'Our town', homePage: 'index.html', css: 'body { color: teal }', origin: { kind: 'blank' },
  pages: [{ name: 'index.html', html: '<h1>Hello</h1>' }], assets: [], ...over,
})
interface Saved { number: number; savedAt: string; removedPaths: string[] }
const save = (me: User, world: string, base: number, s: Site = site()) =>
  db.rpc<Saved>(me, 'save_community_draft', { p_world: world, p_base_number: base, p_site: s })
const get = (me: Caller, world: string, which = 'draft', number?: number) =>
  db.rpc<Record<string, unknown> | null>(me, 'get_community_website', { p_world: world, p_which: which, ...(number !== undefined ? { p_number: number } : {}) })
const publish = (me: User, world: string, number: number, note?: string) =>
  db.rpc<{ number: number; changed: boolean }>(me, 'publish_community_website', { p_world: world, p_number: number, ...(note ? { p_note: note } : {}) })
const revisions = (me: User, world: string, args: Record<string, unknown> = {}) =>
  db.rpc<Array<{ number: number; authorName: string | null; isDraft: boolean; isPublished: boolean }>>(me, 'list_community_revisions', { p_world: world, ...args })
const logActions = async (world: string) =>
  (await db.superuser<{ action: string }>('select action from public.community_moderation_log where world_id = $1 order by id', [world])).map(r => r.action)
const image = (id: string = crypto.randomUUID(), over: Site = {}) => ({ id, name: 'poster.png', mimeType: 'image/png', size: 68, ...over })
const objectExists = async (path: string) =>
  (await db.superuser("select 1 from storage.objects where bucket_id = 'community-assets' and name = $1", [path])).length === 1

describe('the shared draft', () => {
  it('exists for every Hall, and goes with its world', async () => {
    const missing = await db.superuser('select h.world_id from public.community_halls h left join public.community_websites w using (world_id) where w.world_id is null')
    expect(missing).toEqual([])
    const { me, world } = await player('Gone')
    await save(me, world, 0)
    await db.superuser('delete from public.worlds where id = $1', [world])
    for (const table of ['community_websites', 'community_website_revisions', 'community_website_assets']) {
      expect(await db.superuser(`select 1 from public.${table} where world_id = $1`, [world]), table).toEqual([])
    }
  })

  it('is saved by any member, as a new numbered revision, and refused when someone saved first', async () => {
    const { a, b, world } = await town()
    expect(await get(a, world)).toBeNull()
    expect(await save(a, world, 0)).toMatchObject({ number: 1, removedPaths: [] })
    expect(await get(b, world)).toMatchObject({
      number: 1, authorId: a.id, authorName: 'Ada', draftNumber: 1, publishedNumber: null, title: 'Our town',
      pages: [{ name: 'index.html', html: '<h1>Hello</h1>' }], css: 'body { color: teal }', assets: [],
    })
    expect(await save(b, world, 1, site({ title: 'Bo was here' }))).toMatchObject({ number: 2 })
    // Ada still has revision 1 open: her save is refused, and so is starting from nothing.
    for (const base of [1, 0, 3]) {
      expect((await rejection(save(a, world, base))).code, String(base)).toBe('WTCON')
    }
    expect(await get(a, world)).toMatchObject({ number: 2, title: 'Bo was here', authorName: 'Bo' })
  })

  it('keeps only the known fields of what was saved', async () => {
    const { a, world } = await town()
    await save(a, world, 0, site({ evil: '<script>', pages: [{ name: 'index.html', html: 'x', extra: 1 }], title: '  Spaced  ' }))
    const [{ content }] = await db.superuser<{ content: Record<string, unknown> }>('select content from public.community_website_revisions where world_id = $1', [world])
    expect(Object.keys(content!).sort()).toEqual(['assets', 'css', 'homePage', 'origin', 'pages', 'title'])
    expect(content!['pages']).toEqual([{ name: 'index.html', html: 'x' }])
    expect(content!['title']).toBe('Spaced')
  })

  it('refuses websites that break the rules, with a message', async () => {
    const { a, world } = await town()
    const big = 'x'.repeat(1_000_001)
    const nearly = 'y'.repeat(999_000)
    for (const over of [
      { pages: [] }, { pages: 'x' }, { assets: {} }, { title: '' }, { title: 'x'.repeat(61) }, { title: 'a\u0007b' },
      { pages: [{ name: 'index.htm', html: '' }] }, { pages: [{ name: '../index.html', html: '' }] }, { pages: [{ name: 'index.html' }] },
      { pages: [{ name: 'index.html', html: 1 }] }, { pages: [{ name: 'index.html', html: big }] },
      { pages: [{ name: 'index.html', html: '' }, { name: 'INDEX.html', html: '' }] }, { homePage: 'about.html' },
      { css: big }, { css: 5 },
      { assets: [image('not-a-uuid')] }, { assets: [image(undefined, { name: 'x.exe' })] }, { assets: [image(undefined, { mimeType: 'text/html' })] },
      { assets: [image(undefined, { size: '68' })] }, { assets: [image(undefined, { size: 0 })] }, { assets: [image(undefined, { size: 5_000_001 })] },
      { assets: [image(undefined, { size: 1.5 })] }, { assets: [image(undefined, { size: 1e20 })] },
      { assets: [image(), image(undefined, { name: 'POSTER.png' })] },
      // Three pages of almost 1 MB: each is allowed, together they are too much for one revision.
      { pages: ['a', 'b', 'c', 'd'].map(n => ({ name: `${n}.html`, html: nearly })), homePage: 'a.html' },
    ]) {
      const e = await rejection(save(a, world, 0, site(over)))
      expect(e.code, JSON.stringify(over).slice(0, 80)).toBe('22023')
      expect(e.message.length).toBeGreaterThan(10)
    }
    expect(await get(a, world)).toBeNull()
  }, 30_000)

  it('is refused while a moderator has locked it, except to moderators', async () => {
    const { owner, a, world } = await town()
    await save(a, world, 0)
    await db.rpc(owner, 'set_hall_lock', { p_world: world, p_what: 'draft', p_locked: true })
    expect((await rejection(save(a, world, 1))).message).toMatch(/locked/)
    expect(await save(owner, world, 1)).toMatchObject({ number: 2 })
    await db.rpc(owner, 'set_hall_lock', { p_world: world, p_what: 'draft', p_locked: false })
    expect(await save(a, world, 2)).toMatchObject({ number: 3 })
  })
})

describe('publishing', () => {
  it('lets moderators publish a reviewed revision, and roll back to an older one, logged', async () => {
    const { owner, a, world } = await town()
    await save(a, world, 0, site({ title: 'One' }))
    await save(a, world, 1, site({ title: 'Two' }))
    await save(a, world, 2, site({ title: 'Three' }))
    expect(await get(a, world, 'published')).toBeNull()
    expect((await rejection(publish(a, world, 2))).code).toBe('42501')
    expect(await publish(owner, world, 2, 'Looks good')).toMatchObject({ number: 2, changed: true })
    expect(await get(a, world, 'published')).toMatchObject({ number: 2, title: 'Two', publishedNumber: 2, draftNumber: 3 })
    expect(await publish(owner, world, 2)).toMatchObject({ changed: false })
    await publish(owner, world, 3)
    await publish(owner, world, 1)
    expect(await get(a, world, 'published')).toMatchObject({ title: 'One' })
    expect(await logActions(world)).toEqual(['publish', 'publish', 'rollback'])
    const entry = await db.superuser<{ target: unknown; reason: string }>("select target, reason from public.community_moderation_log where world_id = $1 order by id limit 1", [world])
    expect(entry).toEqual([{ target: { number: 2, previous: null }, reason: 'Looks good' }])
    expect((await rejection(publish(owner, world, 99))).code).toBe('22023')
    // Editing goes on: the draft moves, visitors still see what was published.
    await save(a, world, 3, site({ title: 'Four' }))
    expect(await get(a, world, 'published')).toMatchObject({ title: 'One' })
  })

  it('keeps the newest 30 revisions, the 10 last published, the draft and the published version', async () => {
    const { owner, a, world } = await town()
    // 1 was published, then 2 (published now); then 39 more saves.
    await save(a, world, 0)
    await publish(owner, world, 1)
    await save(a, world, 1)
    await publish(owner, world, 2)
    for (let n = 2; n < 41; n++) await save(a, world, n, site({ title: `Rev ${n + 1}` }))
    const kept = await revisions(a, world, { p_limit: 50 })
    // The newest 30 (12..41), the published one (2), and one published before it (1, among the last 10 published).
    expect(kept.map(r => r.number)).toEqual([...Array.from({ length: 30 }, (_, i) => 41 - i), 2, 1])
    expect(kept[0]).toMatchObject({ number: 41, isDraft: true, isPublished: false })
    expect(kept[30]).toMatchObject({ number: 2, isPublished: true })
    expect(kept[31]).toMatchObject({ number: 1, isPublished: false })
    expect(await get(a, world, 'revision', 5)).toBeNull()
    expect((await rejection(publish(owner, world, 5))).code).toBe('22023')
    expect(await get(a, world, 'published')).toMatchObject({ number: 2 })
    // A rollback to 1 is still possible.
    await publish(owner, world, 1)
    // Paging.
    const page = await revisions(a, world, { p_limit: 2 })
    expect(page.map(r => r.number)).toEqual([41, 40])
    expect((await revisions(a, world, { p_before: 40, p_limit: 2 })).map(r => r.number)).toEqual([39, 38])
    for (const limit of [0, 51]) expect((await rejection(revisions(a, world, { p_limit: limit }))).code).toBe('22023')
  }, 30_000)

  it("keeps a former member's revisions, without their name", async () => {
    const { a, b, world } = await town()
    await save(a, world, 0)
    await db.rpc(a, 'leave_world', { p_world: world })
    expect(await get(b, world)).toMatchObject({ authorId: a.id, authorName: null })
    expect((await revisions(b, world))[0]).toMatchObject({ authorName: null })
  })
})

describe('images in community-assets', () => {
  it("are uploaded by members to their town's folder, read by members only, and recorded on save", async () => {
    const { a, b, world } = await town()
    const { me: stranger, world: other } = await player('Stranger')
    const id = crypto.randomUUID()
    const path = `${world}/${id}`
    expect((await rejection(db.upload(stranger, COMMUNITY_BUCKET, path))).code).toBe('42501')
    expect((await rejection(db.upload(a, COMMUNITY_BUCKET, `${world}/${id}/x`))).code).toBe('42501')
    expect((await rejection(db.upload(a, COMMUNITY_BUCKET, `${other}/${id}`))).code).toBe('42501')
    // Saving an image that was never uploaded is refused.
    expect((await rejection(save(a, world, 0, site({ assets: [image(id)] })))).message).toMatch(/was not uploaded/)
    await db.upload(a, COMMUNITY_BUCKET, path)
    expect(await save(a, world, 0, site({ assets: [image(id)] }))).toMatchObject({ number: 1 })
    expect((await get(b, world))!['assets']).toEqual([{ ...image(id), path }])
    const read = (me: Caller) => db.query(me, "select name from storage.objects where bucket_id = 'community-assets' and name = $1", [path])
    expect(await read(b)).toHaveLength(1)
    expect(await read(stranger)).toEqual([])
    expect(await read(ANON)).toEqual([]) // anon may query Storage, as in Supabase; the policies show it nothing
    // Never replaced, and not removable while used.
    expect((await rejection(db.upload(b, COMMUNITY_BUCKET, path))).code).toBe('42501')
    expect(await db.query(b, "delete from storage.objects where bucket_id = 'community-assets' and name = $1 returning name", [path])).toEqual([])
    expect(await objectExists(path)).toBe(true)
  })

  it("refuses another town's image, and one whose type or size changed", async () => {
    const { a, world } = await town()
    const { me: other, world: elsewhere } = await player('Other')
    const id = crypto.randomUUID()
    await db.upload(other, COMMUNITY_BUCKET, `${elsewhere}/${id}`)
    await save(other, elsewhere, 0, site({ assets: [image(id)] }))
    expect((await rejection(save(a, world, 0, site({ assets: [image(id)] })))).code).toBe('22023')
    const mine = crypto.randomUUID()
    await db.upload(a, COMMUNITY_BUCKET, `${world}/${mine}`)
    await save(a, world, 0, site({ assets: [image(mine)] }))
    expect((await rejection(save(a, world, 1, site({ assets: [image(mine, { size: 99 })] })))).code).toBe('22023')
    expect((await rejection(save(a, world, 1, site({ assets: [image(mine, { mimeType: 'image/gif', name: 'poster.gif' })] })))).code).toBe('22023')
    // Renaming is per revision.
    expect(await save(a, world, 1, site({ assets: [image(mine, { name: 'renamed.png' })] }))).toMatchObject({ number: 2 })
  })

  it('may be removed once no kept revision uses them, and are then gone for good', async () => {
    const { a, b, world } = await town()
    const id = crypto.randomUUID()
    const path = `${world}/${id}`
    await db.upload(a, COMMUNITY_BUCKET, path)
    await save(a, world, 0, site({ assets: [image(id)] }))
    let last: Saved | null = null
    for (let n = 1; n <= 30; n++) last = await save(a, world, n) // without the image
    expect(last!.removedPaths).toEqual([path])
    expect(await db.query(b, "delete from storage.objects where bucket_id = 'community-assets' and name = $1 returning name", [path])).toEqual([{ name: path }])
    expect((await rejection(db.upload(a, COMMUNITY_BUCKET, path))).code).toBe('42501')
    expect((await rejection(save(a, world, 31, site({ assets: [image(id)] })))).code).toBe('22023')
  }, 30_000)
})

describe('who may use it', () => {
  it('is members of that world only; strangers, other worlds and anon get nothing', async () => {
    const { a, world } = await town()
    const { me: stranger } = await player('Stranger')
    await save(a, world, 0)
    for (const caller of [stranger, ANON] as Caller[]) {
      for (const [fn, args] of [
        ['get_community_website', { p_world: world, p_which: 'draft' }],
        ['save_community_draft', { p_world: world, p_base_number: 1, p_site: site() }],
        ['publish_community_website', { p_world: world, p_number: 1 }],
        ['list_community_revisions', { p_world: world }],
      ] as const) {
        expect((await rejection(db.rpc(caller, fn, args))).code, `${caller.kind} ${fn}`).toBe('42501')
      }
    }
    expect((await rejection(get(a, world, 'everything'))).code).toBe('22023')
  })

  it('cannot be read or written directly, only through the functions', async () => {
    const { owner, world } = await town()
    await save(owner, world, 0)
    for (const sql of [
      `select * from public.community_websites`,
      `select * from public.community_website_revisions`,
      `select * from public.community_website_assets`,
      `update public.community_websites set published_number = 1 where world_id = '${world}'`,
      `insert into public.community_website_revisions (world_id, number, content) values ('${world}', 9, '{}')`,
      `select private.community_site('{}')`,
      `select private.community_announce('${world}', 'draft', 1)`,
    ]) {
      expect((await rejection(db.query(owner, sql))).code, sql.slice(0, 60)).toBe('42501')
    }
  })

  it('announces saves and publishes on the Hall channel as hints', async () => {
    const { owner, a, world } = await town()
    await save(a, world, 0)
    await publish(owner, world, 1)
    await rejection(save(a, world, 0)) // refused: nothing announced
    const sent = await db.superuser<{ payload: unknown; event: string }>("select payload, event from realtime.messages where topic = $1 and event = 'website' order by id", [`hall:${world}`])
    expect(sent).toEqual([{ payload: { kind: 'draft', number: 1 }, event: 'website' }, { payload: { kind: 'published', number: 1 }, event: 'website' }])
    expect(parseWebsiteAnnouncement(sent[1]!.payload)).toEqual({ kind: 'published', number: 1 })
    for (const junk of [null, {}, { kind: 'draft' }, { kind: 'x', number: 1 }, { kind: 'draft', number: 0 }, { kind: 'draft', number: '1' }]) {
      expect(parseWebsiteAnnouncement(junk)).toBeNull()
    }
  })
})

// ── The client calls (src/cloud/community-website.ts) ──────────────────────────────────────────────────────

describe('the Community Website client', () => {
  const NOW = '2026-12-25T09:00:00.000Z'
  const studioSave = (base: number, assets: SiteAsset[] = [], title = 'Our town'): SiteSave => {
    const project = { ...blankProject(COMMUNITY_SITE_KEY, NOW), title, revision: base }
    project.assets = assets.map(a => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size }))
    return { project, baseRevision: base, putAssets: assets, deleteAssetIds: [] }
  }

  it('saves from the Studio with images, loads them back, publishes and lists', async () => {
    const { owner, a, b, world } = await town()
    const files = new FileStore()
    const ada = testBackend(db, a, files)
    const bo = testBackend(db, b, files)
    const boss = testBackend(db, owner, files)
    const bytes = PNG_1PX()
    const asset: SiteAsset = { id: crypto.randomUUID(), name: 'poster.png', mimeType: 'image/png', size: bytes.byteLength, houseId: COMMUNITY_SITE_KEY, bytes }

    const saved = await new CommunityDraftWriter(ada, world, () => NOW).save(studioSave(0, [asset]))
    expect(saved).toMatchObject({ revision: 1, houseId: COMMUNITY_SITE_KEY, title: 'Our town' })
    expect(ada.calls).toEqual(['upload:community-assets', 'rpc:save_community_draft'])
    // The answer was lost and the Studio saves again with the same new image: Storage refuses to replace it, the
    // save goes on and the database finds the file recorded.
    const again = studioSave(1, [asset])
    expect(await new CommunityDraftWriter(ada, world, () => NOW).save(again)).toMatchObject({ revision: 2 })

    const loaded = await loadCommunityWebsite(bo, world, 'draft')
    expect(loaded.info).toMatchObject({ number: 2, authorName: 'Ada', draftNumber: 2, publishedNumber: null })
    expect(loaded.load.kind).toBe('saved')
    if (loaded.load.kind !== 'saved') return
    expect(loaded.load.snapshot.project).toMatchObject({ revision: 2, houseId: COMMUNITY_SITE_KEY, title: 'Our town' })
    expect(loaded.load.snapshot.assets.map(x => [x.name, x.houseId, new Uint8Array(x.bytes).length])).toEqual([['poster.png', COMMUNITY_SITE_KEY, bytes.byteLength]])

    // Bo saves on top; Ada's next save from revision 2 is a conflict the Studio shows as such.
    await new CommunityDraftWriter(bo, world, () => NOW).save(studioSave(2, [], 'Bo'))
    await expect(new CommunityDraftWriter(ada, world, () => NOW).save(studioSave(2))).rejects.toBeInstanceOf(ConflictError)

    expect(await publishCommunityWebsite(boss, world, 1)).toMatchObject({ number: 1, changed: true })
    await expect(publishCommunityWebsite(ada, world, 2)).rejects.toBeInstanceOf(PermissionError)
    expect((await loadCommunityWebsite(ada, world, 'published')).info).toMatchObject({ number: 1, publishedNumber: 1, draftNumber: 3 })
    expect((await loadCommunityWebsite(ada, world, { number: 3 })).info).toMatchObject({ number: 3, authorName: 'Bo' })
    expect((await listCommunityRevisions(ada, world)).map(r => [r.number, r.isDraft, r.isPublished])).toEqual([[3, true, false], [2, false, false], [1, false, true]])
    expect(await loadCommunityWebsite(ada, world, { number: 77 })).toEqual({ load: { kind: 'none' }, info: null })
  })

  it("refuses a house's website, and reports the database's refusals as the app's own errors", async () => {
    const { a, world } = await town()
    const ada = testBackend(db, a)
    const writer = new CommunityDraftWriter(ada, world, () => NOW)
    const house = { ...studioSave(0), project: { ...blankProject('house-a', NOW), revision: 0 } }
    await expect(writer.save(house)).rejects.toBeInstanceOf(PermissionError)
    expect(ada.calls).toEqual([])
    const tooLong = studioSave(0, [], 'x'.repeat(61))
    await expect(writer.save(tooLong)).rejects.toBeInstanceOf(ValidationError)
    const { me: stranger } = await player('Stranger')
    await expect(loadCommunityWebsite(testBackend(db, stranger), world, 'draft')).rejects.toBeInstanceOf(PermissionError)
  })
})
