import { describe, expect, it } from 'vitest'
import {
  CANVAS_LIMITS, encodePoints, parseCanvasAnnouncement, parseCanvasOp, parseCanvasStroke, validateStroke, type StrokeInput,
} from './canvas'
import { StorageError, ValidationError } from '../personal-spaces/errors'

const id = '0b6c1c4e-8f0e-4c7e-9d7a-1f2e3d4c5b6a'
const stroke = (over: Record<string, unknown> = {}) => ({
  id, authorId: null, authorName: null, tool: 'pen', color: '#112233', width: 3, points: [0, 0, 5, 5],
  createdAt: '2026-12-15T09:00:00.000Z', hidden: false, ...over,
})

describe('encodePoints', () => {
  it('rounds to whole units and drops repeated positions', () => {
    expect(encodePoints([{ x: 0.4, y: -0.4 }, { x: 0.2, y: 0.1 }, { x: 1.6, y: 2.5 }, { x: 2, y: 3 }])).toEqual([0, 0, 2, 3])
    expect(encodePoints([{ x: -10.5, y: 7 }])).toEqual([-10, 7])
  })

  it('refuses empty, damaged, too long and out-of-canvas strokes', () => {
    const many = Array.from({ length: CANVAS_LIMITS.maxPoints + 1 }, (_, i) => ({ x: i, y: 0 }))
    for (const points of [[], [{ x: NaN, y: 0 }], [{ x: 0, y: Infinity }], [{ x: 1_000_001, y: 0 }], [{ x: 0, y: -1_000_000.6 }], many]) {
      expect(() => encodePoints(points), String(points.length)).toThrow(ValidationError)
    }
    expect(encodePoints(many.slice(1))).toHaveLength(CANVAS_LIMITS.maxPoints * 2)
    // Repeats don't count towards the limit.
    expect(encodePoints([...many.slice(1), ...Array.from({ length: 50 }, () => ({ x: 2000, y: 0 }))])).toHaveLength(CANVAS_LIMITS.maxPoints * 2)
  })
})

describe('validateStroke', () => {
  const ok: StrokeInput = { id, tool: 'pen', color: '#a0b1c2', width: 1, points: [0, 0] }
  it('accepts what the database accepts', () => {
    expect(validateStroke(ok)).toBe(ok)
    expect(() => validateStroke({ ...ok, tool: 'marker', width: 64, points: [1_000_000, -1_000_000] })).not.toThrow()
  })
  it('refuses what the database refuses', () => {
    for (const over of [
      { id: 'nope' }, { id: id.toUpperCase() }, { tool: 'spray' }, { color: '#A0B1C2' }, { color: 'red' }, { color: '#abc' },
      { width: 0 }, { width: 65 }, { width: 2.5 }, { points: [] }, { points: [1] }, { points: [1, 2, 3] }, { points: [0, 0.5] },
      { points: [0, 1_000_001] }, { points: Array.from({ length: 4002 }, () => 0) },
    ]) {
      expect(() => validateStroke({ ...ok, ...over } as StrokeInput), JSON.stringify(over).slice(0, 60)).toThrow(ValidationError)
    }
  })
})

describe('parsing answers', () => {
  it('reads strokes and every kind of operation', () => {
    expect(parseCanvasStroke(stroke())).toEqual(stroke())
    const base = { seq: 7, actorId: null, createdAt: '2026-12-15T09:00:00.000Z' }
    expect(parseCanvasOp({ ...base, kind: 'add', strokeId: id, stroke: stroke() })).toEqual({ ...base, kind: 'add', strokeId: id, stroke: stroke() })
    expect(parseCanvasOp({ ...base, kind: 'restore', strokeId: id, stroke: null })).toMatchObject({ kind: 'restore', stroke: null })
    expect(parseCanvasOp({ ...base, kind: 'hide', strokeId: id })).toEqual({ ...base, kind: 'hide', strokeId: id })
    expect(parseCanvasOp({ ...base, kind: 'clear', strokeId: null, region: { x1: -1, y1: -2, x2: 3, y2: 4 }, strokeIds: [id] }))
      .toEqual({ ...base, kind: 'clear', region: { x1: -1, y1: -2, x2: 3, y2: 4 }, strokeIds: [id] })
  })

  it('refuses malformed answers instead of drawing them', () => {
    for (const raw of [null, [], 'x', stroke({ tool: 'laser' }), stroke({ color: 'javascript:alert(1)' }), stroke({ width: 0 }),
      stroke({ points: [0, 0, 1] }), stroke({ points: [0, '1'] }), stroke({ points: [0, 2_000_000] }), stroke({ id: 'x' }),
      stroke({ hidden: 'no' }), stroke({ authorName: 5 })]) {
      expect(() => parseCanvasStroke(raw), JSON.stringify(raw)?.slice(0, 60)).toThrow(StorageError)
    }
    const base = { seq: 1, actorId: null, createdAt: 'now' }
    for (const raw of [{ ...base, kind: 'paint', strokeId: id }, { ...base, seq: 0, kind: 'hide', strokeId: id },
      { ...base, seq: 1.5, kind: 'hide', strokeId: id }, { ...base, kind: 'hide' },
      { ...base, kind: 'add', strokeId: id, stroke: stroke({ id: '1b6c1c4e-8f0e-4c7e-9d7a-1f2e3d4c5b6a' }) },
      { ...base, kind: 'clear', region: { x1: 0, y1: 0, x2: 1 }, strokeIds: [] }, { ...base, kind: 'clear', region: { x1: 0, y1: 0, x2: 1, y2: 1 } }]) {
      expect(() => parseCanvasOp(raw), JSON.stringify(raw).slice(0, 80)).toThrow(StorageError)
    }
  })

  it('treats a channel message only as a sequence number to catch up to', () => {
    expect(parseCanvasAnnouncement({ seq: 12, kind: 'add', stroke: { anything: true } })).toEqual({ seq: 12 })
    for (const payload of [null, undefined, [], 'x', {}, { seq: '12' }, { seq: 0 }, { seq: -1 }, { seq: 1.5 }, { seq: Number.MAX_SAFE_INTEGER + 2 }]) {
      expect(parseCanvasAnnouncement(payload), JSON.stringify(payload)).toBeNull()
    }
  })
})
