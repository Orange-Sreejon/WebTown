import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rejection, TestDatabase, type Caller } from './test-database.test-support'

/**
 * Phase 5 on real PostgreSQL: invitations, joining, leaving, membership management and the realtime channel
 * policies, with several distinct users, users of other worlds and the `anon` role.
 */

interface Context {
  profile: { id: string; displayName: string }
  world: { id: string; name: string; role: string }
  houses: Array<{ id: string; slot: string; ownerId: string | null }>
}
interface Invite { id: string; code: string; hint: string; expiresAt: string }
type User = Caller & { kind: 'user' }

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

const ANON: Caller = { kind: 'anon' }

async function player(name?: string): Promise<{ me: User; boot: Context }> {
  const me = await db.createUser()
  const boot = await db.rpc<Context>(me, 'bootstrap_player', name ? { p_display_name: name } : {})
  return { me, boot }
}
const invite = (owner: User, world: string, days = 7) => db.rpc<Invite>(owner, 'create_world_invite', { p_world: world, p_days: days })
const join = (me: User, code: string) => db.rpc<{ worldId: string; joined: boolean }>(me, 'join_world', { p_code: code })
const members = (me: User, world: string) =>
  db.rpc<Array<{ userId: string; displayName: string; role: string; slot: string | null }>>(me, 'list_world_members', { p_world: world })
const topic = (world: string) => `world:${world}`

