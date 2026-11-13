import { pointInRect, rectsOverlap, type Point, type Rect } from '../../../lib/geometry'
import { INTERIOR_PROP_REACH_PX } from '../../config/GameConfig'
import { isFeetSafe } from '../../systems/return-position'
import {
  getInteriorCollisionRects,
  pieceBounds,
  type InteriorDefinition,
  type InteriorPiece,
} from '../interior-layout'
import { getFurnitureType } from './furniture-catalog'
import type { HouseLayout, InteriorTemplate } from './house-layout'
import { resolveInterior } from './resolve-interior'

/**
 * What makes a house layout legal. Pure functions over data: the same rules
 * will judge an owner's edit before it is saved, and judge the default room in
 * tests. The rules check the SAME resolved geometry the scene draws and
 * collides with, so a layout that passes cannot behave differently in game.
 */

export type ViolationCode =
  | 'unknown-type'
  | 'duplicate-id'
  | 'bad-rotation'
  | 'bad-placement'
  | 'not-on-grid'
  | 'bad-support'
  | 'out-of-bounds'
  | 'overlap'
  | 'wall-clash'
  | 'blocks-exit'
  | 'blocks-spawn'
  | 'missing-mandatory'
  | 'unreachable'

export interface Violation {
  code: ViolationCode
  /** The item at fault, when one is. */
  itemId?: string
  /** The other item involved, for overlaps and wall clashes. */
  otherId?: string
  message: string
}

const v = (code: ViolationCode, message: string, itemId?: string, otherId?: string): Violation => {
  const out: Violation = { code, message }
  if (itemId !== undefined) out.itemId = itemId
  if (otherId !== undefined) out.otherId = otherId
  return out
}

/** Cell spacing used when testing where the player can stand. */
export const REACH_STEP_PX = 2

// ─── Reachability ──────────────────────────────────────────────────────────

export interface Reachability {
  /** Keys "x,y" of every feet position the player can walk to from the spawn. */
  reached: ReadonlySet<string>
  /** Count of all feet positions that are free, reachable or not. */
  free: number
}

/**
 * Flood fill over player-feet positions, `step` px apart, from the spawn. The
 * player is a body, not a point, so squeezing through a gap narrower than the
 * body does not count.
 */
export function reachableFeet(
  room: { widthPx: number; heightPx: number },
  spawn: Point,
  obstacles: readonly Rect[],
  step = REACH_STEP_PX,
): Reachability {
  const bounds: Rect = { x: 0, y: 0, w: room.widthPx, h: room.heightPx }
  const safe = (x: number, y: number): boolean => isFeetSafe({ x, y }, obstacles, bounds)
  const key = (x: number, y: number): string => `${x},${y}`

  let free = 0
  for (let y = 0; y <= bounds.h; y += step) {
    for (let x = 0; x <= bounds.w; x += step) if (safe(x, y)) free++
  }

  const reached = new Set<string>([key(spawn.x, spawn.y)])
  const queue: Point[] = [{ x: spawn.x, y: spawn.y }]
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head]!
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

