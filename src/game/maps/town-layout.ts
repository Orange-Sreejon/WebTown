import { AssetKeys } from '../config/AssetKeys'
import {
  TILE_SIZE,
  MAP_TILES_W,
  MAP_TILES_H,
  DEPTH_GROUND,
  DEPTH_ROAD,
  DEPTH_DECORATION,
  DEPTH_STRUCTURE,
} from '../config/GameConfig'

export { DEPTH_GROUND, DEPTH_ROAD, DEPTH_DECORATION, DEPTH_STRUCTURE }

export interface StructurePlacement {
  key: string
  tileX: number
  tileY: number
  pxW: number
  pxH: number
  depth: number
}

export interface TilePlacement {
  key: string
  tileX: number
  tileY: number
  depth: number
}

export interface FenceRun {
  key: string
  /** start tile */
  x: number
  y: number
  /** horizontal length in tiles (0 = vertical run) */
  lenH: number
  /** vertical length in tiles (0 = horizontal run) */
  lenV: number
  depth: number
}

/** Tile → pixel top-left. */
export function tileToPixel(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE, y: ty * TILE_SIZE }
}

// ─── MAP OVERVIEW ──────────────────────────────────────────────────────────
//
// 80 × 64 tile map.  Inspired by Pokémon-style top-down towns:
//   • Dense tree border 2–3 tiles thick around all 4 edges
//   • Central dirt-path cross (+)
//   • NORTH cluster  (cols 10–45, rows 4–17): 3 houses + church, fences
//   • SOUTH cluster  (cols 20–55, rows 35–55): 2 houses + bridge + stairs
//   • WEST  pond     (cols 2–12,  rows 38–54): water + details + bridge
//   • Heavy grass/detail coverage in every open green area
//
// Player spawns at the path intersection (~tile 28, 28).

// ─── PATH NETWORK ──────────────────────────────────────────────────────────
// Main H road: rows 27–28, full width
export const H_ROAD_ROW = 27
// Main V road: cols 26–27, full height
export const V_ROAD_COL = 26

// Secondary H spur: rows 14–15, cols 10–26  (leads to north cluster)
export const SPUR_H_ROW  = 14
export const SPUR_H_COL_START = 10
export const SPUR_H_COL_END   = 26

// Secondary V spur: cols 44–45, rows 14–27  (east side of north cluster)
export const SPUR_V_COL  = 44
export const SPUR_V_ROW_START = 14
export const SPUR_V_ROW_END   = 27

// South spur: cols 36–37, rows 28–50  (leads to south cluster)
export const SOUTH_SPUR_COL       = 36
export const SOUTH_SPUR_ROW_START = 28
export const SOUTH_SPUR_ROW_END   = 50

// ─── STRUCTURES ────────────────────────────────────────────────────────────
// NORTH CLUSTER
//   House A (small):  tile (10,  5) — 80×112 px  (5 w × 7 h tiles)
//   House B (large):  tile (20,  5) — 128×112 px (8 w × 7 h tiles)
//   House C (small):  tile (35,  5) — 80×112 px
//   Church:           tile (48,  5) — 128×112 px
//
// SOUTH CLUSTER
//   House D (large):  tile (20, 38) — 128×112 px
//   House E (small):  tile (45, 40) — 80×112 px
//
// DECORATIVE
//   Bridge:           tile (3,  36) — 96×48 px  (over pond edge)
//   Stairs:           tile (27, 36) — 32×64 px  (leads down from main path)

export const STRUCTURES: StructurePlacement[] = [
  // North cluster
  { key: AssetKeys.HOUSE_1, tileX: 10, tileY:  5, pxW:  80, pxH: 112, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.HOUSE_2, tileX: 20, tileY:  5, pxW: 128, pxH: 112, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.HOUSE_1, tileX: 35, tileY:  5, pxW:  80, pxH: 112, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.CHURCH,  tileX: 48, tileY:  5, pxW: 128, pxH: 112, depth: DEPTH_STRUCTURE },
  // South cluster
  { key: AssetKeys.HOUSE_2, tileX: 20, tileY: 38, pxW: 128, pxH: 112, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.HOUSE_1, tileX: 45, tileY: 40, pxW:  80, pxH: 112, depth: DEPTH_STRUCTURE },
  // Decorative
  { key: AssetKeys.BRIDGE,  tileX: 10, tileY: 36, pxW:  96, pxH:  48, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.STAIRS,  tileX: 27, tileY: 36, pxW:  32, pxH:  64, depth: DEPTH_STRUCTURE },
]

