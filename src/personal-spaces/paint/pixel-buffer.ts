import type { Rgba } from './color'

/**
 * An image as straight (not premultiplied) RGBA bytes, row by row. Every
 * WebTown Paint tool draws into one of these; the `<canvas>` only shows it.
 * Pure data: no DOM.
 */
export interface PixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray<ArrayBuffer>
}

/** The largest canvas WebTown Paint makes (Image > Attributes). */
export const MAX_WIDTH = 1280
export const MAX_HEIGHT = 1024

export function createBuffer(width: number, height: number, fill: Rgba): PixelBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new RangeError(`A canvas must be 1 to ${MAX_WIDTH} by 1 to ${MAX_HEIGHT} pixels.`)
  }
  const buffer: PixelBuffer = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  if (fill.a !== 0 || fill.r !== 0 || fill.g !== 0 || fill.b !== 0) fillAll(buffer, fill)
  return buffer
}

export const cloneBuffer = (b: PixelBuffer): PixelBuffer => ({ width: b.width, height: b.height, data: b.data.slice() })

/** Copies `from` into `into` (same size). */
export function copyInto(into: PixelBuffer, from: PixelBuffer): void {
  into.data.set(from.data)
}

export const inside = (b: PixelBuffer, x: number, y: number): boolean => x >= 0 && y >= 0 && x < b.width && y < b.height

/** The colour at a pixel, or null outside the image. */
export function getPixel(b: PixelBuffer, x: number, y: number): Rgba | null {
  if (!inside(b, x, y)) return null
  const i = (y * b.width + x) * 4
  return { r: b.data[i]!, g: b.data[i + 1]!, b: b.data[i + 2]!, a: b.data[i + 3]! }
}

/** Sets one pixel. The single write path: anything outside the image is ignored. */
export function setPixel(b: PixelBuffer, x: number, y: number, c: Rgba): void {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return
  const i = (y * b.width + x) * 4
  b.data[i] = c.r
  b.data[i + 1] = c.g
  b.data[i + 2] = c.b
  b.data[i + 3] = c.a
}

/** Fills a horizontal run, clipped. */
export function fillSpan(b: PixelBuffer, x0: number, x1: number, y: number, c: Rgba): void {
  if (y < 0 || y >= b.height) return
  const from = Math.max(0, Math.min(x0, x1))
  const to = Math.min(b.width - 1, Math.max(x0, x1))
  for (let x = from; x <= to; x++) setPixel(b, x, y, c)
}

export function fillAll(b: PixelBuffer, c: Rgba): void {
  const d = b.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = c.r
    d[i + 1] = c.g
    d[i + 2] = c.b
    d[i + 3] = c.a
  }
}

/** A new buffer of the new size: the old image at the top left, new area in `fill`, anything beyond cropped. */
export function resizeBuffer(b: PixelBuffer, width: number, height: number, fill: Rgba): PixelBuffer {
  const out = createBuffer(width, height, fill)
  const w = Math.min(width, b.width)
  const h = Math.min(height, b.height)
  for (let y = 0; y < h; y++) {
    out.data.set(b.data.subarray(y * b.width * 4, (y * b.width + w) * 4), y * width * 4)
  }
  return out
}

export const sameImage = (a: PixelBuffer, b: PixelBuffer): boolean =>
  a.width === b.width && a.height === b.height && a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i])
