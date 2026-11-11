import { AssetKeys } from '../config/AssetKeys'
import {
  DEPTH_STRUCTURE,
  MAP_TILES_H,
  MAP_TILES_W,
  TILE_SIZE,
} from '../config/GameConfig'
import {
  carveRoadH,
  carveRoadV,
  createMask,
  createRng,
  fillBlob,
  fillRect,
  kindAt,
  setTile,
  surroundWithBank,
  TILE_GRASS,
  TILE_PATH,
  TILE_WATER,
  type TerrainMask,
} from './terrain'

export interface StructurePlacement {
  label: string
  key: string
  tileX: number
  tileY: number
  wTiles: number
  hTiles: number
  /** Solid buildings get collision; the bridge does not. */
  solid: boolean
  /**
   * Rows of the sprite that are roof overhang — walkable up to, not into.
   * Only used when the sprite cannot be measured (see sprite-shape.ts).
   */
  solidInsetTop: number
  /**
   * Horizontal centre of the front door, in texture pixels from the sprite's
   * left edge, measured from the porch/steps in the art. Not every house is
   * symmetric — house 2's door sits 40px in, well left of its centre — so the
   * driveway and the yard gate follow this rather than the footprint centre.
   */
  doorOffsetPx: number
  depth: number
}

export interface TreePlacement {
  key: string
  /** Omitted for single-image trees; set for spritesheet trees. */
  frame?: number
  tileX: number
  tileY: number
  wTiles: number
  hTiles: number
  depth: number
}

export interface FenceRun {
  key: string
  /** Start tile. */
  x: number
  y: number
  /** Horizontal length in tiles (0 = vertical run). */
  lenH: number
  /** Vertical length in tiles (0 = horizontal run). */
  lenV: number
  depth: number
}

export interface TileArea {
  x: number
  y: number
  w: number
  h: number
}

/** Tile → pixel top-left. */
export function tileToPixel(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE, y: ty * TILE_SIZE }
}

// ─── STRUCTURES ────────────────────────────────────────────────────────────
// Footprints are exact tile sizes of the source art:
//   HOUSE 1              80×112 px = 5×7 tiles (Pixeljad)
//   HOUSE 2 / CHURCH    128×112 px = 8×7 tiles (Pixeljad)
//   Cute Fantasy house   96×128 px = 6×8 tiles
//   Cute Fantasy bridge 144×64  px = 9×4 tiles
// Doors are drawn at the bottom centre of each building, so every building
// faces south and is placed directly above the street it opens onto.
export const STRUCTURES: StructurePlacement[] = [
  // North residential street (row 14): houses face south onto it.
  { label: 'house-a', key: AssetKeys.HOUSE_1, tileX: 14, tileY: 5, wTiles: 5, hTiles: 7, solid: true, solidInsetTop: 2, doorOffsetPx: 40, depth: DEPTH_STRUCTURE },
  { label: 'house-b', key: AssetKeys.HOUSE_2, tileX: 22, tileY: 5, wTiles: 8, hTiles: 7, solid: true, solidInsetTop: 2, doorOffsetPx: 40, depth: DEPTH_STRUCTURE },
  { label: 'house-c', key: AssetKeys.CUTE_HOUSE, tileX: 31, tileY: 4, wTiles: 6, hTiles: 8, solid: true, solidInsetTop: 4, doorOffsetPx: 48, depth: DEPTH_STRUCTURE },
  // Church sits on its own path north of the main road.
  { label: 'church', key: AssetKeys.CHURCH, tileX: 48, tileY: 5, wTiles: 8, hTiles: 7, solid: true, solidInsetTop: 2, doorOffsetPx: 64, depth: DEPTH_STRUCTURE },
  // South-east street (row 46).
  { label: 'house-d', key: AssetKeys.HOUSE_2, tileX: 44, tileY: 37, wTiles: 8, hTiles: 7, solid: true, solidInsetTop: 2, doorOffsetPx: 40, depth: DEPTH_STRUCTURE },
  { label: 'house-e', key: AssetKeys.HOUSE_1, tileX: 55, tileY: 37, wTiles: 5, hTiles: 7, solid: true, solidInsetTop: 2, doorOffsetPx: 40, depth: DEPTH_STRUCTURE },
  // South-west, above the pond street.
  { label: 'house-f', key: AssetKeys.HOUSE_1, tileX: 8, tileY: 35, wTiles: 5, hTiles: 7, solid: true, solidInsetTop: 2, doorOffsetPx: 40, depth: DEPTH_STRUCTURE },
  // East park, on its own spur off the main road.
  { label: 'house-g', key: AssetKeys.CUTE_HOUSE, tileX: 59, tileY: 17, wTiles: 6, hTiles: 8, solid: true, solidInsetTop: 4, doorOffsetPx: 48, depth: DEPTH_STRUCTURE },
  // Bridge across the pond to the island (walkable, so not solid).
  { label: 'bridge', key: AssetKeys.CUTE_BRIDGE, tileX: 11, tileY: 52, wTiles: 9, hTiles: 4, solid: false, solidInsetTop: 0, doorOffsetPx: 0, depth: DEPTH_STRUCTURE },
]

