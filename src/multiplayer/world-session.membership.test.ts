import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryHub, type HubClient } from './memory-hub.test-support'
import { LEAVE_GRACE_MS, MEMBER_POLL_MS, MEMBER_REFRESH_MS, WorldSession, type Member, type SessionEvent } from './world-session'

/**
 * Stabilization B1: membership changes while players are online. A member removed from the world must disappear
 * for everyone and learn it themselves, without anyone reconnecting; names and looks changed in the database must
 * show; a non-member's presence must not make every player reload the member list over and over.
 */

const WORLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let hub: MemoryHub
/** The database's member list right now. */
let members: Member[]
const sessions: WorldSession[] = []
const loads = new Map<string, number>()

function join(user: number): { s: WorldSession; client: HubClient; events: SessionEvent[] } {
  const client = hub.client(uid(user))
  const s = new WorldSession({
    transport: client, worldId: WORLD, userId: uid(user), sessionId: crypto.randomUUID(), selfAvatar: 'red-cap',
    // As the database answers list_world_members: refused (null) for someone who is not a member.
    loadMembers: async () => {
      loads.set(uid(user), (loads.get(uid(user)) ?? 0) + 1)
      return members.some(m => m.userId === uid(user)) ? members.map(m => ({ ...m })) : null
    },
  })
  const events: SessionEvent[] = []
  s.subscribe(e => events.push(e))
  s.publish({ scene: 'town', x: 100 * user, y: 200, facing: 'down', walking: false }, Date.now())
  void s.start()
  sessions.push(s)
  return { s, client, events }
}

const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const ids = (s: WorldSession): string[] => s.remotes('town', Date.now()).map(r => r.id).sort()

beforeEach(() => {
  vi.useFakeTimers()
  hub = new MemoryHub()
  members = [1, 2, 3].map(n => ({ userId: uid(n), displayName: `P${n}`, avatar: 'red-cap' }))
  loads.clear()
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
  vi.useRealTimers()
})

describe('a member removed while online', () => {
  it('disappears for everyone at the next member reload, and is told so, leaving the channel', async () => {
    const a = join(1)
    const b = join(2)
    const c = join(3)
    await settle()
    expect(ids(a.s)).toEqual([uid(2), uid(3)])

    members = members.filter(m => m.userId !== uid(2)) // the owner removes B
    await settle(MEMBER_POLL_MS + 10)

    expect(ids(a.s)).toEqual([uid(3)])
    expect(ids(c.s)).toEqual([uid(1)])
    expect(b.s.status).toBe('removed')
    expect(b.events).toContainEqual({ kind: 'status', status: 'removed' })
    expect(b.s.remotes('town', Date.now())).toEqual([])
    expect(hub.subscribers(`world:${WORLD}`)).toBe(2)

    // B's game goes on, but sends nothing more and never rejoins, even with Retry.
    const sent = hub.sent.length
    b.s.publish({ scene: 'town', x: 260, y: 200, facing: 'right', walking: true }, Date.now())
    b.s.emote('heart')
    b.s.retry()
    await settle(MEMBER_POLL_MS * 2)
    expect(hub.sent.length).toBe(sent)
    expect(b.s.status).toBe('removed')
    expect(hub.subscribers(`world:${WORLD}`)).toBe(2)
  })

  it('disappears at once for the player who removed them (membersChanged)', async () => {
    const a = join(1)
    join(2)
    await settle()
    members = members.filter(m => m.userId !== uid(2))
    a.s.membersChanged()
    await settle()
    expect(ids(a.s)).toEqual([])
  })

  it('stays hidden even if their client keeps announcing itself, without a reload every few seconds', async () => {
    const a = join(1)
    const b = join(2)
    await settle()
    members = members.filter(m => m.userId !== uid(2))
    a.s.membersChanged()
    await settle()
    // A modified client: still in the channel, still tracking presence (the server only re-checks later).
    const key = crypto.randomUUID()
    hub.fakePresence(`world:${WORLD}`, key, { v: 1, s: key, u: uid(2), j: Date.now() + 1, q: 0, sc: 'town', x: 5, y: 5, f: 'down' })
    const before = loads.get(uid(1))!
    for (let i = 0; i < 6; i++) {
      hub.fakePresence(`world:${WORLD}`, crypto.randomUUID(), { v: 1, s: key, u: uid(2), j: Date.now() + 2 + i, q: 0, sc: 'town', x: 5, y: 5, f: 'down' })
      await settle(MEMBER_REFRESH_MS)
    }
    expect(ids(a.s)).toEqual([])
    // Only the regular poll (at most one in this time), not one per presence change.
    expect(loads.get(uid(1))! - before).toBeLessThanOrEqual(1)
    expect(b.s.status === 'removed' || b.s.status === 'joined').toBe(true)
  })

  it('shows a renamed member with the new name, and a new look, at the next reload', async () => {
    const a = join(1)
    join(2)
    await settle()
    members = members.map(m => (m.userId === uid(2) ? { ...m, displayName: 'Renamed', avatar: 'pink-cap' } : m))
    await settle(MEMBER_POLL_MS + 10)
    expect(a.s.remotes('town', Date.now())[0]).toMatchObject({ id: uid(2), name: 'Renamed', avatar: 'pink-cap' })
  })

  it('ends as removed, never joining, when the player is not a member at the start', async () => {
    members = members.filter(m => m.userId !== uid(2))
    join(1)
    const b = join(2)
    await settle(LEAVE_GRACE_MS)
    expect(b.s.status).toBe('removed')
    expect(hub.subscribers(`world:${WORLD}`)).toBe(1)
  })

  it('changes nothing when the member list cannot be loaded (offline): still joined, everyone still shown', async () => {
    const a = join(1)
    join(2)
    await settle()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const original = members
    members = new Proxy([], { get: () => { throw new Error('Failed to fetch') } }) as unknown as Member[]
    await settle(MEMBER_POLL_MS + 10)
    members = original
    warn.mockRestore()
    expect(a.s.status).toBe('joined')
    expect(ids(a.s)).toEqual([uid(2)])
  })
})
