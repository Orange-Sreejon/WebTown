// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATION_FILES, TestDatabase, rejection, type Caller } from './test-database.test-support'

/**
 * The Phase 4 schema on real PostgreSQL: structure, RLS and every function the app calls, with several
 * distinct users (permanent and anonymous), a user of another world, and the `anon` role.
 */

interface Bootstrap {
  profile: { id: string; displayName: string; avatar: string; settings: Record<string, unknown> }
  world: { id: string; name: string; kind: string; role: string }
  houses: Array<{ id: string; slot: string; ownerId: string | null }>
}

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

const ANON: Caller = { kind: 'anon' }
const own = (b: Bootstrap) => b.houses.find(h => h.ownerId === b.profile.id)!
const other = (b: Bootstrap, slot = 'house-b') => b.houses.find(h => h.slot === slot)!

async function player(options: { anonymous?: boolean } = {}): Promise<{ me: Caller & { kind: 'user' }; boot: Bootstrap }> {
  const me = await db.createUser(options)
  const boot = await db.rpc<Bootstrap>(me, 'bootstrap_player')
  return { me, boot }
}

const layout = (n = 1) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, type: 'table', rotation: 0, at: { kind: 'grid', col: i, row: 1 } })) })

describe('migrations', () => {
  it('apply in order on a Supabase-shaped database', () => {
    expect(MIGRATION_FILES.length).toBeGreaterThanOrEqual(2)
    expect(MIGRATION_FILES).toEqual([...MIGRATION_FILES].sort())
  })

  it('turn RLS on for every table with user or world data', async () => {
    const rows = await db.superuser<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`)
    expect(rows.length).toBe(10)
    for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true)
  })

  it('give the anon role nothing at all', async () => {
    for (const table of ['profiles', 'worlds', 'world_members', 'houses', 'house_layouts', 'websites', 'website_pages', 'website_assets', 'artworks', 'local_imports']) {
      expect((await rejection(db.query(ANON, `select * from public.${table}`))).code, table).toBe('42501')
    }
    expect((await rejection(db.rpc(ANON, 'bootstrap_player'))).code).toBe('42501')
    expect((await rejection(db.query(ANON, 'select private.owns_house(gen_random_uuid())'))).code).toBe('42501')
  })

  it('creates the two private buckets with size and type limits', async () => {
    const buckets = await db.superuser<{ id: string; public: boolean; file_size_limit: string; allowed_mime_types: string[] }>('select * from storage.buckets order by id')
    expect(buckets.map(b => [b.id, b.public, Number(b.file_size_limit)])).toEqual([['artworks', false, 5000000], ['website-assets', false, 5000000]])
    expect(buckets[0]!.allowed_mime_types).toEqual(['image/png'])
  })
})

describe('bootstrap_player', () => {
  it('gives a new player a profile, a personal world they own, every house slot, and house-a', async () => {
    const { me, boot } = await player()
    expect(boot.profile.id).toBe(me.id)
    expect(boot.profile.displayName).toMatch(/^Resident [0-9A-F]{4}$/)
    expect(boot.world).toMatchObject({ name: 'My WebTown', kind: 'personal', role: 'owner' })
    expect(boot.houses.map(h => h.slot)).toEqual(['house-a', 'house-b', 'house-c', 'house-d', 'house-e', 'house-f', 'house-g'])
    expect(boot.houses.filter(h => h.ownerId !== null)).toEqual([expect.objectContaining({ slot: 'house-a', ownerId: me.id })])
  })

  it('treats a guest (anonymous user) exactly like a permanent user', async () => {
    const { me, boot } = await player({ anonymous: true })
    expect(own(boot).slot).toBe('house-a')
    expect(own(boot).ownerId).toBe(me.id)
  })

  it('is idempotent: the same world, houses and profile on every start, nothing duplicated', async () => {
    const { me, boot } = await player()
    const again = await db.rpc<Bootstrap>(me, 'bootstrap_player', { p_display_name: 'Ignored later' })
    expect(again).toEqual(boot)
    const counts = await db.superuser<{ worlds: number; houses: number; members: number; profiles: number }>(
      `select (select count(*)::int from public.worlds where owner_id = $1) worlds,
              (select count(*)::int from public.houses h join public.worlds w on w.id = h.world_id where w.owner_id = $1) houses,
              (select count(*)::int from public.world_members where user_id = $1) members,
              (select count(*)::int from public.profiles where id = $1) profiles`, [me.id])
    expect(counts[0]).toEqual({ worlds: 1, houses: 7, members: 1, profiles: 1 })
  })

  it('uses a requested display name on the first start, and refuses control characters', async () => {
    const me = await db.createUser()
    expect((await db.rpc<Bootstrap>(me, 'bootstrap_player', { p_display_name: '  Ada  ' })).profile.displayName).toBe('Ada')
    const other = await db.createUser()
    expect((await db.rpc<Bootstrap>(other, 'bootstrap_player', { p_display_name: 'bad\u0007' })).profile.displayName).toMatch(/^Resident /)
  })

  it('gives two players separate worlds and houses', async () => {
    const a = await player()
    const b = await player()
    expect(a.boot.world.id).not.toBe(b.boot.world.id)
    expect(own(a.boot).id).not.toBe(own(b.boot).id)
  })

  it('needs a signed-in user', async () => {
    expect((await rejection(db.rpc({ kind: 'user', id: '', anonymous: false } as Caller, 'bootstrap_player'))).code).toBeTruthy()
  })

  it('prevents a second owner for a house and a second house per user per world', async () => {
    const { me, boot } = await player()
    const stranger = await db.createUser()
    await db.superuser("insert into public.world_members (world_id, user_id, role) values ($1, $2, 'resident')", [boot.world.id, stranger.id])
    const dup = await db.superuser('update public.houses set owner_id = $1 where id = $2', [me.id, other(boot).id]).catch(e => e as Error)
    expect(String(dup)).toMatch(/duplicate|unique/i)
    const notMember = await db.createUser()
    const fk = await db.superuser('update public.houses set owner_id = $1 where id = $2', [notMember.id, other(boot).id]).catch(e => e as Error)
    expect(String(fk)).toMatch(/foreign key/i)
  })
})

describe('profiles', () => {
  it('lets a player read and change only their own profile', async () => {
    const a = await player()
    const b = await player()
    expect(await db.query(a.me, 'select id from public.profiles')).toEqual([{ id: a.me.id }])
    await db.query(a.me, "update public.profiles set display_name = 'Ada' where id = $1", [a.me.id])
    const changed = await db.query(a.me, "update public.profiles set display_name = 'Hacked' where id = $1 returning id", [b.me.id])
    expect(changed).toEqual([])
    expect((await db.superuser<{ display_name: string }>('select display_name from public.profiles where id = $1', [b.me.id]))[0]!.display_name).toMatch(/^Resident/)
  })

  it('does not let a player change their id or dates', async () => {
    const a = await player()
    expect((await rejection(db.query(a.me, 'update public.profiles set id = gen_random_uuid() where id = $1', [a.me.id]))).code).toBe('42501')
    expect((await rejection(db.query(a.me, "update public.profiles set created_at = '2000-01-01' where id = $1", [a.me.id]))).code).toBe('42501')
    expect((await rejection(db.query(a.me, "insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')"))).code).toBe('42501')
  })

  it('updates the profile through update_profile, with validation', async () => {
    const a = await player({ anonymous: true })
    const next = await db.rpc<{ displayName: string; settings: Record<string, unknown> }>(a.me, 'update_profile', {
      p_display_name: ' Night Owl ', p_avatar: null, p_settings: { upgradeHintDismissed: true },
    })
    expect(next).toMatchObject({ displayName: 'Night Owl', settings: { upgradeHintDismissed: true } })
    expect((await rejection(db.rpc(a.me, 'update_profile', { p_display_name: 'x'.repeat(41), p_avatar: null, p_settings: null }))).code).toBe('23514')
    expect((await rejection(db.rpc(a.me, 'update_profile', { p_display_name: null, p_avatar: null, p_settings: { big: 'x'.repeat(5000) } }))).code).toBe('23514')
  })
})

describe('worlds, members and houses', () => {
  it('are visible only to members', async () => {
    const a = await player()
    const b = await player()
    expect(await db.query(b.me, 'select id from public.worlds where id = $1', [a.boot.world.id])).toEqual([])
    expect(await db.query(b.me, 'select id from public.houses where world_id = $1', [a.boot.world.id])).toEqual([])
    expect(await db.query(b.me, 'select * from public.world_members where world_id = $1', [a.boot.world.id])).toEqual([])
    expect((await db.query(a.me, 'select id from public.houses where world_id = $1', [a.boot.world.id])).length).toBe(7)
  })

  it('cannot be created, joined or reassigned by a client', async () => {
    const a = await player()
    const b = await player()
    expect((await rejection(db.query(b.me, "insert into public.worlds (name, owner_id) values ('Mine', $1)", [b.me.id]))).code).toBe('42501')
    expect((await rejection(db.query(b.me, "insert into public.world_members (world_id, user_id, role) values ($1, $2, 'owner')", [a.boot.world.id, b.me.id]))).code).toBe('42501')
    expect((await rejection(db.query(b.me, 'update public.houses set owner_id = $1 where id = $2', [b.me.id, other(a.boot).id]))).code).toBe('42501')
    expect((await rejection(db.query(a.me, 'update public.houses set owner_id = null where id = $1', [own(a.boot).id]))).code).toBe('42501')
  })

  it('lets the owner rename their world, and nobody else', async () => {
    const a = await player()
    const b = await player()
    await db.query(a.me, "update public.worlds set name = 'Ada Town' where id = $1", [a.boot.world.id])
    expect(await db.query(b.me, "update public.worlds set name = 'Nope' where id = $1 returning id", [a.boot.world.id])).toEqual([])
    expect((await rejection(db.query(a.me, 'update public.worlds set owner_id = $1 where id = $2', [b.me.id, a.boot.world.id]))).code).toBe('42501')
  })
})

describe('furniture layouts', () => {
  it('saves and loads with compare-and-swap on the revision', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    expect(await db.rpc(me, 'get_house_layout', { p_house: house })).toBeNull()
    expect(await db.rpc(me, 'save_house_layout', { p_house: house, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: layout(2).items })).toEqual({ revision: 1 })
    expect(await db.rpc(me, 'save_house_layout', { p_house: house, p_base_revision: 1, p_template_id: 'cozy-room', p_schema_version: 1, p_items: layout(3).items })).toEqual({ revision: 2 })
    const loaded = await db.rpc<{ items: unknown[]; revision: number }>(me, 'get_house_layout', { p_house: house })
    expect(loaded.revision).toBe(2)
    expect(loaded.items).toHaveLength(3)
  })

  it('refuses a stale save, and a second first save', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    await db.rpc(me, 'save_house_layout', { p_house: house, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
    await db.rpc(me, 'save_house_layout', { p_house: house, p_base_revision: 1, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
    expect((await rejection(db.rpc(me, 'save_house_layout', { p_house: house, p_base_revision: 1, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] }))).code).toBe('WTCON')
    expect((await rejection(db.rpc(me, 'save_house_layout', { p_house: house, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] }))).code).toBe('WTCON')
  })

  it("keeps another player out of a house's furniture, and the unowned houses read-only", async () => {
    const a = await player()
    const b = await player({ anonymous: true })
    const house = own(a.boot).id
    await db.rpc(a.me, 'save_house_layout', { p_house: house, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
    expect((await rejection(db.rpc(b.me, 'get_house_layout', { p_house: house }))).code).toBe('42501')
    expect((await rejection(db.rpc(b.me, 'save_house_layout', { p_house: house, p_base_revision: 1, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] }))).code).toBe('42501')
    expect(await db.query(b.me, 'select * from public.house_layouts where house_id = $1', [house])).toEqual([])
    expect((await rejection(db.query(b.me, "insert into public.house_layouts (house_id, template_id, schema_version, items) values ($1, 'cozy-room', 1, '[]')", [own(a.boot).id]))).code).toBe('42501')
    // An unowned house in their own world: visible, not editable.
    expect(await db.rpc(a.me, 'get_house_layout', { p_house: other(a.boot).id })).toBeNull()
    expect((await rejection(db.rpc(a.me, 'save_house_layout', { p_house: other(a.boot).id, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] }))).code).toBe('42501')
  })

  it('refuses damaged item lists', async () => {
    const { me, boot } = await player()
    for (const items of [{ not: 'array' }, [1], [{ id: 1, type: 'x', at: {} }], [{ id: 'a', type: 'x' }]]) {
      expect((await rejection(db.rpc(me, 'save_house_layout', { p_house: own(boot).id, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: items }))).code).toBe('22023')
    }
    const huge = Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, type: 't', at: {} }))
    expect((await rejection(db.rpc(me, 'save_house_layout', { p_house: own(boot).id, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: huge }))).code).toBe('23514')
  })
})

describe('websites', () => {
  const site = (folder: string, assets: Array<{ id: string; name?: string }> = [], change: Record<string, unknown> = {}) => ({
    title: 'Night Shift', homePage: 'index.html', css: 'body { color: red }', origin: { kind: 'blank' },
    pages: [{ name: 'index.html', html: '<h1>Hi</h1>' }, { name: 'zine.html', html: '<p>2</p>' }],
    assets: assets.map(a => ({ id: a.id, name: a.name ?? 'banner.gif', mimeType: 'image/gif', size: 100, path: folder + a.id })),
    ...change,
  })

  it('saves pages, stylesheet and assets together, and loads them back in order', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    const folder = `${boot.world.id}/${house}/`
    const asset = crypto.randomUUID()
    await db.upload(me, 'website-assets', folder + asset)
    const saved = await db.rpc<{ revision: number; removedPaths: string[] }>(me, 'save_website', { p_house: house, p_base_revision: 0, p_site: site(folder, [{ id: asset }]) })
    expect(saved).toMatchObject({ revision: 1, removedPaths: [] })
    const loaded = await db.rpc<Record<string, unknown>>(me, 'get_website', { p_house: house })
    expect(loaded).toMatchObject({ title: 'Night Shift', homePage: 'index.html', css: 'body { color: red }', revision: 1 })
    expect(loaded['pages']).toEqual([{ name: 'index.html', html: '<h1>Hi</h1>' }, { name: 'zine.html', html: '<p>2</p>' }])
    expect(loaded['assets']).toEqual([{ id: asset, name: 'banner.gif', mimeType: 'image/gif', size: 100, path: folder + asset }])
  })

  it('replaces pages, renames and removes assets, and returns what to delete from Storage', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    const folder = `${boot.world.id}/${house}/`
    const [a1, a2] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.upload(me, 'website-assets', folder + a1)
    await db.upload(me, 'website-assets', folder + a2)
    await db.rpc(me, 'save_website', { p_house: house, p_base_revision: 0, p_site: site(folder, [{ id: a1, name: 'a.gif' }, { id: a2, name: 'b.gif' }]) })
    const next = await db.rpc<{ revision: number; removedPaths: string[] }>(me, 'save_website', {
      p_house: house, p_base_revision: 1,
      p_site: site(folder, [{ id: a1, name: 'b.gif' }], { pages: [{ name: 'index.html', html: 'only' }] }),
    })
    expect(next).toMatchObject({ revision: 2, removedPaths: [folder + a2] })
    const loaded = await db.rpc<{ pages: unknown[]; assets: Array<{ name: string }> }>(me, 'get_website', { p_house: house })
    expect(loaded.pages).toEqual([{ name: 'index.html', html: 'only' }])
    expect(loaded.assets.map(a => a.name)).toEqual(['b.gif'])
  })

  it('refuses a stale save, a missing homepage, too many pages and an asset that was not uploaded', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    const folder = `${boot.world.id}/${house}/`
    await db.rpc(me, 'save_website', { p_house: house, p_base_revision: 0, p_site: site(folder) })
    expect((await rejection(db.rpc(me, 'save_website', { p_house: house, p_base_revision: 0, p_site: site(folder) }))).code).toBe('WTCON')
    expect((await rejection(db.rpc(me, 'save_website', { p_house: house, p_base_revision: 1, p_site: site(folder, [], { homePage: 'nope.html' }) }))).code).toBe('22023')
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `p${i}.html`, html: '' }))
    expect((await rejection(db.rpc(me, 'save_website', { p_house: house, p_base_revision: 1, p_site: site(folder, [], { pages: many, homePage: 'p0.html' }) }))).code).toBe('22023')
    const missing = await rejection(db.rpc(me, 'save_website', { p_house: house, p_base_revision: 1, p_site: site(folder, [{ id: crypto.randomUUID(), name: 'ghost.gif' }]) }))
    expect(missing.code).toBe('22023')
    expect(missing.message).toContain('ghost.gif')
    expect((await rejection(db.rpc(me, 'save_website', { p_house: house, p_base_revision: 1, p_site: site(folder, [], { pages: [{ name: '../x.html', html: '' }], homePage: '../x.html' }) }))).code).toBe('23514')
    // Nothing of the refused saves stuck.
    expect((await db.rpc<{ revision: number }>(me, 'get_website', { p_house: house })).revision).toBe(1)
  })

  it("does not let an asset point into another house's folder", async () => {
    const a = await player()
    const b = await player()
    const aFolder = `${a.boot.world.id}/${own(a.boot).id}/`
    const asset = crypto.randomUUID()
    await db.upload(a.me, 'website-assets', aFolder + asset)
    const bFolder = `${b.boot.world.id}/${own(b.boot).id}/`
    const stolen = { ...site(bFolder), assets: [{ id: asset, name: 'x.gif', mimeType: 'image/gif', size: 1, path: aFolder + asset }] }
    expect((await rejection(db.rpc(b.me, 'save_website', { p_house: own(b.boot).id, p_base_revision: 0, p_site: stolen }))).code).toBe('22023')
  })

  it("keeps another player's website private, including pages and assets read directly", async () => {
    const a = await player()
    const b = await player({ anonymous: true })
    const house = own(a.boot).id
    await db.rpc(a.me, 'save_website', { p_house: house, p_base_revision: 0, p_site: site(`${a.boot.world.id}/${house}/`) })
    expect((await rejection(db.rpc(b.me, 'get_website', { p_house: house }))).code).toBe('42501')
    expect(await db.query(b.me, 'select * from public.website_pages where house_id = $1', [house])).toEqual([])
    expect(await db.query(b.me, "update public.website_pages set html = 'pwned' where house_id = $1 returning name", [house])).toEqual([])
    expect(await db.query(b.me, 'delete from public.websites where house_id = $1 returning house_id', [house])).toEqual([])
    expect((await rejection(db.rpc(b.me, 'save_website', { p_house: house, p_base_revision: 1, p_site: site('x/') }))).code).toBe('42501')
  })
})

describe('storage', () => {
  it("lets an owner upload only into their own house's folder", async () => {
    const a = await player()
    const b = await player()
    const mine = `${a.boot.world.id}/${own(a.boot).id}/${crypto.randomUUID()}.png`
    await db.upload(a.me, 'artworks', mine)
    for (const path of [
      `${b.boot.world.id}/${own(b.boot).id}/${crypto.randomUUID()}.png`, // another player's house
      `${a.boot.world.id}/${other(a.boot).id}/${crypto.randomUUID()}.png`, // an unowned house
      `${b.boot.world.id}/${own(a.boot).id}/${crypto.randomUUID()}.png`, // the right house under the wrong world
      `${own(a.boot).id}/${crypto.randomUUID()}.png`, // not three segments
      `${a.boot.world.id}/${own(a.boot).id}/../../x.png`,
    ]) {
      expect((await rejection(db.upload(a.me, 'artworks', path))).code, path).toBe('42501')
    }
    expect((await rejection(db.upload(a.me, 'avatars', mine))).code).toBeTruthy()
  })

  it("hides one player's files from another, and stops them deleting them", async () => {
    const a = await player()
    const b = await player({ anonymous: true })
    const path = `${a.boot.world.id}/${own(a.boot).id}/${crypto.randomUUID()}.png`
    await db.upload(a.me, 'artworks', path)
    expect(await db.query(b.me, 'select name from storage.objects where name = $1', [path])).toEqual([])
    expect(await db.query(b.me, 'delete from storage.objects where name = $1 returning name', [path])).toEqual([])
    expect(await db.query(a.me, 'select name from storage.objects where name = $1', [path])).toEqual([{ name: path }])
    expect(await db.query(ANON, 'select name from storage.objects')).toEqual([])
  })
})

describe('sketchbook drawings', () => {
  async function upload(me: Caller, boot: Bootstrap): Promise<string> {
    const path = `${boot.world.id}/${own(boot).id}/${crypto.randomUUID()}.png`
    await db.upload(me, 'artworks', path)
    return path
  }
  const art = (house: string, path: string, change: Record<string, unknown> = {}) => ({
    p_house: house, p_id: null, p_base_revision: 0, p_title: 'Sunset', p_width: 640, p_height: 480,
    p_transparent: false, p_byte_size: 1234, p_path: path, ...change,
  })

  it('creates, updates with a new image, lists and deletes', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    const first = await upload(me, boot)
    const created = await db.rpc<{ id: string; revision: number; oldPath: null }>(me, 'save_artwork', art(house, first))
    expect(created).toMatchObject({ revision: 1, oldPath: null, duplicate: false })
    const second = await upload(me, boot)
    const updated = await db.rpc<{ revision: number; oldPath: string }>(me, 'save_artwork', art(house, second, { p_id: created.id, p_base_revision: 1, p_title: ' Night ' }))
    expect(updated).toMatchObject({ revision: 2, oldPath: first })
    const list = await db.rpc<Array<{ id: string; title: string; path: string }>>(me, 'list_artworks', { p_house: house })
    expect(list.map(a => [a.id, a.title, a.path])).toEqual([[created.id, 'Night', second]])
    expect(await db.rpc(me, 'delete_artwork', { p_house: house, p_id: created.id })).toEqual({ removedPath: second })
    expect(await db.rpc(me, 'list_artworks', { p_house: house })).toEqual([])
  })

  it('refuses a stale save and keeps the newer drawing', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    const created = await db.rpc<{ id: string }>(me, 'save_artwork', art(house, await upload(me, boot)))
    const newer = await upload(me, boot)
    await db.rpc(me, 'save_artwork', art(house, newer, { p_id: created.id, p_base_revision: 1 }))
    expect((await rejection(db.rpc(me, 'save_artwork', art(house, await upload(me, boot), { p_id: created.id, p_base_revision: 1 })))).code).toBe('WTCON')
    const list = await db.rpc<Array<{ path: string; revision: number }>>(me, 'list_artworks', { p_house: house })
    expect(list[0]).toMatchObject({ path: newer, revision: 2 })
  })

  it('holds at most 50 drawings per house', async () => {
    const { me, boot } = await player()
    const house = own(boot).id
    for (let i = 0; i < 50; i++) await db.rpc(me, 'save_artwork', art(house, await upload(me, boot)))
    const full = await rejection(db.rpc(me, 'save_artwork', art(house, await upload(me, boot))))
    expect(full.code).toBe('22023')
    expect(full.message).toContain('50')
  })

  it('refuses an image that was not uploaded, or is in another folder', async () => {
    const a = await player()
    const b = await player()
    expect((await rejection(db.rpc(a.me, 'save_artwork', art(own(a.boot).id, `${a.boot.world.id}/${own(a.boot).id}/${crypto.randomUUID()}.png`)))).code).toBe('22023')
    const bPath = await upload(b.me, b.boot)
    expect((await rejection(db.rpc(a.me, 'save_artwork', art(own(a.boot).id, bPath)))).code).toBe('22023')
    expect((await rejection(db.rpc(a.me, 'save_artwork', art(own(a.boot).id, await upload(a.me, a.boot), { p_width: 2000 })))).code).toBe('23514')
  })

  it("keeps another player's drawings private and untouchable", async () => {
    const a = await player()
    const b = await player({ anonymous: true })
    const house = own(a.boot).id
    const created = await db.rpc<{ id: string }>(a.me, 'save_artwork', art(house, await upload(a.me, a.boot)))
    expect((await rejection(db.rpc(b.me, 'list_artworks', { p_house: house }))).code).toBe('42501')
    expect((await rejection(db.rpc(b.me, 'delete_artwork', { p_house: house, p_id: created.id }))).code).toBe('42501')
    // Their own house with the other drawing's id: not found there, nothing changed.
    expect(await db.rpc(b.me, 'delete_artwork', { p_house: own(b.boot).id, p_id: created.id })).toEqual({ removedPath: null })
    expect((await rejection(db.rpc(b.me, 'save_artwork', art(own(b.boot).id, await upload(b.me, b.boot), { p_id: created.id, p_base_revision: 1 })))).code).toBe('WTCON')
    expect((await rejection(db.rpc(b.me, 'save_artwork', art(own(b.boot).id, await upload(b.me, b.boot), { p_id: created.id })))).code).toBe('WTCON')
    expect(await db.query(b.me, 'select * from public.artworks where id = $1', [created.id])).toEqual([])
    expect((await db.rpc<unknown[]>(a.me, 'list_artworks', { p_house: house }))).toHaveLength(1)
  })
})

describe('local imports', () => {
  it('never imports the same item twice', async () => {
    const { me, boot } = await player({ anonymous: true })
    const house = own(boot).id
    const path = () => `${boot.world.id}/${house}/${crypto.randomUUID()}.png`
    const p1 = path()
    await db.upload(me, 'artworks', p1)
    const first = await db.rpc<{ id: string; duplicate: boolean }>(me, 'save_artwork', {
      p_house: house, p_id: null, p_base_revision: 0, p_title: 'Old', p_width: 10, p_height: 10, p_transparent: false, p_byte_size: 5, p_path: p1, p_import_key: 'artwork:local-1',
    })
    expect(first.duplicate).toBe(false)
    expect(await db.rpc(me, 'imported_keys', { p_keys: ['artwork:local-1', 'artwork:local-2'] })).toEqual(['artwork:local-1'])
    const p2 = path()
    await db.upload(me, 'artworks', p2)
    const again = await db.rpc<{ id: string; duplicate: boolean }>(me, 'save_artwork', {
      p_house: house, p_id: null, p_base_revision: 0, p_title: 'Old', p_width: 10, p_height: 10, p_transparent: false, p_byte_size: 5, p_path: p2, p_import_key: 'artwork:local-1',
    })
    expect(again).toEqual({ id: first.id, duplicate: true })
    expect(await db.rpc<unknown[]>(me, 'list_artworks', { p_house: house })).toHaveLength(1)
  })

  it('keeps receipts per user', async () => {
    const a = await player()
    const b = await player()
    await db.rpc(a.me, 'record_import', { p_key: 'website:house-a', p_target: own(a.boot).id })
    expect(await db.rpc(a.me, 'imported_keys', { p_keys: ['website:house-a'] })).toEqual(['website:house-a'])
    expect(await db.rpc(b.me, 'imported_keys', { p_keys: ['website:house-a'] })).toEqual([])
    expect(await db.query(b.me, 'select * from public.local_imports')).toEqual([])
    expect((await rejection(db.query(b.me, "insert into public.local_imports (user_id, source_key) values ($1, 'forged')", [a.me.id]))).code).toBe('42501')
  })
})

describe('shared worlds (prepared, not used by the app yet)', () => {
  it("lets a resident read the world's houses and the owner's name, but change nothing they do not own", async () => {
    const owner = await player()
    const resident = await db.createUser({ anonymous: true })
    await db.rpc(resident, 'bootstrap_player')
    await db.superuser("insert into public.world_members (world_id, user_id, role) values ($1, $2, 'resident')", [owner.boot.world.id, resident.id])
    await db.superuser('update public.houses set owner_id = $1 where id = $2', [resident.id, other(owner.boot).id])
    const house = own(owner.boot).id
    await db.rpc(owner.me, 'save_house_layout', { p_house: house, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
    expect((await db.rpc<{ revision: number }>(resident, 'get_house_layout', { p_house: house })).revision).toBe(1)
    expect((await rejection(db.rpc(resident, 'save_house_layout', { p_house: house, p_base_revision: 1, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] }))).code).toBe('42501')
    expect((await db.query<{ id: string }>(resident, 'select id from public.profiles')).map(p => p.id).sort()).toEqual([owner.me.id, resident.id].sort())
    // Their assigned house in the shared world is theirs to furnish.
    await db.rpc(resident, 'save_house_layout', { p_house: other(owner.boot).id, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
  })
})

describe('deleting an account', () => {
  it('removes everything the user owns, and nothing else', async () => {
    const a = await player({ anonymous: true })
    const b = await player()
    await db.rpc(a.me, 'save_house_layout', { p_house: own(a.boot).id, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
    await db.superuser('delete from auth.users where id = $1', [a.me.id])
    const left = await db.superuser<{ n: number }>(
      `select (select count(*)::int from public.worlds where id = $1) + (select count(*)::int from public.houses where world_id = $1)
            + (select count(*)::int from public.profiles where id = $2) + (select count(*)::int from public.house_layouts where house_id = $3) as n`,
      [a.boot.world.id, a.me.id, own(a.boot).id])
    expect(left[0]!.n).toBe(0)
    expect((await db.rpc<Bootstrap>(b.me, 'bootstrap_player')).world.id).toBe(b.boot.world.id)
  })
})