const BRIDGE_TILES = { x: 11, y: 52, w: 9, h: 4 }

// ─── FARM ──────────────────────────────────────────────────────────────────
/** Fenced pasture holding the farm animals, south-east of the crossroads. */
export const PASTURE: TileArea = { x: 46, y: 48, w: 12, h: 8 }

/** Gap in the pasture's north fence so the player can walk in. */
export const PASTURE_GATE = { x: 50, w: 2 }

/** Vegetable patch beside the pasture. */
export const GARDEN: TileArea = { x: 59, y: 49, w: 4, h: 3 }

function inArea(area: TileArea, tx: number, ty: number): boolean {
  return tx >= area.x && ty >= area.y && tx < area.x + area.w && ty < area.y + area.h
}

export function isInPasture(tx: number, ty: number): boolean {
  return inArea(PASTURE, tx, ty)
}

export function isInGarden(tx: number, ty: number): boolean {
  return inArea(GARDEN, tx, ty)
}

// ─── ROADS ────────────────────────────────────────────────────────────────
// `thickness` is in tiles; the carving routine drifts the edges by ±1 tile so
// paths have an uneven, hand-drawn outline instead of dead-straight borders.
interface RoadSegment {
  dir: 'h' | 'v'
  at: number
  from: number
  to: number
  thickness: number
  seed: number
}

const ROADS: RoadSegment[] = [
  // Main east-west road and north-south road (the crossroads).
  { dir: 'h', at: 30, from: 0, to: MAP_TILES_W - 1, thickness: 2, seed: 0.4 },
  { dir: 'v', at: 40, from: 0, to: MAP_TILES_H - 1, thickness: 2, seed: 2.1 },
  // North residential street, running west to the church path.
  { dir: 'h', at: 14, from: 12, to: 54, thickness: 2, seed: 1.3 },
  { dir: 'v', at: 16, from: 14, to: 30, thickness: 2, seed: 0.9 },
  { dir: 'v', at: 54, from: 14, to: 30, thickness: 2, seed: 3.3 },
  // South-east street and its link back to the main road.
  { dir: 'h', at: 46, from: 40, to: 68, thickness: 2, seed: 2.7 },
  { dir: 'v', at: 66, from: 30, to: 46, thickness: 2, seed: 1.1 },
  // Pond approach.
  { dir: 'v', at: 24, from: 31, to: 44, thickness: 2, seed: 4.2 },
  { dir: 'h', at: 44, from: 8, to: 24, thickness: 2, seed: 5.6 },
  // Spur to the east park house.
  { dir: 'v', at: 62, from: 25, to: 30, thickness: 2, seed: 6.1 },
]

