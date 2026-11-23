import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryHub, type HubClient } from './memory-hub.test-support'
import { RENDER_DELAY_MS, STALE_WALK_MS } from './interpolation'
import { RESYNC_MS, SENDER_BURST, WorldSession, type Member } from './world-session'
import type { LocalState } from '../lib/multiplayer-link'

/**
 * M3: movement between real sessions over the in-memory hub: what is sent (throttled, nothing while standing),
 * what is accepted (order, speed, rate, bounds), how it is drawn (interpolated, extrapolated briefly, jumps on
 * scene changes), delay, reconnects and world isolation.
 */

const WORLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let hub: MemoryHub
const members: Member[] = [1, 2, 3].map(n => ({ userId: uid(n), displayName: `P${n}`, avatar: 'traveller' }))
const sessions: WorldSession[] = []

function join(user: number, world = WORLD): { s: WorldSession; client: HubClient; sessionId: string } {
  const client = hub.client(uid(user))
  const sessionId = crypto.randomUUID()
  const s = new WorldSession({
    transport: client, worldId: world, userId: uid(user), sessionId,
    loadMembers: async () => members, selfAvatar: 'traveller',
  })
  s.publish({ scene: 'town', x: 100, y: 100, facing: 'down', walking: false }, Date.now())
  void s.start()
  sessions.push(s)
  return { s, client, sessionId }
}

const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const moves = (from = uid(2)) => hub.sent.filter(m => m.event === 'mv' && m.from === from)

/** Walks `b` right at the real walk speed for `ms`, one frame every 16 ms. */
async function walkRight(b: WorldSession, fromX: number, ms: number, y = 100): Promise<number> {
  let x = fromX
  for (let t = 0; t < ms; t += 16) {
    x += 80 * 0.016
    b.publish({ scene: 'town', x, y, facing: 'right', walking: true }, Date.now())
    await settle(16)
  }
  return x
}
const stand = (b: WorldSession, x: number, extra: Partial<LocalState> = {}): void =>
  b.publish({ scene: 'town', x, y: 100, facing: 'right', walking: false, ...extra }, Date.now())

beforeEach(() => {
  vi.useFakeTimers()
  hub = new MemoryHub()
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
  vi.useRealTimers()
})

describe('sending', () => {
  it('sends at most 10 moves a second while walking, one when stopping, none while standing', async () => {
    join(1)
    const { s: b } = join(2)
    await settle()
    const x = await walkRight(b, 100, 1000)
    expect(moves().length).toBeGreaterThanOrEqual(9)
    expect(moves().length).toBeLessThanOrEqual(11)
    const walking = moves().length
    stand(b, x)
    expect(moves()).toHaveLength(walking + 1)
    expect(moves()[moves().length - 1]!.payload).toMatchObject({ w: 0 })
    for (let i = 0; i < 60; i++) {
      stand(b, x)
      await settle(16)
    }
    expect(moves()).toHaveLength(walking + 1)
  })

  it('sends nothing at all before the channel is joined, or after it is lost', async () => {
    const { s: b, client } = join(2)
    b.publish({ scene: 'town', x: 120, y: 100, facing: 'right', walking: true }, Date.now())
    expect(moves()).toHaveLength(0)
    await settle()
    client.goOffline()
    await walkRight(b, 120, 500)
    expect(moves()).toHaveLength(0)
  })
})

