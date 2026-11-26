import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rejection, TestDatabase, type Caller } from './test-database.test-support'
import {
  displayNameOr, grantModerator, hallContext, listHallModerators, listModerationLog, parseHallContext, revokeModerator,
} from '../community'
import type { CloudBackend } from '../backend'
import { testBackend } from './test-backend.test-support'
import { PermissionError, StorageError, ValidationError } from '../../personal-spaces/errors'

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
      'can_view_house', 'house_folder', 'house_path_allows', 'is_hall_moderator', 'is_world_member', 'iso', 'owns_house',
      'realtime_hall_member', 'realtime_world_member', 'shares_world', 'touch_updated_at',
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

// ── Community Hall (CH-01) ────────────────────────────────────────────────────────────────────────────────────
// One Hall per world, moderators, the append-only moderation log, the Hall's realtime channel, and the client calls in
// src/cloud/community.ts. Kept in this file on purpose: it shares this file's PGlite, because every extra PGlite costs
// seconds of CPU and made unrelated tests time out when the whole suite runs at once.

const SERVICE: Caller = { kind: 'service' }


async function hallPlayer(name?: string): Promise<{ me: User; world: string }> {
  const me = await db.createUser()
  const boot = await db.rpc<{ world: { id: string } }>(me, 'bootstrap_player', name ? { p_display_name: name } : {})
  return { me, world: boot.world.id }
}
/** An owner's town with two residents. */
async function town(): Promise<{ owner: User; a: User; b: User; world: string }> {
  const { me: owner, world } = await hallPlayer('Owner')
  const { me: a } = await hallPlayer('Ada')
  const { me: b } = await hallPlayer('Bo')
  const inv = await db.rpc<{ code: string }>(owner, 'create_world_invite', { p_world: world, p_days: 1 })
  await db.rpc(a, 'join_world', { p_code: inv.code })
  await db.rpc(b, 'join_world', { p_code: inv.code })
  return { owner, a, b, world }
}
const role = async (me: User, world: string) => (await db.rpc<{ role: string }>(me, 'hall_context', { p_world: world })).role
const log = (me: User, world: string, args: Record<string, unknown> = {}) =>
  db.rpc<Array<{ id: number; action: string; target: { userId?: string }; reason: string | null; actorId: string | null; actorName: string | null; targetName: string | null }>>(
    me, 'list_moderation_log', { p_world: world, ...args })

describe('one Community Hall per world', () => {
  it('is created with every new world, and a second one is impossible', async () => {
    const { me, world } = await hallPlayer()
    expect(await db.superuser('select world_id, name from public.community_halls where world_id = $1', [world]))
      .toEqual([{ world_id: world, name: 'Community Hall' }])
    expect((await rejection(db.as(SERVICE, tx => tx.query('insert into public.community_halls (world_id) values ($1)', [world])))).code).toBe('23505')
    expect(await db.rpc(me, 'hall_context', { p_world: world }))
      .toEqual({ worldId: world, name: 'Community Hall', canvasLocked: false, draftLocked: false, role: 'owner' })
  })

  it('exists for every world, including those made before this migration (backfill)', async () => {
    const missing = await db.superuser('select w.id from public.worlds w left join public.community_halls h on h.world_id = w.id where h.world_id is null')
    expect(missing).toEqual([])
  })

  it('goes with its world', async () => {
    const { me, world } = await hallPlayer()
    await db.superuser('delete from auth.users where id = $1', [me.id])
    expect(await db.superuser('select 1 from public.community_halls where world_id = $1', [world])).toEqual([])
  })

  it('cannot be created, changed or removed by signed-in users directly', async () => {
    const { owner, world } = await town()
    for (const sql of [
      `insert into public.community_halls (world_id) values (gen_random_uuid())`,
      `update public.community_halls set canvas_locked = true where world_id = '${world}'`,
      `delete from public.community_halls where world_id = '${world}'`,
      `insert into public.world_moderators (world_id, user_id) values ('${world}', '${owner.id}')`,
      `insert into public.community_moderation_log (world_id, action) values ('${world}', 'publish')`,
    ]) {
      expect((await rejection(db.query(owner, sql))).code, sql).toBe('42501')
    }
  })
})

