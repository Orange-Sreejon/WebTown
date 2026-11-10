/**
 * Pure movement calculation functions — no Phaser dependency.
 * These are fully unit-testable without a game instance.
 */

export interface InputState {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

export interface Velocity {
  vx: number
  vy: number
}

export type Direction = 'up' | 'down' | 'left' | 'right'

const SQRT2 = Math.SQRT2

/**
 * Computes the velocity vector for the given input state and speed.
 *
 * - Opposite axes cancel each other out.
 * - Diagonal movement is normalised so diagonal speed equals straight speed.
 * - Returns (0, 0) when no keys are pressed or speed is non-positive.
 */
export function computeVelocity(input: InputState, speed: number): Velocity {
  if (speed <= 0) return { vx: 0, vy: 0 }

  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0)

  if (dx === 0 && dy === 0) return { vx: 0, vy: 0 }

  // Diagonal: normalise by √2 to keep constant speed in all directions
  const isDiagonal = dx !== 0 && dy !== 0
  const factor = isDiagonal ? speed / SQRT2 : speed

  return {
    vx: dx * factor,
    vy: dy * factor,
  }
}

/**
 * Returns the primary facing direction for the given input.
 *
 * Priority when diagonal: down > up > right > left (RPG convention).
 * Falls back to `fallback` when no keys are pressed.
 */
export function inputToDirection(input: InputState, fallback: Direction): Direction {
  if (input.down) return 'down'
  if (input.up) return 'up'
  if (input.right) return 'right'
  if (input.left) return 'left'
  return fallback
}