describe('receiving', () => {
  it('draws the other player walking smoothly along their path', async () => {
    const { s: a } = join(1)
    const { s: b } = join(2)
    await settle()
    await walkRight(b, 100, 1500)
    let last = -Infinity
    const xs: number[] = []
    for (let i = 0; i < 30; i++) {
      const [r] = a.remotes('town', Date.now())
      expect(r!.walking).toBe(true)
      expect(r!.facing).toBe('right')
      xs.push(r!.x)
      expect(r!.x).toBeGreaterThanOrEqual(last)
      last = r!.x
      await walkRight(b, 100 + 80 * 1.5 + i * 1.28, 16)
    }
    const steps = xs.slice(1).map((x, i) => x - xs[i]!)
    expect(Math.max(...steps)).toBeLessThan(4)
  })

  it('stops the other player where they stopped', async () => {
    const { s: a } = join(1)
    const { s: b } = join(2)
    await settle()
    const x = await walkRight(b, 100, 600)
    stand(b, x)
    await settle(RENDER_DELAY_MS + 50)
    const [r] = a.remotes('town', Date.now())
    expect(r!.x).toBeCloseTo(Math.round(x * 10) / 10, 1)
    expect(r!.walking).toBe(false)
  })

  it('holds still, not walking in place, when messages stop arriving', async () => {
    const { s: a } = join(1)
    const { s: b, client } = join(2)
    await settle()
    await walkRight(b, 100, 500)
    client.goOffline()
    await settle(STALE_WALK_MS + RENDER_DELAY_MS + 50)
    const [r] = a.remotes('town', Date.now())
    expect(r?.walking ?? false).toBe(false)
  })

  it('copes with delayed messages arriving in a bunch', async () => {
    const { s: a, client } = join(1)
    const { s: b } = join(2)
    await settle()
    client.hold = true
    const x = await walkRight(b, 100, 800)
    client.hold = false
    client.release()
    stand(b, x)
    await settle(RENDER_DELAY_MS + 50)
    expect(a.remotes('town', Date.now())[0]!.x).toBeCloseTo(Math.round(x * 10) / 10, 1)
    expect(a.dropped).toBe(0)
  })

  it('drops stale, out-of-order, malformed, out-of-bounds and impossibly fast moves', async () => {
    const { s: a } = join(1)
    const { sessionId } = join(2)
    await settle()
    const topic = `world:${WORLD}`
    const mv = (q: number, x: number, extra: Record<string, unknown> = {}) => hub.inject(topic, 'mv', { v: 1, s: sessionId, q, t: q * 100, sc: 'town', x, y: 100, f: 'right', w: 1, ...extra })
    const x = (): number => a.remotes('town', Date.now() + 1000)[0]!.x

    mv(5, 104)
    await settle(50)
    expect(x()).toBe(104)
    mv(4, 300) // older
    mv(5, 300) // repeated
    mv(6, 9999) // outside the map
    mv(7, 104, { f: 'sideways' })
    hub.inject(topic, 'mv', 'garbage')
    hub.inject(topic, 'mv', null)
    mv(8, 400) // 296 px in 50 ms
    await settle(50)
    expect(x()).toBe(104)
    expect(a.dropped).toBe(7)

    // After a long silence, a far position is accepted as a jump.
    await settle(RESYNC_MS + 10)
    mv(9, 400)
    await settle(10)
    const [r] = a.remotes('town', Date.now() + 1000)
    expect(r!.x).toBe(400)
  })

  it('limits how many messages one sender can push', async () => {
    const { s: a } = join(1)
    const { sessionId } = join(2)
    await settle()
    for (let q = 1; q <= 200; q++) hub.inject(`world:${WORLD}`, 'mv', { v: 1, s: sessionId, q, t: q, sc: 'town', x: 100, y: 100, f: 'right', w: 1 })
    expect(a.dropped).toBeGreaterThanOrEqual(200 - SENDER_BURST)
  })

  it('ignores moves pretending to be from sessions that are not here, and its own echo', async () => {
    const { s: a, sessionId: mine } = join(1)
    join(2)
    await settle()
    hub.inject(`world:${WORLD}`, 'mv', { v: 1, s: crypto.randomUUID(), q: 1, t: 1, sc: 'town', x: 5, y: 5, f: 'up', w: 1 })
    hub.inject(`world:${WORLD}`, 'mv', { v: 1, s: mine, q: 1, t: 1, sc: 'town', x: 5, y: 5, f: 'up', w: 1 })
    await settle(3000)
    expect(a.remotes('town', Date.now()).map(r => r.x)).toEqual([100])
  })

  it('moves the player to another scene at once, and only shows them there', async () => {
    const { s: a } = join(1)
    const { s: b } = join(2)
    await settle()
    b.publish({ scene: 'house:house-b', x: 60, y: 80, facing: 'up', walking: false }, Date.now())
    await settle()
    expect(a.remotes('town', Date.now())).toEqual([])
    const [r] = a.remotes('house:house-b', Date.now())
    expect(r).toMatchObject({ x: 60, y: 80, snap: true })
    b.publish({ scene: 'town', x: 300, y: 300, facing: 'down', walking: false }, Date.now())
    await settle()
    expect(a.remotes('house:house-b', Date.now())).toEqual([])
    expect(a.remotes('town', Date.now())[0]).toMatchObject({ x: 300, y: 300, snap: true })
  })

  it('carries on after a reconnect, with one character', async () => {
    const { s: a } = join(1)
    const { s: b, client } = join(2)
    await settle()
    client.goOffline()
    await settle(500)
    client.goOnline()
    await settle()
    const x = await walkRight(b, 100, 400)
    stand(b, x)
    await settle(RENDER_DELAY_MS + 50)
    const drawn = a.remotes('town', Date.now())
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.x).toBeCloseTo(Math.round(x * 10) / 10, 1)
  })

  it('starts walking at walking pace after standing a while (no slow creep from the old spot)', async () => {
    const { s: a } = join(1)
    const { s: b } = join(2)
    await settle(3000) // standing for a while
    await walkRight(b, 100, 600)
    const xs: number[] = []
    for (let i = 0; i < 10; i++) {
      xs.push(a.remotes('town', Date.now())[0]!.x)
      await walkRight(b, 100 + 80 * 0.6 + i * 1.28, 16)
    }
    const speed = (xs[9]! - xs[0]!) / (9 * 16) // px per ms
    expect(speed).toBeGreaterThan(0.05)
  })

  it('never lets an older presence update pull a walking player back', async () => {
    const { s: a } = join(1)
    const { s: b, sessionId } = join(2)
    await settle()
    const x = await walkRight(b, 100, 1200)
    stand(b, x)
    await settle(1500)
    // Presence published before the last moves (a smaller q), arriving late.
    hub.fakePresence(`world:${WORLD}`, sessionId, { v: 1, s: sessionId, u: uid(2), j: 0, q: 1, sc: 'town', x: 100, y: 100, f: 'right' })
    await settle(500)
    expect(a.remotes('town', Date.now())[0]!.x).toBeCloseTo(Math.round(x * 10) / 10, 1)
  })

  it('never carries movement into another world', async () => {
    const { s: a } = join(1)
    const { s: c } = join(3, OTHER)
    await settle()
    await walkRight(c, 100, 500)
    expect(a.remotes('town', Date.now())).toEqual([])
    expect(hub.sent.every(m => m.topic === `world:${OTHER}`)).toBe(true)
  })
})
