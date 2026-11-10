import { describe, it, expect } from 'vitest'
import { getCollisionRects, isWithinMap } from './collision-objects'
import { MAP_WIDTH_PX, MAP_HEIGHT_PX } from '../config/GameConfig'
import { AssetKeys } from '../config/AssetKeys'
import type { SpriteShape } from './sprite-shape'

/** A house silhouette: a narrow chimney, a roof that widens, and wider walls. */
const HOUSE_SHAPE: SpriteShape = {
  width: 32,
  height: 32,
  left: 2,
  right: 29,
  top: 2,
  bottom: 31,
  bands: [
    { top: 2, bottom: 9, x: 12, y: 2, w: 8, h: 8 },
    { top: 10, bottom: 17, x: 4, y: 10, w: 24, h: 8 },
    { top: 18, bottom: 25, x: 2, y: 18, w: 28, h: 8 },
  ],
}

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

  it('all tree rects are within bounds', () => {
    const trees = rects.filter(r => r.label.startsWith('tree-'))
    expect(trees.length).toBeGreaterThan(0)
    for (const tree of trees) {
      expect(isWithinMap(tree), tree.label).toBe(true)
    }
  })
})

describe('collision-objects with measured sprite shapes', () => {
  const shapes = getCollisionRects(key => (key === AssetKeys.HOUSE_1 || key === AssetKeys.TREE_1 ? HOUSE_SHAPE : null))

  it('replaces a building box with one box per silhouette band', () => {
    const bands = shapes.filter(r => r.label === 'house-a' || r.label.startsWith('house-a-band-'))
    expect(bands).toHaveLength(3)

    // The walls band is the bottom one and keeps the plain label.
    const walls = bands.find(r => r.label === 'house-a')!
    expect(walls.w).toBe(28)
    expect(walls.h).toBe(8)

    // Bands step outward as the roof widens, so no band is the full bbox width.
    expect(bands.some(r => r.w === 8)).toBe(true)
    expect(bands.some(r => r.w === 24)).toBe(true)
  })

  it('keeps every band inside the building footprint', () => {
    for (const rect of shapes.filter(r => r.label.startsWith('house-a'))) {
      expect(rect.x).toBeGreaterThanOrEqual(14 * 16)
      expect(rect.x + rect.w).toBeLessThanOrEqual((14 + 5) * 16)
      expect(rect.y).toBeGreaterThanOrEqual(5 * 16)
      expect(rect.y + rect.h).toBeLessThanOrEqual((5 + 7) * 16)
    }
  })

  it('shapes tree colliders to the canopy outline, not a whole tile', () => {
    const measured = shapes.filter(r => /^tree-\d+(-band-\d+)?$/.test(r.label))
    expect(measured.length).toBeGreaterThan(0)

    // Measured trees are split into bands that step with the canopy width.
    expect(measured.some(r => r.w === 8)).toBe(true)
    expect(measured.some(r => r.w === 24)).toBe(true)
    expect(measured.some(r => r.label.includes('-band-'))).toBe(true)

    // Each tree gets exactly one ground band plus its upper bands.
    const first = measured[0]!.label.split('-band-')[0]!
    const forOneTree = measured.filter(r => r.label.split('-band-')[0] === first)
    expect(forOneTree.filter(r => r.label === first)).toHaveLength(1)
    expect(forOneTree).toHaveLength(3)

    // Species without a measured shape fall back to the 16×16 tile.
    const fallback = shapes.filter(r => /^tree-\d+$/.test(r.label) && r.w === 16 && r.h === 16)
    expect(fallback.length).toBeGreaterThan(0)
  })

  it('still produces fallback rects when no shape is available', () => {
    const plain = getCollisionRects()
    const houseA = plain.find(r => r.label === 'house-a')!
    expect(houseA).toEqual({ label: 'house-a', x: 14 * 16, y: 7 * 16, w: 5 * 16, h: 5 * 16 })
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
