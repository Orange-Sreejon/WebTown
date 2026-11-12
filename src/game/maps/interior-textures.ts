import type Phaser from 'phaser'
import { AssetKeys } from '../config/AssetKeys'
import type { SpriteRef } from './interior-layout'
import {
  COMPUTERS_GROUND_TOLERANCE,
  FURNITURE,
  OFFICE_KIT,
  PREPARED,
  type SliceRect,
} from './interior-slices'
import { boxDownscale, clearBackground, scaledHeight } from './sprite-prep'

/** Texture key for a computer-sheet sprite after it has been prepared. */
export function preparedKey(name: string): string {
  return `interior-prepared-${name}`
}

/** Phaser texture key and frame for a sprite reference. */
export function textureForSprite(sprite: SpriteRef): { key: string; frame?: string } {
  switch (sprite.sheet) {
    case 'kit':
      return { key: AssetKeys.INTERIOR_OFFICE_KIT, frame: sprite.name }
    case 'furniture':
      return { key: AssetKeys.INTERIOR_FURNITURE, frame: sprite.name }
    case 'prepared':
      return { key: preparedKey(sprite.name) }
  }
}

/** True when the three interior sheets are in the texture cache. */
export function interiorSheetsLoaded(scene: Phaser.Scene): boolean {
  return [
    AssetKeys.INTERIOR_OFFICE_KIT,
    AssetKeys.INTERIOR_FURNITURE,
    AssetKeys.INTERIOR_COMPUTERS,
  ].every(key => scene.textures.exists(key))
}

/**
 * Makes every interior sprite addressable by name: registers a frame for each
 * slice of the two 16px sheets and builds the prepared computer sprites.
 * Idempotent, so a second visit to an interior does no work.
 */
export function registerInteriorTextures(scene: Phaser.Scene): void {
  registerSlices(scene, AssetKeys.INTERIOR_OFFICE_KIT, OFFICE_KIT)
  registerSlices(scene, AssetKeys.INTERIOR_FURNITURE, FURNITURE)

  for (const [name, spec] of Object.entries(PREPARED)) {
    prepareSprite(scene, preparedKey(name), spec.source, spec.targetWidth)
  }
}

function registerSlices(scene: Phaser.Scene, key: string, slices: Record<string, SliceRect>): void {
  const texture = scene.textures.get(key)
  for (const [name, r] of Object.entries(slices)) {
    if (!texture.has(name)) texture.add(name, 0, r.x, r.y, r.w, r.h)
  }
}

/**
 * Crops a rectangle from the computer sheet, keys out its ground colour and
 * area-averages it to `targetWidth`. Plain nearest-neighbour scaling would
 * sample every Nth pixel of the dithered art and turn it to noise.
 */
function prepareSprite(
  scene: Phaser.Scene,
  key: string,
  rect: SliceRect,
  targetWidth: number,
): void {
  if (scene.textures.exists(key)) return

  const sheet = scene.textures.get(AssetKeys.INTERIOR_COMPUTERS)
  const source = sheet.getSourceImage() as CanvasImageSource
  const crop = document.createElement('canvas')
  crop.width = rect.w
  crop.height = rect.h
  const cropContext = crop.getContext('2d', { willReadFrequently: true })
  if (!cropContext) throw new Error('2d canvas context unavailable')

  cropContext.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  const pixels = cropContext.getImageData(0, 0, rect.w, rect.h)
  clearBackground(pixels.data, rect.w, rect.h, COMPUTERS_GROUND_TOLERANCE)

  const targetHeight = scaledHeight(rect.w, rect.h, targetWidth)
  const scaled = boxDownscale(pixels.data, rect.w, rect.h, targetWidth, targetHeight)

  const texture = scene.textures.createCanvas(key, targetWidth, targetHeight)
  if (!texture) throw new Error(`could not create texture ${key}`)
  const image = texture.context.createImageData(targetWidth, targetHeight)
  image.data.set(scaled)
  texture.context.putImageData(image, 0, 0)
  texture.refresh()
}
