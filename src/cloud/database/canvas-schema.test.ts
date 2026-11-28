import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rejection, TestDatabase, type Caller } from './test-database.test-support'
import { testBackend } from './test-backend.test-support'
import {
  addCanvasStroke, canvasOpsSince, canvasStrokesIn, clearCanvasRegion, hideCanvasStroke, restoreCanvasStroke, setHallLock,
} from '../canvas'
import { PermissionError, ValidationError } from '../../personal-spaces/errors'

/**
 * The Community Hall's shared canvas (CH-03) on real PostgreSQL: strokes, the operation log, erase/undo/restore,
 * moderation, locks, viewport loads, catch-up, and the announcements on `hall:<uuid>`, with members, moderators,
 * strangers, other worlds and anon.
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

interface Stroke { id: string; authorId: string | null; authorName: string | null; tool: string; color: string; width: number; points: number[]; hidden: boolean }
interface Op { seq: number; kind: string; strokeId: string | null; actorId: string | null; stroke?: Stroke | null; region?: Record<string, number>; strokeIds?: string[] }
interface View { seq: number; strokes: Stroke[]; truncated: boolean }

const add = (me: User, world: string, over: Record<string, unknown> = {}) =>
  db.rpc<Op>(me, 'add_canvas_stroke', { p_world: world, p_id: crypto.randomUUID(), p_tool: 'pen', p_color: '#336699', p_width: 4, p_points: [0, 0, 10, 10], ...over })
const hide = (me: User, world: string, id: string, reason: string, note?: string) =>
  db.rpc<Op | null>(me, 'hide_canvas_stroke', { p_world: world, p_id: id, p_reason: reason, ...(note ? { p_note: note } : {}) })
const restore = (me: User, world: string, id: string) => db.rpc<Op | null>(me, 'restore_canvas_stroke', { p_world: world, p_id: id })
const view = (me: Caller, world: string, box = [-1_000_000, -1_000_000, 1_000_000, 1_000_000], limit?: number) =>
  db.rpc<View>(me, 'canvas_strokes_in', { p_world: world, p_x1: box[0], p_y1: box[1], p_x2: box[2], p_y2: box[3], ...(limit !== undefined ? { p_limit: limit } : {}) })
const since = (me: Caller, world: string, seq: number, limit?: number) =>
  db.rpc<{ ops: Op[]; more: boolean }>(me, 'canvas_ops_since', { p_world: world, p_seq: seq, ...(limit !== undefined ? { p_limit: limit } : {}) })
const lock = (me: User, world: string, what: string, locked: boolean) => db.rpc(me, 'set_hall_lock', { p_world: world, p_what: what, p_locked: locked })
const logActions = async (world: string) =>
  (await db.superuser<{ action: string }>('select action from public.community_moderation_log where world_id = $1 order by id', [world])).map(r => r.action)
const bbox = async (id: string) => (await db.superuser<{ b: string }>('select bbox::text as b from public.canvas_strokes where id = $1', [id]))[0]!.b

/** Strokes stored directly, as if drawn earlier (for the limits); `ago` keeps them out of the per-minute window. */
const seed = (world: string, author: string, n: number, ago = '2 minutes') => db.superuser(
  `insert into public.canvas_strokes (id, world_id, author_id, tool, color, width, points, bbox, created_at)
   select gen_random_uuid(), $1, $2, 'pen', '#000000', 1, '{0,0}', box(point(0, 0), point(1, 1)), now() - $4::interval
   from generate_series(1, $3)`, [world, author, n, ago])

