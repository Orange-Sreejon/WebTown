import Phaser from 'phaser'
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, TILE_SIZE } from '../config/GameConfig'
import { mergeRects, TILE_WATER } from './terrain'
import { AssetKeys } from '../config/AssetKeys'
import { FENCES, STRUCTURES, TERRAIN, TREES, VILLAGE_PROPS } from './town-layout'
import { measureSpriteShape, outlineRects, type SpriteShape } from './sprite-shape'

export interface CollisionRect {
  label: string
  x: number
  y: number
  w: number
  h: number
}

/** Resolves the measured pixel shape of a sprite, or null when unavailable. */
export type ShapeResolver = (key: string, frame?: number) => SpriteShape | null

/**
 * One collider per outline band. The bottom band is the part resting on the
 * ground, so it keeps the plain label; the ones above are suffixed.
 */
function outlineColliders(
  shape: SpriteShape,
  spriteX: number,
  spriteY: number,
  label: string,
): CollisionRect[] {
  const bands = outlineRects(shape, spriteX, spriteY)
  return bands.map((band, index) => ({
    label: index === bands.length - 1 ? label : `${label}-band-${index + 1}`,
    ...band,
  }))
}

/**
 * All solid obstacle collision rectangles. Coordinates in pixels at 1× scale.
 *
 * Everything is derived from the layout data and, for buildings and trees,
 * from the sprite's own alpha channel, so collision can never drift out of
 * sync with what is drawn: a house is solid along its silhouette rather than
 * its bounding box, and a tree blocks its trunk instead of a whole tile.
 *
 * Without a shape resolver (pure unit tests, or a texture that could not be
 * read) each object falls back to its tile footprint.
 */
export function getCollisionRects(shapeOf?: ShapeResolver): CollisionRect[] {
  const T = TILE_SIZE
  const rects: CollisionRect[] = []

  // ── Buildings ────────────────────────────────────────────────────────────
  for (const structure of STRUCTURES) {
    if (!structure.solid) continue

    const shape = shapeOf?.(structure.key)
    if (shape) {
      // The sprite is centred on its footprint; carry that offset into the
      // measured shape so transparent padding stays empty.
      const spriteX = structure.tileX * T + (structure.wTiles * T - shape.width) / 2
      const spriteY = structure.tileY * T + (structure.hTiles * T - shape.height) / 2
      rects.push(...outlineColliders(shape, spriteX, spriteY, structure.label))
      continue
    }

    // Fallback: the old footprint box, starting below the roof overhang.
    const inset = structure.solidInsetTop
    rects.push({
      label: structure.label,
      x: structure.tileX * T,
      y: (structure.tileY + inset) * T,
      w: structure.wTiles * T,
      h: (structure.hTiles - inset) * T,
    })
  }

  // ── Trees ────────────────────────────────────────────────────────────────
  // Trees are drawn centred on their footprint. When the sprite has been
  // measured the colliders follow the canopy outline, so a round tree blocks
  // a rounded area rather than its whole footprint; otherwise the box falls
  // back to the bottom-centre tile.
  TREES.forEach((tree, index) => {
    const shape = shapeOf?.(tree.key, tree.frame)
    if (shape) {
      const centreX = tree.tileX * T + (tree.wTiles * T) / 2
      const centreY = tree.tileY * T + (tree.hTiles * T) / 2
      rects.push(
        ...outlineColliders(
          shape,
          centreX - shape.width / 2,
          centreY - shape.height / 2,
          `tree-${index}`,
        ),
      )
      return
    }

    rects.push({
      label: `tree-${index}`,
      x: (tree.tileX + Math.floor(tree.wTiles / 2)) * T,
      y: (tree.tileY + tree.hTiles - 1) * T,
      w: T,
      h: T,
    })
  })

  // ── Village props ────────────────────────────────────────────────────────
  // Stalls, the well, tents and barrels are solid; baskets and produce on the
  // ground are decorative and can be walked over.
  VILLAGE_PROPS.forEach((prop, index) => {
    if (!prop.solid) return

    // A lamp is a thin pole on a small base, so it blocks just the post rather
    // than the two tiles of air its light reaches across.
    if (prop.key === AssetKeys.MARKET_LAMP) {
      rects.push({
        label: `prop-${prop.key}-${index}`,
        x: prop.tileX * T + T / 2 - 5,
        y: (prop.tileY + 1) * T - 10,
        w: 10,
        h: 10,
      })
      return
    }

    // Solid props block their own footprint: the bottom half of the scaled
    // sprite, which is the counter/basin that actually stands on the ground.
    const size = T * prop.scale
    rects.push({
      label: `prop-${prop.key}-${index}`,
      x: prop.tileX * T + 1,
      y: prop.tileY * T + T - size * 0.5,
      w: Math.round(size) - 2,
      h: Math.round(size * 0.5),
    })
  })

  // ── Fences ───────────────────────────────────────────────────────────────
  FENCES.forEach((fence, index) => {
    if (fence.lenH > 0) {
      for (let i = 0; i < fence.lenH; i++) {
        rects.push({
          label: `fence-${index}-${i}`,
          x: (fence.x + i) * T,
          y: fence.y * T + 6,
          w: T,
          h: 10,
        })
      }
    } else {
      for (let i = 0; i < fence.lenV; i++) {
        rects.push({
          label: `fence-${index}-${i}`,
          x: fence.x * T + 6,
          y: (fence.y + i) * T,
          w: 10,
          h: T,
        })
      }
    }
  })

  // ── Water ────────────────────────────────────────────────────────────────
  // The pond is an irregular blob, so its tiles are merged into a handful of
  // rectangles instead of one static body per tile. The bridge deck is carved
  // into the mask as path, so it is walkable automatically.
  mergeRects(TERRAIN, kind => kind === TILE_WATER).forEach((rect, index) => {
    rects.push({
      label: `water-${index}`,
      x: rect.x * T,
      y: rect.y * T,
      w: rect.w * T,
      h: rect.h * T,
    })
  })

  return rects
}

export function createCollisionObjects(scene: Phaser.Scene): Phaser.Physics.Arcade.StaticGroup {
  const group = scene.physics.add.staticGroup()

  const shapes = new Map<string, SpriteShape | null>()
  const shapeOf: ShapeResolver = (key, frame) => {
    const cacheKey = frame === undefined ? key : `${key}#${frame}`
    const cached = shapes.get(cacheKey)
    if (cached !== undefined) return cached
    const measured = measureSpriteShape(scene, key, frame)
    shapes.set(cacheKey, measured)
    return measured
  }

  for (const rect of getCollisionRects(shapeOf)) {
    const zone = scene.add.zone(
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      rect.w,
      rect.h,
    )

    scene.physics.add.existing(zone, true)

    const body = zone.body as Phaser.Physics.Arcade.StaticBody
    body.setSize(rect.w, rect.h)
    body.reset(rect.x + rect.w / 2, rect.y + rect.h / 2)

    group.add(zone)
  }

  return group
}

export function isWithinMap(rect: CollisionRect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= MAP_WIDTH_PX &&
    rect.y + rect.h <= MAP_HEIGHT_PX
  )
}
