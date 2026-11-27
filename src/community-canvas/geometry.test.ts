import { describe, expect, it } from 'vitest'
import {
  CHUNK, MAX_ZOOM, MIN_ZOOM, chunkBox, chunksFor, hitsStroke, panBy, screenToWorld, simplify, strokeBox, tooFarOut,
  unionBox, viewBox, worldToScreen, zoomAt,
} from './geometry'

describe('simplify', () => {
  it('drops points on a straight line, keeps corners and both ends', () => {
    expect(simplify([0, 0, 1, 0, 2, 0, 3, 0, 4, 0], 0.5)).toEqual([0, 0, 4, 0])
    expect(simplify([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.5)).toEqual([0, 0, 10, 0, 10, 10])
    expect(simplify([3, 4], 1)).toEqual([3, 4])
    expect(simplify([0, 0, 9, 9], 1)).toEqual([0, 0, 9, 9])
  })

  it('keeps wiggles bigger than the tolerance only', () => {
    const wiggle = [0, 0, 1, 1, 2, 0, 3, 1, 4, 0]
    expect(simplify(wiggle, 0.4)).toEqual(wiggle)
    expect(simplify(wiggle, 2)).toEqual([0, 0, 4, 0])
  })

  it('handles a very long stroke without recursion', () => {
    const long = Array.from({ length: 200_000 }, (_, i) => (i % 2 === 0 ? i : Math.round(Math.sin(i / 50) * 100)))
    const out = simplify(long, 1)
    expect(out.length).toBeLessThan(long.length)
    expect(out.slice(0, 2)).toEqual(long.slice(0, 2))
    expect(out.slice(-2)).toEqual(long.slice(-2))
  })
})

describe('bounds and hits', () => {
  it('matches the database: the points padded by half the width, rounded up', () => {
    expect(strokeBox([10, 20, -30, 5, 40, 60], 5)).toEqual({ x1: -33, y1: 2, x2: 43, y2: 63 })
    expect(strokeBox([7, 7], 1)).toEqual({ x1: 6, y1: 6, x2: 8, y2: 8 })
  })

  it('hits a stroke within the eraser radius plus half its width', () => {
    const line = [0, 0, 100, 0]
    expect(hitsStroke(line, 4, 50, 5, 3)).toBe(true) // 5 <= 3 + 2
    expect(hitsStroke(line, 4, 50, 6, 3)).toBe(false)
    expect(hitsStroke(line, 4, 104, 0, 3)).toBe(true) // past the end, within reach
    expect(hitsStroke([10, 10], 2, 12, 10, 1)).toBe(true) // a dot
    expect(hitsStroke([10, 10], 2, 13, 10, 1)).toBe(false)
  })
})

describe('chunks', () => {
  it('covers a box with the chunks it touches, plus a ring', () => {
    expect(chunksFor({ x1: 0, y1: 0, x2: CHUNK - 1, y2: CHUNK - 1 })).toEqual(['0,0'])
    expect(chunksFor({ x1: -1, y1: 0, x2: CHUNK, y2: 0 })).toEqual(['-1,0', '0,0', '1,0'])
    expect(chunksFor({ x1: 0, y1: 0, x2: 0, y2: 0 }, 1)).toHaveLength(9)
    expect(chunkBox('-1,2')).toEqual({ x1: -CHUNK, y1: 2 * CHUNK, x2: -1, y2: 3 * CHUNK - 1 })
  })

  it('stays inside the plane at its edges', () => {
    const edge = chunksFor({ x1: 999_999, y1: 999_999, x2: 1_000_000, y2: 1_000_000 }, 1)
    for (const k of edge) {
      const b = chunkBox(k)
      expect(Math.max(Math.abs(b.x1), Math.abs(b.x2), Math.abs(b.y1), Math.abs(b.y2))).toBeLessThanOrEqual(1_000_000)
    }
    expect(edge.length).toBeLessThan(9) // the ring stops at the edge
    expect(unionBox([chunkBox('0,0'), chunkBox('2,-1')])).toEqual({ x1: 0, y1: -CHUNK, x2: 3 * CHUNK - 1, y2: CHUNK - 1 })
  })
})

describe('the view', () => {
  const size = { width: 800, height: 600 }
  it('maps screen to world and back', () => {
    const v = { x: 100, y: -50, zoom: 2 }
    expect(screenToWorld(v, size, 400, 300)).toEqual({ x: 100, y: -50 })
    const w = screenToWorld(v, size, 10, 20)
    expect(worldToScreen(v, size, w.x, w.y)).toEqual({ x: 10, y: 20 })
    expect(viewBox(v, size)).toEqual({ x1: -100, y1: -200, x2: 300, y2: 100 })
  })

  it('zooms around the pointer and stays within its limits and the plane', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    const z = zoomAt(v, size, 2, 600, 300)
    expect(z.zoom).toBe(2)
    expect(screenToWorld(z, size, 600, 300)).toEqual(screenToWorld(v, size, 600, 300))
    expect(zoomAt(v, size, 1000, 0, 0).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(v, size, 0.0001, 0, 0).zoom).toBe(MIN_ZOOM)
    expect(panBy({ x: 999_990, y: 0, zoom: 1 }, -100, 0).x).toBe(1_000_000)
    expect(panBy(v, 10, -20)).toEqual({ x: -10, y: 20, zoom: 1 })
  })

  it('says when it is too far out to load', () => {
    expect(tooFarOut({ x: 0, y: 0, zoom: 1 }, size)).toBe(false)
    expect(tooFarOut({ x: 0, y: 0, zoom: 800 / (16 * CHUNK) }, size)).toBe(false)
    expect(tooFarOut({ x: 0, y: 0, zoom: MIN_ZOOM }, size)).toBe(false) // 800 * 16 = 12,800 < 16,384
    expect(tooFarOut({ x: 0, y: 0, zoom: MIN_ZOOM }, { width: 2000, height: 1000 })).toBe(true)
  })
})