describe('adding strokes', () => {
  it('stores the stroke with its author and a bounding box computed by the database', async () => {
    const { a, world } = await town()
    const id = crypto.randomUUID()
    const op = await add(a, world, { p_id: id, p_points: [10, 20, -30, 5, 40, 60], p_width: 5 })
    expect(op).toMatchObject({ kind: 'add', strokeId: id, actorId: a.id, stroke: {
      id, authorId: a.id, authorName: 'Ada', tool: 'pen', color: '#336699', width: 5, points: [10, 20, -30, 5, 40, 60], hidden: false,
    } })
    expect(op.seq).toBeGreaterThan(0)
    // Points span x -30..40, y 5..60; padded by ceil(5 / 2) = 3.
    expect(await bbox(id)).toBe('(43,63),(-33,2)')
    const single = await add(a, world, { p_points: [7, 7], p_width: 1 })
    expect(await bbox(single.strokeId!)).toBe('(8,8),(6,6)')
  })

  it('stores a stroke sent twice once, and refuses to reuse someone else\'s id', async () => {
    const { a, b, world } = await town()
    const { me: other, world: otherWorld } = await player('Other')
    const id = crypto.randomUUID()
    const first = await add(a, world, { p_id: id })
    // A retry after a reconnect, even with different content, returns what was stored.
    expect(await add(a, world, { p_id: id, p_color: '#ff0000' })).toEqual(first)
    expect(await db.superuser('select color from public.canvas_strokes where id = $1', [id])).toEqual([{ color: '#336699' }])
    expect(await db.superuser("select count(*)::int as n from public.canvas_ops where stroke_id = $1", [id])).toEqual([{ n: 1 }])
    expect((await rejection(add(b, world, { p_id: id }))).code).toBe('42501')
    expect((await rejection(add(other, otherWorld, { p_id: id }))).code).toBe('42501')
  })

  it('refuses tools, colours, widths and points WebTown does not have', async () => {
    const { a, world } = await town()
    const big = Array.from({ length: 4002 }, () => 1)
    for (const over of [
      { p_tool: 'spray' }, { p_tool: null }, { p_color: 'red' }, { p_color: '#FFFFFF' }, { p_color: '#fff' }, { p_color: "#000000'; --" },
      { p_width: 0 }, { p_width: 65 }, { p_width: null }, { p_points: [] }, { p_points: [1] }, { p_points: [1, 2, 3] }, { p_points: big },
      { p_points: [0, 0, 1_000_001, 0] }, { p_points: [0, -1_000_001] }, { p_points: null }, { p_points: [1, null] }, { p_id: null },
    ]) {
      expect((await rejection(add(a, world, over))).code, JSON.stringify(over).slice(0, 80)).toBe('22023')
    }
    expect(await add(a, world, { p_points: [1_000_000, -1_000_000], p_width: 64, p_tool: 'marker', p_color: '#ffffff' })).toMatchObject({ kind: 'add' })
    expect(await add(a, world, { p_points: Array.from({ length: 4000 }, (_, i) => i) })).toMatchObject({ kind: 'add' })
    expect((await rejection(add(a, world, { p_points: [[1, 2], [3, 4]] }))).code).toBe('22023')
    expect(await db.superuser('select count(*)::int as n from public.canvas_strokes where world_id = $1', [world])).toEqual([{ n: 2 }])
  })

  it('lets a member add 60 strokes a minute and 1,500 a day', async () => {
    const { a, b, world } = await town()
    await seed(world, a.id, 59, '10 seconds')
    await add(a, world)
    expect((await rejection(add(a, world))).message).toContain('Slow down')
    await add(b, world) // the limit is per member
    await seed(world, b.id, 1499, '2 hours')
    expect((await rejection(add(b, world))).message).toContain('for one day')
  })

  it('holds at most 20,000 visible strokes per Hall, counting only visible ones', async () => {
    const { owner, a, world } = await town()
    await seed(world, owner.id, 19_999, '3 days')
    const last = await add(a, world)
    expect((await rejection(add(a, world))).message).toContain('canvas is full')
    await hide(a, world, last.strokeId!, 'erased')
    await add(a, world)
    // Restoring counts too.
    expect((await rejection(restore(a, world, last.strokeId!))).message).toContain('canvas is full')
  }, 30_000)

  it('is refused on a locked canvas, except to moderators', async () => {
    const { owner, a, b, world } = await town()
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: b.id })
    const mine = await add(a, world)
    await lock(owner, world, 'canvas', true)
    expect((await rejection(add(a, world))).message).toContain('locked')
    expect((await rejection(hide(a, world, mine.strokeId!, 'undone'))).message).toContain('locked')
    await add(owner, world)
    await add(b, world)
    await lock(owner, world, 'canvas', false)
    await add(a, world)
  })
})

