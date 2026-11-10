import { MAP_TILES_H, MAP_TILES_W } from '../config/GameConfig'

/**
 * Terrain is stored as a per-tile mask rather than as hand-written coordinate
 * lists. Decorations and collision are then *derived* from the mask, which is
 * what keeps grass off the water and pebbles off the middle of the road.
 */

export const TILE_GRASS = 0
export const TILE_PATH = 1
export const TILE_BANK = 2
export const TILE_WATER = 3

export type TileKind = 0 | 1 | 2 | 3

export interface TerrainMask {
  readonly width: number
  readonly height: number
  readonly tiles: Uint8Array
}

export interface TileRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * mulberry32 — small deterministic PRNG. The town must look identical on every
 * reload (and in tests), so nothing here uses Math.random().
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createMask(
  width: number = MAP_TILES_W,
  height: number = MAP_TILES_H,
): TerrainMask {
  const tiles = new Uint8Array(width * height)
  tiles.fill(TILE_GRASS)
  return { width, height, tiles }
}

export function inBounds(mask: TerrainMask, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < mask.width && ty < mask.height
}

/** Tile kind at (tx, ty), or -1 when outside the map. */
export function kindAt(mask: TerrainMask, tx: number, ty: number): TileKind | -1 {
  if (!inBounds(mask, tx, ty)) return -1
  return mask.tiles[ty * mask.width + tx] as TileKind
}

export function setTile(
  mask: TerrainMask,
  tx: number,
  ty: number,
  kind: TileKind,
): void {
  if (!inBounds(mask, tx, ty)) return
  mask.tiles[ty * mask.width + tx] = kind
}

export function fillRect(
  mask: TerrainMask,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: TileKind,
): void {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) setTile(mask, tx, ty, kind)
  }
}

/**
 * Smooth pseudo-noise in [-1, 1] used to give roads an uneven, hand-drawn edge.
 * The frequencies are deliberately low: the edge should drift over several
 * tiles like a worn footpath, not jitter one tile per tile (which reads as a
 * pixel staircase).
 */
function wobbleAt(value: number, seed: number): number {
  return (
    Math.sin(value * 0.18 + seed) * 0.6 + Math.sin(value * 0.07 + seed * 1.7) * 0.4
  )
}

/** Carve a horizontal road whose top/bottom edges drift by up to one tile. */
export function carveRoadH(
  mask: TerrainMask,
  row: number,
  fromX: number,
  toX: number,
  thickness: number,
  seed = 0,
): void {
  const half = Math.floor(thickness / 2)
  for (let tx = fromX; tx <= toX; tx++) {
    const shift = Math.max(-1, Math.min(1, Math.round(wobbleAt(tx, seed))))
    const top = row - half + shift
    for (let i = 0; i < thickness; i++) setTile(mask, tx, top + i, TILE_PATH)
  }
}

/** Carve a vertical road whose left/right edges drift by up to one tile. */
export function carveRoadV(
  mask: TerrainMask,
  col: number,
  fromY: number,
  toY: number,
  thickness: number,
  seed = 0,
): void {
  const half = Math.floor(thickness / 2)
  for (let ty = fromY; ty <= toY; ty++) {
    const shift = Math.max(-1, Math.min(1, Math.round(wobbleAt(ty, seed))))
    const left = col - half + shift
    for (let i = 0; i < thickness; i++) setTile(mask, left + i, ty, TILE_PATH)
  }
}

/**
 * Fill an organic ellipse. The radius is modulated by a few sine harmonics so
 * ponds and plazas get an irregular outline instead of a hard rectangle.
 */
export function fillBlob(
  mask: TerrainMask,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  kind: TileKind,
  seed = 0,
  wobble = 0.14,
): void {
  const x0 = Math.floor(cx - rx - 1)
  const x1 = Math.ceil(cx + rx + 1)
  const y0 = Math.floor(cy - ry - 1)
  const y1 = Math.ceil(cy + ry + 1)

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const nx = (tx + 0.5 - cx) / rx
      const ny = (ty + 0.5 - cy) / ry
      const angle = Math.atan2(ny, nx)
      const radiusScale =
        1 + wobble * Math.sin(angle * 3 + seed) + wobble * 0.6 * Math.sin(angle * 5 - seed * 2)
      const d = Math.sqrt(nx * nx + ny * ny) / radiusScale
      if (d <= 1) setTile(mask, tx, ty, kind)
    }
  }
}

/**
 * Turns every grass tile that touches water into a bank tile. This is the
 * pond shoreline: water never meets bare grass, so the edge reads as a shore
 * rather than a blue rectangle pasted onto the field.
 */
export function surroundWithBank(mask: TerrainMask): void {
  const snapshot = mask.tiles.slice()

  for (let ty = 1; ty < mask.height - 1; ty++) {
    for (let tx = 1; tx < mask.width - 1; tx++) {
      if (snapshot[ty * mask.width + tx] !== TILE_WATER) continue

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = ty + dy
          const nx = tx + dx
          if (snapshot[ny * mask.width + nx] === TILE_GRASS) {
            setTile(mask, nx, ny, TILE_BANK)
          }
        }
      }
    }
  }
}

/**
 * Merges all matching tiles into the smallest set of rectangles, row by row.
 * Used to build a handful of water collision bodies instead of one per tile.
 */
export function mergeRects(
  mask: TerrainMask,
  isMatch: (kind: TileKind) => boolean,
): TileRect[] {
  const finished: TileRect[] = []
  let open: TileRect[] = []

  for (let ty = 0; ty < mask.height; ty++) {
    const runs: TileRect[] = []
    let start = -1

    for (let tx = 0; tx <= mask.width; tx++) {
      const matches =
        tx < mask.width && isMatch(mask.tiles[ty * mask.width + tx] as TileKind)

      if (matches && start === -1) {
        start = tx
      } else if (!matches && start !== -1) {
        runs.push({ x: start, y: ty, w: tx - start, h: 1 })
        start = -1
      }
    }

    const stillOpen: TileRect[] = []
    for (const run of runs) {
      const index = open.findIndex(r => r.x === run.x && r.w === run.w)
      if (index >= 0) {
        const carried = open[index]!
        carried.h += 1
        stillOpen.push(carried)
        open.splice(index, 1)
      } else {
        stillOpen.push(run)
      }
    }

    finished.push(...open)
    open = stillOpen
  }

  finished.push(...open)
  return finished
}