// ─── TREE KEY SEQUENCES ────────────────────────────────────────────────────
// Must be declared BEFORE the TREES array below: `const` bindings are not
// hoisted, so referencing them earlier in the module throws a
// "Cannot access '<name>' before initialization" reference error.
const TILE_ROW_TREES_TOP   = [AssetKeys.TREE_1, AssetKeys.TREE_2, AssetKeys.TREE_3, AssetKeys.TREE_2]
const TILE_ROW_TREES_BOT   = [AssetKeys.TREE_3, AssetKeys.TREE_1, AssetKeys.TREE_2, AssetKeys.TREE_3]
const TILE_COL_TREES_LEFT  = [AssetKeys.TREE_2, AssetKeys.TREE_3, AssetKeys.TREE_1, AssetKeys.TREE_2]
const TILE_COL_TREES_RIGHT = [AssetKeys.TREE_1, AssetKeys.TREE_3, AssetKeys.TREE_2, AssetKeys.TREE_1]

// ─── TREE BORDER + INTERIOR ─────────────────────────────────────────────────
// Tree positions are top-left tile of each 3×3 (48×48 px) tree sprite.
// The border is 2–3 trees deep on each edge; interior clusters fill gaps.
export const TREES: TilePlacement[] = [
  // ── TOP border (rows 0–3) ──────────────────────────────────────────
  ..._row(0,  3,  TILE_ROW_TREES_TOP),
  // ── BOTTOM border (rows 58–61) ────────────────────────────────────
  ..._row(0, 58, TILE_ROW_TREES_BOT),
  // ── LEFT border (col 0–3, every 3 rows) ──────────────────────────
  ..._col(0,  4, TILE_COL_TREES_LEFT),
  // ── RIGHT border (col 74–77) ─────────────────────────────────────
  ..._col(74, 4, TILE_COL_TREES_RIGHT),

  // ── Interior clusters — north area (above main road) ──────────────
  // Between north cluster houses and left border
  { key: AssetKeys.TREE_2, tileX:  3, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX:  6, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX:  3, tileY:  8, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX:  6, tileY:  8, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX:  3, tileY: 12, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX:  6, tileY: 12, depth: DEPTH_STRUCTURE },
  // Between house A and B
  { key: AssetKeys.TREE_1, tileX: 16, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 16, tileY:  8, depth: DEPTH_STRUCTURE },
  // Between house B and C
  { key: AssetKeys.TREE_2, tileX: 29, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 29, tileY:  8, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 32, tileY:  4, depth: DEPTH_STRUCTURE },
  // Between house C and church
  { key: AssetKeys.TREE_1, tileX: 41, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 41, tileY:  8, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 44, tileY:  8, depth: DEPTH_STRUCTURE },
  // Right of church → right border
  { key: AssetKeys.TREE_1, tileX: 57, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 60, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 63, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 57, tileY:  8, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 63, tileY:  8, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 60, tileY: 11, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 66, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 69, tileY:  4, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 69, tileY:  8, depth: DEPTH_STRUCTURE },
  // North of main road, between spurs (open park area — a few trees)
  { key: AssetKeys.TREE_3, tileX:  3, tileY: 16, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX:  6, tileY: 16, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX:  3, tileY: 20, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX:  6, tileY: 22, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 48, tileY: 17, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 54, tileY: 17, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 60, tileY: 17, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 66, tileY: 17, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 69, tileY: 17, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 54, tileY: 21, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 60, tileY: 21, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 66, tileY: 21, depth: DEPTH_STRUCTURE },

  // ── Interior clusters — south area (below main road) ──────────────
  // Left of south spur
  { key: AssetKeys.TREE_2, tileX:  3, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX:  6, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX:  3, tileY: 36, depth: DEPTH_STRUCTURE },
  // Right of south spur, north side
  { key: AssetKeys.TREE_1, tileX: 40, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 45, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 51, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 57, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 63, tileY: 31, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 69, tileY: 31, depth: DEPTH_STRUCTURE },
  // Around south houses
  { key: AssetKeys.TREE_1, tileX: 16, tileY: 36, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 29, tileY: 46, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 29, tileY: 51, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 32, tileY: 51, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 51, tileY: 36, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 54, tileY: 40, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 54, tileY: 45, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 57, tileY: 45, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 60, tileY: 36, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 63, tileY: 40, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 66, tileY: 36, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 69, tileY: 40, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 69, tileY: 45, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_1, tileX: 63, tileY: 51, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX: 66, tileY: 51, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX: 69, tileY: 51, depth: DEPTH_STRUCTURE },
  // Around pond (left side)
  { key: AssetKeys.TREE_1, tileX:  3, tileY: 42, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_2, tileX:  3, tileY: 48, depth: DEPTH_STRUCTURE },
  { key: AssetKeys.TREE_3, tileX:  3, tileY: 54, depth: DEPTH_STRUCTURE },
]