describe('erasing, undoing and restoring', () => {
  it('lets the author erase or undo and redo their own stroke', async () => {
    const { a, b, world } = await town()
    const s = await add(a, world)
    expect((await rejection(hide(b, world, s.strokeId!, 'erased'))).code).toBe('42501')
    expect(await hide(a, world, s.strokeId!, 'undone')).toMatchObject({ kind: 'hide', strokeId: s.strokeId, actorId: a.id })
    expect(await hide(a, world, s.strokeId!, 'undone')).toBeNull() // already hidden: nothing changes
    expect((await rejection(restore(b, world, s.strokeId!))).code).toBe('42501')
    expect(await restore(a, world, s.strokeId!)).toMatchObject({ kind: 'restore', stroke: { id: s.strokeId, hidden: false } })
    expect(await restore(a, world, s.strokeId!)).toBeNull()
    expect((await rejection(hide(a, world, s.strokeId!, 'deleted'))).code).toBe('22023')
    expect((await rejection(hide(a, world, crypto.randomUUID(), 'erased'))).code).toBe('22023')
    expect(await logActions(world)).toEqual([]) // erasing your own drawing is not moderation
  })

  it('lets moderators remove anyone\'s stroke and bring it back, logged; never overruling an author\'s own erase', async () => {
    const { owner, a, b, world } = await town()
    const s = await add(a, world)
    expect((await rejection(hide(b, world, s.strokeId!, 'moderated'))).code).toBe('42501')
    await db.rpc(owner, 'grant_moderator', { p_world: world, p_user: b.id })
    await hide(b, world, s.strokeId!, 'moderated', 'Not nice')
    // The author can't bring back what a moderator removed.
    expect((await rejection(restore(a, world, s.strokeId!))).code).toBe('42501')
    await restore(owner, world, s.strokeId!)
    const erased = await add(a, world)
    await hide(a, world, erased.strokeId!, 'erased')
    expect((await rejection(restore(owner, world, erased.strokeId!))).code).toBe('42501')
    expect(await logActions(world)).toEqual(['grant_moderator', 'hide_stroke', 'restore_stroke'])
    const entry = await db.superuser<{ target: Record<string, string>; reason: string; actor_id: string }>(
      "select target, reason, actor_id from public.community_moderation_log where world_id = $1 and action = 'hide_stroke'", [world])
    expect(entry).toEqual([{ target: { strokeId: s.strokeId, authorId: a.id }, reason: 'Not nice', actor_id: b.id }])
  })

  it('shows hidden drawing only to its author and moderators', async () => {
    const { owner, a, b, world } = await town()
    const s = await add(a, world)
    await hide(a, world, s.strokeId!, 'erased')
    const read = (me: User) => db.query(me, 'select id from public.canvas_strokes where id = $1', [s.strokeId])
    expect(await read(a)).toHaveLength(1)
    expect(await read(owner)).toHaveLength(1)
    expect(await read(b)).toEqual([])
    // Nor through the log: the 'add' no longer carries it.
    const ops = (await since(b, world, 0)).ops
    expect(ops.map(o => [o.kind, o.stroke ?? null])).toEqual([['add', null], ['hide', null]])
    expect((await view(b, world)).strokes).toEqual([])
  })
})