function parseKey(key: string): Point {
  const [x, y] = key.split(',').map(Number) as [number, number]
  return { x, y }
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Every rule a layout breaks; an empty list means it is valid. Structural
 * problems (unknown types, bad supports) are reported on their own, because
 * the geometry rules cannot run on a layout that cannot be resolved.
 */
export function validateLayout(template: InteriorTemplate, layout: HouseLayout): Violation[] {
  const structural = structuralViolations(layout)
  if (structural.length > 0) return structural

  return geometryViolations(template, layout, resolveInterior(template, layout))
}

function structuralViolations(layout: HouseLayout): Violation[] {
  const out: Violation[] = []
  const seen = new Set<string>()

  for (const item of layout.items) {
    if (seen.has(item.id)) out.push(v('duplicate-id', `Two items share the id "${item.id}"`, item.id))
    seen.add(item.id)

    const type = getFurnitureType(item.type)
    if (!type) {
      out.push(v('unknown-type', `"${item.id}" is an unknown furniture type "${item.type}"`, item.id))
      continue
    }
    if (!type.rotations.includes(item.rotation)) {
      out.push(v('bad-rotation', `${type.label} cannot face ${item.rotation}°`, item.id))
    }

    const at = item.at
    if (type.mount === 'surface') {
      if (at.kind !== 'attached') {
        out.push(v('bad-placement', `${type.label} must rest on furniture`, item.id))
        continue
      }
      const support = layout.items.find(other => other.id === at.to)
      const supportType = support ? getFurnitureType(support.type) : undefined
      if (!support || !supportType?.supports || support.at.kind !== 'grid') {
        out.push(v('bad-support', `${type.label} is not resting on a table-like item`, item.id))
      }
    } else if (at.kind !== 'grid') {
      out.push(v('bad-placement', `${type.label} cannot rest on other furniture`, item.id))
    } else if (!Number.isInteger(at.col) || !Number.isInteger(at.row)) {
      out.push(v('not-on-grid', `${type.label} is not on a grid cell`, item.id))
    }
  }
  return out
}

function geometryViolations(
  template: InteriorTemplate,
  layout: HouseLayout,
  def: InteriorDefinition,
): Violation[] {
  const out: Violation[] = []
  const room: Rect = { x: 0, y: 0, w: def.widthPx, h: def.heightPx }
  const wall: Rect = { x: 0, y: 0, w: def.widthPx, h: def.wallHeightPx }
  const floor: Rect = { x: 0, y: def.wallHeightPx, w: def.widthPx, h: def.heightPx - def.wallHeightPx }
  const pieceById = new Map(def.pieces.map(p => [p.id, p]))
  const inside = (outer: Rect, inner: Rect): boolean =>
    inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

  const door = pieceById.get('door')!
  const wallPieces: InteriorPiece[] = [door]

  for (const item of layout.items) {
    const piece = pieceById.get(item.id)!
    const type = getFurnitureType(item.type)!
    const bounds = pieceBounds(piece)

    if (type.mount === 'wall') {
      wallPieces.push(piece)
      if (!inside(wall, bounds)) {
        out.push(v('out-of-bounds', `${type.label} must hang on the back wall`, item.id))
      }
    } else if (type.mount === 'floor') {
      // Tall furniture may overlap the wall visually; what must lie on the floor is its base.
      const base: Rect = piece.solid ?? bounds
      const withinRoom = bounds.x >= 0 && bounds.x + bounds.w <= room.w && bounds.y >= 0 &&
        bounds.y + bounds.h <= room.h
      if (!withinRoom || !inside(floor, type.layer === 'flat' ? bounds : base)) {
        out.push(v('out-of-bounds', `${type.label} does not fit on the floor there`, item.id))
      }
    } else if (item.at.kind === 'attached') {
      const supportId = item.at.to
      const support = pieceById.get(supportId)!
      const s = pieceBounds(support)
      const onTop = bounds.x >= s.x && bounds.x + bounds.w <= s.x + s.w &&
        piece.bottom >= s.y && piece.bottom <= s.y + s.h
      if (!onTop) {
        out.push(v('bad-support', `${type.label} is not on top of its support`, item.id))
      }
    }
  }

  // Wall hangings and the door must not overlap each other.
  for (let i = 0; i < wallPieces.length; i++) {
    for (let j = i + 1; j < wallPieces.length; j++) {
      const a = wallPieces[i]!
      const b = wallPieces[j]!
      if (rectsOverlap(pieceBounds(a), pieceBounds(b))) {
        const [item, other] = a.id === 'door' ? [b.id, a.id] : [a.id, b.id]
        out.push(v('wall-clash', `"${a.id}" overlaps "${b.id}" on the wall`, item, other))
      }
    }
  }

  // Solids must not overlap each other.
  const solids = def.pieces.filter(p => p.solid)
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (rectsOverlap(solids[i]!.solid!, solids[j]!.solid!)) {
        out.push(v(
          'overlap',
          `"${solids[i]!.id}" overlaps "${solids[j]!.id}"`,
          solids[j]!.id,
          solids[i]!.id,
        ))
      }
    }
  }

  // Nothing may sit in the doorway.
  for (const piece of solids) {
    if (rectsOverlap(piece.solid!, template.exit.zone)) {
      out.push(v('blocks-exit', `"${piece.id}" blocks the way to the door`, piece.id))
    }
  }

  // Exactly one computer and one notebook.
  for (const role of ['computer', 'notebook'] as const) {
    const count = def.pieces.filter(p => p.role === role).length
    if (count !== 1) {
      out.push(v('missing-mandatory', `A house needs exactly one ${role}, found ${count}`))
    }
  }

  // The player must be able to arrive, leave, and reach the computer and notebook.
  const obstacles: Rect[] = getInteriorCollisionRects(def)
  const spawn: Point = { x: template.spawn.feetX, y: template.spawn.feetY }
  const body: Rect = { x: 0, y: 0, w: def.widthPx, h: def.heightPx }
  if (!isFeetSafe(spawn, obstacles, body)) {
    out.push(v('blocks-spawn', 'Furniture is standing where the player arrives'))
    return out
  }

  const { reached } = reachableFeet(def, spawn, obstacles)
  const cells = [...reached].map(parseKey)

  if (!cells.some(p => pointInRect(p, template.exit.zone))) {
    out.push(v('unreachable', 'The player cannot walk to the door'))
  }
  for (const role of ['computer', 'notebook'] as const) {
    const piece = def.pieces.find(p => p.role === role)
    if (!piece) continue
    const b = pieceBounds(piece)
    const reach = INTERIOR_PROP_REACH_PX
    const near = cells.some(
      p => p.x >= b.x - reach && p.x <= b.x + b.w + reach && p.y >= b.y - reach && p.y <= b.y + b.h + reach,
    )
    if (!near) out.push(v('unreachable', `The player cannot get near the ${role}`, piece.id))
  }
  return out
}

/** Convenience: true when the layout breaks no rule. */
export function isLayoutValid(template: InteriorTemplate, layout: HouseLayout): boolean {
  return validateLayout(template, layout).length === 0
}
