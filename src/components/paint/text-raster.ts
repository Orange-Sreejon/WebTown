import type { Mask } from '../../personal-spaces/paint/raster'

export const TEXT_FONT = 'Arial, Helvetica, sans-serif'
export const lineHeightFor = (size: number): number => Math.round(size * 1.2)

/** Turns typed text into a one-bit mask, or null when there is nothing to draw. */
export type TextRasterizer = (text: string, size: number) => Mask | null

/**
 * The browser's text drawing, made aliased: pixels at least half covered become
 * solid, the rest stay untouched, so text matches the rest of the picture and
 * Fill works around it.
 */
export const browserTextRasterizer: TextRasterizer = (text, size) => {
  const lines = text.replace(/\r/g, '').split('\n')
  if (lines.every(line => line.trim() === '')) return null
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null
  probe.font = `${size}px ${TEXT_FONT}`
  const lh = lineHeightFor(size)
  const width = Math.max(1, Math.ceil(Math.max(...lines.map(l => probe.measureText(l).width))) + 2)
  const height = Math.max(1, lines.length * lh + 2)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.font = `${size}px ${TEXT_FONT}`
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#000'
  lines.forEach((line, i) => ctx.fillText(line, 0, i * lh + Math.round((lh - size) / 2)))
  const alpha = ctx.getImageData(0, 0, width, height).data
  const bits = new Uint8Array(width * height)
  for (let i = 0; i < bits.length; i++) bits[i] = alpha[i * 4 + 3]! >= 128 ? 1 : 0
  return { width, height, bits }
}
