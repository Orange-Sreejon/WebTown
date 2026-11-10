import { AssetKeys } from '../config/AssetKeys'
import { DEPTH_DECORATION } from '../config/GameConfig'
import {
  createRng,
  kindAt,
  TILE_GRASS,
  TILE_PATH,
  type TerrainMask,
} from './terrain'
import {
  FENCES,
  GARDEN,
  isInGarden,
  isInPasture,
  PASTURE,
  STRUCTURES,
} from './town-layout'

/**
 * Props taken from `Cute_Fantasy_Free/Outdoor decoration/Outdoor_Decor_Free.png`.
 *
 * That file is a 7 column × 12 row grid of 16×16 cells, so a frame index is
 * `row * 7 + column`. These constants name the handful that suit a village.
 *
 * Licence: Cute Fantasy Free — non-commercial use, modification allowed,
 * no redistribution of the raw files. See docs/ASSETS.md.
 */
export const CuteFrame = {
  signA: 3,
  signB: 4,
  signC: 5,
  signD: 6,

  flowersGreen: 7,
  flowersYellow: 8,
  flowersWhite: 9,

  bush: 11,
  hedge: 12,
  leafyPlant: 13,

  stump: 14,
  rock: 15,
  boulder: 16,

  wheat: 19,
  wheatTall: 20,
  carrotBunch: 18,
  carrot: 25,

  rockPileA: 21,
  rockPileB: 22,
  rockPileC: 23,
  crystal: 24,
  sunflower: 27,

  log: 49,
  mushroom: 50,

  potRed: 56,
  potYellow: 57,
  potRedTall: 58,
  potOrange: 59,
  potRedDark: 63,
  potOrangeDark: 64,
  potPink: 65,
  potYellowTall: 66,
} as const

const SIGN_FRAMES: readonly number[] = [CuteFrame.signA, CuteFrame.signB, CuteFrame.signC, CuteFrame.signD]
const POT_FRAMES: readonly number[] = [
  CuteFrame.potRed, CuteFrame.potYellow, CuteFrame.potRedTall, CuteFrame.potOrange,
  CuteFrame.potRedDark, CuteFrame.potOrangeDark, CuteFrame.potPink, CuteFrame.potYellowTall,
]
const BUSH_FRAMES: readonly number[] = [CuteFrame.bush, CuteFrame.hedge, CuteFrame.leafyPlant]
const ROCK_FRAMES: readonly number[] = [
  CuteFrame.rock, CuteFrame.boulder, CuteFrame.rockPileA, CuteFrame.rockPileB, CuteFrame.rockPileC,
]
const FLOWER_FRAMES: readonly number[] = [
  CuteFrame.flowersGreen, CuteFrame.flowersYellow, CuteFrame.flowersWhite, CuteFrame.sunflower,
]

export interface FrameProp {
  key: string
  frame: number
  tileX: number
  tileY: number
  /** Footprint in tiles — 1 for a 16px prop, 2 for a 32px animal. */
  sizeTiles: number
  depth: number
}

function prop(frame: number, tileX: number, tileY: number, sizeTiles = 1): FrameProp {
  return {
    key: AssetKeys.CUTE_DECOR,
    frame,
    tileX,
    tileY,
    sizeTiles,
    depth: DEPTH_DECORATION,
  }
}

/** True when the tile falls inside any building footprint. */
function isOnStructure(tx: number, ty: number): boolean {
  return STRUCTURES.some(
    structure =>
      tx >= structure.tileX &&
      ty >= structure.tileY &&
      tx < structure.tileX + structure.wTiles &&
      ty < structure.tileY + structure.hTiles,
  )
}

function isOnFence(tx: number, ty: number): boolean {
  return FENCES.some(fence => {
    if (fence.lenH > 0) {
      return ty === fence.y && tx >= fence.x && tx < fence.x + fence.lenH
    }
    return tx === fence.x && ty >= fence.y && ty < fence.y + fence.lenV
  })
}

function hasPathNeighbour(mask: TerrainMask, tx: number, ty: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const kind = kindAt(mask, tx + dx, ty + dy)
    if (kind === TILE_PATH) return true
  }
  return false
}

/**
 * Vegetable rows inside the garden patch. These are 16×16 tiles, so they are
 * baked into the ground layer rather than drawn as sprites.
 */
