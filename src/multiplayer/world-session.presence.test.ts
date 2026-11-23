import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryHub, type HubClient } from './memory-hub.test-support'
import { LEAVE_GRACE_MS, WorldSession, type Member, type SessionEvent } from './world-session'
import type { LocalState } from '../lib/multiplayer-link'

/**
 * M2: presence between real session objects over an in-memory realtime hub: who is here, names from the member
 * list only, one character per player, joins, leaves, disconnects, reconnects, refusal, and world isolation.
 */

const WORLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_WORLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = (): string => crypto.randomUUID()

let hub: MemoryHub
let members: Member[]
const sessions: WorldSession[] = []

function join(user: number, options: { world?: string; client?: HubClient; at?: Partial<LocalState>; sessionId?: string } = {}): { session: WorldSession; client: HubClient; events: SessionEvent[] } {
  const client = options.client ?? hub.client(uid(user))
  const session = new WorldSession({
    transport: client, worldId: options.world ?? WORLD, userId: uid(user), sessionId: options.sessionId ?? sid(),
    loadMembers: async () => members.filter(m => options.world !== OTHER_WORLD || m.userId === uid(user)),
    selfAvatar: 'traveller-0', lostAfterMs: 10_000,
  })
  const events: SessionEvent[] = []
  session.subscribe(e => events.push(e))
  session.publish({ scene: 'town', x: 100 * user, y: 200, facing: 'down', walking: false, ...options.at }, Date.now())
  void session.start()
  sessions.push(session)
  return { session, client, events }
}

const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  hub = new MemoryHub()
  members = [1, 2, 3].map(n => ({ userId: uid(n), displayName: `Player ${n}`, avatar: `traveller-${n}` }))
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
  vi.useRealTimers()
})

