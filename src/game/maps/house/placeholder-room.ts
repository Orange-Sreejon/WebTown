/**
 * Colours for the placeholder room.
 *
 * The interior art (`public/assets/interior/`) is deliberately kept out of the
 * repository: its licence is unverified (see `docs/ASSETS.md`, Pack 7). A fresh
 * clone therefore has no interior sheets, and without a fallback the player
 * could not enter any house at all.
 *
 * When the sheets are missing the room is drawn from plain coloured rectangles
 * sized by the real layout, so walking, collision, the computer and the
 * notebook all still work — only the art is a placeholder. Nothing here is a
 * third-party asset, so it can live in the repository.
 */

import type { SpriteRef } from '../interior-layout'

/** Room shell colours, in the town's warm pixel palette. */
export const PLACEHOLDER_ROOM = {
  floor: 0x6d4b35,
  wallUpper: 0x8b7c69,
  wallLower: 0x776857,
  skirting: 0x3a2c22,
} as const

/** The furniture a piece stands for, as far as colour is concerned. */
interface PieceLook {
  role?: 'computer' | 'notebook'
  layer: 'flat' | 'decor' | 'sorted'
  sprite: SpriteRef
}

/**
 * A colour that makes each kind of piece recognisable at a glance: the
 * computer reads as a dark screen, the notebook as paper, rugs as fabric,
 * plants as green, and everything else as wood.
 */
export function placeholderPieceColour(piece: PieceLook): number {
  if (piece.role === 'computer') return 0x33415c
  if (piece.role === 'notebook') return 0xd9c9a1

  const name = piece.sprite.name

  if (name.includes('rug')) return 0x8a4b4b
  if (name.includes('plant')) return 0x3f6b45
  if (name.includes('door')) return 0x5d3f2b
  if (name.includes('bed')) return 0x5a6b8a
  if (name.includes('bookshelf')) return 0x6a4a33
  if (name.includes('window')) return 0x7d8fa8
  if (piece.layer === 'decor') return 0x7b6a56
  if (piece.layer === 'flat') return 0x8a4b4b

  return 0x87664a
}

/** How dark the outline of a placeholder piece is. */
export const PLACEHOLDER_OUTLINE = { colour: 0x2a1f17, alpha: 0.6, width: 1 } as const
