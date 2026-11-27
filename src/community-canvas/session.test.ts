import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase, type Caller } from '../cloud/database/test-database.test-support'
import { testBackend, type TestBackend } from '../cloud/database/test-backend.test-support'
import { MemoryHub, type HubClient } from '../multiplayer/memory-hub.test-support'
import { CHUNK, HOME_VIEW } from './geometry'
import { ANNOUNCE_GAP_MS, CanvasSession } from './session'

/**
 * The canvas session (CH-04) against the real database functions (PGlite) and an in-memory realtime hub. The
 * database's own announcements (realtime.send rows) are relayed to the hub as Supabase Realtime would.
 */

type User = Caller & { kind: 'user' }
const SIZE = { width: 800, height: 600 }

let db: TestDatabase
let hub: MemoryHub
let relayed = 0
let relay: ReturnType<typeof setInterval>
const sessions: CanvasSession[] = []

beforeAll(async () => {
  db = await TestDatabase.create()
  hub = new MemoryHub()
  // What Realtime does with realtime.send: deliver each new broadcast row to the topic's subscribers.
  relay = setInterval(() => {
    void db.superuser<{ id: number; topic: string; payload: unknown }>(
      "select id, topic, payload from realtime.messages where event = 'canvas' and id > $1 order by id", [relayed],
    ).then(rows => {
      for (const r of rows) {
        relayed = Math.max(relayed, r.id)
        hub.inject(r.topic, 'canvas', r.payload)
      }
    })
  }, 15)
}, 60_000)
afterAll(async () => {
  clearInterval(relay)
  await db.close()
})
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

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

interface Open { session: CanvasSession; backend: TestBackend; transport: HubClient; notices: string[] }
async function open(me: User, world: string): Promise<Open> {
  const backend = testBackend(db, me)
  const transport = hub.client(me.id)
  const session = new CanvasSession({ backend, transport, worldId: world, userId: me.id })
  sessions.push(session)
  const notices: string[] = []
  session.onNotice(t => notices.push(t))
  await session.start()
  session.setView(HOME_VIEW, SIZE)
  await vi.waitFor(() => expect(session.store.seq).not.toBeNull(), { timeout: 3000, interval: 10 })
  await vi.waitFor(() => expect(session.status).toBe('live'), { timeout: 3000, interval: 10 })
  return { session, backend, transport, notices }
}
const until = (check: () => void, timeout = 4000) => vi.waitFor(check, { timeout, interval: 10 })
/** Every announcement so far has been relayed (so one can't arrive late and stand in for a catch-up). */
async function relayDone(): Promise<void> {
  const [{ last }] = await db.superuser<{ last: number }>("select coalesce(max(id), 0)::int as last from realtime.messages where event = 'canvas'")
  await until(() => expect(relayed).toBeGreaterThanOrEqual(last!))
}

function draw(s: CanvasSession, points: Array<[number, number]>, tool: 'pen' | 'marker' = 'pen'): string {
  s.begin(tool, '#336699', 4, points[0]![0], points[0]![1])
  for (const [x, y] of points.slice(1)) s.extend(x, y)
  const id = s.current!.id
  s.end()
  return id
}
const ids = (s: CanvasSession) => s.store.inBox({ x1: -1e6, y1: -1e6, x2: 1e6, y2: 1e6 }).map(x => x.id)

