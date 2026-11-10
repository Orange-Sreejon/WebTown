import Phaser from 'phaser'
import { TILE_SIZE, MAP_WIDTH_PX, MAP_HEIGHT_PX } from '../config/GameConfig'

export interface CollisionRect {
  label: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * All solid obstacle collision rectangles. Coordinates in pixels at 1× scale.
 * Pure data — no Phaser dependency — fully unit-testable.
 */
export function getCollisionRects(): CollisionRect[] {
  const T = TILE_SIZE

  return [
    // ── NORTH CLUSTER ─────────────────────────────────────────────────
    // House A (small 80×112): tile (10, 5) — skip top tile (roof)
    { label: 'house-a', x: 10*T, y:  6*T, w: 5*T, h: 6*T },
    // House B (large 128×112): tile (20, 5)
    { label: 'house-b', x: 20*T, y:  6*T, w: 8*T, h: 6*T },
    // House C (small 80×112): tile (35, 5)
    { label: 'house-c', x: 35*T, y:  6*T, w: 5*T, h: 6*T },
    // Church (128×112): tile (48, 5)
    { label: 'church',  x: 48*T, y:  6*T, w: 8*T, h: 6*T },

    // ── SOUTH CLUSTER ─────────────────────────────────────────────────
    // House D (large 128×112): tile (20, 38)
    { label: 'house-d', x: 20*T, y: 39*T, w: 8*T, h: 6*T },
    // House E (small 80×112): tile (45, 40)
    { label: 'house-e', x: 45*T, y: 41*T, w: 5*T, h: 6*T },

    // ── DECORATIVE STRUCTURES ─────────────────────────────────────────
    // Bridge: tile (10, 36) — 96×48 px (6×3 tiles), block full footprint
    { label: 'bridge', x: 10*T, y: 36*T, w: 6*T, h: 3*T },
    // Stairs: tile (27, 36) — 32×64 px (2×4 tiles)
    { label: 'stairs', x: 27*T, y: 36*T, w: 2*T, h: 4*T },

    // ── TREE TRUNKS ───────────────────────────────────────────────────
    // Each tree is 48×48 (3×3 tiles); trunk = centre tile of bottom row
    ...trunks([
      // Left border interior
      [3,4],[6,4],[3,8],[6,8],[3,12],[6,12],
      [3,16],[6,16],[3,20],[6,22],
      // North cluster gaps
      [16,4],[16,8],[29,4],[29,8],[32,4],[41,4],[41,8],[44,8],
      [57,4],[60,4],[63,4],[66,4],[69,4],
      [57,8],[63,8],[69,8],[60,11],
      [57,14],[60,14],[63,14],[66,14],[69,14],[72,14],
      [57,18],[60,18],[63,18],[66,18],[69,18],[72,18],
      [57,22],[60,22],[63,22],[66,22],[69,22],[72,22],
      // Right border interior
      [74,0],[74,3],[74,6],[74,9],[74,12],[74,15],[74,18],[74,21],[74,24],[74,27],
      [74,30],[74,33],[74,36],[74,39],[74,42],[74,45],[74,48],[74,51],[74,54],[74,57],[74,60],
      // South area
      [3,31],[6,31],[3,36],[16,36],[29,46],[29,51],[32,51],
      [40,31],[45,31],[51,31],[57,31],[63,31],[69,31],
      [51,36],[54,40],[54,45],[57,45],[60,36],[63,40],[66,36],[69,40],[69,45],
      [63,51],[66,51],[69,51],
      // Pond surrounds
      [3,42],[3,48],[3,54],
    ]),

    // ── WATER BARRIER ─────────────────────────────────────────────────
    // Block top edge of pond so player can't walk into the water
    { label: 'water-top', x:  7*T, y: 40*T, w: 12*T, h: T },
    // Block left side
    { label: 'water-left', x: 7*T, y: 40*T, w: T, h: 14*T },
    // Block right side
    { label: 'water-right', x: 18*T, y: 40*T, w: T, h: 14*T },
  ]
}

function trunks(positions: Array<[number, number]>): CollisionRect[] {
  return positions.map(([tx, ty], i) => ({
    label: `tree-trunk-${i}`,
    x: (tx + 1) * TILE_SIZE,
    y: (ty + 2) * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE,
  }))
}

export function createCollisionObjects(scene: Phaser.Scene): Phaser.Physics.Arcade.StaticGroup {
  const group = scene.physics.add.staticGroup()

  for (const rect of getCollisionRects()) {
    const obj = scene.add.image(
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      '__DEFAULT',
    )
    obj.setVisible(false).setAlpha(0)
    scene.physics.add.existing(obj, true)
    const body = obj.body as Phaser.Physics.Arcade.StaticBody
    body.setSize(rect.w, rect.h)
    body.reset(rect.x + rect.w / 2, rect.y + rect.h / 2)
    group.add(obj)
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