// ─── WATER POND (bottom-left) ───────────────────────────────────────────────
// Irregular oval shape approximated with tiles: cols 7–18, rows 40–54
export const WATER_REGION = {
  tileX:  7,
  tileY: 40,
  tilesW: 12,
  tilesH: 14,
}

// ─── FENCES ────────────────────────────────────────────────────────────────
// Runs of fence tiles placed around houses and along path edges.
// lenH = number of horizontal tiles; lenV = vertical tiles.
export const FENCES: FenceRun[] = [
  // North of house A — separates it from path
  { key: AssetKeys.FENCE_1, x: 10, y: 13, lenH: 5, lenV: 0, depth: DEPTH_DECORATION },
  // East of house A
  { key: AssetKeys.FENCE_2, x: 15, y: 13, lenH: 0, lenV: 4, depth: DEPTH_DECORATION },
  // North of house B
  { key: AssetKeys.FENCE_1, x: 20, y: 13, lenH: 8, lenV: 0, depth: DEPTH_DECORATION },
  // North of house C
  { key: AssetKeys.FENCE_1, x: 35, y: 13, lenH: 5, lenV: 0, depth: DEPTH_DECORATION },
  // Along south spur east side (decorative border)
  { key: AssetKeys.FENCE_2, x: 38, y: 29, lenH: 0, lenV: 8, depth: DEPTH_DECORATION },
  // Around south house D (north side)
  { key: AssetKeys.FENCE_1, x: 20, y: 36, lenH: 8, lenV: 0, depth: DEPTH_DECORATION },
  // Around south house E (north side)
  { key: AssetKeys.FENCE_1, x: 45, y: 38, lenH: 5, lenV: 0, depth: DEPTH_DECORATION },
]

// ─── GRASS DETAILS ─────────────────────────────────────────────────────────
// Dense scatter across all open green areas — avoids roads, structures, water.
// All 6 grass detail variants used.
export const GRASS_DETAILS: TilePlacement[] = buildGrassDetails()

function buildGrassDetails(): TilePlacement[] {
  const K = AssetKeys
  const D = DEPTH_DECORATION
  // Explicit hand-placed positions for natural feel
  // Format: [tx, ty, variant 1-6]
  const pts: Array<[number, number, number]> = [
    // Top-left open area (cols 3–9, rows 4–26)
    [3,4,1],[4,6,3],[5,9,2],[6,12,4],[4,15,5],[5,18,1],[4,21,3],[5,24,6],
    [7,5,2],[8,8,4],[9,11,1],[7,14,3],[8,17,5],[9,20,2],[7,23,4],[8,25,6],
    // Between top cluster and right border (cols 57–73, rows 4–26)
    [57,5,1],[60,5,3],[63,5,5],[66,5,2],[69,5,4],[72,5,6],
    [57,10,2],[60,10,4],[63,10,1],[66,10,3],[69,10,5],[72,10,1],
    [57,14,3],[60,14,5],[63,14,2],[66,14,4],[69,14,6],[72,14,3],
    [57,18,4],[60,18,1],[63,18,3],[66,18,5],[69,18,2],[72,18,4],
    [57,22,5],[60,22,2],[63,22,4],[66,22,6],[69,22,1],[72,22,3],
    // Middle corridor (cols 29–43, rows 16–26) — open park
    [29,16,1],[31,16,3],[33,16,5],[38,16,2],[40,16,4],[42,16,6],
    [29,19,3],[31,20,5],[33,21,2],[38,19,4],[40,20,6],[42,21,1],
    [29,23,2],[31,24,4],[33,25,6],[38,22,1],[40,23,3],[42,24,5],
    // South-left (cols 3–19, rows 29–57)
    [3,29,1],[5,30,3],[7,31,5],[9,32,2],[11,33,4],[13,34,6],
    [3,33,2],[5,34,4],[7,35,1],[9,36,3],[11,37,5],[13,38,2],
    [3,37,3],[5,38,5],[7,55,1],[9,55,3],[11,55,5],[13,55,2],
    [15,30,4],[17,31,6],[19,32,1],[15,35,3],[17,36,5],[19,37,2],
    [15,42,4],[17,43,6],[19,44,1],[15,47,3],[17,48,5],[19,49,2],
    [15,52,4],[17,53,6],[19,54,1],
    // South-right (cols 40–73, rows 29–57)
    [40,29,1],[43,29,3],[46,29,5],[49,29,2],[52,29,4],[55,29,6],
    [58,29,1],[61,29,3],[64,29,5],[67,29,2],[70,29,4],[73,29,6],
    [40,34,2],[43,34,4],[46,34,6],[49,34,1],[52,34,3],[55,34,5],
    [58,34,2],[61,34,4],[64,34,6],[67,34,1],[70,34,3],[73,34,5],
    [40,46,3],[43,47,5],[46,48,2],[49,49,4],[52,50,6],[55,51,1],
    [58,46,3],[61,47,5],[64,48,2],[67,49,4],[70,50,6],[73,51,1],
    [40,54,4],[43,54,6],[46,54,1],[49,54,3],[52,54,5],[55,54,2],
    [58,54,4],[61,54,6],[64,54,1],[67,54,3],[70,54,5],[73,54,2],
    // South house areas — scattered between structures
    [29,36,1],[31,37,3],[33,38,5],[29,40,2],[31,41,4],[33,42,6],
    [29,46,3],[31,47,5],[33,48,2],
  ]

  const detailMap: Record<number, string> = {
    1: K.GRASS_DETAIL_1, 2: K.GRASS_DETAIL_2, 3: K.GRASS_DETAIL_3,
    4: K.GRASS_DETAIL_4, 5: K.GRASS_DETAIL_5, 6: K.GRASS_DETAIL_6,
  }

  return pts
    .filter(([tx, ty]) => tx < MAP_TILES_W && ty < MAP_TILES_H)
    .map(([tx, ty, v]) => ({
      key: detailMap[v]!,
      tileX: tx,
      tileY: ty,
      depth: D,
    }))
}

