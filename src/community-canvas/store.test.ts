import { describe, expect, it } from 'vitest'
import type { CanvasOp, CanvasStroke } from '../cloud/canvas'
import { CHUNK } from './geometry'
import { CanvasStore, toShown } from './store'

let n = 0
const uuid = (): string => `0b6c1c4e-8f0e-4c7e-9d7a-${String(++n).padStart(12, '0')}`
const stroke = (points: number[], over: Partial<CanvasStroke> = {}): CanvasStroke => ({
  id: uuid(), authorId: null, authorName: null, tool: 'pen', color: '#000000', width: 2, points,
  createdAt: '2026-12-20T09:00:00.000Z', hidden: false, ...over,
})
const base = (seq: number) => ({ seq, actorId: null, createdAt: '2026-12-20T09:00:00.000Z' })
const add = (seq: number, s: CanvasStroke | null, id = s!.id): CanvasOp => ({ ...base(seq), kind: 'add', strokeId: id, stroke: s })
const hide = (seq: number, id: string): CanvasOp => ({ ...base(seq), kind: 'hide', strokeId: id })

describe('CanvasStore', () => {
  it('ignores operations until the first load, then applies each once, in order', () => {
    const store = new CanvasStore()
    const a = stroke([10, 10])
    expect(store.apply(add(1, a))).toBe(false)
    store.load(['0,0'], [], 5)
    expect(store.seq).toBe(5)
    expect(store.apply(add(5, a))).toBe(false) // already reflected in the load
    expect(store.apply(add(6, a))).toBe(true)
    expect(store.apply(add(6, a))).toBe(false) // a duplicate
    expect(store.get(a.id)).toMatchObject({ id: a.id, pending: false })
    expect(store.apply(hide(7, a.id))).toBe(true)
    expect(store.get(a.id)).toBeUndefined()
    expect(store.seq).toBe(7)
  })

  it('keeps only strokes in loaded chunks', () => {
    const store = new CanvasStore()
    const near = stroke([10, 10])
    const far = stroke([5 * CHUNK, 5 * CHUNK])
    const spanning = stroke([-3 * CHUNK, 0, 3 * CHUNK, 0]) // crosses the loaded chunk
    store.load(['0,0'], [near, far, spanning], 1)
    expect(store.get(near.id)).toBeDefined()
    expect(store.get(far.id)).toBeUndefined()
    expect(store.get(spanning.id)).toBeDefined()
    expect(store.apply(add(2, stroke([9 * CHUNK, 0])))).toBe(true)
    expect(store.size).toBe(2) // an add far away moves `seq` on but keeps nothing
  })

  it('replays a load and the operations after it to the same result in any overlap (idempotent)', () => {
    const store = new CanvasStore()
    const a = stroke([1, 1])
    const b = stroke([2, 2])
    store.load(['0,0'], [a], 3)
    // Operations 4..6 arrive; then a second load (another chunk, as of seq 6) and the same operations again.
    const ops = [add(4, b), hide(5, a.id), { ...base(6), kind: 'restore' as const, strokeId: a.id, stroke: a }]
    for (const op of ops) store.apply(op)
    store.load(['1,0'], [a, b], 6)
    for (const op of ops) store.apply(op)
    expect([store.get(a.id)?.id, store.get(b.id)?.id]).toEqual([a.id, b.id])
    // An add whose stroke was hidden again since (stroke null) removes it.
    store.apply(add(7, null, b.id))
    expect(store.get(b.id)).toBeUndefined()
    store.apply({ ...base(8), kind: 'clear', region: { x1: 0, y1: 0, x2: 9, y2: 9 }, strokeIds: [a.id] })
    expect(store.size).toBe(0)
  })

  it('shows own changes at once and the stored version when confirmed', () => {
    const store = new CanvasStore()
    store.load(['0,0'], [], 1)
    const mine = stroke([3, 3])
    store.putLocal(toShown(mine, true))
    expect(store.get(mine.id)?.pending).toBe(true)
    store.confirm({ ...mine, authorName: 'Ada' })
    expect(store.get(mine.id)).toMatchObject({ pending: false, authorName: 'Ada' })
  })

  it('forgets far chunks and their strokes, but never unsaved ones', () => {
    const store = new CanvasStore()
    const a = stroke([10, 10])
    const b = stroke([CHUNK * 3 + 5, 5])
    store.load(['0,0', '3,0'], [a, b], 1)
    const unsaved = toShown(stroke([CHUNK * 3 + 9, 9]), true)
    store.putLocal(unsaved)
    expect(store.unloadExcept(new Set(['0,0']))).toBe(true)
    expect(store.loadedChunks()).toEqual(['0,0'])
    expect([store.get(a.id), store.get(b.id), store.get(unsaved.id)].map(s => s?.id)).toEqual([a.id, undefined, unsaved.id])
    expect(store.unloadExcept(new Set(['0,0']))).toBe(false)
    store.reset()
    expect([store.seq, store.size, store.loadedChunks()]).toEqual([null, 1, []])
  })

  it('finds the newest stroke under a point that the rule allows', () => {
    const store = new CanvasStore()
    const older = stroke([0, 0, 100, 0], { authorId: 'me' })
    const newer = stroke([50, -50, 50, 50], { authorId: 'them' })
    store.load(['0,0', '-1,0', '0,-1', '-1,-1'], [older, newer], 1)
    expect(store.hit(50, 0, 2, () => true)?.id).toBe(newer.id)
    expect(store.hit(50, 0, 2, s => s.authorId === 'me')?.id).toBe(older.id)
    expect(store.hit(500, 500, 2, () => true)).toBeNull()
    expect(store.inBox({ x1: 90, y1: -5, x2: 95, y2: 5 }).map(s => s.id)).toEqual([older.id])
  })
})