describe('invitations', () => {
  it('gives the owner a one-time code and stores only its hash', async () => {
    const { me, boot } = await player('Ada')
    const inv = await invite(me, boot.world.id)
    expect(inv.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(inv.hint).toBe(inv.code.slice(-4))
    const stored = await db.superuser<{ code_hash: string }>('select code_hash from public.world_invites where id = $1', [inv.id])
    expect(stored[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(inv.code.replace(/-/g, ''))
    const listed = await db.rpc<Array<Record<string, unknown>>>(me, 'list_world_invites', { p_world: boot.world.id })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: inv.id, hint: inv.hint, uses: 0, revoked: false, expired: false })
    expect(JSON.stringify(listed)).not.toContain(inv.code)
  })

  it('makes a different code every time', async () => {
    const { me, boot } = await player()
    const codes = new Set<string>()
    for (let i = 0; i < 10; i++) codes.add((await invite(me, boot.world.id)).code)
    expect(codes.size).toBe(10)
  })

  it('is only for the owner, between 1 and 30 days, at most 20 open at once', async () => {
    const { me, boot } = await player()
    const { me: stranger } = await player()
    expect((await rejection(invite(stranger, boot.world.id))).code).toBe('42501')
    expect((await rejection(db.rpc(stranger, 'list_world_invites', { p_world: boot.world.id }))).code).toBe('42501')
    expect((await rejection(invite(me, boot.world.id, 0))).code).toBe('22023')
    expect((await rejection(invite(me, boot.world.id, 31))).code).toBe('22023')
    for (let i = 0; i < 20; i++) await invite(me, boot.world.id)
    expect((await rejection(invite(me, boot.world.id))).code).toBe('22023')
  })

  it('previews the world for anyone signed in, refusing bad, revoked and expired codes', async () => {
    const { me, boot } = await player('Grace')
    const { me: guest } = await player()
    const inv = await invite(me, boot.world.id)
    expect(await db.rpc(guest, 'preview_world_invite', { p_code: inv.code })).toEqual({
      worldId: boot.world.id, worldName: 'My WebTown', ownerName: 'Grace', members: 1, max: 7, alreadyMember: false,
    })
    // Case, dashes and spaces don't matter.
    expect(await db.rpc(guest, 'preview_world_invite', { p_code: ` ${inv.code.replace(/-/g, '').toLowerCase()} ` })).toMatchObject({ worldId: boot.world.id })
    expect((await rejection(db.rpc(guest, 'preview_world_invite', { p_code: 'AAAA-AAAA-AAAA' }))).code).toBe('WTINV')
    expect((await rejection(db.rpc(guest, 'preview_world_invite', { p_code: 'short' }))).code).toBe('WTINV')
    expect((await rejection(db.rpc(guest, 'preview_world_invite', { p_code: "'; drop table worlds; --" }))).code).toBe('WTINV')

    const expired = await invite(me, boot.world.id)
    await db.superuser("update public.world_invites set expires_at = now() - interval '1 minute' where id = $1", [expired.id])
    expect((await rejection(db.rpc(guest, 'preview_world_invite', { p_code: expired.code }))).code).toBe('WTEXP')
    expect((await rejection(join(guest, expired.code))).code).toBe('WTEXP')

    const revoked = await invite(me, boot.world.id)
    expect((await rejection(db.rpc(guest, 'revoke_world_invite', { p_invite: revoked.id }))).code).toBe('42501')
    await db.rpc(me, 'revoke_world_invite', { p_invite: revoked.id })
    expect((await rejection(db.rpc(guest, 'preview_world_invite', { p_code: revoked.code }))).code).toBe('WTINV')
    expect((await rejection(join(guest, revoked.code))).code).toBe('WTINV')
    const listed = await db.rpc<Array<{ id: string; revoked: boolean; expired: boolean }>>(me, 'list_world_invites', { p_world: boot.world.id })
    expect(listed.find(i => i.id === revoked.id)?.revoked).toBe(true)
    expect(listed.find(i => i.id === expired.id)?.expired).toBe(true)
  })

  it('gives anon nothing', async () => {
    for (const [fn, args] of [
      ['preview_world_invite', { p_code: 'AAAA-AAAA-AAAA' }], ['join_world', { p_code: 'AAAA-AAAA-AAAA' }],
      ['list_my_worlds', {}], ['create_world_invite', { p_world: crypto.randomUUID(), p_days: 7 }],
    ] as const) {
      expect((await rejection(db.rpc(ANON, fn, args))).code, fn).toBe('42501')
    }
    expect((await rejection(db.query(ANON, 'select * from public.world_invites'))).code).toBe('42501')
    expect((await rejection(db.query((await player()).me, 'select * from public.world_invites'))).code).toBe('42501')
  })
})

describe('joining', () => {
  it('makes the guest a resident with the first free house, and shows each to the other', async () => {
    const { me: owner, boot } = await player('Owner')
    const { me: guest, boot: guestBoot } = await player('Guest')
    const inv = await invite(owner, boot.world.id)
    expect(await join(guest, inv.code)).toEqual({ worldId: boot.world.id, joined: true })

    const ctx = await db.rpc<Context>(guest, 'enter_world', { p_world: boot.world.id })
    expect(ctx.world).toMatchObject({ id: boot.world.id, role: 'resident' })
    expect(ctx.houses.find(h => h.ownerId === guest.id)?.slot).toBe('house-b')
    expect(ctx.houses.find(h => h.ownerId === owner.id)?.slot).toBe('house-a')

    expect((await members(owner, boot.world.id)).map(m => [m.displayName, m.role, m.slot])).toEqual([
      ['Owner', 'owner', 'house-a'], ['Guest', 'resident', 'house-b'],
    ])
    const worlds = await db.rpc<Array<{ id: string; role: string; members: number }>>(guest, 'list_my_worlds')
    expect(worlds.map(w => [w.id, w.role, w.members])).toEqual([[guestBoot.world.id, 'owner', 1], [boot.world.id, 'resident', 2]])
    const uses = await db.rpc<Array<{ uses: number }>>(owner, 'list_world_invites', { p_world: boot.world.id })
    expect(uses[0]!.uses).toBe(1)
  })

  it('changes nothing when joining twice, or when the owner opens their own invitation', async () => {
    const { me: owner, boot } = await player()
    const { me: guest } = await player()
    const inv = await invite(owner, boot.world.id)
    await join(guest, inv.code)
    expect(await join(guest, inv.code)).toEqual({ worldId: boot.world.id, joined: false })
    expect(await join(owner, inv.code)).toEqual({ worldId: boot.world.id, joined: false })
    expect(await members(owner, boot.world.id)).toHaveLength(2)
    const owned = await db.superuser('select slot from public.houses where world_id = $1 and owner_id = $2', [boot.world.id, guest.id])
    expect(owned).toHaveLength(1)
    expect(await db.rpc(guest, 'preview_world_invite', { p_code: inv.code })).toMatchObject({ alreadyMember: true, members: 2 })
  })

  it('stops at 7 players', async () => {
    const { me: owner, boot } = await player()
    const inv = await invite(owner, boot.world.id)
    for (let i = 0; i < 6; i++) await join((await player()).me, inv.code)
    expect(await members(owner, boot.world.id)).toHaveLength(7)
    const late = (await player()).me
    expect(await db.rpc(late, 'preview_world_invite', { p_code: inv.code })).toMatchObject({ members: 7, max: 7 })
    expect((await rejection(join(late, inv.code))).code).toBe('WTFUL')
    expect(await db.superuser('select 1 from public.world_members where world_id = $1 and user_id = $2', [boot.world.id, late.id])).toHaveLength(0)
  })

  it('keeps strangers out of a world they were not invited to', async () => {
    const { me: owner, boot } = await player()
    const { me: stranger } = await player()
    for (const fn of ['enter_world', 'list_world_members', 'leave_world']) {
      expect((await rejection(db.rpc(stranger, fn, { p_world: boot.world.id }))).code, fn).toBe('42501')
    }
    expect((await rejection(db.rpc(stranger, 'remove_world_member', { p_world: boot.world.id, p_user: owner.id }))).code).toBe('42501')
    expect(await db.query(stranger, 'select * from public.worlds where id = $1', [boot.world.id])).toEqual([])
    // A made-up world id is no better.
    expect((await rejection(db.rpc(stranger, 'enter_world', { p_world: crypto.randomUUID() }))).code).toBe('42501')
  })
})

describe('leaving and removing', () => {
  it('lets a resident leave; their house is emptied for the next one', async () => {
    const { me: owner, boot } = await player()
    const { me: guest } = await player()
    await join(guest, (await invite(owner, boot.world.id)).code)
    const ctx = await db.rpc<Context>(guest, 'enter_world', { p_world: boot.world.id })
    const house = ctx.houses.find(h => h.ownerId === guest.id)!
    await db.rpc(guest, 'save_house_layout', { p_house: house.id, p_base_revision: 0, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] })
    expect(await db.superuser('select 1 from public.house_layouts where house_id = $1', [house.id])).toHaveLength(1)

    await db.rpc(guest, 'leave_world', { p_world: boot.world.id })
    expect((await rejection(db.rpc(guest, 'enter_world', { p_world: boot.world.id }))).code).toBe('42501')
    expect(await db.superuser('select 1 from public.house_layouts where house_id = $1', [house.id])).toHaveLength(0)
    const slot = await db.superuser<{ id: string; owner_id: string | null }>('select id, owner_id from public.houses where world_id = $1 and slot = $2', [boot.world.id, house.slot])
    expect(slot).toHaveLength(1)
    expect(slot[0]!.id).not.toBe(house.id)
    expect(slot[0]!.owner_id).toBeNull()
    expect(await members(owner, boot.world.id)).toHaveLength(1)
  })

  it('does not let the owner leave their own town', async () => {
    const { me, boot } = await player()
    expect((await rejection(db.rpc(me, 'leave_world', { p_world: boot.world.id }))).code).toBe('22023')
  })

  it('lets only the owner remove a resident, and never themselves', async () => {
    const { me: owner, boot } = await player()
    const { me: a } = await player()
    const { me: b } = await player()
    const code = (await invite(owner, boot.world.id)).code
    await join(a, code)
    await join(b, code)
    expect((await rejection(db.rpc(a, 'remove_world_member', { p_world: boot.world.id, p_user: b.id }))).code).toBe('42501')
    expect((await rejection(db.rpc(owner, 'remove_world_member', { p_world: boot.world.id, p_user: owner.id }))).code).toBe('22023')
    await db.rpc(owner, 'remove_world_member', { p_world: boot.world.id, p_user: b.id })
    expect((await members(owner, boot.world.id)).map(m => m.userId)).toEqual([owner.id, a.id])
    expect((await rejection(db.rpc(b, 'enter_world', { p_world: boot.world.id }))).code).toBe('42501')
    // They can come back with a valid invitation, into an empty house.
    await join(b, code)
    expect(await members(owner, boot.world.id)).toHaveLength(3)
  })
})