// Open dirt clearings at the junctions — the reference towns all widen at
// junctions rather than crossing two narrow strips.
interface Plaza {
  x: number
  y: number
  rx: number
  ry: number
  seed: number
}

const PLAZAS: Plaza[] = [
  { x: 40, y: 30, rx: 5, ry: 3.6, seed: 0.6 }, // central crossroads
  { x: 16, y: 14, rx: 3.4, ry: 2.4, seed: 2.2 }, // north junction
  { x: 52, y: 15, rx: 3.2, ry: 2.2, seed: 6.6 }, // church forecourt
  { x: 66, y: 46, rx: 3.4, ry: 3, seed: 4.4 }, // south-east junction
  { x: 24, y: 44, rx: 3, ry: 2.4, seed: 5.2 }, // pond approach
]

// ─── POND ─────────────────────────────────────────────────────────────────
const POND = { x: 20, y: 53, rx: 8.5, ry: 5.2, seed: 1.4, wobble: 0.16 }
const ISLAND = { x: 22, y: 53, rx: 3, ry: 2.6, seed: 2.9, wobble: 0.1 }

/** The tile column the front door sits on. */
export function doorColumn(structure: StructurePlacement): number {
  return structure.tileX + Math.floor(structure.doorOffsetPx / TILE_SIZE)
}

/**
 * Carve a short path from a building's door down to the nearest street.
 *
 * Three tiles wide: the same width as the gap left in the yard fence, so the
 * driveway lines up with the gate instead of being pinched to two tiles.
 */
function carveDriveway(mask: TerrainMask, structure: StructurePlacement): void {
  const doorCol = doorColumn(structure)
  const startRow = structure.tileY + structure.hTiles

  for (let i = 0; i <= 5; i++) {
    const ty = startRow + i
    if (ty >= MAP_TILES_H) break

    const alreadyConnected =
      kindAt(mask, doorCol, ty) === TILE_PATH ||
      kindAt(mask, doorCol - 1, ty) === TILE_PATH ||
      kindAt(mask, doorCol + 1, ty) === TILE_PATH

    setTile(mask, doorCol, ty, TILE_PATH)
    setTile(mask, doorCol - 1, ty, TILE_PATH)
    setTile(mask, doorCol + 1, ty, TILE_PATH)

    if (alreadyConnected) break
  }
}

function buildTerrain(): TerrainMask {
  const mask = createMask()

  for (const road of ROADS) {
    if (road.dir === 'h') {
      carveRoadH(mask, road.at, road.from, road.to, road.thickness, road.seed)
    } else {
      carveRoadV(mask, road.at, road.from, road.to, road.thickness, road.seed)
    }
  }

  for (const plaza of PLAZAS) {
    fillBlob(mask, plaza.x, plaza.y, plaza.rx, plaza.ry, TILE_PATH, plaza.seed, 0.2)
  }

  for (const structure of STRUCTURES) {
    if (structure.solid) carveDriveway(mask, structure)
  }

  // Water last so it can never be punched through by a road, then the island
  // and the bridge deck, then the shoreline ring.
  fillBlob(mask, POND.x, POND.y, POND.rx, POND.ry, TILE_WATER, POND.seed, POND.wobble)
  fillBlob(mask, ISLAND.x, ISLAND.y, ISLAND.rx, ISLAND.ry, TILE_GRASS, ISLAND.seed, ISLAND.wobble)
  fillRect(mask, BRIDGE_TILES.x, BRIDGE_TILES.y, BRIDGE_TILES.w, BRIDGE_TILES.h, TILE_PATH)
  surroundWithBank(mask)

  return mask
}

export const TERRAIN: TerrainMask = buildTerrain()

