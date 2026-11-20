/**
 * Applies a Phaser colour matrix to pixels on the CPU.
 *
 * Phaser's `preFX` colour-matrix pipeline is a WebGL shader. On some devices
 * and drivers that pipeline draws the sprite as a black rectangle, and it also
 * disables `setTint`. Baking the same matrix into a canvas texture produces
 * the identical look with no GPU pipeline involved, so a sprite can never go
 * black because of a shader.
 *
 * The maths follows Phaser's `ColorMatrix.frag` exactly: the 20 values are a
 * 4×5 matrix applied to normalised RGBA, with the last column added as an
 * offset.
 */

export interface RgbaImage {
  /** Straight-alpha RGBA, as returned by `CanvasRenderingContext2D`. */
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Applies `matrix` (20 values) to `image` in place. */
export function applyColorMatrix(image: RgbaImage, matrix: ArrayLike<number>): void {
  if (matrix.length < 20) throw new Error('a colour matrix needs 20 values')

  const { data } = image
  const m = matrix

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! / 255
    const g = data[i + 1]! / 255
    const b = data[i + 2]! / 255
    const a = data[i + 3]! / 255

    const outR = m[0]! * r + m[1]! * g + m[2]! * b + m[3]! * a + m[4]!
    const outG = m[5]! * r + m[6]! * g + m[7]! * b + m[8]! * a + m[9]!
    const outB = m[10]! * r + m[11]! * g + m[12]! * b + m[13]! * a + m[14]!
    const outA = m[15]! * r + m[16]! * g + m[17]! * b + m[18]! * a + m[19]!

    data[i] = toByte(outR)
    data[i + 1] = toByte(outG)
    data[i + 2] = toByte(outB)
    data[i + 3] = toByte(outA)
  }
}

function toByte(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 255
  return Math.round(value * 255)
}