describe('clearing and locking', () => {
  it('lets moderators clear the visible strokes touching an area, as one logged operation', async () => {
    const { owner, a, b, world } = await town()
    const inside = await add(a, world, { p_points: [10, 10, 20, 20] })
    const edge = await add(b, world, { p_points: [100, 100, 104, 104], p_width: 10 }) // padded by 5: its box 95..109 touches the area
    const outside = await add(a, world, { p_points: [500, 500, 600, 600] })
    const gone = await add(a, world, { p_points: [15, 15] })
    await hide(a, world, gone.strokeId!, 'erased')
    expect((await rejection(db.rpc(a, 'clear_canvas_region', { p_world: world, p_x1: 0, p_y1: 0, p_x2: 96, p_y2: 96 }))).code).toBe('42501')
    // Corners in any order.
    const op = await db.rpc<Op>(owner, 'clear_canvas_region', { p_world: world, p_x1: 96, p_y1: 96, p_x2: 0, p_y2: 0, p_note: 'Fresh start' })
    expect(op).toMatchObject({ kind: 'clear', strokeId: null, region: { x1: 0, y1: 0, x2: 96, y2: 96 } })
    expect([...op.strokeIds!].sort()).toEqual([inside.strokeId, edge.strokeId].sort())
    expect((await view(a, world)).strokes.map(s => s.id)).toEqual([outside.strokeId])
    expect(await db.rpc(owner, 'clear_canvas_region', { p_world: world, p_x1: 0, p_y1: 0, p_x2: 96, p_y2: 96 })).toBeNull()
    expect((await rejection(db.rpc(owner, 'clear_canvas_region', { p_world: world, p_x1: 0, p_y1: 0, p_x2: 2_000_000, p_y2: 1 }))).code).toBe('22023')
    expect(await logActions(world)).toEqual(['clear_region'])
    // A cleared stroke can be brought back by a moderator only.
    expect((await rejection(restore(a, world, inside.strokeId!))).code).toBe('42501')
    await restore(owner, world, inside.strokeId!)
    expect(await logActions(world)).toEqual(['clear_region', 'restore_stroke'])
  })

  it('locks and unlocks the canvas and the draft, moderators only, logging only real changes', async () => {
    const { owner, a, world } = await town()
    expect((await rejection(lock(a, world, 'canvas', true))).code).toBe('42501')
    await lock(owner, world, 'canvas', true)
    await lock(owner, world, 'canvas', true)
    await lock(owner, world, 'draft', true)
    await lock(owner, world, 'draft', false)
    expect(await db.rpc(a, 'hall_context', { p_world: world })).toMatchObject({ canvasLocked: true, draftLocked: false })
    expect((await rejection(lock(owner, world, 'website', true))).code).toBe('22023')
    expect((await rejection(db.rpc(owner, 'set_hall_lock', { p_world: world, p_what: 'canvas', p_locked: null }))).code).toBe('22023')
    expect(await logActions(world)).toEqual(['lock_canvas', 'lock_draft', 'unlock_draft'])
    // Each real change is announced on the Hall channel as a hint (20261228090000); the repeat is not.
    const sent = await db.superuser<{ payload: unknown }>("select payload from realtime.messages where topic = $1 and event = 'lock' order by id", [`hall:${world}`])
    expect(sent.map(s => s.payload)).toEqual([{ what: 'canvas', locked: true }, { what: 'draft', locked: true }, { what: 'draft', locked: false }])
    const [{ granted }] = await db.superuser<{ granted: boolean }>("select has_function_privilege('anon', 'public.set_hall_lock(uuid, text, boolean, text)', 'execute') as granted")
    expect(granted).toBe(false)
  })
})

