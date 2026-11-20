/**
 * Bakes the Cute Fantasy house's palette harmonisation into a texture.
 *
 * The house used to be reshaded with a `preFX` colour matrix, which is a WebGL
 * pipeline: on some devices and drivers it draws the sprite as a black
 * rectangle (and it also makes `setTint` stop working). Baking the same matrix
 * into a canvas texture at load time gives the identical look on every
 * renderer, with no per-frame shader and no GPU dependency.
 *
 * If the canvas cannot be read (a tainted texture, or no 2D context), the
 * caller falls back to the original sprite rather than failing.
 */

import Phaser from 'phaser'
import { AssetKeys } from '../config/AssetKeys'
import { applyColorMatrix } from './color-matrix'

/** Texture key of the harmonised copy. */
export const CUTE_HOUSE_HARMONISED_KEY = 'cute-house-harmonised'

/** The same three steps the old `preFX` chain applied, in the same order. */
export const CUTE_HOUSE_PALETTE = {
  saturate: -0.25,
  contrast: 0.82,
  brightness: 1.12,
} as const

/** The composed 4×5 matrix, straight from Phaser so it matches the shader. */
export function cuteHousePaletteMatrix(): Float32Array {
  return new Phaser.Display.ColorMatrix()
    .saturate(CUTE_HOUSE_PALETTE.saturate)
    .contrast(CUTE_HOUSE_PALETTE.contrast, true)
    .brightness(CUTE_HOUSE_PALETTE.brightness, true)
    .getData()
}

/**
 * Creates the harmonised texture once and returns its key, or null when the
 * source image cannot be read. Repeated calls reuse the existing texture.
 */
export function harmoniseCuteHouse(scene: Phaser.Scene): string | null {
  const textures = scene.textures
  if (textures.exists(CUTE_HOUSE_HARMONISED_KEY)) return CUTE_HOUSE_HARMONISED_KEY

  const source = textures.get(AssetKeys.CUTE_HOUSE)
  const frame = source.get()
  if (!frame || !frame.width || !frame.height) return null

  const width = frame.width
  const height = frame.height

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  try {
    context.drawImage(
      source.getSourceImage() as CanvasImageSource,
      -(frame.cutX ?? 0),
      -(frame.cutY ?? 0),
    )

    const pixels = context.getImageData(0, 0, width, height)
    applyColorMatrix({ data: pixels.data, width, height }, cuteHousePaletteMatrix())
    context.putImageData(pixels, 0, 0)
  } catch (error) {
    console.warn('[CuteHouse] could not bake the harmonised texture; using the original', error)
    return null
  }

  const baked = textures.createCanvas(CUTE_HOUSE_HARMONISED_KEY, width, height)
  if (!baked) return null

  baked.context.drawImage(canvas, 0, 0)
  baked.refresh()

  return CUTE_HOUSE_HARMONISED_KEY
}
