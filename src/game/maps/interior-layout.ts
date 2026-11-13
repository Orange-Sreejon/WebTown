import type { Point, Rect } from '../../lib/geometry'
import {
  DEPTH_DECORATION,
  DEPTH_STRUCTURE,
  INTERIOR_BORDER_PX,
  depthForFeetY,
} from '../config/GameConfig'
import type { Direction } from '../systems/movement'
import type { InteractionTarget } from '../systems/interaction'
import type { CollisionRect } from './collision-objects'
import {
  FURNITURE,
  OFFICE_KIT,
  PREPARED,
  type SliceRect,
} from './interior-slices'
import { scaledHeight } from './sprite-prep'

/**
 * Interior types and pure helpers.
 *
 * An `InteriorDefinition` is what the scene draws and collides with: a floor,
 * a back wall, and a list of pieces. It is no longer written by hand. It is
 * resolved from a template plus one house's furniture layout (see
 * `maps/house/`), so everything the scene needs still derives from one
 * description. Coordinates are room-local pixels at 1× scale, origin at the
 * room's top-left corner.
 */

/** Which source a piece's sprite is cut from. */
export type SheetId = 'kit' | 'furniture' | 'prepared'

export interface SpriteRef {
  sheet: SheetId
  /** Key into `OFFICE_KIT`, `FURNITURE` or `PREPARED`. */
  name: string
}

/**
 * Draw order group.
 *  - `flat`    lies on the floor and is walked over (rugs)
 *  - `decor`   hangs on the wall behind everything (windows, pictures, the door)
 *  - `sorted`  stands on the floor and is y-sorted against the player
 */
export type PieceLayer = 'flat' | 'decor' | 'sorted'

/** Props that Phase 3 will make interactive. Inert in Phase 2. */
export type PieceRole = 'computer' | 'notebook'

export interface InteriorPiece {
  id: string
  sprite: SpriteRef
  /** Left edge of the sprite. */
  x: number
  /** Bottom edge of the sprite; the piece is anchored here. */
  bottom: number
  layer: PieceLayer
  /** Blocks the player. Omit for anything walkable or purely decorative. */
  solid?: Rect
  /** Overrides the bottom edge used for y-sorting, so items on a table sit above it. */
  sortBottom?: number
  role?: PieceRole
}

export interface InteriorDefinition {
  id: string
  widthPx: number
  heightPx: number
  /** Height of the back wall; the floor starts directly below it. */
  wallHeightPx: number
  /** Which office-kit tiles make the floor and the back wall. */
  style: InteriorStyle
  /** Where the player appears, and which way they face. */
  spawn: { feetX: number; feetY: number; facing: Direction }
  /** The door the player leaves through. */
  exit: InteractionTarget
  pieces: readonly InteriorPiece[]
}

/** Office-kit frames that can serve as floor or wall tiles. */
export type KitTile = 'floor' | 'brickWall' | 'wallUpper' | 'wallLower'

export interface InteriorStyle {
  /** Tiled across the floor. */
  floor: KitTile
  /** Upper and lower halves of the back wall, each 32px tall. */
  wallUpper: KitTile
  wallLower: KitTile
}

// ─── Sprite sizes ──────────────────────────────────────────────────────────

const SHEETS: Record<'kit' | 'furniture', Record<string, SliceRect>> = {
  kit: OFFICE_KIT,
  furniture: FURNITURE,
}

/** Drawn size of a sprite, or null when the reference is unknown. */
export function spriteSize(sprite: SpriteRef): { w: number; h: number } | null {
  if (sprite.sheet === 'prepared') {
    const spec = (PREPARED as Record<string, (typeof PREPARED)[keyof typeof PREPARED]>)[sprite.name]
    if (!spec) return null
    return {
      w: spec.targetWidth,
      h: scaledHeight(spec.source.w, spec.source.h, spec.targetWidth),
    }
  }
  const slice = SHEETS[sprite.sheet][sprite.name]
  return slice ? { w: slice.w, h: slice.h } : null
}

/** The rectangle a piece's sprite covers. */
export function pieceBounds(piece: InteriorPiece): Rect {
  const size = spriteSize(piece.sprite)
  if (!size) throw new Error(`Piece "${piece.id}" uses unknown sprite "${piece.sprite.name}"`)
  return { x: piece.x, y: piece.bottom - size.h, w: size.w, h: size.h }
}

// ─── Depth ─────────────────────────────────────────────────────────────────

/**
 * Draw depth for a piece. Flat things (rugs) sit just above the floor, wall
 * decoration above the wall, and everything else is y-sorted by its base with
 * the same function the player uses, so the player passes in front of or
 * behind furniture according to where their feet are.
 */
export function pieceDepth(piece: InteriorPiece): number {
  switch (piece.layer) {
    case 'flat':
      return DEPTH_DECORATION
    case 'decor':
      return DEPTH_STRUCTURE
    case 'sorted':
      return depthForFeetY(piece.sortBottom ?? piece.bottom)
  }
}

// ─── Framing and collision ─────────────────────────────────────────────────

/**
 * The rectangle the camera should frame: the room plus its decorative side and
 * bottom borders. The top edge is the back wall, which has no border.
 */
export function interiorViewRect(def: InteriorDefinition): Rect {
  return {
    x: -INTERIOR_BORDER_PX,
    y: 0,
    w: def.widthPx + INTERIOR_BORDER_PX * 2,
    h: def.heightPx + INTERIOR_BORDER_PX,
  }
}

/** The back wall plus every solid piece. The room's other edges are the world bounds. */
export function getInteriorCollisionRects(def: InteriorDefinition): CollisionRect[] {
  const rects: CollisionRect[] = [
    { label: 'wall', x: 0, y: 0, w: def.widthPx, h: def.wallHeightPx },
  ]
  for (const piece of def.pieces) {
    if (piece.solid) rects.push({ label: piece.id, ...piece.solid })
  }
  return rects
}

/** The spawn point as feet coordinates. */
export function spawnFeet(def: InteriorDefinition): Point {
  return { x: def.spawn.feetX, y: def.spawn.feetY }
}