describe('reading the canvas', () => {
  it('returns the visible strokes touching an area, oldest first, with the newest operation number', async () => {
    const { a, b, world } = await town()
    const s1 = await add(a, world, { p_points: [0, 0, 50, 50] })
    const s2 = await add(b, world, { p_points: [1000, 1000] })
    const s3 = await add(a, world, { p_points: [40, 40, 45, 45] })
    const area = await view(b, world, [-10, -10, 60, 60])
    expect(area.strokes.map(s => s.id)).toEqual([s1.strokeId, s3.strokeId])
    expect(area).toMatchObject({ seq: s3.seq, truncated: false })
    expect((await view(b, world, [999, 999, 1001, 1001])).strokes.map(s => s.id)).toEqual([s2.strokeId])
    expect((await view(b, world, [-10, -10, 2000, 2000], 2))).toMatchObject({ truncated: true, strokes: [{ id: s1.strokeId }, { id: s2.strokeId }] })
    for (const limit of [0, 5001]) {
      expect((await rejection(view(b, world, undefined, limit))).code, String(limit)).toBe('22023')
    }
    expect((await rejection(view(b, world, [0, 0, 1_000_001, 1]))).code).toBe('22023')
  })

  it('gives the changes after a sequence number, in order and in pages', async () => {
    const { a, world } = await town()
    const s = await add(a, world)
    await hide(a, world, s.strokeId!, 'undone')
    await restore(a, world, s.strokeId!)
    const all = await since(a, world, 0)
    expect(all.more).toBe(false)
    expect(all.ops.map(o => o.kind)).toEqual(['add', 'hide', 'restore'])
    expect(all.ops.map(o => o.seq)).toEqual([...all.ops.map(o => o.seq)].sort((x, y) => x - y))
    // The add carries the stroke again now it is visible.
    expect(all.ops[0]!.stroke).toMatchObject({ id: s.strokeId })
    const page = await since(a, world, 0, 2)
    expect(page).toMatchObject({ more: true })
    expect(page.ops.map(o => o.kind)).toEqual(['add', 'hide'])
    expect((await since(a, world, page.ops[1]!.seq)).ops.map(o => o.kind)).toEqual(['restore'])
    expect(await since(a, world, all.ops[2]!.seq)).toEqual({ ops: [], more: false })
    for (const [seq, limit] of [[-1, 10], [0, 1001]] as const) {
      expect((await rejection(since(a, world, seq, limit))).code).toBe('22023')
    }
  })

  it("keeps a former member's drawing, without their name", async () => {
    const { owner, a, world } = await town()
    const s = await add(a, world)
    await db.rpc(a, 'leave_world', { p_world: world })
    expect((await view(owner, world)).strokes).toEqual([expect.objectContaining({ id: s.strokeId, authorId: a.id, authorName: null })])
    expect((await rejection(add(a, world))).code).toBe('42501')
    expect((await rejection(view(a, world))).code).toBe('42501')
  })
})

describe('who may use the canvas', () => {
  it('is members of that world only; strangers, other worlds and anon get nothing', async () => {
    const { a, world } = await town()
    const { me: stranger, world: other } = await player('Stranger')
    const s = await add(a, world)
    for (const caller of [stranger, ANON] as Caller[]) {
      for (const [fn, args] of [
        ['add_canvas_stroke', { p_world: world, p_id: crypto.randomUUID(), p_tool: 'pen', p_color: '#000000', p_width: 1, p_points: [0, 0] }],
        ['hide_canvas_stroke', { p_world: world, p_id: s.strokeId, p_reason: 'moderated' }],
        ['restore_canvas_stroke', { p_world: world, p_id: s.strokeId }],
        ['clear_canvas_region', { p_world: world, p_x1: -10, p_y1: -10, p_x2: 10, p_y2: 10 }],
        ['set_hall_lock', { p_world: world, p_what: 'canvas', p_locked: true }],
        ['canvas_strokes_in', { p_world: world, p_x1: -10, p_y1: -10, p_x2: 10, p_y2: 10 }],
        ['canvas_ops_since', { p_world: world, p_seq: 0 }],
      ] as const) {
        expect((await rejection(db.rpc(caller, fn, args))).code, `${caller.kind} ${fn}`).toBe('42501')
      }
    }
    // The stranger's own Hall knows nothing of the stroke.
    expect((await rejection(hide(stranger, other, s.strokeId!, 'moderated'))).code).toBe('22023')
    expect(await db.query(stranger, 'select id from public.canvas_strokes')).toEqual([])
    expect(await db.query(stranger, 'select seq from public.canvas_ops where world_id = $1', [world])).toEqual([])
    expect((await rejection(db.query(ANON, 'select id from public.canvas_strokes'))).code).toBe('42501')
  })

  it('cannot be written directly, only through the functions', async () => {
    const { owner, a, world } = await town()
    const s = await add(a, world)
    for (const sql of [
      `insert into public.canvas_strokes (id, world_id, author_id, tool, color, width, points, bbox)
       values (gen_random_uuid(), '${world}', '${owner.id}', 'pen', '#000000', 1, '{0,0}', box(point(0,0), point(1,1)))`,
      `update public.canvas_strokes set hidden_at = now(), hidden_reason = 'erased' where id = '${s.strokeId}'`,
      `delete from public.canvas_strokes where id = '${s.strokeId}'`,
      `insert into public.canvas_ops (world_id, kind, stroke_id) values ('${world}', 'add', gen_random_uuid())`,
      `delete from public.canvas_ops where world_id = '${world}'`,
      `select private.canvas_record('${world}', 'add', gen_random_uuid(), null, null)`,
      `select private.canvas_need_unlocked('${world}')`,
    ]) {
      expect((await rejection(db.query(owner, sql))).code, sql.slice(0, 60)).toBe('42501')
    }
  })

  it('goes with its world', async () => {
    const { me, world } = await player('Gone')
    await add(me, world)
    await db.superuser('delete from public.worlds where id = $1', [world])
    expect(await db.superuser('select 1 from public.canvas_strokes where world_id = $1 union all select 1 from public.canvas_ops where world_id = $1', [world])).toEqual([])
  })
})

