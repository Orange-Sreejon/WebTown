/**
 * A slow day-night cycle: morning → afternoon → evening → night → dawn, once
 * every 15 minutes, so a player sees the town change light without ever being
 * rushed by it. The cycle loops forever: `skyAt` wraps any point in time back
 * onto the curve, so it never stops and simply starts morning again.
 *
 * Kept as pure data + maths so the lighting curve can be tested without a
 * renderer: `skyAt(t)` takes the position in the cycle (0–1) and returns the
 * multiply tint for the world, how dark it is, and how lit the street lamps are.
 */

/** One full cycle, day back to day: 15 minutes. */
export const DAY_CYCLE_MS = 15 * 60 * 1000

export interface SkyFrame {
  /** Multiply colour laid over the world. White leaves daylight untouched. */
  tint: number
  /** 0 in full daylight, 1 in the dead of night. How dark the world is. */
  night: number
  /** 0 with the lamps off, 1 with them at full: only evening and night. */
  lamp: number
}

interface SkyKeyframe {
  /** Position in the cycle, 0–1. */
  at: number
  tint: number
  night: number
  lamp: number
}

/**
 * The lighting curve. Daylight holds for the first stretch so the town looks
 * like itself when you arrive; the light then warms through evening, settles
 * into a *light* blue night — dark enough to read as night, bright enough to
 * walk around in — and lifts again through dawn.
 *
 * `lamp` runs on its own curve: the street lamps are off all morning and
 * afternoon, come up as the evening light warms, reach full at nightfall and
 * go out again in the dawn.
 */
const KEYFRAMES: readonly SkyKeyframe[] = [
  { at: 0.0, tint: 0xffffff, night: 0, lamp: 0 }, // morning
  { at: 0.42, tint: 0xfff3e0, night: 0, lamp: 0 }, // afternoon, a touch warmer
  { at: 0.52, tint: 0xffcd93, night: 0.1, lamp: 0.35 }, // evening sets in
  { at: 0.6, tint: 0xd79a7d, night: 0.45, lamp: 0.7 }, // sunset
  { at: 0.68, tint: 0x8a84b0, night: 0.85, lamp: 0.9 }, // dusk
  { at: 0.78, tint: 0x8f9bc8, night: 1, lamp: 1 }, // night
  { at: 0.92, tint: 0x9aa6d0, night: 1, lamp: 1 }, // deep of night
  { at: 0.97, tint: 0xb8b4c8, night: 0.5, lamp: 0.35 }, // first light
  { at: 1.0, tint: 0xffffff, night: 0, lamp: 0 }, // back around to morning
]

/** The tint, darkness and lamp level at a point in the cycle. */
export function skyAt(t: number): SkyFrame {
  const wrapped = ((t % 1) + 1) % 1

  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const from = KEYFRAMES[i]!
    const to = KEYFRAMES[i + 1]!

    if (wrapped < from.at || wrapped > to.at) continue

    const span = to.at - from.at
    const k = span === 0 ? 0 : (wrapped - from.at) / span

    return {
      tint: mixColour(from.tint, to.tint, k),
      night: from.night + (to.night - from.night) * k,
      lamp: from.lamp + (to.lamp - from.lamp) * k,
    }
  }

  const last = KEYFRAMES[KEYFRAMES.length - 1]!
  return { tint: last.tint, night: last.night, lamp: last.lamp }
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
