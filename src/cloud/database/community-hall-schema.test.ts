import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rejection, TestDatabase, type Caller } from './test-database.test-support'

/**
 * CH-01 on real PostgreSQL: one Community Hall per world, moderators, the append-only moderation log and the Hall's
 * realtime channel, with an owner, residents, a moderator, a stranger, another world and `anon`.
 */

interface Context { profile: { id: string }; world: { id: string } }
type User = Caller & { kind: 'user' }
const ANON: Caller = { kind: 'anon' }
const SERVICE: Caller = { kind: 'service' }

let db: TestDatabase
beforeAll(async () => { db = await TestDatabase.create() }, 60_000)
afterAll(async () => { await db.close() })

async function player(name?: string): Promise<{ me: User; world: string }> {
  const me = await db.createUser()
  const boot = await db.rpc<Context>(me, 'bootstrap_player', name ? { p_display_name: name } : {})
  return { me, world: boot.world.id }
}
/** An owner's town with two residents. */
async function town(): Promise<{ owner: User; a: User; b: User; world: string }> {
  const { me: owner, world } = await player('Owner')
  const { me: a } = await player('Ada')
  const { me: b } = await player('Bo')
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
    const { me, world } = await player()
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
    const { me, world } = await player()
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
    const { me: stranger, world: other } = await player()
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
    const { me: stranger } = await player()
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
    const { me: owner, world } = await player()
    const { me: other } = await player()
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
    const { me: stranger, world: other } = await player()
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
