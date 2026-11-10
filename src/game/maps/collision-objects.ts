import Phaser from 'phaser'
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, TILE_SIZE } from '../config/GameConfig'
import { mergeRects, TILE_WATER } from './terrain'
import { FENCES, STRUCTURES, TERRAIN, TREES } from './town-layout'

export interface CollisionRect {
  label: string
  x: number
  y: number
  w: number
  h: number
}


/**
 * All solid obstacle collision rectangles. Coordinates in pixels at 1× scale.
 *
 * Everything is derived from the layout data, so collision can never drift out
 * of sync with what is drawn: buildings from their footprints, tree trunks from
 * the tree positions, the pond from the water tiles in the terrain mask.
 */
export function getCollisionRects(): CollisionRect[] {
  const T = TILE_SIZE
  const rects: CollisionRect[] = []

  // ── Buildings ────────────────────────────────────────────────────────────
  for (const structure of STRUCTURES) {
    if (!structure.solid) continue
    // The top rows are roof overhang, so collision starts below them.
    const inset = structure.solidInsetTop
    rects.push({
      label: structure.label,
      x: structure.tileX * T,
      y: (structure.tileY + inset) * T,
      w: structure.wTiles * T,
      h: (structure.hTiles - inset) * T,
    })
  }

  // ── Tree trunks ──────────────────────────────────────────────────────────
  // Only the bottom-centre tile of a tree footprint (the trunk) blocks, so the
  // player can walk under the canopy of every tree species.
  TREES.forEach((tree, index) => {
    rects.push({
      label: `tree-trunk-${index}`,
      x: (tree.tileX + Math.floor(tree.wTiles / 2)) * T,
      y: (tree.tileY + tree.hTiles - 1) * T,
      w: T,
      h: T,
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

  for (const rect of getCollisionRects()) {
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