describe('roles', () => {
  it('owner, member, and strangers or other worlds or anon refused', async () => {
    const { owner, a, world } = await town()
    const { me: stranger, world: other } = await hallPlayer()
    expect(await role(owner, world)).toBe('owner')
    expect(await role(a, world)).toBe('member')
    expect(await role(stranger, other)).toBe('owner')
    for (const fn of ['hall_context', 'list_hall_moderators', 'list_moderation_log']) {
      expect((await rejection(db.rpc(stranger, fn, { p_world: world }))).code, fn).toBe('42501')
      expect((await rejection(db.rpc(ANON, fn, { p_world: world }))).code, `${fn} anon`).toBe('42501')
    }
    expect((await rejection(db.rpc(stranger, 'hall_context', { p_world: crypto.randomUUID() }))).code).toBe('42501')
    // Tables read directly: members see their Hall; a stranger sees nothing of it.
    expect(await db.query(a, 'select world_id from public.community_halls where world_id = $1', [world])).toHaveLength(1)
    expect(await db.query(stranger, 'select world_id from public.community_halls where world_id = $1', [world])).toEqual([])
    expect(await db.query(stranger, 'select * from public.world_moderators where world_id = $1', [world])).toEqual([])
  })

  it('lets only the owner appoint and remove moderators, who must be members', async () => {
    const { owner, a, b, world } = await town()
    const { me: stranger } = await hallPlayer()
    expect((await rejection(db.rpc(a, 'grant_moderator', { p_world: world, p_user: b.id }))).code).toBe('42501')
    expect((await rejection(db.rpc(owner, 'grant_moderator', { p_world: world, p_user: stranger.id }))).code).toBe('22023')
    expect((await rejection(db.rpc(owner, 'grant_moderator', { p_world: world, p_user: owner.id }))).code).toBe('22023')
    expect((await rejection(db.rpc(owner, 'revoke_moderator', { p_world: world, p_user: owner.id }))).code).toBe('22023')

    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id, p_reason: 'Helps a lot' })
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id }) // twice: no change
    expect(await role(a, world)).toBe('moderator')
    // A moderator still can't appoint or remove moderators.
    expect((await rejection(db.rpc(a, 'grant_moderator', { p_world: world, p_user: b.id }))).code).toBe('42501')
    expect((await rejection(db.rpc(a, 'revoke_moderator', { p_world: world, p_user: a.id }))).code).toBe('42501')

    const mods = await db.rpc<Array<{ userId: string; displayName: string | null; isOwner: boolean }>>(b, 'list_hall_moderators', { p_world: world })
    expect(mods.map(m => [m.userId, m.displayName, m.isOwner])).toEqual([[owner.id, 'Owner', true], [a.id, 'Ada', false]])

    await db.rpc(owner, 'revoke_moderator', { p_world: world, p_user: a.id })
    await db.rpc(owner, 'revoke_moderator', { p_world: world, p_user: a.id }) // twice: no change
    expect(await role(a, world)).toBe('member')
    expect((await log(owner, world)).map(e => e.action)).toEqual(['revoke_moderator', 'grant_moderator'])
  })

  it('ends a moderator role when the member leaves or is removed, and keeps what they did as "a former member"', async () => {
    const { owner, a, b, world } = await town()
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id })
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: b.id })
    await db.rpc(a, 'leave_world', { p_world: world })
    await db.rpc(owner, 'remove_world_member', { p_world: world, p_user: b.id })
    expect(await db.superuser('select user_id from public.world_moderators where world_id = $1', [world])).toEqual([])
    expect((await rejection(db.rpc(a, 'hall_context', { p_world: world }))).code).toBe('42501')
    const entries = await log(owner, world)
    expect(entries.map(e => [e.action, e.targetName])).toEqual([['grant_moderator', null], ['grant_moderator', null]])
    expect(entries.every(e => e.actorName === 'Owner')).toBe(true)
  })
})