// ─── GROUND DETAILS (path edge pebbles) ────────────────────────────────────
export function getRoadEdgeTiles(): TilePlacement[] {
  const edges: TilePlacement[] = []
  const K = AssetKeys

  // Main H road edges
  for (let tx = 0; tx < MAP_TILES_W; tx++) {
    edges.push({ key: K.GROUND_DETAIL_1, tileX: tx, tileY: H_ROAD_ROW - 1, depth: DEPTH_ROAD })
    edges.push({ key: K.GROUND_DETAIL_2, tileX: tx, tileY: H_ROAD_ROW + 2, depth: DEPTH_ROAD })
  }
  // Main V road edges
  for (let ty = 0; ty < MAP_TILES_H; ty++) {
    edges.push({ key: K.GROUND_DETAIL_3, tileX: V_ROAD_COL - 1,     tileY: ty, depth: DEPTH_ROAD })
    edges.push({ key: K.GROUND_DETAIL_4, tileX: V_ROAD_COL + 2, tileY: ty, depth: DEPTH_ROAD })
  }
  // North spur edges
  for (let tx = SPUR_H_COL_START; tx <= SPUR_H_COL_END; tx++) {
    edges.push({ key: K.GROUND_DETAIL_5, tileX: tx, tileY: SPUR_H_ROW - 1, depth: DEPTH_ROAD })
    edges.push({ key: K.GROUND_DETAIL_1, tileX: tx, tileY: SPUR_H_ROW + 2, depth: DEPTH_ROAD })
  }
  // East spur edges
  for (let ty = SPUR_V_ROW_START; ty <= SPUR_V_ROW_END; ty++) {
    edges.push({ key: K.GROUND_DETAIL_2, tileX: SPUR_V_COL - 1,    tileY: ty, depth: DEPTH_ROAD })
    edges.push({ key: K.GROUND_DETAIL_3, tileX: SPUR_V_COL + 2, tileY: ty, depth: DEPTH_ROAD })
  }
  // South spur edges
  for (let ty = SOUTH_SPUR_ROW_START; ty <= SOUTH_SPUR_ROW_END; ty++) {
    edges.push({ key: K.GROUND_DETAIL_4, tileX: SOUTH_SPUR_COL - 1,    tileY: ty, depth: DEPTH_ROAD })
    edges.push({ key: K.GROUND_DETAIL_5, tileX: SOUTH_SPUR_COL + 2, tileY: ty, depth: DEPTH_ROAD })
  }

  return edges
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

/** Generate a full row of trees across the top/bottom border. */
function _row(colStart: number, rowY: number, keys: string[]): TilePlacement[] {
  const result: TilePlacement[] = []
  let ki = 0
  for (let tx = colStart; tx < MAP_TILES_W - 2; tx += 3) {
    result.push({ key: keys[ki % keys.length]!, tileX: tx, tileY: rowY, depth: DEPTH_STRUCTURE })
    ki++
  }
  return result
}

/** Generate a full column of trees down the left/right border. */
function _col(colX: number, _colW: number, keys: string[]): TilePlacement[] {
  const result: TilePlacement[] = []
  let ki = 0
  for (let ty = 0; ty < MAP_TILES_H - 2; ty += 3) {
    result.push({ key: keys[ki % keys.length]!, tileX: colX, tileY: ty, depth: DEPTH_STRUCTURE })
    ki++
  }
  return result
}
