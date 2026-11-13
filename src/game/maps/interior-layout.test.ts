import { describe, expect, it } from 'vitest'
import { findNearbyTarget } from '../systems/interaction'
import { isFeetSafe, playerBodyRect } from '../systems/return-position'
import { DEPTH_PLAYER, DEPTH_TREETOP, depthForFeetY } from '../config/GameConfig'
import { HOUSES } from '../config/houses'
import { pointInRect, rectContains, rectsOverlap, type Point, type Rect } from '../../lib/geometry'
import {
  getInteriorCollisionRects,
  pieceBounds,
  pieceDepth,
  spriteSize,
} from './interior-layout'
import { DEFAULT_INTERIOR, getTemplate } from './house/default-interior'
import { reachableFeet } from './house/layout-rules'
import { COMPUTER_WIDTH_PX } from './interior-slices'

const ROOM: Rect = { x: 0, y: 0, w: DEFAULT_INTERIOR.widthPx, h: DEFAULT_INTERIOR.heightPx }
const OBSTACLES: Rect[] = getInteriorCollisionRects(DEFAULT_INTERIOR)

/** Where the player can walk from the spawn point; shared with the runtime rules. */
function reachableFrom(start: Point): { reached: ReadonlySet<string>; free: number } {
  return reachableFeet(DEFAULT_INTERIOR, start, OBSTACLES)
}

describe('default room data', () => {
  it('is the template every house references, findable by id', () => {
    expect(getTemplate(DEFAULT_INTERIOR.id)?.id).toBe(DEFAULT_INTERIOR.id)
    expect(getTemplate('nope')).toBeUndefined()
  })

  it('serves every house in the town', () => {
    for (const house of HOUSES) expect(getTemplate(house.interiorId), house.id).toBeDefined()
  })

  it('has unique piece ids and only known sprites', () => {
    const ids = DEFAULT_INTERIOR.pieces.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const piece of DEFAULT_INTERIOR.pieces) {
      expect(spriteSize(piece.sprite), piece.id).not.toBeNull()
    }
  })

  it('keeps every sprite and every solid inside the room', () => {
    for (const piece of DEFAULT_INTERIOR.pieces) {
      expect(rectContains(ROOM, pieceBounds(piece)), `${piece.id} sprite`).toBe(true)
      if (piece.solid) expect(rectContains(ROOM, piece.solid), `${piece.id} solid`).toBe(true)
    }
  })

  it('contains every required feature', () => {
    const ids = DEFAULT_INTERIOR.pieces.map(p => p.id)
    for (const required of [
      'door', 'window-blue', 'window-pink', 'bookshelf', 'bed', 'table', 'chair', 'rug',
      'computer-desk', 'notebook', 'books', 'plant-green', 'plant-red', 'plant-pink',
    ]) {
      expect(ids, required).toContain(required)
    }
  })

  it('has exactly one computer and one notebook, and the computer is 48px wide', () => {
    const computers = DEFAULT_INTERIOR.pieces.filter(p => p.role === 'computer')
    const notebooks = DEFAULT_INTERIOR.pieces.filter(p => p.role === 'notebook')
    expect(computers).toHaveLength(1)
    expect(notebooks).toHaveLength(1)
    expect(spriteSize(computers[0]!.sprite)!.w).toBe(COMPUTER_WIDTH_PX)
    expect(COMPUTER_WIDTH_PX).toBe(48)
  })

  it('stands the door in the back wall, above the exit zone', () => {
    const door = DEFAULT_INTERIOR.pieces.find(p => p.id === 'door')!
    const bounds = pieceBounds(door)
    expect(bounds.y).toBe(0)
    expect(bounds.y + bounds.h).toBe(DEFAULT_INTERIOR.wallHeightPx)

    const doorCentre = bounds.x + bounds.w / 2
    expect(DEFAULT_INTERIOR.exit.promptX).toBe(doorCentre)
    expect(DEFAULT_INTERIOR.spawn.feetX).toBe(doorCentre)
    const exitZone = DEFAULT_INTERIOR.exit.zone
    expect(pointInRect({ x: doorCentre, y: exitZone.y + 1 }, exitZone)).toBe(true)
  })
})

