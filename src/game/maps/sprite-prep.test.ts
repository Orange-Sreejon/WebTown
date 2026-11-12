import { describe, expect, it } from 'vitest'
import { boxDownscale, clearBackground, scaledHeight } from './sprite-prep'

/** Builds an RGBA buffer from a per-pixel colour function. */
function image(
  width: number,
  height: number,
  colourAt: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(colourAt(x, y), (y * width + x) * 4)
    }
  }
  return data
}

const alphaAt = (data: Uint8ClampedArray, width: number, x: number, y: number): number =>
  data[(y * width + x) * 4 + 3]

describe('clearBackground', () => {
  it('clears the border-connected ground but keeps a dark pixel enclosed by the sprite', () => {
    // 5×5: dark ground everywhere, a bright ring at distance 1, a dark core.
    const data = image(5, 5, (x, y) => {
      const ring = Math.max(Math.abs(x - 2), Math.abs(y - 2))
      if (ring === 1) return [200, 150, 90, 255]
      return [1, 0, 0, 255]
    })

    const cleared = clearBackground(data, 5, 5, 12)

    expect(cleared).toBe(16) // 25 pixels − 8 ring − 1 core
    expect(alphaAt(data, 5, 0, 0)).toBe(0)
    expect(alphaAt(data, 5, 4, 4)).toBe(0)
    expect(alphaAt(data, 5, 1, 1)).toBe(255)
    expect(alphaAt(data, 5, 2, 2)).toBe(255) // enclosed core survives
  })

  it('does nothing for an image that is already transparent at the corner', () => {
    const data = image(3, 3, () => [0, 0, 0, 0])
    expect(clearBackground(data, 3, 3, 12)).toBe(0)
  })

  it('leaves colours outside the tolerance alone', () => {
    const data = image(2, 2, (x) => (x === 0 ? [1, 0, 0, 255] : [90, 90, 90, 255]))
    clearBackground(data, 2, 2, 12)
    expect(alphaAt(data, 2, 0, 0)).toBe(0)
    expect(alphaAt(data, 2, 1, 0)).toBe(255)
  })
})

describe('boxDownscale', () => {
  it('averages colour over each block', () => {
    const data = image(4, 2, (x) => (x < 2 ? [100, 0, 0, 255] : [200, 0, 0, 255]))
    const out = boxDownscale(data, 4, 2, 2, 1)
    expect(Array.from(out.slice(0, 4))).toEqual([100, 0, 0, 255])
    expect(Array.from(out.slice(4, 8))).toEqual([200, 0, 0, 255])
  })

  it('does not darken edge colour with transparent neighbours', () => {
    // Left half opaque orange, right half transparent: the opaque pixel keeps its colour.
    const data = image(4, 1, (x) => (x < 2 ? [240, 120, 40, 255] : [0, 0, 0, 0]))
    const out = boxDownscale(data, 4, 1, 1, 1, 0.4)
    expect(Array.from(out)).toEqual([240, 120, 40, 255])
  })

  it('drops pixels that are mostly transparent', () => {
    const data = image(4, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const out = boxDownscale(data, 4, 1, 1, 1, 0.45)
    expect(out[3]).toBe(0)
  })

  it('returns an empty buffer for a zero-sized target', () => {
    expect(boxDownscale(new Uint8ClampedArray(4), 1, 1, 0, 0).length).toBe(0)
  })
})

describe('scaledHeight', () => {
  it('keeps the aspect ratio', () => {
    expect(scaledHeight(260, 275, 48)).toBe(51)
  })

  it('never returns less than one pixel', () => {
    expect(scaledHeight(1000, 1, 10)).toBe(1)
  })
})