describe('the moderation log', () => {
  it('is readable by moderators only, newest first, in pages', async () => {
    const { owner, a, b, world } = await town()
    expect((await rejection(log(a, world))).code).toBe('42501')
    for (let i = 0; i < 3; i++) {
      await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: b.id, p_reason: `round ${i}` })
      await db.rpc(owner, 'revoke_moderator', { p_world: world, p_user: b.id })
    }
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id })
    const all = await log(a, world) // a is a moderator now
    expect(all).toHaveLength(7)
    expect(all.map(e => e.id)).toEqual([...all.map(e => e.id)].sort((x, y) => y - x))
    expect(all[0]).toMatchObject({ action: 'grant_moderator', target: { userId: a.id }, actorId: owner.id, actorName: 'Owner', targetName: 'Ada' })
    const page = await log(owner, world, { p_limit: 2 })
    const next = await log(owner, world, { p_before: page[1]!.id, p_limit: 2 })
    expect(next.map(e => e.id)).toEqual(all.slice(2, 4).map(e => e.id))
    expect((await rejection(log(owner, world, { p_limit: 0 }))).code).toBe('22023')
    expect((await rejection(log(owner, world, { p_limit: 101 }))).code).toBe('22023')
    // Direct reads: moderators only, own world only.
    expect(await db.query(b, 'select id from public.community_moderation_log where world_id = $1', [world])).toEqual([])
    expect(await db.query(a, 'select id from public.community_moderation_log where world_id = $1', [world])).toHaveLength(7)
  })

  it('can never be changed or deleted, not even by the service role, but goes with its world', async () => {
    const { me: owner, world } = await hallPlayer()
    const { me: other } = await hallPlayer()
    const inv = await db.rpc<{ code: string }>(owner, 'create_world_invite', { p_world: world, p_days: 1 })
    await db.rpc(other, 'join_world', { p_code: inv.code })
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: other.id })
    for (const sql of [
      `update public.community_moderation_log set reason = 'edited' where world_id = '${world}'`,
      `delete from public.community_moderation_log where world_id = '${world}'`,
    ]) {
      expect((await rejection(db.as(SERVICE, tx => tx.query(sql)))).code, sql).toBe('42501')
    }
    expect(await db.superuser('select 1 from public.community_moderation_log where world_id = $1', [world])).toHaveLength(1)
    await db.superuser('delete from public.worlds where id = $1', [world])
    expect(await db.superuser('select 1 from public.community_moderation_log where world_id = $1', [world])).toEqual([])
  })

  it('rejects unreasonable reasons', async () => {
    const { owner, a, world } = await town()
    expect((await rejection(db.rpc(owner, 'grant_moderator', { p_world: world, p_user: a.id, p_reason: 'x'.repeat(501) }))).code).toBe('23514')
    expect(await role(a, world)).toBe('member') // nothing half-done
  })
})

describe("the Hall's realtime channel", () => {
  it('is for members of that world only, for broadcast and presence', async () => {
    const { owner, a, world } = await town()
    const { me: stranger, world: other } = await hallPlayer()
    for (const ext of ['broadcast', 'presence'] as const) {
      expect(await db.realtimeAccess(owner, `hall:${world}`, ext)).toEqual({ read: true, write: true })
      expect(await db.realtimeAccess(a, `hall:${world}`, ext)).toEqual({ read: true, write: true })
      expect(await db.realtimeAccess(stranger, `hall:${world}`, ext)).toEqual({ read: false, write: false })
    }
    expect(await db.realtimeAccess(stranger, `hall:${other}`)).toEqual({ read: true, write: true })
    expect(await db.realtimeAccess(a, `hall:${other}`)).toEqual({ read: false, write: false })
    expect(await db.realtimeAccess(ANON, `hall:${world}`)).toEqual({ read: false, write: false })
  })

  it('refuses topics that are not a Hall, and leaves the movement channel exactly as it was', async () => {
    const { owner, a, world } = await town()
    for (const t of ['hall:', 'hall:not-a-uuid', `Hall:${world}`, `hall:${world}x`, `hall:${world}:canvas`]) {
      expect(await db.realtimeAccess(owner, t), t).toEqual({ read: false, write: false })
    }
    expect(await db.realtimeAccess(a, `world:${world}`)).toEqual({ read: true, write: true })
    await db.rpc(a, 'leave_world', { p_world: world })
    expect(await db.realtimeAccess(a, `world:${world}`)).toEqual({ read: false, write: false })
    expect(await db.realtimeAccess(a, `hall:${world}`)).toEqual({ read: false, write: false })
  })
})