describe('cozy room collision', () => {
  it('blocks the back wall', () => {
    const wall = OBSTACLES.find(r => (r as { label?: string }).label === 'wall')
    expect(wall).toMatchObject({ x: 0, y: 0, w: 256, h: 64 })
  })

  it('makes furniture solid and decoration walkable', () => {
    const solidIds = DEFAULT_INTERIOR.pieces.filter(p => p.solid).map(p => p.id)
    const solid = ['bed', 'bookshelf', 'table', 'chair', 'computer-desk', 'nightstand', 'chest']
    const walkable = [
      'rug', 'door', 'window-blue', 'window-pink', 'painting', 'clock', 'notebook', 'books', 'lamp',
    ]
    for (const id of solid) expect(solidIds, id).toContain(id)
    for (const id of walkable) expect(solidIds, id).not.toContain(id)
  })

  it('stops the player behind or inside nothing: pieces against the wall reach it', () => {
    for (const id of ['bed', 'bookshelf', 'computer-desk', 'plant-pink']) {
      const piece = DEFAULT_INTERIOR.pieces.find(p => p.id === id)!
      expect(piece.solid!.y, id).toBe(DEFAULT_INTERIOR.wallHeightPx)
    }
  })

  it('never overlaps two solids', () => {
    const solids = DEFAULT_INTERIOR.pieces.filter(p => p.solid)
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
  const spawn: Point = { x: DEFAULT_INTERIOR.spawn.feetX, y: DEFAULT_INTERIOR.spawn.feetY }
  const { reached, free } = reachableFrom(spawn)
  const canReach = (p: Point): boolean => reached.has(`${p.x},${p.y}`)

  it('spawns the player in free space', () => {
    expect(isFeetSafe(spawn, OBSTACLES, ROOM)).toBe(true)
  })

  it('spawns one tile outside the exit zone, so no prompt greets the player on arrival', () => {
    expect(findNearbyTarget(spawn, [DEFAULT_INTERIOR.exit])).toBeNull()
    expect(DEFAULT_INTERIOR.spawn.feetY).toBe(84 + 16)
  })

  it('keeps the exit zone aligned with the doorway and reachable from the spawn', () => {
    const door = pieceBounds(DEFAULT_INTERIOR.pieces.find(p => p.id === 'door')!)
    const zone = DEFAULT_INTERIOR.exit.zone
    expect(zone.x).toBeLessThanOrEqual(door.x)
    expect(zone.x + zone.w).toBeGreaterThanOrEqual(door.x + door.w)
    expect(zone.x + zone.w).toBeLessThanOrEqual(door.x + door.w + 8)
    // Walking straight up from the spawn enters the zone.
    expect(findNearbyTarget({ x: spawn.x, y: zone.y + zone.h - 1 }, [DEFAULT_INTERIOR.exit])?.id).toBe(
      'exit',
    )
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

describe('cozy room gameplay: walls, furniture and the way out', () => {
  const exitZone = DEFAULT_INTERIOR.exit.zone
  const bodyH = playerBodyRect(0, 0).h
  const spawnPoint: Point = { x: DEFAULT_INTERIOR.spawn.feetX, y: DEFAULT_INTERIOR.spawn.feetY }

  it('stops the player at the back wall and at the side and bottom edges', () => {
    // Body top sits 8.8px above the feet, so feet must stay below wall + 8.8.
    expect(isFeetSafe({ x: 132, y: DEFAULT_INTERIOR.wallHeightPx + bodyH - 2 }, OBSTACLES, ROOM)).toBe(false)
    expect(isFeetSafe({ x: 132, y: DEFAULT_INTERIOR.wallHeightPx + bodyH + 1 }, OBSTACLES, ROOM)).toBe(true)
    expect(isFeetSafe({ x: 2, y: 160 }, OBSTACLES, ROOM)).toBe(false)
    expect(isFeetSafe({ x: ROOM.w - 2, y: 160 }, OBSTACLES, ROOM)).toBe(false)
    expect(isFeetSafe({ x: 100, y: ROOM.h + 2 }, OBSTACLES, ROOM)).toBe(false)
  })

  it('blocks the player on every piece of solid furniture', () => {
    for (const piece of DEFAULT_INTERIOR.pieces) {
      if (!piece.solid) continue
      const s = piece.solid
      const centre: Point = { x: s.x + s.w / 2, y: s.y + s.h / 2 + bodyH / 2 }
      expect(isFeetSafe(centre, OBSTACLES, ROOM), `${piece.id} is not solid`).toBe(false)
    }
  })

  it('keeps every collision rectangle inside the room, clear of the decorative border', () => {
    for (const rect of OBSTACLES) {
      expect(rectContains(ROOM, rect), (rect as { label?: string }).label).toBe(true)
    }
  })

  it('keeps all furniture out of the exit zone', () => {
    for (const rect of OBSTACLES) {
      if ((rect as { label?: string }).label === 'wall') continue
      expect(rectsOverlap(rect, exitZone), (rect as { label?: string }).label).toBe(false)
    }
  })

  it('leaves a clear corridor from the spawn straight up to the door', () => {
    const door = pieceBounds(DEFAULT_INTERIOR.pieces.find(p => p.id === 'door')!)
    const lowestFeet = DEFAULT_INTERIOR.wallHeightPx + bodyH + 1
    for (const x of [door.x, door.x + door.w / 2, door.x + door.w]) {
      for (let y = spawnPoint.y; y >= lowestFeet; y -= 1) {
        expect(isFeetSafe({ x, y }, OBSTACLES, ROOM), `blocked at (${x},${y})`).toBe(true)
      }
    }
  })

  it('lets the player reach the whole exit zone from the spawn', () => {
    const { reached } = reachableFrom(spawnPoint)
    const topY = DEFAULT_INTERIOR.wallHeightPx + bodyH + 2
    for (const x of [exitZone.x + 4, DEFAULT_INTERIOR.exit.promptX, exitZone.x + exitZone.w - 4]) {
      const point = { x: Math.round(x / 2) * 2, y: Math.ceil(topY / 2) * 2 }
      expect(reached.has(`${point.x},${point.y}`), `(${point.x},${point.y})`).toBe(true)
      expect(findNearbyTarget(point, [DEFAULT_INTERIOR.exit])?.id).toBe('exit')
    }
  })
})

describe('cozy room depth sorting (by the player\u2019s feet)', () => {
  const sorted = DEFAULT_INTERIOR.pieces.filter(p => p.layer === 'sorted')
  const bodyH = playerBodyRect(0, 0).h

  it('draws every y-sorted piece inside the player depth band', () => {
    for (const piece of sorted) {
      expect(pieceDepth(piece), piece.id).toBeGreaterThan(DEPTH_PLAYER)
      expect(pieceDepth(piece), piece.id).toBeLessThan(DEPTH_TREETOP)
    }
  })

  it('keeps the rug and wall decoration beneath the player at any position', () => {
    const lowestPlayer = depthForFeetY(0)
    for (const piece of DEFAULT_INTERIOR.pieces) {
      if (piece.layer === 'sorted') continue
      expect(pieceDepth(piece), piece.id).toBeLessThan(lowestPlayer)
    }
  })

  it('puts the player behind furniture when north of it and in front when south of it', () => {
    for (const piece of sorted) {
      if (!piece.solid) continue
      const behind = depthForFeetY(piece.solid.y)
      const inFront = depthForFeetY(piece.solid.y + piece.solid.h + bodyH)
      expect(behind, `${piece.id} behind`).toBeLessThan(pieceDepth(piece))
      expect(inFront, `${piece.id} in front`).toBeGreaterThan(pieceDepth(piece))
    }
  })

  it('draws table and nightstand items above their supports but below a player in front', () => {
    const depth = (id: string): number => pieceDepth(DEFAULT_INTERIOR.pieces.find(p => p.id === id)!)
    expect(depth('notebook')).toBeGreaterThan(depth('table'))
    expect(depth('books')).toBeGreaterThan(depth('table'))
    expect(depth('lamp')).toBeGreaterThan(depth('nightstand'))

    const table = DEFAULT_INTERIOR.pieces.find(p => p.id === 'table')!.solid!
    const playerInFront = depthForFeetY(table.y + table.h + bodyH)
    expect(playerInFront).toBeGreaterThan(depth('notebook'))
    expect(playerInFront).toBeGreaterThan(depth('books'))
  })
})
