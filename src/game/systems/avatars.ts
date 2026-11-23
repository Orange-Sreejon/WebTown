/**
 * How players look (Phase 5, design 7a). A look is either one of six recolours of the traveller sheet, or a
 * character with a 48 x 64 sheet of its own. Variant 0 is the original art; the others shift the hue of the hat
 * and shirt (the saturated yellow pixels) so skin, hair and the backpack stay as drawn. A character sheet is an
 * optional file: when it is absent the look is not offered, and anything drawn with it falls back to the
 * traveller, so a missing image never breaks the town. Pure: the recolouring works on plain RGBA.
 */

import { AssetKeys } from '../config/AssetKeys'

/** Every character sheet is this grid: 3 columns (left step, stand, right step) x 4 rows (down, left, right, up). */
export const AVATAR_FRAME_WIDTH = 48
export const AVATAR_FRAME_HEIGHT = 64
/** The standing frame of the down row, used for the picker's still previews. */
export const IDLE_DOWN_FRAME = 1

/** Always available: the traveller sheet, recoloured at boot. Variant 0 is the original art. */
export const RECOLOURED_LOOKS = [
  'traveller',
  'traveller-1',
  'traveller-2',
  'traveller-3',
  'traveller-4',
  'traveller-5',
] as const
export type RecolouredLook = (typeof RECOLOURED_LOOKS)[number]

/**
 * The characters with a sheet of their own, each a drop-in 48 x 64 sheet and a look in the picker. Adding an
 * entry (and its PNG under public/assets/characters/tiny-cast/) offers a new look; a missing PNG is not an
 * error, it is simply a look that is not offered yet. See docs/ASSETS.md.
 */
export const SHEET_LOOKS = [
  { id: 'red-cap', label: 'Red cap' },
  { id: 'green-hair', label: 'Green hair' },
  { id: 'green-beanie', label: 'Green beanie' },
  { id: 'pink-cap', label: 'Pink cap' },
  { id: 'brown-hair', label: 'Brown hair' },
  { id: 'violet-hair', label: 'Violet hair' },
] as const

export type SheetLook = (typeof SHEET_LOOKS)[number]
export type SheetLookId = SheetLook['id']

/** Where a character's sheet lives. */
export const sheetUrl = (id: SheetLookId): string => `/assets/characters/tiny-cast/${id}.png`

export type AvatarId = RecolouredLook | SheetLookId

/** The looks a player can choose: one per shipped character. Recolours are only drawn as a fallback. */
export const AVATARS: readonly SheetLookId[] = SHEET_LOOKS.map(sheet => sheet.id)

/** Hue shift in degrees per recolour (index = variant number). */
const HUE_SHIFT = [0, 190, 100, 285, -40, 225] as const

export const isAvatar = (v: unknown): v is SheetLookId =>
  typeof v === 'string' && SHEET_LOOKS.some(sheet => sheet.id === v)

let available: readonly SheetLook[] = []
let probe: Promise<readonly SheetLook[]> | null = null

/**
 * Which optional character sheets this build actually has. Probed once, before the game boots (and reused by
 * the account picker), so Phaser never queues a sheet that is not there.
 */
export function findAvailableSheets(): Promise<readonly SheetLook[]> {
  probe ??= typeof Image === 'undefined'
    ? Promise.resolve(available)
    : Promise.all(SHEET_LOOKS.map(sheet => new Promise<SheetLook | null>(resolve => {
        const image = new Image()
        image.onload = () => resolve(sheet)
        image.onerror = () => resolve(null)
        image.src = sheetUrl(sheet.id)
      }))).then(sheets => (available = sheets.filter((sheet): sheet is SheetLook => sheet !== null)))
  return probe
}

/** The sheets found so far; empty until `findAvailableSheets` resolves. */
export const availableSheetLooks = (): readonly SheetLook[] => available

/**
 * The look to draw for a player: their chosen character, or (for the Phase 4 default `villager`, an old colour
 * choice, and anything unknown) one picked from their user id, so players who never chose still look different
 * from each other. The pick is among the shipped characters; the traveller stands in if the list is empty.
 */
export function avatarFor(chosen: string | null | undefined, userId: string): AvatarId {
  if (isAvatar(chosen)) return chosen
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length] ?? 'traveller'
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
export function recolour(data: Uint8ClampedArray, look: RecolouredLook): void {
  const shift = HUE_SHIFT[RECOLOURED_LOOKS.indexOf(look)] ?? 0
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
