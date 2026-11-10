import { describe, it, expect } from 'vitest'
import { getCollisionRects, isWithinMap } from './collision-objects'
import { MAP_WIDTH_PX, MAP_HEIGHT_PX } from '../config/GameConfig'

describe('collision-objects', () => {
  const rects = getCollisionRects()

  it('produces at least one rect', () => {
    expect(rects.length).toBeGreaterThan(0)
  })

  it('every rect is within map boundaries', () => {
    for (const rect of rects) {
      expect(
        isWithinMap(rect),
        `${rect.label} at (${rect.x},${rect.y}) ${rect.w}×${rect.h} exceeds map ${MAP_WIDTH_PX}×${MAP_HEIGHT_PX}`,
      ).toBe(true)
    }
  })

  it('every rect has positive width and height', () => {
    for (const rect of rects) {
      expect(rect.w, `${rect.label} width`).toBeGreaterThan(0)
      expect(rect.h, `${rect.label} height`).toBeGreaterThan(0)
    }
  })

  it('house-a rect exists and is within bounds', () => {
    const h1 = rects.find(r => r.label === 'house-a')
    expect(h1).toBeDefined()
    expect(isWithinMap(h1!)).toBe(true)
  })

  it('house-b rect exists and is within bounds', () => {
    const h2 = rects.find(r => r.label === 'house-b')
    expect(h2).toBeDefined()
    expect(isWithinMap(h2!)).toBe(true)
  })

  it('church rect exists and is within bounds', () => {
    const church = rects.find(r => r.label === 'church')
    expect(church).toBeDefined()
    expect(isWithinMap(church!)).toBe(true)
  })

  it('house-a and house-b do not overlap', () => {
    const h1 = rects.find(r => r.label === 'house-a')!
    const h2 = rects.find(r => r.label === 'house-b')!
    expect(rectsOverlap(h1, h2)).toBe(false)
  })

  it('house-a and church do not overlap', () => {
    const h1 = rects.find(r => r.label === 'house-a')!
    const church = rects.find(r => r.label === 'church')!
    expect(rectsOverlap(h1, church)).toBe(false)
  })

  it('house-b and church do not overlap', () => {
    const h2 = rects.find(r => r.label === 'house-b')!
    const church = rects.find(r => r.label === 'church')!
    expect(rectsOverlap(h2, church)).toBe(false)
  })

  it('all tree trunk rects are within bounds', () => {
    const trunks = rects.filter(r => r.label.startsWith('tree-trunk'))
    expect(trunks.length).toBeGreaterThan(0)
    for (const trunk of trunks) {
      expect(isWithinMap(trunk), trunk.label).toBe(true)
    }
  })
})

/** AABB overlap check */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}