describe('realtime channel of a world', () => {
  it('is for its members only, for broadcast and presence', async () => {
    const { me: owner, boot } = await player()
    const { me: guest } = await player()
    const { me: stranger, boot: other } = await player()
    await join(guest, (await invite(owner, boot.world.id)).code)

    for (const ext of ['broadcast', 'presence'] as const) {
      expect(await db.realtimeAccess(owner, topic(boot.world.id), ext)).toEqual({ read: true, write: true })
      expect(await db.realtimeAccess(guest, topic(boot.world.id), ext)).toEqual({ read: true, write: true })
      expect(await db.realtimeAccess(stranger, topic(boot.world.id), ext)).toEqual({ read: false, write: false })
    }
    // Each member only in their own worlds.
    expect(await db.realtimeAccess(stranger, topic(other.world.id))).toEqual({ read: true, write: true })
    expect(await db.realtimeAccess(guest, topic(other.world.id))).toEqual({ read: false, write: false })
    expect(await db.realtimeAccess(ANON, topic(boot.world.id))).toEqual({ read: false, write: false })
  })

  it('refuses topics that are not a world, without error', async () => {
    const { me } = await player()
    for (const t of ['world:', 'world:not-a-uuid', 'lobby', `World:${crypto.randomUUID()}`, `world:${crypto.randomUUID()}x`, '']) {
      expect(await db.realtimeAccess(me, t), t).toEqual({ read: false, write: false })
    }
  })

  it('closes when the member leaves', async () => {
    const { me: owner, boot } = await player()
    const { me: guest } = await player()
    await join(guest, (await invite(owner, boot.world.id)).code)
    expect((await db.realtimeAccess(guest, topic(boot.world.id))).read).toBe(true)
    await db.rpc(guest, 'leave_world', { p_world: boot.world.id })
    expect(await db.realtimeAccess(guest, topic(boot.world.id))).toEqual({ read: false, write: false })
  })
})