// ─── FENCES ───────────────────────────────────────────────────────────────
/**
 * One continuous fence line per street frontage, broken only by a three-tile
 * gate in front of each door, plus the pasture perimeter. Short per-house
 * stubs read as scattered crates; a long unbroken line reads as a boundary.
 */
function buildFences(): FenceRun[] {
  const runs: FenceRun[] = []
  const rows = new Map<number, StructurePlacement[]>()

  for (const structure of STRUCTURES) {
    if (!structure.solid || structure.key === AssetKeys.CHURCH) continue
    const row = structure.tileY + structure.hTiles
    const houses = rows.get(row) ?? []
    houses.push(structure)
    rows.set(row, houses)
  }

  for (const [row, houses] of rows) {
    houses.sort((a, b) => a.tileX - b.tileX)

    const first = houses[0]!
    const last = houses[houses.length - 1]!
    const startX = first.tileX - 1
    const endX = last.tileX + last.wTiles

    // The gate is three tiles wide, centred on the door, so no fence post ever
    // stands in front of a front door.
    const gates = houses.map(house => {
      const doorCol = doorColumn(house)
      return [doorCol - 1, doorCol + 1] as const
    })

    let runStart = startX
    for (let x = startX; x <= endX + 1; x++) {
      const inGate = gates.some(([from, to]) => x >= from && x <= to)

      if (inGate || x > endX) {
        const length = x - runStart
        if (length >= 2) {
          runs.push({
            key: AssetKeys.FENCE_1,
            x: runStart,
            y: row,
            lenH: length,
            lenV: 0,
            depth: DEPTH_STRUCTURE,
          })
        }
        runStart = x + 1
      }
    }
  }

  // ── Pasture perimeter, with a two-tile gate in the north fence ──────────
  const top = PASTURE.y
  const bottom = PASTURE.y + PASTURE.h - 1
  const left = PASTURE.x
  const right = PASTURE.x + PASTURE.w - 1
  const gateEnd = PASTURE_GATE.x + PASTURE_GATE.w

  runs.push(
    { key: AssetKeys.FENCE_1, x: left, y: top, lenH: PASTURE_GATE.x - left, lenV: 0, depth: DEPTH_STRUCTURE },
    { key: AssetKeys.FENCE_1, x: gateEnd, y: top, lenH: right - gateEnd + 1, lenV: 0, depth: DEPTH_STRUCTURE },
    { key: AssetKeys.FENCE_1, x: left, y: bottom, lenH: PASTURE.w, lenV: 0, depth: DEPTH_STRUCTURE },
    { key: AssetKeys.FENCE_1, x: left, y: top, lenH: 0, lenV: PASTURE.h, depth: DEPTH_STRUCTURE },
    { key: AssetKeys.FENCE_1, x: right, y: top, lenH: 0, lenV: PASTURE.h, depth: DEPTH_STRUCTURE },
  )

  return runs
}

export const FENCES: FenceRun[] = buildFences()

// ─── VILLAGE PROPS ────────────────────────────────────────────────────────
// Street furniture and a market row from the 16×16 Pixel Medieval Market Props
// pack. Purely additive: a prop is only ever placed on bare grass that no
// building, fence, path, animal or crop already uses, so the existing layout
// does not move. `solid` props get a collision box (stalls, the well, barrels);
// the small goods lying on the ground are decorative only.
export interface VillagePropPlacement {
  key: string
  tileX: number
  tileY: number
  scale: number
  solid: boolean
  depth: number
}

interface PropSpec {
  key: string
  x: number
  y: number
  solid?: boolean
}

/**
 * World scale per prop.
 *
 * The market pack draws a whole stall, well or barrel inside one 16×16 cell —
 * the same box as a single grass tile — so at 1× they read as toys beside the
 * 5–8 tile houses and a player who is two tiles tall. These scales put them at
 * the size the town implies: market furniture is 2× (32 px, the height of a
 * person), hand props like benches and barrels 1.5×, and produce lying on the
 * ground stays at 1×.
 *
 * Only 1, 1.5 and 2 are used, so the pixel grid never lands on a third of a
 * pixel.
 */
