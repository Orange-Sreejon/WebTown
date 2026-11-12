import type { Point, Rect } from '../../lib/geometry'
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
 * Interior layouts as pure data.
 *
 * A room is a floor, a back wall, and a list of pieces. Everything the scene
 * draws and everything the player collides with is derived from this one
 * description, so a second room is a second `InteriorDefinition` and nothing
 * else. Coordinates are room-local pixels at 1× scale, origin at the room's
 * top-left corner.
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
  /** Where the player appears, and which way they face. */
  spawn: { feetX: number; feetY: number; facing: Direction }
  /** The door the player leaves through. */
  exit: InteractionTarget
  pieces: readonly InteriorPiece[]
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

// ─── Collision ─────────────────────────────────────────────────────────────

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

// ─── The cozy room ─────────────────────────────────────────────────────────
// A 16 × 14 tile room: a 4-tile back wall over a 10-tile floor. Everything
// against the back wall extends its solid up to the wall so the player cannot
// squeeze into the gap behind it. Bed, nightstand and chest on the left; door,
// shelf and decor along the wall; computer desk in the right corner; table,
// chair and rug in the middle of the floor; plants in the corners.

export const COZY_ROOM: InteriorDefinition = {
  id: 'cozy-room',
  widthPx: 256,
  heightPx: 224,
  wallHeightPx: 64,
  spawn: { feetX: 132, feetY: 84, facing: 'down' },
  exit: {
    id: 'exit',
    zone: { x: 108, y: 68, w: 48, h: 36 },
    promptX: 132,
    promptY: 30,
  },
  pieces: [
    // Wall: door, windows with curtains, pictures
    { id: 'door', sprite: { sheet: 'kit', name: 'door' }, x: 116, bottom: 64, layer: 'decor' },
    {
      id: 'window-blue',
      sprite: { sheet: 'furniture', name: 'windowBlue' },
      x: 12, bottom: 50, layer: 'decor',
    },
    {
      id: 'window-pink',
      sprite: { sheet: 'furniture', name: 'windowPink' },
      x: 210, bottom: 50, layer: 'decor',
    },
    {
      id: 'painting',
      sprite: { sheet: 'furniture', name: 'paintingLandscape' },
      x: 152, bottom: 43, layer: 'decor',
    },
    {
      id: 'clock',
      sprite: { sheet: 'furniture', name: 'clock' },
      x: 192, bottom: 40, layer: 'decor',
    },

    // Floor covering
    {
      id: 'rug',
      sprite: { sheet: 'furniture', name: 'rugOrange' },
      x: 60, bottom: 197, layer: 'flat',
    },

    // Left wall: bed, nightstand with lamp, chest at the foot of the bed
    {
      id: 'bed',
      sprite: { sheet: 'furniture', name: 'bedBlue' },
      x: 12, bottom: 124, layer: 'sorted',
      solid: { x: 12, y: 64, w: 30, h: 60 },
    },
    {
      id: 'chest',
      sprite: { sheet: 'furniture', name: 'chest' },
      x: 14, bottom: 148, layer: 'sorted',
      solid: { x: 14, y: 130, w: 24, h: 18 },
    },
    {
      id: 'nightstand',
      sprite: { sheet: 'furniture', name: 'nightstand' },
      x: 44, bottom: 100, layer: 'sorted',
      solid: { x: 44, y: 76, w: 26, h: 24 },
    },
    {
      id: 'lamp',
      sprite: { sheet: 'furniture', name: 'lamp' },
      x: 48, bottom: 86, layer: 'sorted', sortBottom: 100.2,
    },

    // Back wall: bookshelf, plant
    {
      id: 'bookshelf',
      sprite: { sheet: 'furniture', name: 'bookshelfTall' },
      x: 60, bottom: 72, layer: 'sorted',
      solid: { x: 60, y: 64, w: 48, h: 8 },
    },
    {
      id: 'plant-pink',
      sprite: { sheet: 'furniture', name: 'plantPink' },
      x: 162, bottom: 86, layer: 'sorted',
      solid: { x: 162, y: 64, w: 19, h: 22 },
    },

    // Right corner: the computer desk with the large computer
    {
      id: 'computer-desk',
      sprite: { sheet: 'prepared', name: 'computerDesk' },
      x: 204, bottom: 118, layer: 'sorted',
      solid: { x: 204, y: 64, w: 48, h: 54 },
      role: 'computer',
    },

    // Middle: table with notebook and books, and a chair
    {
      id: 'table',
      sprite: { sheet: 'furniture', name: 'plankTable' },
      x: 176, bottom: 190, layer: 'sorted',
      solid: { x: 176, y: 140, w: 64, h: 50 },
    },
    {
      id: 'notebook',
      sprite: { sheet: 'prepared', name: 'notebook' },
      x: 198, bottom: 170, layer: 'sorted', sortBottom: 190.2,
      role: 'notebook',
    },
    {
      id: 'books',
      sprite: { sheet: 'prepared', name: 'bookStack' },
      x: 182, bottom: 168, layer: 'sorted', sortBottom: 190.2,
    },
    {
      id: 'chair',
      sprite: { sheet: 'furniture', name: 'chair' },
      x: 157, bottom: 178, layer: 'sorted',
      solid: { x: 158, y: 166, w: 13, h: 12 },
    },

    // Corner plants
    {
      id: 'plant-green',
      sprite: { sheet: 'furniture', name: 'plantGreen' },
      x: 10, bottom: 218, layer: 'sorted',
      solid: { x: 12, y: 206, w: 34, h: 12 },
    },
    {
      id: 'plant-red',
      sprite: { sheet: 'furniture', name: 'plantRed' },
      x: 234, bottom: 218, layer: 'sorted',
      solid: { x: 234, y: 208, w: 14, h: 10 },
    },
  ],
}

const INTERIORS: Record<string, InteriorDefinition> = {
  [COZY_ROOM.id]: COZY_ROOM,
}

/** Looks up an interior by id; undefined for an unknown id. */
export function getInterior(id: string): InteriorDefinition | undefined {
  return INTERIORS[id]
}

/** The spawn point as feet coordinates. */
export function spawnFeet(def: InteriorDefinition): Point {
  return { x: def.spawn.feetX, y: def.spawn.feetY }
}
