import type { PieceLayer, PieceRole, SpriteRef } from '../interior-layout'
import type { Rotation } from './house-layout'

/**
 * Every kind of furniture a house can contain.
 *
 * A type says what the thing looks like and how it collides; WHERE it is
 * belongs to the house's layout. Collision is the item's honest footprint
 * (what the sprite really occupies on the floor), relative to the sprite's
 * left edge and bottom edge. Closing the gap between a piece and the back
 * wall is a layout rule, not a catalogue property, so moving a piece away
 * from the wall never leaves invisible collision behind.
 */

export type Mount =
  /** Stands on the floor at a grid position. */
  | 'floor'
  /** Hangs on the back wall at a grid position. */
  | 'wall'
  /** Rests on a supporting item and moves with it. */
  | 'surface'

export interface FurnitureSolid {
  /** From the sprite's left edge. */
  dx: number
  /** From the sprite's bottom edge; negative is up. */
  dy: number
  w: number
  h: number
}

export interface FurnitureType {
  label: string
  sprite: SpriteRef
  layer: PieceLayer
  mount: Mount
  solid?: FurnitureSolid
  role?: PieceRole
  /** The computer and the notebook are mandatory, so they can never be removed. */
  removable: boolean
  /** Allowed quarter turns. Every current sprite has a single facing. */
  rotations: readonly Rotation[]
  /** Other items may rest on this one. */
  supports?: boolean
}

const FIXED: readonly Rotation[] = [0]

export const FURNITURE_CATALOG: Readonly<Record<string, FurnitureType>> = {
  // Wall hangings
  'window-blue': {
    label: 'Blue window', sprite: { sheet: 'furniture', name: 'windowBlue' },
    layer: 'decor', mount: 'wall', removable: true, rotations: FIXED,
  },
  'window-pink': {
    label: 'Pink window', sprite: { sheet: 'furniture', name: 'windowPink' },
    layer: 'decor', mount: 'wall', removable: true, rotations: FIXED,
  },
  painting: {
    label: 'Landscape painting', sprite: { sheet: 'furniture', name: 'paintingLandscape' },
    layer: 'decor', mount: 'wall', removable: true, rotations: FIXED,
  },
  clock: {
    label: 'Wall clock', sprite: { sheet: 'furniture', name: 'clock' },
    layer: 'decor', mount: 'wall', removable: true, rotations: FIXED,
  },
  'sticky-note': {
    label: 'Sticky note', sprite: { sheet: 'kit', name: 'stickyNote' },
    layer: 'decor', mount: 'wall', removable: true, rotations: FIXED,
  },

  // Floor coverings (walked over)
  'rug-orange': {
    label: 'Orange rug', sprite: { sheet: 'furniture', name: 'rugOrange' },
    layer: 'flat', mount: 'floor', removable: true, rotations: FIXED,
  },
  'rug-blue': {
    label: 'Blue rug', sprite: { sheet: 'furniture', name: 'rugBlue' },
    layer: 'flat', mount: 'floor', removable: true, rotations: FIXED,
  },

  // Furniture
  'bed-blue': {
    label: 'Bed', sprite: { sheet: 'furniture', name: 'bedBlue' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 0, dy: -49, w: 30, h: 49 },
  },
  chest: {
    label: 'Chest', sprite: { sheet: 'furniture', name: 'chest' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 0, dy: -18, w: 24, h: 18 },
  },
  nightstand: {
    label: 'Nightstand', sprite: { sheet: 'furniture', name: 'nightstand' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED, supports: true,
    solid: { dx: 0, dy: -24, w: 26, h: 24 },
  },
  bookshelf: {
    label: 'Bookshelf', sprite: { sheet: 'furniture', name: 'bookshelfTall' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 0, dy: -8, w: 48, h: 8 },
  },
  'computer-desk': {
    label: 'Computer desk', sprite: { sheet: 'prepared', name: 'computerDesk' },
    layer: 'sorted', mount: 'floor', removable: false, rotations: FIXED, role: 'computer',
    solid: { dx: 0, dy: -52, w: 48, h: 52 },
  },
  table: {
    label: 'Table', sprite: { sheet: 'furniture', name: 'plankTable' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED, supports: true,
    solid: { dx: 0, dy: -50, w: 64, h: 50 },
  },
  chair: {
    label: 'Chair', sprite: { sheet: 'furniture', name: 'chair' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 1, dy: -12, w: 13, h: 12 },
  },
  stool: {
    label: 'Stool', sprite: { sheet: 'furniture', name: 'stool' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 1, dy: -10, w: 12, h: 10 },
  },
  barrel: {
    label: 'Barrel', sprite: { sheet: 'furniture', name: 'barrel' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 0, dy: -10, w: 19, h: 10 },
  },
  'plant-pink': {
    label: 'Pink flowers', sprite: { sheet: 'furniture', name: 'plantPink' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 0, dy: -22, w: 19, h: 22 },
  },
  'plant-green': {
    label: 'Green plant', sprite: { sheet: 'furniture', name: 'plantGreen' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 2, dy: -12, w: 34, h: 12 },
  },
  'plant-red': {
    label: 'Red flowers', sprite: { sheet: 'furniture', name: 'plantRed' },
    layer: 'sorted', mount: 'floor', removable: true, rotations: FIXED,
    solid: { dx: 0, dy: -10, w: 14, h: 10 },
  },

  // Things that rest on furniture
  lamp: {
    label: 'Table lamp', sprite: { sheet: 'furniture', name: 'lamp' },
    layer: 'sorted', mount: 'surface', removable: true, rotations: FIXED,
  },
  notebook: {
    label: 'Notebook', sprite: { sheet: 'prepared', name: 'notebook' },
    layer: 'sorted', mount: 'surface', removable: false, rotations: FIXED, role: 'notebook',
  },
  'book-stack': {
    label: 'Books', sprite: { sheet: 'prepared', name: 'bookStack' },
    layer: 'sorted', mount: 'surface', removable: true, rotations: FIXED,
  },
}

/** The catalogue entry for a type, or undefined for an unknown type. */
export function getFurnitureType(type: string): FurnitureType | undefined {
  return FURNITURE_CATALOG[type]
}
