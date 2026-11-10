import type Phaser from 'phaser'

/**
 * Collider geometry read from a sprite's own pixels.
 *
 * The collision boxes for buildings and trees used to be derived from the
 * tile footprint, which drifts away from the art: sprites carry transparent
 * padding, house 2's door is well left of centre, and a tree's canopy sits
 * well inside its footprint. Measuring the alpha channel keeps the boxes on
 * the shape that is actually drawn.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Band extends Rect {
  /** Row range in texture pixels, for traceability. */
  top: number
  bottom: number
}

export interface SpriteShape {
  width: number
  height: number
  /** Drawn bounding box in texture pixels. */
  left: number
  right: number
  top: number
  bottom: number
  /** Opaque extent of every 8px row band, top to bottom. */
  bands: Band[]
}

/** Anything above this alpha counts as drawn (includes soft shadows). */
const ALPHA_VISIBLE = 8
/**
 * Bands use opaque pixels only, so the soft drop shadow under a tree is not
 * mistaken for solid canopy.
 */
const ALPHA_SOLID = 128
const BAND_HEIGHT = 8

const cache = new Map<string, SpriteShape | null>()

/**
 * Measures a texture (or one frame of a spritesheet) once and caches the
 * result. Returns null when the texture cannot be read, so callers can fall
 * back to footprint-based boxes.
 */
export function measureSpriteShape(
  scene: Phaser.Scene,
  key: string,
  frame?: number,
): SpriteShape | null {
  const cacheKey = frame === undefined ? key : `${key}#${frame}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const shape = measure(scene, key, frame)
  cache.set(cacheKey, shape)
  return shape
}

function measure(scene: Phaser.Scene, key: string, frame?: number): SpriteShape | null {
  const texture = scene.textures.get(key)
  if (!texture || !texture.key || texture.key === '__MISSING') return null

  const source = texture.getSourceImage() as CanvasImageSource | undefined
  if (!source) return null

  const f = texture.get(frame ?? 0)
  const width = f.width
  const height = f.height
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // Spritesheet frames are offset into the sheet; draw the frame at the origin.
  ctx.drawImage(source, -(f.cutX ?? 0), -(f.cutY ?? 0))

  let pixels: Uint8ClampedArray
  try {
    pixels = ctx.getImageData(0, 0, width, height).data
  } catch {
    return null // tainted canvas — fall back to footprint boxes
  }

  const alphaAt = (x: number, y: number): number => pixels[(y * width + x) * 4 + 3]!

  const rowExtent = (y: number, threshold: number): { left: number; right: number } | null => {
    let left = width
    let right = -1
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) > threshold) {
        if (x < left) left = x
        if (x > right) right = x
      }
    }
    return right < 0 ? null : { left, right }
  }

  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    const extent = rowExtent(y, ALPHA_VISIBLE)
    if (!extent) continue
    left = Math.min(left, extent.left)
    right = Math.max(right, extent.right)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  if (bottom < 0) return null

  const bands: Band[] = []
  for (let y = top; y <= bottom; y += BAND_HEIGHT) {
    const bandBottom = Math.min(bottom, y + BAND_HEIGHT - 1)
    let bandLeft = width
    let bandRight = -1
    for (let row = y; row <= bandBottom; row++) {
      const extent = rowExtent(row, ALPHA_SOLID) ?? rowExtent(row, ALPHA_VISIBLE)
      if (!extent) continue
      bandLeft = Math.min(bandLeft, extent.left)
      bandRight = Math.max(bandRight, extent.right)
    }
    if (bandRight < 0) continue
    bands.push({
      top: y,
      bottom: bandBottom,
      x: bandLeft,
      y,
      w: bandRight - bandLeft + 1,
      h: bandBottom - y + 1,
    })
  }
  if (bands.length === 0) return null

  return { width, height, left, right, top, bottom, bands }
}

/**
 * The sprite's outline as one collider per 8px row band: a sloping roof or a
 * rounded canopy is solid along its edge instead of filling the empty corners
 * of its bounding box.
 */
export function outlineRects(shape: SpriteShape, spriteX: number, spriteY: number): Rect[] {
  return shape.bands
    .filter(band => band.w >= 3 && band.h >= 2)
    .map(band => ({
      x: spriteX + band.x,
      y: spriteY + band.y,
      w: band.w,
      h: band.h,
    }))
}