describe('private helpers', () => {
  it('cannot be called directly to log or name anyone', async () => {
    const { a, world } = await town()
    for (const sql of [
      `select private.log_moderation('${world}', 'publish', '{}', null)`,
      `select private.member_name('${world}', '${a.id}')`,
      `select private.need_hall_member('${world}')`,
    ]) {
      expect((await rejection(db.query(a, sql))).code, sql).toBe('42501')
    }
  })
})

// ── The client calls ──────────────────────────────────────────────────────────────────────────────────────────

async function clientFor(name: string): Promise<{ caller: Caller & { kind: 'user' }; backend: CloudBackend; world: string }> {
  const caller = await db.createUser()
  const boot = await db.rpc<{ world: { id: string } }>(caller, 'bootstrap_player', { p_display_name: name })
  return { caller, backend: testBackend(db, caller), world: boot.world.id }
}

describe('the Community Hall client calls (src/cloud/community.ts)', () => {
  it('reads the Hall and roles, appoints and removes moderators, and reads the log', async () => {
    const owner = await clientFor('Owner')
    const ada = await clientFor('Ada')
    const code = (await db.rpc<{ code: string }>(owner.caller, 'create_world_invite', { p_world: owner.world, p_days: 1 })).code
    await db.rpc(ada.caller, 'join_world', { p_code: code })
    const W = owner.world

    expect(await hallContext(owner.backend, W)).toEqual({ worldId: W, name: 'Community Hall', canvasLocked: false, draftLocked: false, role: 'owner' })
    expect((await hallContext(ada.backend, W)).role).toBe('member')

    await grantModerator(owner.backend, W, ada.caller.id, 'Keeps things tidy')
    expect((await hallContext(ada.backend, W)).role).toBe('moderator')
    expect((await listHallModerators(ada.backend, W)).map(m => [m.displayName, m.isOwner])).toEqual([['Owner', true], ['Ada', false]])

    const entries = await listModerationLog(ada.backend, W)
    expect(entries).toEqual([expect.objectContaining({
      action: 'grant_moderator', target: { userId: ada.caller.id }, reason: 'Keeps things tidy',
      actorId: owner.caller.id, actorName: 'Owner', targetName: 'Ada',
    })])

    await revokeModerator(owner.backend, W, ada.caller.id)
    expect((await hallContext(ada.backend, W)).role).toBe('member')
    expect((await listModerationLog(owner.backend, W, { limit: 1 }))[0]!.action).toBe('revoke_moderator')
  })

  it("turns the database's refusals into the app's own errors", async () => {
    const owner = await clientFor('Owner')
    const stranger = await clientFor('Stranger')
    await expect(hallContext(stranger.backend, owner.world)).rejects.toBeInstanceOf(PermissionError)
    await expect(grantModerator(stranger.backend, owner.world, stranger.caller.id)).rejects.toBeInstanceOf(PermissionError)
    await expect(grantModerator(owner.backend, owner.world, stranger.caller.id)).rejects.toBeInstanceOf(ValidationError)
    await expect(listModerationLog(owner.backend, owner.world, { limit: 500 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses malformed answers instead of showing them', () => {
    for (const raw of [null, [], { worldId: 'x' }, { worldId: crypto.randomUUID(), name: 'H', canvasLocked: 'no', draftLocked: false, role: 'owner' },
      { worldId: crypto.randomUUID(), name: 'H', canvasLocked: false, draftLocked: false, role: 'admin' }]) {
      expect(() => parseHallContext(raw), JSON.stringify(raw)).toThrow(StorageError)
    }
  })

  it('shows people who left as "a former member"', () => {
    expect(displayNameOr(null)).toBe('a former member')
    expect(displayNameOr('Ada')).toBe('Ada')
  })
})
