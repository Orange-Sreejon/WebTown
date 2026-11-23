import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryHub } from './memory-hub.test-support'
import { GREET_RANGE_PX, WorldSession, type Member } from './world-session'
import type { GameEvent } from '../lib/multiplayer-link'

/**
 * M4: nearby detection, waving and emotes between real sessions over the in-memory hub, with the range checked
 * by the sender and by the receiver, cooldowns, spam and malformed messages.
 */

const WORLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const members: Member[] = [1, 2, 3].map(n => ({ userId: uid(n), displayName: `P${n}`, avatar: 'traveller' }))

let hub: MemoryHub
const sessions: WorldSession[] = []

function join(user: number, x: number, y = 100): { s: WorldSession; events: GameEvent[]; sessionId: string } {
  const sessionId = crypto.randomUUID()
  const s = new WorldSession({
    transport: hub.client(uid(user)), worldId: WORLD, userId: uid(user), sessionId,
    loadMembers: async () => members, selfAvatar: 'traveller',
  })
  const events: GameEvent[] = []
  s.onEvent(e => events.push(e))
  s.publish({ scene: 'town', x, y, facing: 'down', walking: false }, Date.now())
  void s.start()
  sessions.push(s)
  return { s, events, sessionId }
}
const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const emotes = () => hub.sent.filter(m => m.event === 'em')
const notices = (events: GameEvent[]) => events.filter(e => e.kind === 'notice').map(e => (e as { text: string }).text)

beforeEach(() => {
  vi.useFakeTimers()
  hub = new MemoryHub()
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
  vi.useRealTimers()
})

describe('nearby', () => {
  it('finds the nearest player within greeting range, and nobody beyond it', async () => {
    const a = join(1, 100)
    join(2, 130)
    join(3, 140)
    await settle()
    expect(a.s.nearestInRange('town', { x: 100, y: 100 }, Date.now())).toEqual({ id: uid(2), name: 'P2' })
    expect(a.s.nearestInRange('town', { x: 100 - GREET_RANGE_PX, y: 100 }, Date.now())).toBeNull()
    expect(a.s.nearestInRange('house:house-a', { x: 130, y: 100 }, Date.now())).toBeNull()
  })
})

describe('waving', () => {
  it('waves to the player next to you: you see it, they see it with a notice', async () => {
    const a = join(1, 100)
    const b = join(2, 130)
    await settle()
    a.s.wave()
    await settle()
    expect(a.events).toContainEqual({ kind: 'emote', from: uid(1), emote: 'wave', self: true })
    expect(b.events).toContainEqual({ kind: 'emote', from: uid(1), emote: 'wave' })
    expect(notices(b.events)).toEqual(['P1 waved at you'])
    expect(emotes()[0]!.payload).toMatchObject({ e: 'wave', to: b.sessionId })

    // And back.
    await settle(1000)
    b.s.wave()
    await settle()
    expect(notices(a.events)).toEqual(['P2 waved at you'])
  })

  it('says nobody is close enough, and sends nothing, when alone', async () => {
    const a = join(1, 100)
    join(2, 400)
    await settle()
    a.s.wave()
    await settle()
    expect(notices(a.events)).toEqual(['No one is close enough to wave to.'])
    expect(emotes()).toEqual([])
  })

  it('refuses to wave at someone out of range, with a reason', async () => {
    const a = join(1, 100)
    const b = join(2, 400)
    await settle()
    a.s.emote('wave', uid(2))
    await settle()
    expect(notices(a.events)).toEqual(['P2 is too far away to wave to.'])
    expect(emotes()).toEqual([])
    expect(b.events).toEqual([])
  })

  it('ignores a wave aimed at you from someone who is not close (a modified client)', async () => {
    const a = join(1, 100)
    const b = join(2, 600)
    await settle()
    hub.inject(`world:${WORLD}`, 'em', { v: 1, s: b.sessionId, q: 50, e: 'wave', to: a.sessionId })
    await settle()
    expect(a.events).toEqual([])
    expect(a.s.dropped).toBe(1)
    // The refused wave does not block the sender's later, honest emotes.
    await settle(1000)
    b.s.emote('heart')
    await settle()
    expect(a.events).toEqual([{ kind: 'emote', from: uid(2), emote: 'heart' }])
  })

  it('shows a wave aimed at someone else as a wave, without telling you', async () => {
    const a = join(1, 100)
    const b = join(2, 130)
    const c = join(3, 500)
    await settle()
    a.s.wave()
    await settle()
    expect(c.events).toEqual([{ kind: 'emote', from: uid(1), emote: 'wave' }])
    expect(notices(b.events)).toEqual(['P1 waved at you'])
  })
})

describe('emotes', () => {
  it('shows an emote to everyone in the world, whatever the distance', async () => {
    const a = join(1, 100)
    const b = join(2, 1000)
    await settle()
    a.s.emote('heart')
    await settle()
    expect(b.events).toEqual([{ kind: 'emote', from: uid(1), emote: 'heart' }])
  })

  it('allows one emote a second from you', async () => {
    const a = join(1, 100)
    join(2, 130)
    await settle()
    a.s.emote('laugh')
    a.s.emote('laugh')
    a.s.emote('surprise')
    await settle(1000)
    a.s.emote('surprise')
    expect(emotes().map(m => (m.payload as { e: string }).e)).toEqual(['laugh', 'surprise'])
  })

  it('shrugs off spam and malformed emotes from others', async () => {
    const a = join(1, 100)
    const b = join(2, 130)
    await settle()
    for (let q = 1; q <= 20; q++) hub.inject(`world:${WORLD}`, 'em', { v: 1, s: b.sessionId, q, e: 'heart' })
    hub.inject(`world:${WORLD}`, 'em', { v: 1, s: b.sessionId, q: 99, e: 'explode' })
    hub.inject(`world:${WORLD}`, 'em', { v: 1, s: b.sessionId, q: 100, e: 'heart', to: 'all' })
    hub.inject(`world:${WORLD}`, 'em', { v: 1, s: crypto.randomUUID(), q: 1, e: 'heart' })
    await settle()
    expect(a.events.filter(e => e.kind === 'emote')).toHaveLength(1)
    expect(a.s.dropped).toBe(22)
  })
})