describe('drawing together', () => {
  it("shows a stroke to the others as it is drawn, then as stored, by its author's name", async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    const bo = await open(b, world)
    ada.session.begin('marker', '#aa00cc', 8, 0, 0)
    ada.session.extend(10, 10)
    await until(() => expect(bo.session.previews.all().map(p => p.points)).toEqual([[0, 0, 10, 10]]))
    ada.session.extend(20, 0)
    const id = ada.session.current!.id
    ada.session.end()
    expect(ada.session.store.get(id)).toMatchObject({ pending: true })
    await until(() => expect(bo.session.store.get(id)).toMatchObject({ authorName: 'Ada', tool: 'marker', points: [0, 0, 10, 10, 20, 0] }))
    expect(bo.session.previews.all()).toEqual([])
    await until(() => expect(ada.session.store.get(id)).toMatchObject({ pending: false, authorName: 'Ada' }))
    expect(ada.session.unsaved).toBe(0)
  })

  it('undoes and redoes own strokes for everyone, and erases only what the player may', async () => {
    const { owner, a, b, world } = await town()
    const ada = await open(a, world)
    const bo = await open(b, world)
    const boss = await open(owner, world)
    const id = draw(ada.session, [[0, 0], [50, 0]])
    await until(() => expect(ids(bo.session)).toEqual([id]))
    ada.session.undo()
    await until(() => expect(ids(bo.session)).toEqual([]))
    ada.session.redo()
    await until(() => expect(ids(bo.session)).toEqual([id]))
    // Bo may not erase Ada's stroke; the eraser offers nothing.
    expect(bo.session.eraseAt(25, 0, 3)).toBe(false)
    // The owner (a moderator) may: hidden for everyone, logged.
    await until(() => expect(ids(boss.session)).toEqual([id]))
    expect(boss.session.eraseAt(25, 0, 3)).toBe(true)
    await until(() => expect(ids(ada.session)).toEqual([]))
    await until(() => expect(boss.session.unsaved).toBe(0))
    expect(await db.superuser("select action from public.community_moderation_log where world_id = $1", [world])).toEqual([{ action: 'hide_stroke' }])
    // Ada's redo stack is gone with her undo history? No: she can still undo her own redo, which the database refuses
    // (a moderator removed it), and the screen stays right.
    ada.session.undo()
    await until(() => expect(ada.session.unsaved).toBe(0))
    expect(ids(ada.session)).toEqual([])
  })

  it('erases own strokes with the eraser, and undoes the erase', async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    const bo = await open(b, world)
    const id = draw(ada.session, [[100, 100], [140, 100]])
    await until(() => expect(ada.session.unsaved).toBe(0))
    expect(ada.session.eraseAt(120, 101, 2)).toBe(true)
    await until(() => expect(ids(bo.session)).not.toContain(id))
    ada.session.undo()
    await until(() => expect(ids(bo.session)).toContain(id))
  })
})