describe('announcements on the Hall channel', () => {
  it('come from changes committed one at a time per Hall, in sequence order (20261220090000)', async () => {
    // PGlite has one connection, so concurrency can't be run here; instead every writer must take the Hall's row
    // lock before touching a stroke (same order everywhere: no deadlock), and canvas_record must insist on it.
    const LOCK = /perform 1 from public\.community_halls h where h\.world_id = p_world for update;/
    for (const fn of ['public.add_canvas_stroke', 'public.hide_canvas_stroke', 'public.restore_canvas_stroke', 'public.clear_canvas_region', 'private.canvas_record']) {
      const [{ full }] = await db.superuser<{ full: string }>(`select pg_get_functiondef('${fn}'::regproc) as full`)
      const def = full!.slice(full!.search(/^begin$/m)) // the body, after the declarations
      const lockAt = def.search(LOCK)
      expect(lockAt, fn).toBeGreaterThan(0)
      const firstStrokeTouch = def.search(/public\.canvas_strokes|public\.canvas_ops \(/)
      expect(lockAt, `${fn} locks the Hall before touching strokes or ops`).toBeLessThan(firstStrokeTouch)
    }
    // create or replace kept the grants.
    const rows = await db.superuser<{ proname: string; auth: boolean; anon: boolean }>(`select p.proname,
        has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('hide_canvas_stroke', 'clear_canvas_region') order by 1`)
    expect(rows).toEqual([{ proname: 'clear_canvas_region', auth: true, anon: false }, { proname: 'hide_canvas_stroke', auth: true, anon: false }])
    const [{ granted }] = await db.superuser<{ granted: boolean }>("select has_function_privilege('authenticated', 'private.canvas_record(uuid, text, uuid, box, uuid[])', 'execute') as granted")
    expect(granted).toBe(false)
  })
  const sent = (world: string) => db.superuser<{ payload: Record<string, unknown>; event: string; extension: string; private: boolean }>(
    "select payload, event, extension, private from realtime.messages where topic = $1 order by id", [`hall:${world}`])

  it('announces each committed change as { seq, kind } on hall:<uuid>, privately, and nothing for refusals', async () => {
    const { owner, a, b, world } = await town()
    const s = await add(a, world)
    await add(a, world, { p_id: s.strokeId }) // a retry: no new change
    await rejection(hide(b, world, s.strokeId!, 'erased'))
    await hide(a, world, s.strokeId!, 'erased')
    await restore(a, world, s.strokeId!)
    const clear = await db.rpc<Op>(owner, 'clear_canvas_region', { p_world: world, p_x1: -5, p_y1: -5, p_x2: 5, p_y2: 5 })
    const ops = (await since(a, world, 0)).ops
    expect(await sent(world)).toEqual(ops.map(o => ({ payload: { seq: o.seq, kind: o.kind }, event: 'canvas', extension: 'broadcast', private: true })))
    expect(ops[ops.length - 1]!.seq).toBe(clear.seq)
    // Not on the movement channel.
    expect(await db.superuser("select 1 from realtime.messages where topic = $1", [`world:${world}`])).toEqual([])
  })

  it('still stores the change when the announcement fails', async () => {
    const { a, world } = await town()
    await db.superuser('alter function realtime.send(jsonb, text, text, boolean) rename to send_off')
    try {
      const s = await add(a, world)
      expect((await view(a, world)).strokes.map(x => x.id)).toEqual([s.strokeId])
      expect(await sent(world)).toEqual([])
    } finally {
      await db.superuser('alter function realtime.send_off(jsonb, text, text, boolean) rename to send')
    }
    await add(a, world)
    expect(await sent(world)).toHaveLength(1)
  })
})

// ── The client calls (src/cloud/canvas.ts) ──────────────────────────────────────────────────────────────────

describe('the canvas client calls', () => {
  it('draws, erases, restores, clears, locks, reads and catches up', async () => {
    const { owner, a, world } = await town()
    const ada = testBackend(db, a)
    const boss = testBackend(db, owner)
    const id = crypto.randomUUID()
    const input = { id, tool: 'marker' as const, color: '#aa00cc', width: 12, points: [0, 0, 30, 40] }
    const op = await addCanvasStroke(ada, world, input)
    expect(op).toMatchObject({ kind: 'add', strokeId: id, actorId: a.id, stroke: { ...input, authorId: a.id, authorName: 'Ada', hidden: false } })
    expect(await addCanvasStroke(ada, world, input)).toEqual(op)

    expect(await hideCanvasStroke(ada, world, id, 'undone')).toMatchObject({ kind: 'hide', strokeId: id })
    expect(await hideCanvasStroke(ada, world, id, 'undone')).toBeNull()
    expect(await restoreCanvasStroke(ada, world, id)).toMatchObject({ kind: 'restore', stroke: { id } })

    const v = await canvasStrokesIn(ada, world, { x1: -100, y1: -100, x2: 100, y2: 100 })
    expect(v).toMatchObject({ truncated: false, strokes: [{ id }] })
    const clear = await clearCanvasRegion(boss, world, { x1: -100, y1: -100, x2: 100, y2: 100 }, 'Tidy')
    expect(clear).toMatchObject({ kind: 'clear', strokeIds: [id], region: { x1: -100, y1: -100, x2: 100, y2: 100 } })
    const after = await canvasOpsSince(ada, world, v.seq)
    expect(after).toEqual({ ops: [clear], more: false })

    await setHallLock(boss, world, 'canvas', true)
    await expect(addCanvasStroke(ada, world, { ...input, id: crypto.randomUUID() })).rejects.toThrow(/locked/)
  })

  it("turns the database's refusals into the app's own errors, and checks strokes before sending them", async () => {
    const { a, b, world } = await town()
    const ada = testBackend(db, a)
    const bo = testBackend(db, b)
    const sid = crypto.randomUUID()
    await addCanvasStroke(ada, world, { id: sid, tool: 'pen', color: '#000000', width: 2, points: [1, 1] })
    await expect(hideCanvasStroke(bo, world, sid, 'erased')).rejects.toBeInstanceOf(PermissionError)
    await expect(hideCanvasStroke(bo, world, crypto.randomUUID(), 'erased')).rejects.toBeInstanceOf(ValidationError)
    const before = ada.calls.length
    await expect(addCanvasStroke(ada, world, { id: crypto.randomUUID(), tool: 'pen', color: '#000000', width: 99, points: [1, 1] }))
      .rejects.toBeInstanceOf(ValidationError)
    await expect(canvasStrokesIn(ada, world, { x1: 0, y1: 0, x2: 1.5, y2: 1 })).rejects.toBeInstanceOf(ValidationError)
    await expect(canvasOpsSince(ada, world, -1)).rejects.toBeInstanceOf(ValidationError)
    expect(ada.calls.length).toBe(before) // refused before reaching the network
  })
})