const PROP_SCALE: Record<string, number> = {
  // Only the shop stalls keep the statement size — they are the thing that
  // should read as a shop from across the street.
  [AssetKeys.MARKET_STALL_RED]: 2.5,
  [AssetKeys.MARKET_STALL_GREEN]: 2.5,
  [AssetKeys.MARKET_STALL_BLUE]: 2.5,

  // Everything else from the pack is a size down, so the furniture supports
  // the stalls instead of competing with them.
  [AssetKeys.MARKET_TENT]: 2,
  [AssetKeys.MARKET_WELL]: 2,
  [AssetKeys.MARKET_HAY_BALE]: 2,
  [AssetKeys.MARKET_LAMP]: 2,
  [AssetKeys.MARKET_TABLE]: 2,

  [AssetKeys.MARKET_CART]: 1.5,
  [AssetKeys.MARKET_WHEELBARROW]: 1.5,
  [AssetKeys.MARKET_BENCH]: 1.5,
  [AssetKeys.MARKET_SIGN_POST]: 1.5,
  [AssetKeys.MARKET_SIGN_BREAD]: 1.5,
  [AssetKeys.MARKET_SIGN_INN]: 1.5,
  [AssetKeys.MARKET_SIGN_POTION]: 1.5,
  [AssetKeys.MARKET_BANNER_RED]: 1.5,
  [AssetKeys.MARKET_BANNER_BLUE]: 1.5,
  [AssetKeys.MARKET_BARREL]: 1.5,
  [AssetKeys.MARKET_CRATE]: 1.5,
  [AssetKeys.MARKET_CHEST]: 1.5,
  [AssetKeys.MARKET_SACK_GRAIN]: 1.5,
  [AssetKeys.MARKET_BUCKET]: 1.5,
}

const DEFAULT_PROP_SCALE = 1

/** Tiles a prop occupies in each direction, counted from its anchor tile. */
export function propTileSpan(scale: number): number {
  return Math.max(1, Math.ceil(scale))
}

/** The world scale a prop key is drawn at. */
export function propScale(key: string): number {
  return PROP_SCALE[key] ?? DEFAULT_PROP_SCALE
}

/**
 * Every tile a prop's sprite covers. Sprites are anchored on the bottom of
 * their tile and grow up and to the right, so a 2× stall covers two columns
 * and its own row plus the one above.
 */
export function propCoversTile(
  prop: { tileX: number; tileY: number; scale: number },
  tx: number,
  ty: number,
): boolean {
  const span = propTileSpan(prop.scale)
  return (
    tx >= prop.tileX &&
    tx < prop.tileX + span &&
    ty > prop.tileY - span &&
    ty <= prop.tileY
  )
}

/**
 * Hand-placed props, in placement order (first come, first served). The market
 * sits on the grass south of the main road just east of the crossroads — close
 * enough to read as a square, far enough not to crowd the junction.
 */
