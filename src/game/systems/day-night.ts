/**
 * The day-night lighting curve, now anchored to the in-game clock.
 *
 * `skyAtHour(hour)` is the primary function: it takes an in-game hour (0–24)
 * and returns the multiply tint for the world, how dark it is, how lit the
 * street lamps are, and how visible the Halloween decorations should be. It
 * stays a pure function of time, so the whole 24-hour curve is testable
 * without a renderer.
 *
 * `skyAt(t)` is the original cycle-position API (0–1). It is kept for
 * backwards compatibility — the existing tests and any caller that thinks in
 * cycle positions still work — and is now a thin wrapper that maps a cycle
 * position onto the equivalent clock hour. Its visual curve is unchanged.
 *
 * There is still exactly one multiply overlay and one lamp curve; the
 * Halloween factor rides along rather than adding a second lighting pass.
 */

import {
  CYCLE_DURATION_MS,
  HALLOWEEN_FADE,
  SKY_KEYFRAMES,
} from '../config/halloween'

/** One full cycle, day back to day: 15 minutes. */
export const DAY_CYCLE_MS = CYCLE_DURATION_MS

/** The hour the legacy cycle position 0 corresponds to. */
const LEGACY_CYCLE_START_HOUR = 6

export interface SkyFrame {
  /** Multiply colour laid over the world. White leaves daylight untouched. */
  tint: number
  /** 0 in full daylight, 1 in the dead of night. How dark the world is. */
  night: number
  /** 0 with the lamps off, 1 with them at full: only evening and night. */
  lamp: number
  /** 0 with the Halloween decorations hidden, 1 with them fully visible. */
  halloween: number
}

/**
 * How visible the Halloween decorations are at an in-game hour.
 *
 * Zero all day and all evening, ramps up across 20:00–20:30, stays at one
 * through the night, and fades out again across 05:30–06:00. Nothing pops:
 * the ramps are smoothstepped, so the derivative is continuous too.
 */
export function halloweenAt(hour: number): number {
  const h = wrapHour(hour)
  const { inStartHour, inEndHour, outStartHour, outEndHour } = HALLOWEEN_FADE

  if (h >= inStartHour && h < inEndHour) {
    return smoothstep((h - inStartHour) / (inEndHour - inStartHour))
  }

  if (h >= outStartHour && h < outEndHour) {
    return 1 - smoothstep((h - outStartHour) / (outEndHour - outStartHour))
  }

  // The stretch between the fade-out and the fade-in is the dead of night.
  if (h >= outEndHour && h < inStartHour) return 0
  return 1
}

/** The tint, darkness, lamp level and Halloween factor at an in-game hour. */
export function skyAtHour(hour: number): SkyFrame {
  const h = wrapHour(hour)

  let from = SKY_KEYFRAMES[0]!
  let to = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1]!

  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const a = SKY_KEYFRAMES[i]!
    const b = SKY_KEYFRAMES[i + 1]!

    if (h >= a.hour && h <= b.hour) {
      from = a
      to = b
      break
    }
  }

  const span = to.hour - from.hour
  const k = span === 0 ? 0 : (h - from.hour) / span

  return {
    tint: mixColour(from.tint, to.tint, k),
    night: from.night + (to.night - from.night) * k,
    lamp: from.lamp + (to.lamp - from.lamp) * k,
    halloween: halloweenAt(h),
  }
}

/**
 * The tint, darkness, lamp level and Halloween factor at a point in the
 * original 0–1 cycle. Kept for backwards compatibility; the town itself now
 * drives the curve from the clock with `skyAtHour`.
 */
export function skyAt(t: number): SkyFrame {
  const wrapped = ((t % 1) + 1) % 1
  return skyAtHour(wrapped * 24 + LEGACY_CYCLE_START_HOUR)
}

function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24
}

function smoothstep(k: number): number {
  return k * k * (3 - 2 * k)
}

function mixColour(a: number, b: number, k: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff

  const r = Math.round(ar + (br - ar) * k)
  const g = Math.round(ag + (bg - ag) * k)
  const bl = Math.round(ab + (bb - ab) * k)

  return (r << 16) | (g << 8) | bl
}