describe('when things go wrong', () => {
  it('keeps a stroke drawn offline, says when it is not saved, and sends it once back online', async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    const bo = await open(b, world)
    ada.backend.offline = true
    ada.transport.goOffline()
    const id = draw(ada.session, [[5, 5], [9, 9]])
    await new Promise(r => setTimeout(r, 1200)) // a retry happened and failed
    expect(ada.session.unsaved).toBe(1)
    expect(ids(ada.session)).toContain(id)
    expect(ids(bo.session)).not.toContain(id)
    ada.backend.offline = false
    ada.transport.goOnline()
    // At once on reconnecting, not at the next backoff (2 s away by now).
    await until(() => expect(ids(bo.session)).toContain(id), 800)
    expect(ada.session.unsaved).toBe(0)
    expect(await db.superuser('select count(*)::int as n from public.canvas_strokes where id = $1', [id])).toEqual([{ n: 1 }])
  })

  it('reports "not saved yet" after a minute offline', async () => {
    const { a, world } = await town()
    const ada = await open(a, world)
    ada.backend.offline = true
    draw(ada.session, [[1, 1]])
    expect(ada.session.stale).toBe(false)
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    try {
      expect(ada.session.stale).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('catches up on everything missed while disconnected, without duplicates', async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    const bo = await open(b, world)
    bo.transport.goOffline()
    const drawn = [draw(ada.session, [[0, 0]]), draw(ada.session, [[10, 0]]), draw(ada.session, [[20, 0]])]
    await until(() => expect(ada.session.unsaved).toBe(0))
    ada.session.undo()
    await until(() => expect(ada.session.unsaved).toBe(0))
    await relayDone()
    expect(ids(bo.session)).toEqual([])
    bo.transport.goOnline()
    await until(() => expect(ids(bo.session)).toEqual(drawn.slice(0, 2)))
    expect(bo.session.store.seq).toBe(ada.session.store.seq)
  })

  it('puts the screen back and says why when the database refuses (a locked canvas)', async () => {
    const { owner, a, world } = await town()
    const ada = await open(a, world)
    await db.rpc(owner, 'set_hall_lock', { p_world: world, p_what: 'canvas', p_locked: true })
    const id = draw(ada.session, [[0, 0], [3, 3]])
    await until(() => expect(ada.notices.join()).toMatch(/locked/))
    expect(ada.session.store.get(id)).toBeUndefined()
    expect(ada.session.locked).toBe(true)
    expect(ada.session.canDraw).toBe(false)
    expect(ada.session.canUndo).toBe(false)
  })

  it('treats channel messages as hints only: a forged announcement or preview changes nothing stored', async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    const bo = await open(b, world)
    const id = draw(ada.session, [[0, 0]])
    await until(() => expect(ids(bo.session)).toEqual([id]))
    const calls = bo.backend.calls.length
    hub.inject(`hall:${world}`, 'canvas', { seq: 999_999, kind: 'clear', strokeIds: [id] })
    await until(() => expect(bo.backend.calls.length).toBeGreaterThan(calls))
    expect(ids(bo.session)).toEqual([id])
    for (const junk of [{ seq: 'x' }, null, { v: 1, id: 'nope', i: 0, p: [0, 0], t: 'pen', c: '#000000', w: 1 }]) {
      hub.inject(`hall:${world}`, 'canvas', junk)
      hub.inject(`hall:${world}`, 'preview', junk)
    }
    // A late preview of a stroke already stored is not shown again.
    hub.inject(`hall:${world}`, 'preview', { v: 1, id, i: 0, p: [0, 0, 9, 9], t: 'pen', c: '#000000', w: 1 })
    expect(bo.session.previews.all()).toEqual([])
    // A steady flood of announcements (one every 10 ms for 0.5 s) costs a catch-up every 250 ms, not one each.
    const before = bo.backend.calls.length
    const started = Date.now()
    for (let i = 0; i < 50; i++) {
      hub.inject(`hall:${world}`, 'canvas', { seq: 1_000_000 + i })
      await new Promise(r => setTimeout(r, 10))
    }
    await new Promise(r => setTimeout(r, 300))
    // However slow this machine is right now: at most one per 250 ms that passed, plus the first and a trailing one.
    expect(bo.backend.calls.length - before).toBeLessThanOrEqual(Math.ceil((Date.now() - started) / ANNOUNCE_GAP_MS) + 2)
  })

  it('stops when the player is no longer in the town', async () => {
    const { a, world } = await town()
    const ada = await open(a, world)
    await db.rpc(a, 'leave_world', { p_world: world })
    hub.inject(`hall:${world}`, 'canvas', { seq: 1_000_000 })
    await until(() => expect(ada.session.status).toBe('removed'))
    expect(ada.session.canDraw).toBe(false)
  })
})

describe('loading by area', () => {
  it('loads far areas only when the view goes there, and forgets them when it leaves', async () => {
    const { a, b, world } = await town()
    const ada = await open(a, world)
    const far = { x: 20 * CHUNK, y: 0 }
    ada.session.setView({ ...far, zoom: 1 }, SIZE)
    await until(() => expect(ada.session.store.isLoaded('20,0')).toBe(true))
    const id = draw(ada.session, [[far.x, far.y], [far.x + 5, far.y]])
    await until(() => expect(ada.session.unsaved).toBe(0))

    const bo = await open(b, world) // at home, far from it
    await until(() => expect(bo.session.store.seq).toBe(ada.session.store.seq))
    expect(bo.session.store.get(id)).toBeUndefined()
    bo.session.setView({ ...far, zoom: 1 }, SIZE)
    await until(() => expect(bo.session.store.get(id)).toBeDefined())
    bo.session.setView(HOME_VIEW, SIZE)
    expect(bo.session.store.get(id)).toBeUndefined()
    expect(bo.session.store.isLoaded('20,0')).toBe(false)
  })

  it('does not load while zoomed out too far', async () => {
    const { a, world } = await town()
    const ada = await open(a, world)
    const calls = ada.backend.calls.length
    ada.session.setView({ x: 100 * CHUNK, y: 0, zoom: 1 / 16 }, { width: 2000, height: 1200 })
    expect(ada.session.tooFar).toBe(true)
    await new Promise(r => setTimeout(r, 100))
    expect(ada.backend.calls.slice(calls)).toEqual([])
  })
})
