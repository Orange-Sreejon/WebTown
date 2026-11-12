import type { Point, Rect } from '../../lib/geometry'
import { pointInRect } from '../../lib/geometry'
import {
  ENTRANCE_DEPTH,
  ENTRANCE_FALLBACK_OFFSET,
  ENTRANCE_HALF_WIDTH,
  ENTRANCE_PROMPT_RISE,
  ENTRANCE_RISE,
  TILE_SIZE,
} from '../config/GameConfig'
import type { HouseConfig } from '../config/houses'

/**
 * Anything the player can stand in front of and press E on: a house door
 * outdoors, the exit door indoors. Pure data — no Phaser.
 */
export interface InteractionTarget {
  id: string
  /** Region, in world pixels, that the player's feet must be inside. */
  zone: Rect
  /** Where the prompt is drawn (bottom-centre anchored). */
  promptX: number
  promptY: number
}

export interface Entrance extends InteractionTarget {
  interiorId: string
  /** A known-walkable spot in front of the door, used if the saved one is unsafe. */
  fallbackFeet: Point
}

/** The few `StructurePlacement` fields an entrance is derived from. */
export interface DoorSource {
  label: string
  tileX: number
  tileY: number
  hTiles: number
  doorOffsetPx: number
}

/**
 * Derives one entrance per house from the town layout, so a door can never
 * drift away from the art or the fence gate in front of it.
 *
 * @throws if a house names a structure that does not exist (a config bug).
 */
export function buildEntrances(
  houses: readonly HouseConfig[],
  structures: readonly DoorSource[],
): Entrance[] {
  return houses.map(house => {
    const structure = structures.find(s => s.label === house.structureLabel)
    if (!structure) {
      throw new Error(`House "${house.id}" references unknown structure "${house.structureLabel}"`)
    }

    // Centre on the door's tile column, exactly as the driveway and the yard
    // gate do. `doorOffsetPx` can sit on a tile boundary (the Cute Fantasy
    // house has 48), which would put the zone half a tile off the gate.
    const doorColumn = structure.tileX + Math.floor(structure.doorOffsetPx / TILE_SIZE)
    const doorX = doorColumn * TILE_SIZE + TILE_SIZE / 2
    const bottom = (structure.tileY + structure.hTiles) * TILE_SIZE

    return {
      id: house.id,
      interiorId: house.interiorId,
      zone: {
        x: doorX - ENTRANCE_HALF_WIDTH,
        y: bottom - ENTRANCE_RISE,
        w: ENTRANCE_HALF_WIDTH * 2,
        h: ENTRANCE_DEPTH + ENTRANCE_RISE,
      },
      promptX: doorX,
      promptY: bottom - ENTRANCE_PROMPT_RISE,
      fallbackFeet: { x: doorX, y: bottom + ENTRANCE_FALLBACK_OFFSET },
    }
  })
}

/**
 * The target whose zone contains the player's feet. If zones ever overlap the
 * one whose centre is nearest wins; null when the player is not in any zone.
 */
export function findNearbyTarget<T extends InteractionTarget>(
  feet: Point,
  targets: readonly T[],
): T | null {
  let best: T | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const target of targets) {
    if (!pointInRect(feet, target.zone)) continue

    const dx = feet.x - (target.zone.x + target.zone.w / 2)
    const dy = feet.y - (target.zone.y + target.zone.h / 2)
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      best = target
      bestDistance = distance
    }
  }

  return best
}