describe('presence', () => {
  it('shows each player to the other, with the name and look from the member list', async () => {
    const a = join(1)
    const b = join(2)
    await settle()
    expect(a.session.status).toBe('joined')
    expect(a.session.remotes('town', 0)).toEqual([
      { id: uid(2), name: 'Player 2', avatar: 'traveller-2', x: 200, y: 200, facing: 'down', walking: false, snap: true },
    ])
    expect(b.session.remotes('town', 0).map(r => [r.id, r.name, r.x])).toEqual([[uid(1), 'Player 1', 100]])
    // Only the first frame snaps.
    expect(a.session.remotes('town', 0)[0]!.snap).toBe(false)
  })

  it('announces a newcomer, but not the players already there when you arrive', async () => {
    const a = join(1)
    await settle()
    const b = join(2)
    await settle()
    expect(a.events).toContainEqual({ kind: 'joined', userId: uid(2), name: 'Player 2' })
    expect(b.events.filter(e => e.kind === 'joined')).toEqual([])
  })

  it('removes a player who leaves, after a short grace, and says so', async () => {
    const a = join(1)
    const b = join(2)
    await settle()
    b.session.stop()
    await settle()
    expect(a.session.remotes('town', 0)).toHaveLength(1)
    await settle(LEAVE_GRACE_MS + 10)
    expect(a.session.remotes('town', 0)).toEqual([])
    expect(a.events).toContainEqual({ kind: 'left', userId: uid(2), name: 'Player 2' })
  })

  it('removes a player whose connection drops, and keeps nothing duplicated when they come back', async () => {
    const a = join(1)
    const b = join(2)
    await settle()
    b.client.goOffline()
    await settle()
    expect(b.session.status).toBe('reconnecting')
    await settle(LEAVE_GRACE_MS + 10)
    expect(a.session.remotes('town', 0)).toEqual([])

    b.client.goOnline()
    await settle()
    expect(b.session.status).toBe('joined')
    expect(a.session.remotes('town', 0).map(r => r.id)).toEqual([uid(2)])
    expect(b.session.remotes('town', 0).map(r => r.id)).toEqual([uid(1)])
  })

  it('does not flicker a player who reconnects within the grace period', async () => {
    const a = join(1)
    const b = join(2)
    await settle()
    b.client.goOffline()
    await settle(200)
    b.client.goOnline()
    await settle(LEAVE_GRACE_MS + 10)
    expect(a.session.remotes('town', 0).map(r => r.id)).toEqual([uid(2)])
    expect(a.events.filter(e => e.kind === 'left')).toEqual([])
  })

  it('shows one character for a player with two tabs: the newest', async () => {
    const a = join(1)
    join(2, { at: { x: 300 } })
    await settle(5)
    join(2, { at: { x: 700 } })
    await settle()
    expect(a.session.remotes('town', 0).map(r => [r.id, r.x])).toEqual([[uid(2), 700]])
  })

  it('never shows yourself, even from another tab', async () => {
    const a = join(1)
    join(1, { at: { x: 900 } })
    await settle()
    expect(a.session.remotes('town', 0)).toEqual([])
  })

  it('ignores presence of someone who is not a member, and entries that lie about their key', async () => {
    const a = join(1)
    await settle()
    const stranger = '99999999-9999-4999-8999-999999999999'
    const s = sid()
    hub.fakePresence(`world:${WORLD}`, s, { v: 1, s, u: stranger, j: 1, q: 0, sc: 'town', x: 1, y: 1, f: 'down' })
    const t = sid()
    hub.fakePresence(`world:${WORLD}`, t, { v: 1, s: sid(), u: uid(3), j: 1, q: 0, sc: 'town', x: 1, y: 1, f: 'down' })
    hub.fakePresence(`world:${WORLD}`, sid(), { v: 1, junk: true })
    await settle(10_000)
    expect(a.session.remotes('town', 0)).toEqual([])
  })

  it('picks up a member who joined the world after the session started', async () => {
    members = members.slice(0, 1)
    const a = join(1)
    await settle()
    members = [...members, { userId: uid(2), displayName: 'New', avatar: 'traveller-2' }]
    join(2)
    await settle(6000)
    expect(a.session.remotes('town', 0).map(r => r.name)).toEqual(['New'])
  })

  it('gives a nameless member a safe name', async () => {
    members[1] = { ...members[1]!, displayName: '   ' }
    const a = join(1)
    join(2)
    await settle()
    expect(a.session.remotes('town', 0)[0]!.name).toBe('Player')
  })

  it('keeps worlds apart', async () => {
    const a = join(1)
    join(2, { world: OTHER_WORLD })
    await settle()
    expect(a.session.remotes('town', 0)).toEqual([])
    expect(hub.subscribers(`world:${WORLD}`)).toBe(1)
    expect(hub.subscribers(`world:${OTHER_WORLD}`)).toBe(1)
  })

  it('fails, and stops, when the server refuses the channel', async () => {
    hub.allow = user => user !== uid(2)
    const b = join(2)
    await settle()
    expect(b.session.status).toBe('failed')
    expect(hub.subscribers(`world:${WORLD}`)).toBe(0)
  })

  it('reports a connection lost after a long outage, and Retry starts over', async () => {
    const a = join(1)
    join(2)
    await settle()
    a.client.goOffline()
    await settle(10_001)
    expect(a.session.status).toBe('lost')
    expect(a.session.remotes('town', 0)).toEqual([])
    a.client.online = true
    a.session.retry()
    await settle()
    expect(a.session.status).toBe('joined')
    expect(a.session.remotes('town', 0)).toHaveLength(1)
  })

  it('shows others only in the scene they are in', async () => {
    const a = join(1)
    const b = join(2)
    await settle()
    b.session.publish({ scene: 'house:house-b', x: 40, y: 50, facing: 'up', walking: false }, Date.now())
    await settle()
    expect(a.session.remotes('town', 0)).toEqual([])
    expect(a.session.remotes('house:house-b', 0).map(r => [r.x, r.y, r.facing, r.snap])).toEqual([[40, 50, 'up', true]])
  })

  it('re-publishes presence at most once a second while walking, and at once on stopping', async () => {
    join(1)
    const b = join(2)
    await settle()
    const updates = (): number => hub.presenceUpdates.get(`world:${WORLD}`) ?? 0
    const before = updates()
    for (let i = 1; i <= 5; i++) {
      b.session.publish({ scene: 'town', x: 200 + i, y: 200, facing: 'right', walking: true }, Date.now())
      await settle(100)
    }
    expect(updates() - before).toBe(0)
    await settle(600)
    expect(updates() - before).toBe(1)
    b.session.publish({ scene: 'town', x: 210, y: 200, facing: 'right', walking: false }, Date.now())
    await settle()
    expect(updates() - before).toBe(2)
  })
  it('leaves the channel and goes quiet when stopped', async () => {
    const a = join(1)
    await settle()
    a.session.stop()
    expect(a.session.status).toBe('stopped')
    expect(hub.subscribers(`world:${WORLD}`)).toBe(0)
  })
})
