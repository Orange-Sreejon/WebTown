/**
 * Pure pixel helpers for preparing artwork that is not already on the town's
 * 16px grid. No Phaser or DOM dependency, so they can be unit tested.
 *
 * The large computer sheet is drawn on an opaque near-black ground and at a
 * much higher resolution than the rest of the art. To sit beside 16px
 * furniture it has to be keyed to transparency and averaged down; plain
 * nearest-neighbour scaling would sample every Nth pixel and turn the
 * dithered shading into noise.
 */

/**
 * Makes the sheet's background transparent. Only pixels that are connected to
 * the image border and close to the corner colour are cleared, so a dark pixel
 * enclosed by a sprite's outline is left alone.
 *
 * @param data RGBA bytes, modified in place.
 * @param tolerance Allowed |dr|+|dg|+|db| distance from the corner colour.
 * @returns Number of pixels cleared.
 */
export function clearBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance: number,
): number {
  if (width <= 0 || height <= 0) return 0

  const bgR = data[0]
  const bgG = data[1]
  const bgB = data[2]

  const matches = (pixel: number): boolean => {
    const i = pixel * 4
    return (
      data[i + 3] > 0 &&
      Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB) <=
        tolerance
    )
  }

  const queued = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const enqueue = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const pixel = y * width + x
    if (queued[pixel] === 1 || !matches(pixel)) return
    queued[pixel] = 1
    queue[tail++] = pixel
  }

  for (let x = 0; x < width; x++) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }

  while (head < tail) {
    const pixel = queue[head++]
    const x = pixel % width
    const y = (pixel - x) / width
    data[pixel * 4 + 3] = 0
    enqueue(x + 1, y)
    enqueue(x - 1, y)
    enqueue(x, y + 1)
    enqueue(x, y - 1)
  }

  return tail
}

/**
 * Area-averages an RGBA image down to `targetWidth × targetHeight`.
 *
 * Colour is weighted by alpha so transparent pixels do not darken the edge of
 * a sprite. Output alpha is binary: a pixel is drawn when at least
 * `alphaCutoff` of its source area was opaque, which keeps the silhouette
 * hard-edged like the rest of the pixel art.
 */
export function boxDownscale(
  src: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  alphaCutoff = 0.45,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  if (targetWidth <= 0 || targetHeight <= 0) return out

  const stepX = sourceWidth / targetWidth
  const stepY = sourceHeight / targetHeight

  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = ty * stepY
    const y1 = y0 + stepY
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = tx * stepX
      const x1 = x0 + stepX

      let area = 0
      let alphaSum = 0
      let r = 0
      let g = 0
      let b = 0

      for (let y = Math.floor(y0); y < Math.ceil(y1) && y < sourceHeight; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.ceil(x1) && x < sourceWidth; x++) {
          const weight = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy
          const i = (y * sourceWidth + x) * 4
          const alpha = (src[i + 3] / 255) * weight
          area += weight
          alphaSum += alpha
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
        }
      }

      if (alphaSum <= 0 || alphaSum / area < alphaCutoff) continue

      const o = (ty * targetWidth + tx) * 4
      out[o] = Math.round(r / alphaSum)
      out[o + 1] = Math.round(g / alphaSum)
      out[o + 2] = Math.round(b / alphaSum)
      out[o + 3] = 255
    }
  }

  return out
}

/** Height that keeps a source rectangle's aspect ratio at a given width. */
export function scaledHeight(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
): number {
  return Math.max(1, Math.round((sourceHeight * targetWidth) / sourceWidth))
}
