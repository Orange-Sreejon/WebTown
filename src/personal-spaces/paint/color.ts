/** A colour, straight RGBA, each 0..255. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 }
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 }
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }

/** What an empty canvas is made of: what Eraser, Clear and new canvas area put back. */
export type CanvasBase = 'white' | 'transparent'
export const baseColor = (base: CanvasBase): Rgba => (base === 'white' ? WHITE : TRANSPARENT)

export const sameColor = (a: Rgba, b: Rgba): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

/** `#rrggbb` for an opaque colour (alpha is ignored). */
export const toHex = (c: Rgba): string => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`

/** An opaque colour from `#rgb` or `#rrggbb`, or null. */
export function parseHex(text: string): Rgba | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? m[1]!.split('').map(c => c + c).join('') : m[1]!
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 255 }
}

export interface Swatch {
  name: string
  color: Rgba
}

const sw = (name: string, hex: string): Swatch => ({ name, color: parseHex(hex)! })

/** The classic 28-colour box, as two rows of 14: dark shades above, light below. */
export const PALETTE: readonly Swatch[] = [
  sw('Black', '#000000'), sw('Grey', '#808080'), sw('Maroon', '#800000'), sw('Olive', '#808000'),
  sw('Green', '#008000'), sw('Teal', '#008080'), sw('Navy', '#000080'), sw('Purple', '#800080'),
  sw('Dark khaki', '#808040'), sw('Dark slate', '#004040'), sw('Azure', '#0080ff'), sw('Dark blue', '#004080'),
  sw('Violet', '#4000ff'), sw('Brown', '#804000'),
  sw('White', '#ffffff'), sw('Silver', '#c0c0c0'), sw('Red', '#ff0000'), sw('Yellow', '#ffff00'),
  sw('Lime', '#00ff00'), sw('Cyan', '#00ffff'), sw('Blue', '#0000ff'), sw('Magenta', '#ff00ff'),
  sw('Pale yellow', '#ffff80'), sw('Spring green', '#00ff80'), sw('Light cyan', '#80ffff'), sw('Light blue', '#8080ff'),
  sw('Pink', '#ff0080'), sw('Orange', '#ff8040'),
]

/** How a colour is described to a screen reader and in tooltips. */
export const describeColor = (c: Rgba, name?: string): string =>
  c.a === 0 ? 'Transparent' : `${name ? `${name}, ` : ''}${toHex(c).toUpperCase()}`
