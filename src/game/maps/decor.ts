import { AssetKeys } from '../config/AssetKeys'
import { DEPTH_DECORATION } from '../config/GameConfig'
import {
  createRng,
  kindAt,
  TILE_BANK,
  TILE_GRASS,
  TILE_PATH,
  TILE_WATER,
  type TerrainMask,
} from './terrain'

export interface DecorTile {
  key: string
  tileX: number
  tileY: number
  depth: number
}

/**
 * Grass details are props (rocks, flower patches, ferns), so scattering them on
 * a fixed grid reads as random noise. They are placed as small *clusters*
 * instead — the way the reference maps group rocks together and put flower
 * patches next to trees rather than evenly across the field.
 */
const GRASS_CLUSTERS: readonly string[][] = [
  [AssetKeys.GRASS_DETAIL_1], // boulder
  [AssetKeys.GRASS_DETAIL_1, AssetKeys.GRASS_DETAIL_4], // rock outcrop
  [AssetKeys.GRASS_DETAIL_2], // orange flowers
  [AssetKeys.GRASS_DETAIL_5], // blue flowers
  [AssetKeys.GRASS_DETAIL_3, AssetKeys.GRASS_DETAIL_6], // ferns
]

const CLUSTER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
]

const PEBBLE_KEYS = [
  AssetKeys.GROUND_DETAIL_1,
  AssetKeys.GROUND_DETAIL_2,
  AssetKeys.GROUND_DETAIL_3,
  AssetKeys.GROUND_DETAIL_4,
  AssetKeys.GROUND_DETAIL_5,
]

const WATER_PROP_KEYS = [
  AssetKeys.WATER_DETAIL_1,
  AssetKeys.WATER_DETAIL_3,
  AssetKeys.WATER_DETAIL_4,
  AssetKeys.WATER_DETAIL_5,
]

/** Props scattered over open grass, grouped into clusters of 1-3 tiles. */
export function buildGrassDecor(mask: TerrainMask, seed = 7): DecorTile[] {
  const rng = createRng(seed)
  const decor: DecorTile[] = []

  for (let gy = 3; gy < mask.height - 4; gy += 3) {
    for (let gx = 3; gx < mask.width - 4; gx += 3) {
      // Leave gaps so the field does not look evenly salted.
      if (rng() > 0.75) continue

      const cx = gx + Math.floor(rng() * 4) - 1
      const cy = gy + Math.floor(rng() * 4) - 1
      const cluster = GRASS_CLUSTERS[Math.floor(rng() * GRASS_CLUSTERS.length)]!
      const count = 1 + Math.floor(rng() * 4)

      for (let i = 0; i < count; i++) {
        const [dx, dy] = CLUSTER_OFFSETS[Math.floor(rng() * CLUSTER_OFFSETS.length)]!
        const tileX = cx + dx
        const tileY = cy + dy
        // Only ever on bare grass — never on paths, banks or the pond.
        if (kindAt(mask, tileX, tileY) !== TILE_GRASS) continue
        decor.push({
          key: cluster[i % cluster.length]!,
          tileX,
          tileY,
          depth: DEPTH_DECORATION,
        })
      }
    }
  }

  return decor
}

/**
 * Pebbles belong on the *road*, a tile or two in from the edge — that is what
 * the reference maps do. The previous version traced a solid pebble border down
 * both sides of every road, which is what made the layout look mechanical.
 */
export function buildPathEdges(mask: TerrainMask, seed = 21): DecorTile[] {
  const rng = createRng(seed)
  const decor: DecorTile[] = []

  for (let ty = 1; ty < mask.height - 1; ty++) {
    for (let tx = 1; tx < mask.width - 1; tx++) {
      if (kindAt(mask, tx, ty) !== TILE_PATH) continue

      const touchesGrass =
        kindAt(mask, tx + 1, ty) === TILE_GRASS ||
        kindAt(mask, tx - 1, ty) === TILE_GRASS ||
        kindAt(mask, tx, ty + 1) === TILE_GRASS ||
        kindAt(mask, tx, ty - 1) === TILE_GRASS

      if (!touchesGrass) continue
      if (rng() > 0.16) continue

      decor.push({
        key: PEBBLE_KEYS[Math.floor(rng() * PEBBLE_KEYS.length)]!,
        tileX: tx,
        tileY: ty,
        depth: DEPTH_DECORATION,
      })
    }
  }

  return decor
}

/**
 * Reeds, lily pads and rocks float on the water, so they are restricted to
 * water tiles that actually touch the shore. Nothing is dropped in the middle
 * of the pond, which is what previously looked like grass growing on water.
 */
export function buildWaterProps(mask: TerrainMask): DecorTile[] {
  const props: DecorTile[] = []
  let index = 0

  for (let ty = 1; ty < mask.height - 1; ty++) {
    for (let tx = 1; tx < mask.width - 1; tx++) {
      if (kindAt(mask, tx, ty) !== TILE_WATER) continue

      const touchesShore =
        kindAt(mask, tx + 1, ty) === TILE_BANK ||
        kindAt(mask, tx - 1, ty) === TILE_BANK ||
        kindAt(mask, tx, ty + 1) === TILE_BANK ||
        kindAt(mask, tx, ty - 1) === TILE_BANK

      if (!touchesShore) continue
      // Deterministic sparsity: roughly one prop every nine shore tiles.
      if ((tx * 7 + ty * 13) % 9 !== 0) continue

      props.push({
        key: WATER_PROP_KEYS[index % WATER_PROP_KEYS.length]!,
        tileX: tx,
        tileY: ty,
        depth: DEPTH_DECORATION,
      })
      index++
    }
  }

  return props
}