export function buildGardenTiles(): FrameProp[] {
  const rng = createRng(99)
  const tiles: FrameProp[] = []

  for (let ty = GARDEN.y; ty < GARDEN.y + GARDEN.h; ty++) {
    for (let tx = GARDEN.x; tx < GARDEN.x + GARDEN.w; tx++) {
      const wheatRow = (ty - GARDEN.y) % 2 === 0
      const frame = wheatRow
        ? (rng() < 0.5 ? CuteFrame.wheat : CuteFrame.wheatTall)
        : (rng() < 0.5 ? CuteFrame.carrot : CuteFrame.carrotBunch)
      tiles.push(prop(frame, tx, ty))
    }
  }

  return tiles
}

/** Flower pots flanking the base of every house. */
export function buildYardPots(mask: TerrainMask): FrameProp[] {
  const props: FrameProp[] = []
  let next = 0

  for (const structure of STRUCTURES) {
    if (!structure.solid || structure.key === AssetKeys.CHURCH) continue

    const row = structure.tileY + structure.hTiles - 1
    const spots: Array<[number, number]> = [
      [structure.tileX - 1, row],
      [structure.tileX + structure.wTiles, row],
    ]

    for (const [tx, ty] of spots) {
      if (kindAt(mask, tx, ty) !== TILE_GRASS) continue
      if (isOnFence(tx, ty)) continue

      props.push(prop(POT_FRAMES[next % POT_FRAMES.length]!, tx, ty))
      next++
    }
  }

  return props
}

/**
 * Outdoor decorations scattered beside paths: signposts, pots, bushes, rock
 * piles, stumps, logs and mushrooms. Placed on a jittered lattice and only
 * ever on bare grass beside a path, so nothing lands in a wall, a fence, the
 * pasture, the garden or the pond.
 */
export function buildCuteDecor(mask: TerrainMask): FrameProp[] {
  const rng = createRng(4242)
  const props: FrameProp[] = []

  for (let gy = 2; gy < mask.height - 4; gy += 5) {
    for (let gx = 2; gx < mask.width - 4; gx += 5) {
      if (rng() > 0.6) continue

      const tx = gx + Math.floor(rng() * 4) - 1
      const ty = gy + Math.floor(rng() * 4) - 1

      if (kindAt(mask, tx, ty) !== TILE_GRASS) continue
      if (!hasPathNeighbour(mask, tx, ty)) continue
      if (isOnStructure(tx, ty) || isOnFence(tx, ty)) continue
      if (isInPasture(tx, ty) || isInGarden(tx, ty)) continue

      const roll = rng()
      let frame: number
      if (roll < 0.2) {
        frame = SIGN_FRAMES[Math.floor(rng() * SIGN_FRAMES.length)]!
      } else if (roll < 0.46) {
        frame = POT_FRAMES[Math.floor(rng() * POT_FRAMES.length)]!
      } else if (roll < 0.68) {
        frame = BUSH_FRAMES[Math.floor(rng() * BUSH_FRAMES.length)]!
      } else if (roll < 0.86) {
        frame = ROCK_FRAMES[Math.floor(rng() * ROCK_FRAMES.length)]!
      } else if (roll < 0.92) {
        frame = CuteFrame.log
      } else if (roll < 0.96) {
        frame = CuteFrame.stump
      } else if (roll < 0.98) {
        frame = CuteFrame.mushroom
      } else {
        frame = FLOWER_FRAMES[Math.floor(rng() * FLOWER_FRAMES.length)]!
      }

      props.push(prop(frame, tx, ty))
    }
  }

  return props
}

/**
 * Farm animals inside the fenced pasture. Frames come from the 2×2, 32×32
 * animal sheets — frames 0 and 2 are the un-mirrored facing frames.
 */
export function buildAnimals(): FrameProp[] {
  const animals: Array<{ key: string; frame: number; tileX: number; tileY: number }> = [
    { key: AssetKeys.CHICKEN, frame: 0, tileX: PASTURE.x + 2, tileY: PASTURE.y + 2 },
    { key: AssetKeys.CHICKEN, frame: 2, tileX: PASTURE.x + 4, tileY: PASTURE.y + 5 },
    { key: AssetKeys.COW, frame: 0, tileX: PASTURE.x + 6, tileY: PASTURE.y + 2 },
    { key: AssetKeys.PIG, frame: 0, tileX: PASTURE.x + 3, tileY: PASTURE.y + 4 },
    { key: AssetKeys.SHEEP, frame: 0, tileX: PASTURE.x + 9, tileY: PASTURE.y + 4 },
  ]

  return animals.map(animal => ({
    key: animal.key,
    frame: animal.frame,
    tileX: animal.tileX,
    tileY: animal.tileY,
    sizeTiles: 2,
    depth: DEPTH_DECORATION,
  }))
}
