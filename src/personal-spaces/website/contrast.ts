/**
 * Colour parsing and WCAG 2.x contrast.
 *
 * The website lets the owner pick colours, so the domain refuses combinations
 * that are hard to read: AA needs 4.5:1 for normal text and 3:1 for large text.
 * Pure arithmetic; no DOM and no canvas.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** WCAG 2.x level AA thresholds. */
export const AA_NORMAL_TEXT = 4.5
export const AA_LARGE_TEXT = 3

export type TextSize = 'normal' | 'large'

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/** Parses `#RRGGBB`. Anything else (short forms, names, `rgb()`, alpha) is null. */
export function parseHexColour(input: unknown): Rgb | null {
  if (typeof input !== 'string' || !HEX_COLOUR.test(input)) return null
  return {
    r: parseInt(input.slice(1, 3), 16),
    g: parseInt(input.slice(3, 5), 16),
    b: parseInt(input.slice(5, 7), 16),
  }
}

/** `#rrggbb` → `#RRGGBB`; null when the input is not a six-digit hex colour. */
export function normalizeHexColour(input: unknown): string | null {
  return typeof input === 'string' && HEX_COLOUR.test(input) ? input.toUpperCase() : null
}

/** Linearises one sRGB channel (0-255). */
function channel(value: number): number {
  const s = value / 255
  // 8-bit values never fall between the 0.03928 of WCAG 2.0 and the 0.04045 of
  // the sRGB standard, so the two definitions give identical results here.
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(colour: Rgb): number {
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b)
}

/** The WCAG contrast ratio of two `#RRGGBB` colours (1 to 21); null if either is invalid. */
export function contrastRatio(a: string, b: string): number | null {
  const first = parseHexColour(a)
  const second = parseHexColour(b)
  if (!first || !second) return null
  const la = relativeLuminance(first)
  const lb = relativeLuminance(second)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The minimum ratio AA asks for. "Large" is 18pt, or 14pt bold, and up. */
export function requiredContrast(size: TextSize): number {
  return size === 'large' ? AA_LARGE_TEXT : AA_NORMAL_TEXT
}

/** True when the pair reaches AA for that text size. Invalid colours never pass. */
export function meetsAA(foreground: string, background: string, size: TextSize): boolean {
  const ratio = contrastRatio(foreground, background)
  return ratio !== null && ratio >= requiredContrast(size)
}

/**
 * Shows a ratio to two decimals, rounded **down**, so a pair that scrapes
 * past 4.5 is never displayed as "4.50:1" while failing, or the reverse.
 */
export function formatContrastRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`
}
