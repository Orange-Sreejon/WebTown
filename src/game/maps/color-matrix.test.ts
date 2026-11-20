import { describe, it, expect } from 'vitest'
import { applyColorMatrix } from './color-matrix'

const IDENTITY = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
]

function image(pixels: number[]): { data: Uint8ClampedArray; width: number; height: number } {
  return { data: new Uint8ClampedArray(pixels), width: 1, height: 1 }
}

describe('applyColorMatrix', () => {
  it('leaves pixels exactly as they are under the identity matrix', () => {
    const px = image([12, 200, 255, 255])
    applyColorMatrix(px, IDENTITY)

    expect([...px.data]).toEqual([12, 200, 255, 255])
  })

  it('scales colour like Phaser brightness', () => {
    const px = image([200, 100, 50, 255])
    const half = [0.5, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 1, 0]
    applyColorMatrix(px, half)

    expect([...px.data]).toEqual([100, 50, 25, 255])
  })

  it('clamps values outside 0–255 instead of wrapping', () => {
    const px = image([100, 100, 100, 255])
    const bright = [4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1, 0]
    applyColorMatrix(px, bright)

    expect([...px.data]).toEqual([255, 255, 255, 255])
  })

  it('applies the matrix offset column', () => {
    const px = image([0, 0, 0, 255])
    // result.r = 0 * r + 0.25
    const offset = [0, 0, 0, 0, 0.25, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
    applyColorMatrix(px, offset)

    expect(px.data[0]).toBe(Math.round(0.25 * 255))
  })

  it('leaves transparent pixels transparent', () => {
    const px = image([255, 0, 0, 0])
    applyColorMatrix(px, IDENTITY)

    expect(px.data[3]).toBe(0)
  })

  it('rejects a matrix that is not 20 values', () => {
    expect(() => applyColorMatrix(image([0, 0, 0, 255]), [1, 0, 0])).toThrow()
  })
})
