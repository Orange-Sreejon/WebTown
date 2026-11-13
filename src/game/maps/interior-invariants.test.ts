import { describe, expect, it } from 'vitest'
import { pointInRect, rectContains, rectsOverlap, type Point, type Rect } from '../../lib/geometry'
import { DEPTH_PLAYER, DEPTH_TREETOP, depthForFeetY } from '../config/GameConfig'
import { findNearbyTarget } from '../systems/interaction'
import { chooseIntegerZoom } from '../systems/view-fit'
import { INTERIOR_BORDER_PX, INTERIOR_VIEW_MARGIN_PX } from '../config/GameConfig'
import { isFeetSafe, playerBodyRect } from '../systems/return-position'
import {
  getInteriorCollisionRects,
  interiorViewRect,
  pieceBounds,
  pieceDepth,
  spriteSize,
} from './interior-layout'
import { COMPUTER_WIDTH_PX, OFFICE_KIT } from './interior-slices'
import { DEFAULT_INTERIOR } from './house/default-interior'
import { reachableFeet } from './house/layout-rules'


describe('Default interior invariants', () => {
  const def = DEFAULT_INTERIOR
  const room: Rect = { x: 0, y: 0, w: def.widthPx, h: def.heightPx }
  const obstacles: Rect[] = getInteriorCollisionRects(def)
  const bodyH = playerBodyRect(0, 0).h
  const spawn: Point = { x: def.spawn.feetX, y: def.spawn.feetY }
  const label = (r: Rect): string => (r as { label?: string }).label ?? 'rect'

  it('uses only known sprites with unique ids, and keeps them inside the room', () => {
    const ids = def.pieces.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const piece of def.pieces) {
      expect(spriteSize(piece.sprite), `${piece.id} sprite`).not.toBeNull()
      expect(rectContains(room, pieceBounds(piece)), `${piece.id} sprite bounds`).toBe(true)
      if (piece.solid) expect(rectContains(room, piece.solid), `${piece.id} solid`).toBe(true)
    }
  })

  it('has a wall as tall as the door and tiles that exist in the office kit', () => {
    const door = def.pieces.find(p => p.id === 'door')!
    const bounds = pieceBounds(door)
    expect(bounds.y).toBe(0)
    expect(bounds.y + bounds.h).toBe(def.wallHeightPx)
    for (const tile of [def.style.floor, def.style.wallUpper, def.style.wallLower]) {
      expect(OFFICE_KIT[tile], tile).toBeDefined()
    }
    expect(def.widthPx % OFFICE_KIT.wallUpper.w).toBe(0)
  })

  it('has exactly one computer (48px) and one notebook, both inside the room', () => {
    const computers = def.pieces.filter(p => p.role === 'computer')
    const notebooks = def.pieces.filter(p => p.role === 'notebook')
    expect(computers).toHaveLength(1)
    expect(notebooks).toHaveLength(1)
    expect(spriteSize(computers[0]!.sprite)!.w).toBe(COMPUTER_WIDTH_PX)
    expect(rectContains(room, pieceBounds(computers[0]!))).toBe(true)
    expect(rectContains(room, pieceBounds(notebooks[0]!))).toBe(true)
  })

  it('never overlaps two solids', () => {
    const solids = def.pieces.filter(p => p.solid)
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        expect(
          rectsOverlap(solids[i]!.solid!, solids[j]!.solid!),
          `${solids[i]!.id} / ${solids[j]!.id}`,
        ).toBe(false)
      }
    }
  })

  it('aligns the exit zone and prompt with the door, with the spawn outside the zone', () => {
    const door = pieceBounds(def.pieces.find(p => p.id === 'door')!)
    const centre = door.x + door.w / 2
    const zone = def.exit.zone
    expect(def.exit.promptX).toBe(centre)
    expect(def.spawn.feetX).toBe(centre)
    expect(zone.x).toBeLessThanOrEqual(door.x)
    expect(zone.x + zone.w).toBeGreaterThanOrEqual(door.x + door.w)
    expect(zone.x + zone.w).toBeLessThanOrEqual(door.x + door.w + 8)
    expect(findNearbyTarget(spawn, [def.exit])).toBeNull()
    expect(
      findNearbyTarget({ x: centre, y: zone.y + zone.h - 1 }, [def.exit])?.id,
    ).toBe('exit')
  })

  it('blocks the back wall and every solid piece, and spawns in free space', () => {
    expect(isFeetSafe(spawn, obstacles, room)).toBe(true)
    expect(isFeetSafe({ x: def.widthPx / 2, y: def.wallHeightPx + bodyH - 2 }, obstacles, room))
      .toBe(false)
    for (const piece of def.pieces) {
      if (!piece.solid) continue
      const s = piece.solid
      const centre: Point = { x: s.x + s.w / 2, y: s.y + s.h / 2 + bodyH / 2 }
      expect(isFeetSafe(centre, obstacles, room), `${piece.id} is not solid`).toBe(false)
    }
  })

  it('keeps furniture out of the exit zone and leaves a clear corridor to the door', () => {
    const zone = def.exit.zone
    for (const rect of obstacles) {
      if (label(rect) === 'wall') continue
      expect(rectsOverlap(rect, zone), label(rect)).toBe(false)
    }
    const door = pieceBounds(def.pieces.find(p => p.id === 'door')!)
    const lowestFeet = def.wallHeightPx + bodyH + 1
    for (const x of [door.x, door.x + door.w / 2, door.x + door.w]) {
      for (let y = spawn.y; y >= lowestFeet; y -= 1) {
        expect(isFeetSafe({ x, y }, obstacles, room), `blocked at (${x},${y})`).toBe(true)
      }
    }
  })

  it('lets the player reach the exit, the computer and the notebook, with no dead pockets', () => {
    const { reached, free } = reachableFeet(def, spawn, obstacles)
    const zone = def.exit.zone
    const exitPoint = { x: def.exit.promptX, y: Math.ceil((def.wallHeightPx + bodyH + 2) / 2) * 2 }
    expect(reached.has(`${exitPoint.x},${exitPoint.y}`), 'exit').toBe(true)
    expect(findNearbyTarget(exitPoint, [def.exit])?.id).toBe('exit')
    expect(zone.y).toBeLessThan(exitPoint.y)

    // "Reachable" for a prop means the player can stand within 40px of it: items
    // on a table are only reachable from the table's edge. The real interaction
    // distance is a Phase 3 decision.
    for (const role of ['computer', 'notebook'] as const) {
      const piece = def.pieces.find(p => p.role === role)!
      const box = pieceBounds(piece)
      const near = [...reached].some(k => {
        const [x, y] = k.split(',').map(Number) as [number, number]
        return x >= box.x - 40 && x <= box.x + box.w + 40 &&
          y >= box.y - 40 && y <= box.y + box.h + 40
      })
      expect(near, `${role} unreachable`).toBe(true)
    }
    expect(free - reached.size).toBeLessThanOrEqual(12)
  })

  it('sorts depth by the feet: behind when north of a piece, in front when south', () => {
    for (const piece of def.pieces) {
      if (piece.layer === 'sorted') {
        expect(pieceDepth(piece), piece.id).toBeGreaterThan(DEPTH_PLAYER)
        expect(pieceDepth(piece), piece.id).toBeLessThan(DEPTH_TREETOP)
        if (piece.solid) {
          expect(depthForFeetY(piece.solid.y), `${piece.id} behind`).toBeLessThan(pieceDepth(piece))
          expect(
            depthForFeetY(piece.solid.y + piece.solid.h + bodyH),
            `${piece.id} in front`,
          ).toBeGreaterThan(pieceDepth(piece))
        }
      } else {
        expect(pieceDepth(piece), piece.id).toBeLessThan(depthForFeetY(0))
      }
    }
  })

  it('keeps items resting on furniture above it, and below a player standing in front', () => {
    const solids = def.pieces.filter(p => p.solid)
    for (const item of def.pieces) {
      if (item.sortBottom === undefined) continue
      const base = solids.find(s => pointInRect({ x: item.x + 1, y: item.bottom - 1 }, {
        x: s.solid!.x, y: s.solid!.y - 20, w: s.solid!.w, h: s.solid!.h + 20,
      }))
      if (!base) continue
      expect(pieceDepth(item), `${item.id} above ${base.id}`).toBeGreaterThan(pieceDepth(base))
      const inFront = depthForFeetY(base.solid!.y + base.solid!.h + bodyH)
      expect(inFront, `${item.id} under a player in front`).toBeGreaterThan(pieceDepth(item))
    }
  })

  it('fits on a 1280x720 canvas at a whole-number zoom, and a 1920x1080 one', () => {
    const view = interiorViewRect(def)
    expect(view.w).toBe(def.widthPx + INTERIOR_BORDER_PX * 2)
    for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
      const { zoom, fits } = chooseIntegerZoom(w, h, view, INTERIOR_VIEW_MARGIN_PX)
      expect(fits, `${w}x${h}`).toBe(true)
      expect(Number.isInteger(zoom)).toBe(true)
      expect(view.w * zoom).toBeLessThanOrEqual(w)
      expect(view.h * zoom).toBeLessThanOrEqual(h)
    }
  })
})
