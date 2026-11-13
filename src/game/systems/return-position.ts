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
  /**
   * Camera zoom at the moment of leaving. Scroll is deliberately not saved: the
   * town camera follows the player with lerp 1, so its scroll is a pure
   * function of the player's position and re-derives itself on the next frame.
   */
  cameraZoom: number
}

export interface ReturnResolution {
  feetX: number
  feetY: number
  /** True when the saved spot was unsafe and the fallback was used instead. */
  usedFallback: boolean
}

/** Where, and facing which way, the player reappears. */
export interface ReturnPlan extends ReturnResolution {
  facing: Direction
  cameraZoom: number
}

/** Snapshot taken the moment the player uses a door. */
export function captureReturnState(
  houseId: string,
  feet: Point,
  facing: Direction,
  cameraZoom: number,
): TownReturnState {
  return { houseId, feetX: feet.x, feetY: feet.y, facing, cameraZoom }
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

/**
 * The full return decision: position, facing and zoom. The saved facing is
 * restored with the saved spot; the door-front fallback faces the player down,
 * away from the door, since they did not arrive by walking there.
 */
export function planReturn(
  saved: TownReturnState,
  obstacles: readonly Rect[],
  bounds: Rect,
  fallback: Point,
): ReturnPlan {
  const resolved = resolveReturnFeet(saved, obstacles, bounds, fallback)
  return {
    ...resolved,
    facing: resolved.usedFallback ? 'down' : saved.facing,
    cameraZoom: saved.cameraZoom,
  }
}
