import { describe, expect, it } from 'vitest'
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, TILE_SIZE } from '../config/GameConfig'
import { HOUSES } from '../config/houses'
import { getCollisionRects } from '../maps/collision-objects'
import { STRUCTURES, doorColumn } from '../maps/town-layout'
import { rectContains, rectsOverlap } from '../../lib/geometry'
import { buildEntrances, findNearbyTarget, type InteractionTarget } from './interaction'
import { playerBodyRect } from './return-position'

const ENTRANCES = buildEntrances(HOUSES, STRUCTURES)
const COLLIDERS = getCollisionRects()
const MAP = { x: 0, y: 0, w: MAP_WIDTH_PX, h: MAP_HEIGHT_PX }

describe('house configuration', () => {
  it('lists the seven houses and nothing else', () => {
    expect(HOUSES.map(h => h.id)).toEqual([
      'house-a', 'house-b', 'house-c', 'house-d', 'house-e', 'house-f', 'house-g',
    ])
  })

  it('never makes the church or the bridge enterable', () => {
    const labels = HOUSES.map(h => h.structureLabel)
    expect(labels).not.toContain('church')
    expect(labels).not.toContain('bridge')
  })

  it('points every house at a solid structure that exists', () => {
    for (const house of HOUSES) {
      const structure = STRUCTURES.find(s => s.label === house.structureLabel)
      expect(structure, house.id).toBeDefined()
      expect(structure!.solid, house.id).toBe(true)
    }
  })

  it('has unique ids', () => {
    expect(new Set(HOUSES.map(h => h.id)).size).toBe(HOUSES.length)
  })
})

describe('buildEntrances', () => {
  it('builds one entrance per house', () => {
    expect(ENTRANCES).toHaveLength(HOUSES.length)
  })

  it('centres each zone on the door column and spans the doorstep', () => {
    for (const entrance of ENTRANCES) {
      const house = HOUSES.find(h => h.id === entrance.id)!
      const structure = STRUCTURES.find(s => s.label === house.structureLabel)!
      const doorCentre = doorColumn(structure) * TILE_SIZE + TILE_SIZE / 2
      const bottom = (structure.tileY + structure.hTiles) * TILE_SIZE

      expect(entrance.zone.x + entrance.zone.w / 2, entrance.id).toBe(doorCentre)
      // Reaches a little into the footprint (recessed porches) and well past it.
      expect(entrance.zone.y, entrance.id).toBe(bottom - 8)
      expect(entrance.zone.y + entrance.zone.h, entrance.id).toBe(bottom + 32)
    }
  })

  it('is exactly as wide as the three-tile yard gate', () => {
    for (const entrance of ENTRANCES) expect(entrance.zone.w).toBe(3 * TILE_SIZE)
  })

  it('keeps every zone and prompt inside the map', () => {
    for (const entrance of ENTRANCES) {
      expect(rectContains(MAP, entrance.zone), entrance.id).toBe(true)
      expect(entrance.promptY, entrance.id).toBeGreaterThan(0)
    }
  })

  it('does not let two zones overlap', () => {
    for (let i = 0; i < ENTRANCES.length; i++) {
      for (let j = i + 1; j < ENTRANCES.length; j++) {
        expect(rectsOverlap(ENTRANCES[i]!.zone, ENTRANCES[j]!.zone)).toBe(false)
      }
    }
  })

  it('throws a clear error for an unknown structure', () => {
    const bad = [{ id: 'x', structureLabel: 'nope', interiorId: 'i', title: 'X' }]
    expect(() => buildEntrances(bad, STRUCTURES)).toThrow(/unknown structure "nope"/)
  })

  it('leaves the fallback spot and the doorstep free of town colliders', () => {
    for (const entrance of ENTRANCES) {
      const bottom = entrance.zone.y + entrance.zone.h - 32 // the building's bottom edge
      const spots = [
        entrance.fallbackFeet,
        { x: entrance.zone.x + entrance.zone.w / 2, y: bottom + 16 },
        { x: entrance.zone.x + 8, y: bottom + 12 },
        { x: entrance.zone.x + entrance.zone.w - 8, y: bottom + 12 },
      ]
      for (const spot of spots) {
        const body = playerBodyRect(spot.x, spot.y)
        const hit = COLLIDERS.find(c => rectsOverlap(body, c, 0.5))
        const where = `${entrance.id} at (${spot.x},${spot.y})`
        expect(hit, `${where} blocked by ${hit?.label}`).toBeUndefined()
      }
    }
  })
})

describe('findNearbyTarget', () => {
  const targets: InteractionTarget[] = [
    { id: 'left', zone: { x: 0, y: 0, w: 20, h: 10 }, promptX: 10, promptY: 0 },
    { id: 'right', zone: { x: 15, y: 0, w: 20, h: 10 }, promptX: 25, promptY: 0 },
  ]

  it('returns null outside every zone', () => {
    expect(findNearbyTarget({ x: 100, y: 100 }, targets)).toBeNull()
    expect(findNearbyTarget({ x: 5, y: 10 }, targets)).toBeNull() // bottom edge is exclusive
  })

  it('returns the zone that contains the feet', () => {
    expect(findNearbyTarget({ x: 2, y: 5 }, targets)?.id).toBe('left')
    expect(findNearbyTarget({ x: 33, y: 5 }, targets)?.id).toBe('right')
  })

  it('prefers the nearest zone centre when zones overlap', () => {
    expect(findNearbyTarget({ x: 16, y: 5 }, targets)?.id).toBe('left')
    expect(findNearbyTarget({ x: 19, y: 5 }, targets)?.id).toBe('right')
  })

  it('finds a real house entrance from a point in front of its door', () => {
    const entrance = ENTRANCES[0]!
    expect(findNearbyTarget(entrance.fallbackFeet, ENTRANCES)?.id).toBe(entrance.id)
  })
})
