import { describe, expect, it } from 'vitest'
import { findNearbyTarget } from '../systems/interaction'
import { isFeetSafe } from '../systems/return-position'
import { HOUSES } from '../config/houses'
import { pointInRect, rectContains, rectsOverlap, type Point, type Rect } from '../../lib/geometry'
import {
  COZY_ROOM,
  getInterior,
  getInteriorCollisionRects,
  pieceBounds,
  spriteSize,
} from './interior-layout'
import { COMPUTER_WIDTH_PX } from './interior-slices'

const ROOM: Rect = { x: 0, y: 0, w: COZY_ROOM.widthPx, h: COZY_ROOM.heightPx }
const OBSTACLES: Rect[] = getInteriorCollisionRects(COZY_ROOM)

/** Grid flood fill over player-feet positions, 2px apart, from the spawn point. */
function reachableFrom(start: Point, step = 2): { reached: Set<string>; free: number } {
  const key = (x: number, y: number): string => `${x},${y}`
  const safe = (x: number, y: number): boolean => isFeetSafe({ x, y }, OBSTACLES, ROOM)

  let free = 0
  for (let y = 0; y <= ROOM.h; y += step) {
    for (let x = 0; x <= ROOM.w; x += step) if (safe(x, y)) free++
  }

  const reached = new Set<string>()
  const queue: Point[] = [start]
  reached.add(key(start.x, start.y))
  while (queue.length > 0) {
    const { x, y } = queue.shift()!
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (reached.has(key(nx, ny)) || !safe(nx, ny)) continue
      reached.add(key(nx, ny))
      queue.push({ x: nx, y: ny })
    }
  }
  return { reached, free }
}

describe('cozy room data', () => {
  it('is registered and findable by id', () => {
    expect(getInterior('cozy-room')).toBe(COZY_ROOM)
    expect(getInterior('nope')).toBeUndefined()
  })

  it('serves every house in the town', () => {
    for (const house of HOUSES) expect(getInterior(house.interiorId), house.id).toBeDefined()
  })

  it('has unique piece ids and only known sprites', () => {
    const ids = COZY_ROOM.pieces.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const piece of COZY_ROOM.pieces) {
      expect(spriteSize(piece.sprite), piece.id).not.toBeNull()
    }
  })

  it('keeps every sprite and every solid inside the room', () => {
    for (const piece of COZY_ROOM.pieces) {
      expect(rectContains(ROOM, pieceBounds(piece)), `${piece.id} sprite`).toBe(true)
      if (piece.solid) expect(rectContains(ROOM, piece.solid), `${piece.id} solid`).toBe(true)
    }
  })

  it('contains every required feature', () => {
    const ids = COZY_ROOM.pieces.map(p => p.id)
    for (const required of [
      'door', 'window-blue', 'window-pink', 'bookshelf', 'bed', 'table', 'chair', 'rug',
      'computer-desk', 'notebook', 'books', 'plant-green', 'plant-red', 'plant-pink',
    ]) {
      expect(ids, required).toContain(required)
    }
  })

  it('has exactly one computer and one notebook, and the computer is 48px wide', () => {
    const computers = COZY_ROOM.pieces.filter(p => p.role === 'computer')
    const notebooks = COZY_ROOM.pieces.filter(p => p.role === 'notebook')
    expect(computers).toHaveLength(1)
    expect(notebooks).toHaveLength(1)
    expect(spriteSize(computers[0]!.sprite)!.w).toBe(COMPUTER_WIDTH_PX)
    expect(COMPUTER_WIDTH_PX).toBe(48)
  })

  it('stands the door in the back wall, above the exit zone', () => {
    const door = COZY_ROOM.pieces.find(p => p.id === 'door')!
    const bounds = pieceBounds(door)
    expect(bounds.y).toBe(0)
    expect(bounds.y + bounds.h).toBe(COZY_ROOM.wallHeightPx)

    const doorCentre = bounds.x + bounds.w / 2
    expect(COZY_ROOM.exit.promptX).toBe(doorCentre)
    expect(COZY_ROOM.spawn.feetX).toBe(doorCentre)
    const exitZone = COZY_ROOM.exit.zone
    expect(pointInRect({ x: doorCentre, y: exitZone.y + 1 }, exitZone)).toBe(true)
  })
})

describe('cozy room collision', () => {
  it('blocks the back wall', () => {
    const wall = OBSTACLES.find(r => (r as { label?: string }).label === 'wall')
    expect(wall).toMatchObject({ x: 0, y: 0, w: 256, h: 64 })
  })

  it('makes furniture solid and decoration walkable', () => {
    const solidIds = COZY_ROOM.pieces.filter(p => p.solid).map(p => p.id)
    const solid = ['bed', 'bookshelf', 'table', 'chair', 'computer-desk', 'nightstand', 'chest']
    const walkable = [
      'rug', 'door', 'window-blue', 'window-pink', 'painting', 'clock', 'notebook', 'books', 'lamp',
    ]
    for (const id of solid) expect(solidIds, id).toContain(id)
    for (const id of walkable) expect(solidIds, id).not.toContain(id)
  })

  it('stops the player behind or inside nothing: pieces against the wall reach it', () => {
    for (const id of ['bed', 'bookshelf', 'computer-desk', 'plant-pink']) {
      const piece = COZY_ROOM.pieces.find(p => p.id === id)!
      expect(piece.solid!.y, id).toBe(COZY_ROOM.wallHeightPx)
    }
  })

  it('never overlaps two solids', () => {
    const solids = COZY_ROOM.pieces.filter(p => p.solid)
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        expect(
          rectsOverlap(solids[i]!.solid!, solids[j]!.solid!),
          `${solids[i]!.id} / ${solids[j]!.id}`,
        ).toBe(false)
      }
    }
  })
})

describe('cozy room walkability', () => {
  const spawn: Point = { x: COZY_ROOM.spawn.feetX, y: COZY_ROOM.spawn.feetY }
  const { reached, free } = reachableFrom(spawn)
  const canReach = (p: Point): boolean => reached.has(`${p.x},${p.y}`)

  it('spawns the player in free space', () => {
    expect(isFeetSafe(spawn, OBSTACLES, ROOM)).toBe(true)
  })

  it('puts the spawn point inside the exit zone, so the player can leave at once', () => {
    expect(findNearbyTarget(spawn, [COZY_ROOM.exit])?.id).toBe('exit')
  })

  it('lets the player reach every part of the room that matters', () => {
    const targets: Record<string, Point> = {
      exit: { x: 132, y: 86 },
      'in front of the computer': { x: 228, y: 130 },
      'in front of the table': { x: 208, y: 200 },
      'beside the chair': { x: 148, y: 188 },
      'beside the bed': { x: 54, y: 120 },
      'at the foot of the bed': { x: 30, y: 160 },
      'on the rug': { x: 114, y: 158 },
      'bottom left': { x: 60, y: 214 },
      'bottom right': { x: 220, y: 214 },
    }
    for (const [name, point] of Object.entries(targets)) {
      expect(isFeetSafe(point, OBSTACLES, ROOM), `${name} is blocked`).toBe(true)
      expect(canReach(point), `${name} is unreachable`).toBe(true)
    }
  })

  it('leaves no sizeable free pocket the player cannot get to', () => {
    // A handful of cells is a gap too small to see; more would be a dead zone.
    expect(free - reached.size).toBeLessThanOrEqual(12)
  })
})