const PLACED_PROPS: readonly PropSpec[] = [
  // ── Market row, facing the main road ──────────────────────────────────
  // Shops are spread across the village instead of crowded into one square:
  // a stall on the main road east of the crossroads, one on the north street,
  // one on the pond approach, and the merchant's tent out in the east park.
  // Nothing is laid out on the grass — the goods a stall sells are drawn on
  // the stall itself, the way the reference towns do it.
  { key: AssetKeys.MARKET_STALL_RED, x: 46, y: 33, solid: true },
  { key: AssetKeys.MARKET_TABLE, x: 49, y: 34, solid: true },
  { key: AssetKeys.MARKET_CART, x: 43, y: 34, solid: true },

  { key: AssetKeys.MARKET_STALL_GREEN, x: 50, y: 17, solid: true },
  { key: AssetKeys.MARKET_CRATE, x: 54, y: 18 },

  { key: AssetKeys.MARKET_STALL_BLUE, x: 27, y: 45, solid: true },
  { key: AssetKeys.MARKET_BARREL, x: 31, y: 45 },

  { key: AssetKeys.MARKET_TENT, x: 63, y: 26, solid: true },
  { key: AssetKeys.MARKET_BENCH, x: 60, y: 27 },

  // ── Street furniture ─────────────────────────────────────────────────
  // These are searched into place (see `NEAR_OFFSETS`) so they still land if
  // the road's uneven edge happens to cover the preferred tile.
  // Village well by the north junction, in sight of the crossroads.
  // A signpost at the crossroads, the village well by the north junction, and
  // a bench and bucket at the pond.
  { key: AssetKeys.MARKET_SIGN_POST, x: 37, y: 34 },
  { key: AssetKeys.MARKET_SIGN_BREAD, x: 42, y: 35 },
  { key: AssetKeys.MARKET_WELL, x: 20, y: 18, solid: true },
  { key: AssetKeys.MARKET_BENCH, x: 14, y: 46 },
  { key: AssetKeys.MARKET_BUCKET, x: 16, y: 47 },

  // ── Farm yard beside the pasture and the vegetable patch ─────────────
  { key: AssetKeys.MARKET_HAY_BALE, x: 44, y: 49, solid: true },
  { key: AssetKeys.MARKET_WHEELBARROW, x: 41, y: 48 },
]

// Lamp posts follow the main roads. Each one tries a few rows/columns in turn
// so it settles on the grass edge no matter how the road's outline drifted.
const LAMP_ROWS: readonly number[] = [28, 27, 32, 33]
const LAMP_COLS: readonly number[] = [38, 37, 42, 43]

/** Nearest-first search order for street furniture, out to two tiles. */
const NEAR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, -1], [1, -1], [-1, 1],
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [3, 0], [-3, 0], [0, 3], [0, -3],
]

function isOnStructure(tx: number, ty: number): boolean {
  return STRUCTURES.some(
    structure =>
      tx >= structure.tileX &&
      ty >= structure.tileY &&
      tx < structure.tileX + structure.wTiles &&
      ty < structure.tileY + structure.hTiles,
  )
}

