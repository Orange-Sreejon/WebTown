/**
 * How players look (Phase 5, design 7a): the traveller sprite in six colours. Variant 0 is the original art;
 * the others shift the hue of the hat and shirt (the saturated yellow pixels) so skin, hair and the backpack
 * stay as drawn. Every variant has the same frames and animations. Pure: the recolouring works on plain RGBA.
 */

import { AssetKeys } from '../config/AssetKeys'

export const AVATARS = ['traveller', 'traveller-1', 'traveller-2', 'traveller-3', 'traveller-4', 'traveller-5'] as const
export type AvatarId = (typeof AVATARS)[number]

/** Hue shift in degrees per variant (index = variant number). */
const HUE_SHIFT = [0, 190, 100, 285, -40, 225] as const

export const AVATAR_LABELS: Record<AvatarId, string> = {
  'traveller': 'Sunflower',
  'traveller-1': 'Sky',
  'traveller-2': 'Leaf',
  'traveller-3': 'Plum',
  'traveller-4': 'Berry',
  'traveller-5': 'Ocean',
}

export const isAvatar = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATARS as readonly string[]).includes(v)

/**
 * The look to draw for a player: their chosen one, or (for the Phase 4 default `villager` and anything unknown)
 * one picked from their user id, so players who never chose still look different from each other.
 */
export function avatarFor(chosen: string | null | undefined, userId: string): AvatarId {
  if (isAvatar(chosen)) return chosen
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length]!
}

/** The texture of a look: the loaded sheet for the original, a generated canvas (BootScene) for the others. */
export const avatarTexture = (look: AvatarId): string => (look === 'traveller' ? AssetKeys.TRAVELLER : look)

/** The animation key for a look: the original keeps the Phase 1 names (`walk-down`). */
export function animKey(kind: 'walk' | 'idle', dir: string, look: AvatarId): string {
  return look === 'traveller' ? `${kind}-${dir}` : `${kind}-${dir}@${look}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(v => Math.round(v * 255)) as [number, number, number]
}

/** True for the pixels that are recoloured: the hat and shirt yellows. */
export function isClothing(r: number, g: number, b: number, a: number): boolean {
  if (a === 0) return false
  const [h, s, l] = rgbToHsl(r, g, b)
  return h >= 36 && h <= 66 && s >= 0.35 && l >= 0.2 && l <= 0.9
}

/** Recolours `data` (straight RGBA) in place for `look`. The original look is left untouched. */
export function recolour(data: Uint8ClampedArray, look: AvatarId): void {
  const shift = HUE_SHIFT[AVATARS.indexOf(look)] ?? 0
  if (shift === 0) return
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    if (!isClothing(r, g, b, data[i + 3]!)) continue
    const [h, s, l] = rgbToHsl(r, g, b)
    const [nr, ng, nb] = hslToRgb(h + shift, s, l)
    data[i] = nr
    data[i + 1] = ng
    data[i + 2] = nb
  }
}
