/**
 * Placement rules for the Halloween decorations.
 *
 * Pure layout logic, no Phaser: the same checks run in the game and in the
 * tests, so a pumpkin can never end up inside a house, on the road, in the
 * pond or on the player's spawn tile.
 */

import {
  MAP_TILES_H,
  MAP_TILES_W,
  PLAYER_START_TILE_X,
  PLAYER_START_TILE_Y,
} from '../config/GameConfig'
import { PUMPKIN_PLACEMENTS, type PumpkinSpot } from '../config/halloween'
import { TILE_GRASS, kindAt } from './terrain'
import {
  FENCES,
  STRUCTURES,
  TERRAIN,
  TREES,
  VILLAGE_PROPS,
  isInGarden,
  isInPasture,
  propCoversTile,
} from './town-layout'

/** Keep decorations off the outermost ring of the map. */
const EDGE_MARGIN = 2

function isFenceTile(tx: number, ty: number): boolean {
  for (const fence of FENCES) {
    if (fence.lenH > 0) {
      if (ty === fence.y && tx >= fence.x && tx < fence.x + fence.lenH) return true
    } else if (tx === fence.x && ty >= fence.y && ty < fence.y + fence.lenV) {
      return true
    }
  }
  return false
}

function isStructureTile(tx: number, ty: number): boolean {
  return STRUCTURES.some(
    structure =>
      tx >= structure.tileX &&
      ty >= structure.tileY &&
      tx < structure.tileX + structure.wTiles &&
      ty < structure.tileY + structure.hTiles,
  )
}

/**
 * Trees are drawn across several tiles, so a spot is also rejected when it is
 * within the one-tile margin around a tree's footprint — a pumpkin under a
 * canopy would be invisible.
 */
function isTreeTile(tx: number, ty: number): boolean {
  return TREES.some(
    tree =>
      tx >= tree.tileX - 1 &&
      tx < tree.tileX + tree.wTiles + 1 &&
      ty >= tree.tileY - 1 &&
      ty < tree.tileY + tree.hTiles + 1,
  )
}

function isPropTile(tx: number, ty: number): boolean {
  return VILLAGE_PROPS.some(prop => propCoversTile(prop, tx, ty))
}

/** True when a pumpkin may stand on this tile. */
export function isFreePumpkinTile(tx: number, ty: number): boolean {
  if (tx < EDGE_MARGIN || ty < EDGE_MARGIN) return false
  if (tx > MAP_TILES_W - 1 - EDGE_MARGIN || ty > MAP_TILES_H - 1 - EDGE_MARGIN) return false
  if (kindAt(TERRAIN, tx, ty) !== TILE_GRASS) return false
  if (isFenceTile(tx, ty)) return false
  if (isStructureTile(tx, ty)) return false
  if (isTreeTile(tx, ty)) return false
  if (isPropTile(tx, ty)) return false
  if (isInPasture(tx, ty) || isInGarden(tx, ty)) return false

  // Never on (or directly beside) the tile the player appears on.
  if (Math.abs(tx - PLAYER_START_TILE_X) <= 1 && Math.abs(ty - PLAYER_START_TILE_Y) <= 1) {
    return false
  }

  return true
}

/**
 * Every problem with a set of spots, as human-readable strings. Empty means
 * every pumpkin has somewhere safe to stand.
 */
export function validatePumpkinPlacements(
  spots: readonly PumpkinSpot[] = PUMPKIN_PLACEMENTS,
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const spot of spots) {
    const key = `${spot.tileX},${spot.tileY}`

    if (seen.has(key)) problems.push(`two pumpkins share tile ${key}`)
    seen.add(key)

    if (kindAt(TERRAIN, spot.tileX, spot.tileY) !== TILE_GRASS) {
      problems.push(`pumpkin at ${key} is not on grass`)
    }
    if (!isFreePumpkinTile(spot.tileX, spot.tileY)) {
      problems.push(`pumpkin at ${key} is blocked by the layout`)
    }
  }

  return problems
}