function buildVillageProps(): VillagePropPlacement[] {
  const props: VillagePropPlacement[] = []
  const occupied = new Set<string>()

  // A prop now covers up to 2×2 tiles, so every tile under its sprite has to
  // be free — otherwise a stall's awning would hang over the road, a fence or
  // a neighbour's counter.
  const canPlace = (key: string, tx: number, ty: number): boolean => {
    const span = propTileSpan(propScale(key))

    for (let dx = 0; dx < span; dx++) {
      for (let dy = 0; dy < span; dy++) {
        const px = tx + dx
        const py = ty - dy

        if (px < 1 || py < 1 || px > MAP_TILES_W - 2 || py > MAP_TILES_H - 2) return false
        if (occupied.has(`${px},${py}`)) return false
        if (kindAt(TERRAIN, px, py) !== TILE_GRASS) return false
        if (isFenceTile(px, py)) return false
        if (isInPasture(px, py) || isInGarden(px, py)) return false
        if (isOnStructure(px, py)) return false
      }
    }

    return true
  }

  const add = (key: string, tx: number, ty: number, solid = false): boolean => {
    if (!canPlace(key, tx, ty)) return false

    const scale = propScale(key)
    const span = propTileSpan(scale)
    props.push({ key, tileX: tx, tileY: ty, scale, solid, depth: DEPTH_STRUCTURE })

    for (let dx = 0; dx < span; dx++) {
      for (let dy = 0; dy < span; dy++) {
        occupied.add(`${tx + dx},${ty - dy}`)
      }
    }

    return true
  }

  // Street furniture may nudge up to two tiles to find clear grass; the market
  // row and farm yard must sit exactly where they were laid out, or the
  // composition falls apart.
  const NEARBY_KEYS: readonly string[] = [
    AssetKeys.MARKET_WELL,
    AssetKeys.MARKET_BENCH,
    AssetKeys.MARKET_BUCKET,
    AssetKeys.MARKET_SIGN_INN,
    AssetKeys.MARKET_SIGN_POST,
    AssetKeys.MARKET_SIGN_POTION,
    AssetKeys.MARKET_SIGN_BREAD,
    AssetKeys.MARKET_CART,
    AssetKeys.MARKET_STALL_RED,
    AssetKeys.MARKET_STALL_GREEN,
    AssetKeys.MARKET_STALL_BLUE,
    AssetKeys.MARKET_TENT,
    AssetKeys.MARKET_TABLE,
    AssetKeys.MARKET_HAY_BALE,
    AssetKeys.MARKET_WHEELBARROW,
    AssetKeys.MARKET_CRATE,
    AssetKeys.MARKET_BARREL,
  ]

  for (const spec of PLACED_PROPS) {
    if (!NEARBY_KEYS.includes(spec.key)) {
      add(spec.key, spec.x, spec.y, spec.solid)
      continue
    }

    const spot = NEAR_OFFSETS.find(([dx, dy]) => canPlace(spec.key, spec.x + dx, spec.y + dy))
    if (spot) add(spec.key, spec.x + spot[0], spec.y + spot[1], spec.solid)
  }

  // Lamps line the main road, widely spaced, so the street reads as lit rather
  // than studded with posts.
  for (let x = 6; x < MAP_TILES_W - 6; x += 14) {
    const row = LAMP_ROWS.find(y => canPlace(AssetKeys.MARKET_LAMP, x, y))
    if (row !== undefined) add(AssetKeys.MARKET_LAMP, x, row)
  }

  for (let y = 8; y < MAP_TILES_H - 8; y += 14) {
    const col = LAMP_COLS.find(x => canPlace(AssetKeys.MARKET_LAMP, x, y))
    if (col !== undefined) add(AssetKeys.MARKET_LAMP, col, y)
  }

  return props
}

export const VILLAGE_PROPS: VillagePropPlacement[] = buildVillageProps()

/** True when a tree would grow through a market prop's sprite. */
function isVillagePropTile(tx: number, ty: number): boolean {
  return VILLAGE_PROPS.some(prop => propCoversTile(prop, tx, ty))
}

// ─── TREES ────────────────────────────────────────────────────────────────
// Mostly green canopies with the occasional autumn/blossom tree — an even mix
// of all three reads as confetti rather than a forest.
const TREE_KEYS = [
  AssetKeys.TREE_1,
  AssetKeys.TREE_1,
  AssetKeys.TREE_1,
  AssetKeys.TREE_1,
  AssetKeys.TREE_2,
  AssetKeys.TREE_3,
]

/** A tree species and the tile footprint it occupies. */
interface TreeSpecies {
  key: string
  frame?: number
  wTiles: number
  hTiles: number
}

const PIXEL_TREE: TreeSpecies = { key: AssetKeys.TREE_1, wTiles: 3, hTiles: 3 }
// Farm RPG maple: 32×48 frames, frame 3 is the mature tree.
const MAPLE: TreeSpecies = { key: AssetKeys.MAPLE_TREE, frame: 3, wTiles: 2, hTiles: 3 }
// Cute Fantasy oak: a single 64×80 sprite.
const OAK: TreeSpecies = { key: AssetKeys.OAK_TREE, wTiles: 4, hTiles: 5 }

