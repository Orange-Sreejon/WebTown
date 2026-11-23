import type { Facing } from './protocol'

/**
 * Smooth remote movement (design D8): positions are drawn a little in the past (a little more than the time
 * between the sender's updates), between the two received samples around that moment, so 10 updates a second
 * look like continuous walking and the drawn player never steps back. A big jump is not tweened. Pure.
 */

export interface Sample {
  /** When it was received (ms). */
  t: number
  x: number
  y: number
  f: Facing
  w: boolean
}

export interface Pose {
  x: number
  y: number
  f: Facing
  walking: boolean
}

export const RENDER_DELAY_MS = 120
/** A sender that updates rarely (a slow device) is drawn at most this far behind. */
export const MAX_RENDER_DELAY_MS = 700
/** A gap longer than this between samples, or a jump this far, is drawn as a jump, not a walk. */
export const SNAP_DISTANCE_PX = 96
/** After this long without news a walking player is shown standing. */
export const STALE_WALK_MS = 400
const MAX_SAMPLES = 24

/** Adds a sample. Returns true when it is a jump (the buffer then starts over from it). */
export function addSample(buffer: Sample[], sample: Sample): boolean {
  const last = buffer[buffer.length - 1]
  if (last && sample.t < last.t) return false
  if (last && Math.hypot(sample.x - last.x, sample.y - last.y) > SNAP_DISTANCE_PX) {
    buffer.length = 0
    buffer.push(sample)
    return true
  }
  buffer.push(sample)
  if (buffer.length > MAX_SAMPLES) buffer.splice(0, buffer.length - MAX_SAMPLES)
  return false
}

/**
 * How far in the past to draw a player whose updates arrive every `interval` ms: a little more than one interval,
 * so there is almost always a newer sample to move towards (guessing ahead would have to be taken back).
 */
export function renderDelay(interval: number): number {
  return Math.min(MAX_RENDER_DELAY_MS, Math.max(RENDER_DELAY_MS, interval * 1.5 + 20))
}

/** Where to draw the player at `now`, `delay` ms in the past. */
export function poseAt(buffer: readonly Sample[], now: number, delay = RENDER_DELAY_MS): Pose | null {
  const n = buffer.length
  if (n === 0) return null
  const t = now - delay
  const first = buffer[0]!
  if (t <= first.t) return { x: first.x, y: first.y, f: first.f, walking: first.w && n > 1 }

  for (let i = 0; i < n - 1; i++) {
    const a = buffer[i]!
    const b = buffer[i + 1]!
    if (t >= a.t && t < b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
      const moving = Math.hypot(b.x - a.x, b.y - a.y) > 0.25
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, f: b.f, walking: moving || (a.w && b.w) }
    }
  }

  // Past the newest sample: stay there. Guessing ahead would sometimes have to be taken back, which looks
  // worse than a short pause. The walk animation runs on for a moment in case the next sample is just late.
  const last = buffer[n - 1]!
  return { x: last.x, y: last.y, f: last.f, walking: last.w && t - last.t <= STALE_WALK_MS }
}

/** Keeps `value` inside [0, max]. */
export const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max)

/**
 * Moves a player's current render delay towards `target` without ever turning their clock back: while the delay
 * grows, their drawing time runs at half speed; while it shrinks, a quarter faster. `dt` is the frame time (ms).
 */
export function easeDelay(current: number, target: number, dt: number): number {
  const step = Math.min(Math.max(dt, 0), 100)
  if (target > current) return Math.min(target, current + step * 0.5)
  return Math.max(target, current - step * 0.25)
}