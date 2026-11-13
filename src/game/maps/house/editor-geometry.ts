import type { Point } from '../../../lib/geometry'
import { TILE_SIZE } from '../../config/GameConfig'
import {
  pieceBounds,
  pieceDepth,
  spriteSize,
  type InteriorDefinition,
  type InteriorPiece,
} from '../interior-layout'
import { getFurnitureType } from './furniture-catalog'
import type { HouseLayout } from './house-layout'
import type { Target } from './layout-edits'

/**
 * Pure geometry for the furniture editor: where a dragged item would land,
 * what the pointer is over, and what an item can rest on. Room pixels in,
 * layout targets out. No Phaser, no state.
 */

/** Resting items (notebook, lamp, books) move in steps this fine on their support. */
export const SURFACE_STEP_PX = 4

/** An item's anchor: the sprite's left edge (x) and bottom edge (y). */
export function anchorOf(piece: InteriorPiece): Point {
  return { x: piece.x, y: piece.bottom }
}

/** Where the grabbed point sits relative to the anchor, so a drag never jumps. */
export function grabOffset(pointer: Point, piece: InteriorPiece): Point {
  return { x: pointer.x - piece.x, y: pointer.y - piece.bottom }
}

/** Grab offset for a new item from the catalogue: the pointer holds its centre. */
export function centreGrab(type: string): Point {
  const entry = getFurnitureType(type)
  const size = entry ? spriteSize(entry.sprite) : null
  if (!size) return { x: 0, y: 0 }
  return { x: Math.round(size.w / 2), y: -Math.round(size.h / 2) }
}

/** `Math.round` can return -0, which would leak into stored layouts; this never does. */
const round = (value: number): number => Math.round(value) + 0

/** The nearest grid cell for an anchor. */
export function snapGrid(anchor: Point): Target {
  return {
    kind: 'grid',
    col: round(anchor.x / TILE_SIZE),
    row: round(anchor.y / TILE_SIZE),
  }
}

const snapStep = (value: number): number => round(value / SURFACE_STEP_PX) * SURFACE_STEP_PX + 0
const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi) + 0

/**
 * Resting position on a support for an item of size `size` whose anchor is at
 * `anchor`, or null when the item's base is not over the support's top.
 * Offsets snap to `SURFACE_STEP_PX` and are kept on the support, so hovering
 * near its edge still gives a placement on it.
 */
export function snapOnSupport(
  anchor: Point,
  size: { w: number; h: number },
  support: InteriorPiece,
): Target | null {
  const top = pieceBounds(support)
  const baseCentre = { x: anchor.x + size.w / 2, y: anchor.y }
  const over = baseCentre.x >= top.x && baseCentre.x <= top.x + top.w &&
    baseCentre.y >= top.y && baseCentre.y <= top.y + top.h
  if (!over) return null

  const maxDx = Math.max(0, Math.floor((top.w - size.w) / SURFACE_STEP_PX) * SURFACE_STEP_PX)
  const minDy = -Math.floor(top.h / SURFACE_STEP_PX) * SURFACE_STEP_PX
  return {
    kind: 'attached',
    to: support.id,
    dx: clamp(snapStep(anchor.x - support.x), 0, maxDx),
    dy: clamp(snapStep(anchor.y - support.bottom), minDy, 0),
  }
}

/** Ids of an item and everything resting on it, directly or indirectly. */
export function movingGroup(layout: HouseLayout, itemId: string): Set<string> {
  const group = new Set<string>([itemId])
  let grew = true
  while (grew) {
    grew = false
    for (const item of layout.items) {
      if (item.at.kind === 'attached' && group.has(item.at.to) && !group.has(item.id)) {
        group.add(item.id)
        grew = true
      }
    }
  }
  return group
}

/** Draw order the scene uses: higher depth on top; equal depth, later in the list on top. */
function drawnAbove(a: { piece: InteriorPiece; index: number }, b: { piece: InteriorPiece; index: number }): boolean {
  const da = pieceDepth(a.piece)
  const db = pieceDepth(b.piece)
  return da !== db ? da > db : a.index > b.index
}

/** The supporting item under an anchor, topmost first, or null. */
function supportUnder(
  def: InteriorDefinition,
  layout: HouseLayout,
  anchor: Point,
  size: { w: number; h: number },
  exclude: ReadonlySet<string>,
): Target | null {
  let best: { piece: InteriorPiece; index: number; target: Target } | null = null
  def.pieces.forEach((piece, index) => {
    if (exclude.has(piece.id)) return
    const item = layout.items.find(i => i.id === piece.id)
    if (!item || !getFurnitureType(item.type)?.supports) return
    const target = snapOnSupport(anchor, size, piece)
    if (target && (!best || drawnAbove({ piece, index }, best))) best = { piece, index, target }
  })
  return best ? (best as { target: Target }).target : null
}

/**
 * Where an item of `type` would go with the pointer at `pointer`, holding it
 * at `grab`. Floor and wall items always get a grid cell, even outside the
 * room, so the rules can say why it does not fit. Resting items get a spot on
 * the support under them, or null when there is none. `exclude` lists items
 * that cannot be a support for this move (the item itself and what rests on it).
 */
export function targetFor(
  type: string,
  pointer: Point,
  grab: Point,
  def: InteriorDefinition,
  layout: HouseLayout,
  exclude: ReadonlySet<string> = new Set(),
): Target | null {
  const entry = getFurnitureType(type)
  const size = entry ? spriteSize(entry.sprite) : null
  if (!entry || !size) return null

  const anchor = { x: pointer.x - grab.x, y: pointer.y - grab.y }
  if (entry.mount === 'surface') return supportUnder(def, layout, anchor, size, exclude)
  return snapGrid(anchor)
}

/** The topmost selectable piece under a point, or null. The door is part of the room. */
export function hitTest(def: InteriorDefinition, point: Point): InteriorPiece | null {
  let best: { piece: InteriorPiece; index: number } | null = null
  def.pieces.forEach((piece, index) => {
    if (piece.id === 'door') return
    const b = pieceBounds(piece)
    const inside = point.x >= b.x && point.x < b.x + b.w && point.y >= b.y && point.y < b.y + b.h
    if (inside && (!best || drawnAbove({ piece, index }, best))) best = { piece, index }
  })
  return best ? (best as { piece: InteriorPiece }).piece : null
}

/** True when two targets put an item in the same place. */
export function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'grid' && b.kind === 'grid') return a.col === b.col && a.row === b.row
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.to === b.to && a.dx === b.dx && a.dy === b.dy
  }
  return false
}