// Woodland pockets. Trees are packed inside these and left sparse elsewhere, so
// the town gets real groves instead of an evenly salted field of single trees.
const TREE_GROVES: ReadonlyArray<{ x: number; y: number; r: number }> = [
  { x: 7, y: 6, r: 7 },
  { x: 8, y: 21, r: 7 },
  { x: 13, y: 27, r: 4 },
  { x: 30, y: 23, r: 5 },
  { x: 38, y: 8, r: 5 },
  { x: 45, y: 24, r: 4 },
  { x: 68, y: 9, r: 7 },
  { x: 72, y: 24, r: 5 },
  { x: 4, y: 52, r: 5 },
  { x: 33, y: 54, r: 6 },
  { x: 42, y: 55, r: 5 },
  { x: 64, y: 54, r: 6 },
  { x: 74, y: 40, r: 6 },
  { x: 30, y: 38, r: 4 },
  { x: 62, y: 32, r: 4 },
]

function isFenceTile(tx: number, ty: number): boolean {
  for (const fence of FENCES) {
    if (fence.lenH > 0) {
      if (ty !== fence.y) continue
      if (tx >= fence.x && tx < fence.x + fence.lenH) return true
    } else {
      if (tx !== fence.x) continue
      if (ty >= fence.y && ty < fence.y + fence.lenV) return true
    }
  }
  return false
}

function pickSpecies(rng: () => number): TreeSpecies {
  const roll = rng()
  if (roll < 0.74) {
    return { ...PIXEL_TREE, key: TREE_KEYS[Math.floor(rng() * TREE_KEYS.length)]! }
  }
  if (roll < 0.9) return MAPLE
  return OAK
}

/**
 * Trees are scattered on a jittered lattice: dense along the map borders and
 * inside woodland pockets, sparse between. Every placement is rejected if it
 * would land on a path, the pond, a building, a fence, the pasture or the
 * vegetable garden.
 */
function buildTrees(): TreePlacement[] {
  const rng = createRng(1337)
  const trees: TreePlacement[] = []

  const canPlace = (tx: number, ty: number, wTiles: number, hTiles: number): boolean => {
    for (let dy = 0; dy < hTiles; dy++) {
      for (let dx = 0; dx < wTiles; dx++) {
        const px = tx + dx
        const py = ty + dy
        if (kindAt(TERRAIN, px, py) !== TILE_GRASS) return false
        if (isFenceTile(px, py)) return false
        if (isVillagePropTile(px, py)) return false
        if (isInPasture(px, py) || isInGarden(px, py)) return false
      }
    }

    for (const structure of STRUCTURES) {
      const overlaps =
        tx + wTiles > structure.tileX - 1 &&
        tx < structure.tileX + structure.wTiles + 1 &&
        ty + hTiles > structure.tileY - 1 &&
        ty < structure.tileY + structure.hTiles + 1
      if (overlaps) return false
    }

    return true
  }

  for (let gy = 1; gy < MAP_TILES_H - 6; gy += 3) {
    for (let gx = 1; gx < MAP_TILES_W - 6; gx += 3) {
      const tx = gx + Math.floor(rng() * 3) - 1
      const ty = gy + Math.floor(rng() * 3) - 1

      if (tx < 1 || ty < 1 || tx > MAP_TILES_W - 6 || ty > MAP_TILES_H - 6) continue

      const species = pickSpecies(rng)
      if (!canPlace(tx, ty, species.wTiles, species.hTiles)) continue

      const onBorder =
        tx < 6 || ty < 6 || tx > MAP_TILES_W - 7 || ty > MAP_TILES_H - 7
      const inGrove = TREE_GROVES.some(
        grove => Math.hypot(tx - grove.x, ty - grove.y) <= grove.r,
      )
      const chance = onBorder ? 0.95 : inGrove ? 0.8 : 0.06
      if (rng() > chance) continue

      trees.push({
        key: species.key,
        frame: species.frame,
        tileX: tx,
        tileY: ty,
        wTiles: species.wTiles,
        hTiles: species.hTiles,
        depth: DEPTH_STRUCTURE,
      })
    }
  }

  return trees
}

export const TREES: TreePlacement[] = buildTrees()
