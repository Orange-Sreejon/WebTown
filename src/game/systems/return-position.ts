import type { Point, Rect } from '../../lib/geometry'
import { rectContains, rectsOverlap } from '../../lib/geometry'
import {
  PLAYER_BODY_H,
  PLAYER_BODY_W,
  PLAYER_SPRITE_SCALE,
} from '../config/GameConfig'
import type { Direction } from './movement'

/** Everything needed to put the player back exactly where they left the town. */
export interface TownReturnState {
  houseId: string
  /** Player feet: x = body centre, y = body bottom. */
  feetX: number
  feetY: number
  facing: Direction
  cameraScrollX: number
  cameraScrollY: number
  cameraZoom: number
}

export interface ReturnResolution {
  feetX: number
  feetY: number
  /** True when the saved spot was unsafe and the fallback was used instead. */
  usedFallback: boolean
}

/**
 * Physics separation can leave a body a fraction of a pixel inside a neighbour.
 * Anything under this counts as touching, not colliding.
 */
export const RETURN_OVERLAP_TOLERANCE = 0.5

/**
 * The player's physics body for a given feet position. The body is
 * bottom-aligned and horizontally centred on the sprite, so it is fully
 * described by where the feet are.
 */
export function playerBodyRect(feetX: number, feetY: number): Rect {
  const w = PLAYER_BODY_W * PLAYER_SPRITE_SCALE
  const h = PLAYER_BODY_H * PLAYER_SPRITE_SCALE
  return { x: feetX - w / 2, y: feetY - h, w, h }
}

/** True when a player standing at these feet would be inside the bounds and clear of obstacles. */
export function isFeetSafe(
  feet: Point,
  obstacles: readonly Rect[],
  bounds: Rect,
): boolean {
  const body = playerBodyRect(feet.x, feet.y)
  if (!rectContains(bounds, body)) return false
  return !obstacles.some(obstacle => rectsOverlap(body, obstacle, RETURN_OVERLAP_TOLERANCE))
}

/**
 * Decides where the player reappears. The saved spot is used whenever it is
 * safe — which it always should be, since the player was standing there — and
 * the door-front fallback only when something now occupies it.
 */
export function resolveReturnFeet(
  saved: TownReturnState,
  obstacles: readonly Rect[],
  bounds: Rect,
  fallback: Point,
): ReturnResolution {
  const savedFeet = { x: saved.feetX, y: saved.feetY }
  if (isFeetSafe(savedFeet, obstacles, bounds)) {
    return { feetX: savedFeet.x, feetY: savedFeet.y, usedFallback: false }
  }
  return { feetX: fallback.x, feetY: fallback.y, usedFallback: true }
}
