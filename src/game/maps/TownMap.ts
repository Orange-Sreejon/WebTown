import Phaser from 'phaser'
import { AssetKeys } from '../config/AssetKeys'
import {
  TILE_SIZE,
  MAP_TILES_W,
  MAP_TILES_H,
  MAP_WIDTH_PX,
  MAP_HEIGHT_PX,
  DEPTH_GROUND,
  DEPTH_ROAD,
  DEPTH_DECORATION,
  DEPTH_STRUCTURE,
} from '../config/GameConfig'
import {
  STRUCTURES,
  TREES,
  WATER_REGION,
  GRASS_DETAILS,
  FENCES,
  getRoadEdgeTiles,
  tileToPixel,
  H_ROAD_ROW,
  V_ROAD_COL,
  SPUR_H_ROW,
  SPUR_H_COL_START,
  SPUR_H_COL_END,
  SPUR_V_COL,
  SPUR_V_ROW_START,
  SPUR_V_ROW_END,
  SOUTH_SPUR_COL,
  SOUTH_SPUR_ROW_START,
  SOUTH_SPUR_ROW_END,
} from './town-layout'

/**
 * Builds the town map using a single RenderTexture for the ground layer.
 *
 * WHY RenderTexture:
 *   Placing one Phaser Image per tile (80×64 = 5120 grass tiles alone) creates
 *   thousands of draw calls and freezes Phaser during create(). A RenderTexture
 *   stamps all tiles into one GPU texture in a single pass — the entire ground,
 *   roads, water and decorations become one draw call.
 *
 *   Only structures, trees and the player remain as individual sprites because
 *   they need to interact with the depth/sorting system.
 */
export class TownMap {
  private scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  build(): void {
    this.bakeGroundLayer()
    this.placeStructures()
    this.placeTrees()
    this.placeFences()
  }

  // ── Bake all flat layers into one RenderTexture ──────────────────────────
  private bakeGroundLayer(): void {
    const rt = this.scene.add.renderTexture(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
    rt.setOrigin(0, 0)
    rt.setDepth(DEPTH_GROUND)

    const T = TILE_SIZE

    // Helper: stamp one tile key at tile (tx, ty)
    const stamp = (key: string, tx: number, ty: number): void => {
      rt.stamp(key, 0, tx * T + T / 2, ty * T + T / 2)
    }

    // ── 1. Grass fill ──────────────────────────────────────────────────
    for (let ty = 0; ty < MAP_TILES_H; ty++) {
      for (let tx = 0; tx < MAP_TILES_W; tx++) {
        stamp(AssetKeys.GRASS_TILE, tx, ty)
      }
    }

    // ── 2. Main H road (rows 27–28) ───────────────────────────────────
    for (let tx = 0; tx < MAP_TILES_W; tx++) {
      stamp(AssetKeys.GROUND_TILE, tx, H_ROAD_ROW)
      stamp(AssetKeys.GROUND_TILE, tx, H_ROAD_ROW + 1)
    }

    // ── 3. Main V road (cols 26–27) ───────────────────────────────────
    for (let ty = 0; ty < MAP_TILES_H; ty++) {
      stamp(AssetKeys.GROUND_TILE, V_ROAD_COL, ty)
      stamp(AssetKeys.GROUND_TILE, V_ROAD_COL + 1, ty)
    }

    // ── 4. North spur ─────────────────────────────────────────────────
    for (let tx = SPUR_H_COL_START; tx <= SPUR_H_COL_END; tx++) {
      stamp(AssetKeys.GROUND_TILE, tx, SPUR_H_ROW)
      stamp(AssetKeys.GROUND_TILE, tx, SPUR_H_ROW + 1)
    }

    // ── 5. East spur ──────────────────────────────────────────────────
    for (let ty = SPUR_V_ROW_START; ty <= SPUR_V_ROW_END; ty++) {
      stamp(AssetKeys.GROUND_TILE, SPUR_V_COL, ty)
      stamp(AssetKeys.GROUND_TILE, SPUR_V_COL + 1, ty)
    }

    // ── 6. South spur ─────────────────────────────────────────────────
    for (let ty = SOUTH_SPUR_ROW_START; ty <= SOUTH_SPUR_ROW_END; ty++) {
      stamp(AssetKeys.GROUND_TILE, SOUTH_SPUR_COL, ty)
      stamp(AssetKeys.GROUND_TILE, SOUTH_SPUR_COL + 1, ty)
    }

    // ── 7. Road-edge detail tiles ──────────────────────────────────────
    for (const t of getRoadEdgeTiles()) {
      stamp(t.key, t.tileX, t.tileY)
    }

    // ── 8. Water fill ─────────────────────────────────────────────────
    const { tileX: wx, tileY: wy, tilesW, tilesH } = WATER_REGION
    for (let dy = 0; dy < tilesH; dy++) {
      for (let dx = 0; dx < tilesW; dx++) {
        stamp(AssetKeys.WATER_TILE, wx + dx, wy + dy)
      }
    }

    // ── 9. Water details ──────────────────────────────────────────────
    const waterDetailKeys = [
      AssetKeys.WATER_DETAIL_1, AssetKeys.WATER_DETAIL_2,
      AssetKeys.WATER_DETAIL_3, AssetKeys.WATER_DETAIL_4,
      AssetKeys.WATER_DETAIL_5,
    ]
    const waterDetailOffsets: Array<[number, number]> = [
      [2,2],[4,5],[7,3],[9,7],[11,2],[1,9],[5,11],[8,10],[3,8],[6,6],[10,4],
    ]
    waterDetailOffsets.forEach(([dx, dy], i) => {
      stamp(waterDetailKeys[i % waterDetailKeys.length]!, wx + dx, wy + dy)
    })

    // ── 10. Grass details ─────────────────────────────────────────────
    for (const t of GRASS_DETAILS) {
      stamp(t.key, t.tileX, t.tileY)
    }

    // ── 11. Fences ────────────────────────────────────────────────────
    for (const fence of FENCES) {
      if (fence.lenH > 0) {
        for (let i = 0; i < fence.lenH; i++) {
          stamp(fence.key, fence.x + i, fence.y)
        }
      } else {
        for (let i = 0; i < fence.lenV; i++) {
          stamp(fence.key, fence.x, fence.y + i)
        }
      }
    }
  }

  // ── Structures (houses, church, bridge, stairs) ──────────────────────────
  private placeStructures(): void {
    for (const s of STRUCTURES) {
      const { x, y } = tileToPixel(s.tileX, s.tileY)
      this.scene.add
        .image(x + s.pxW / 2, y + s.pxH / 2, s.key)
        .setDepth(DEPTH_STRUCTURE)
    }
  }

  // ── Trees ────────────────────────────────────────────────────────────────
  private placeTrees(): void {
    for (const t of TREES) {
      const { x, y } = tileToPixel(t.tileX, t.tileY)
      this.scene.add
        .image(x + 24, y + 24, t.key)
        .setDepth(DEPTH_STRUCTURE)
    }
  }

  // ── Fences as sprites (already baked into RT above, this is a no-op now)
  // Fences are baked into the RenderTexture — no separate sprites needed.
  private placeFences(): void {
    // Intentionally empty — fences are stamped in bakeGroundLayer()
  }
}