describe('private functions (stabilization S4)', () => {
  it('lets signed-in users execute only what RLS policies and invoker functions need', async () => {
    const rows = await db.superuser<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)
    expect(rows.map(r => r.proname)).toEqual([
      'can_view_house', 'house_folder', 'house_path_allows', 'is_world_member', 'iso', 'owns_house',
      'realtime_world_member', 'shares_world', 'touch_updated_at',
    ])
    const anon = await db.superuser<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')`)
    expect(anon).toEqual([])
  })

  it('refuses a direct call to the functions that act on any world or user', async () => {
    const { me: owner, boot } = await player()
    const { me: guest } = await player()
    await join(guest, (await invite(owner, boot.world.id)).code)
    for (const sql of [
      `select private.drop_member('${boot.world.id}', '${guest.id}')`,
      `select private.player_context('${owner.id}', '${boot.world.id}')`,
      `select private.new_invite_code()`,
    ]) {
      expect((await rejection(db.query(guest, sql))).code, sql).toBe('42501')
    }
    expect(await members(owner, boot.world.id)).toHaveLength(2)
    // ...while the functions built on them still work for the people allowed to use them.
    await db.rpc(owner, 'remove_world_member', { p_world: boot.world.id, p_user: guest.id })
    expect(await members(owner, boot.world.id)).toHaveLength(1)
  })
})