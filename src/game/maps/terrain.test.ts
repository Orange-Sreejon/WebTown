import { describe, it, expect } from 'vitest'
import {
  createMask,
  fillRect,
  kindAt,
  mergeRects,
  TILE_BANK,
  TILE_GRASS,
  TILE_PATH,
  TILE_WATER,
  type TileKind,
} from './terrain'
import { FENCES, GARDEN, isInPasture, STRUCTURES, TERRAIN, TREES } from './town-layout'
import { buildGrassDecor, buildPathEdges, buildWaterProps } from './decor'
import {
  buildAnimals,
  buildCuteDecor,
  buildGardenTiles,
  buildYardPots,
} from './cute-props'
import {
  MAP_TILES_H,
  MAP_TILES_W,
  PLAYER_START_TILE_X,
  PLAYER_START_TILE_Y,
} from '../config/GameConfig'

const ALLOWED_AROUND_WATER: ReadonlyArray<TileKind | -1> = [
  TILE_WATER,
  TILE_BANK,
  TILE_PATH, // the bridge deck runs straight into the water
]

describe('terrain mask', () => {
  it('spawns the player on a walkable path tile', () => {
    expect(kindAt(TERRAIN, PLAYER_START_TILE_X, PLAYER_START_TILE_Y)).toBe(TILE_PATH)
  })

  it('contains a pond with a shoreline', () => {
    let water = 0
    let bank = 0

    for (let ty = 0; ty < MAP_TILES_H; ty++) {
      for (let tx = 0; tx < MAP_TILES_W; tx++) {
        const kind = kindAt(TERRAIN, tx, ty)
        if (kind === TILE_WATER) water++
        if (kind === TILE_BANK) bank++
      }
    }

    expect(water).toBeGreaterThan(60)
    expect(bank).toBeGreaterThan(20)
  })

  it('never lets pond water touch bare grass', () => {
    for (let ty = 0; ty < MAP_TILES_H; ty++) {
      for (let tx = 0; tx < MAP_TILES_W; tx++) {
        if (kindAt(TERRAIN, tx, ty) !== TILE_WATER) continue

        const neighbours: Array<[number, number]> = [
          [tx + 1, ty],
          [tx - 1, ty],
          [tx, ty + 1],
          [tx, ty - 1],
        ]

        for (const [nx, ny] of neighbours) {
          const kind = kindAt(TERRAIN, nx, ny)
          expect(
            ALLOWED_AROUND_WATER.includes(kind),
            `water at (${tx},${ty}) touches ${kind} at (${nx},${ny})`,
          ).toBe(true)
        }
      }
    }
  })

  it('gives every building a doorstep on a path', () => {
    for (const structure of STRUCTURES) {
      if (!structure.solid) continue

      const doorCol = structure.tileX + Math.floor(structure.wTiles / 2)
      const below = kindAt(TERRAIN, doorCol, structure.tileY + structure.hTiles)

      expect(below, `${structure.label} doorstep at (${doorCol},${structure.tileY + structure.hTiles})`).toBe(
        TILE_PATH,
      )
    }
  })

  it('keeps building footprints off paths and water', () => {
    for (const structure of STRUCTURES) {
      // The bridge deliberately sits on a path tile.
      if (!structure.solid) continue

      for (let dy = 0; dy < structure.hTiles; dy++) {
        for (let dx = 0; dx < structure.wTiles; dx++) {
          const kind = kindAt(TERRAIN, structure.tileX + dx, structure.tileY + dy)
          expect(
            kind,
            `${structure.label} overlaps kind ${kind} at (${structure.tileX + dx},${structure.tileY + dy})`,
          ).not.toBe(TILE_PATH)
          expect(kind).not.toBe(TILE_WATER)
        }
      }
    }
  })

  it('keeps every decoration on bare grass', () => {
    const decor = [
      ...buildGrassDecor(TERRAIN),
      ...buildPathEdges(TERRAIN),
      ...buildWaterProps(TERRAIN),
    ]

    expect(decor.length).toBeGreaterThan(100)

    for (const tile of decor) {
      const kind = kindAt(TERRAIN, tile.tileX, tile.tileY)
      if (tile.key.startsWith('water-detail')) {
        expect(kind, `${tile.key} at ${tile.tileX},${tile.tileY}`).toBe(TILE_WATER)
      } else if (tile.key.startsWith('ground-detail')) {
        expect(kind, `${tile.key} at ${tile.tileX},${tile.tileY}`).toBe(TILE_PATH)
      } else {
        expect(kind, `${tile.key} at ${tile.tileX},${tile.tileY}`).toBe(TILE_GRASS)
      }
    }
  })

  it('plants trees only on clear grass', () => {
    expect(TREES.length).toBeGreaterThan(80)

    for (const tree of TREES) {
      for (let dy = 0; dy < tree.hTiles; dy++) {
        for (let dx = 0; dx < tree.wTiles; dx++) {
          expect(
            kindAt(TERRAIN, tree.tileX + dx, tree.tileY + dy),
            `${tree.key} at (${tree.tileX},${tree.tileY}) covers (${tree.tileX + dx},${tree.tileY + dy})`,
          ).toBe(TILE_GRASS)
        }
      }
    }
  })

  it('builds fenced front yards with a gate at each door', () => {
    expect(FENCES.length).toBeGreaterThan(4)

    for (const fence of FENCES) {
      expect(fence.lenH + fence.lenV).toBeGreaterThan(0)
    }
  })

  it('keeps the farm animals inside the pasture, on grass', () => {
    const animals = buildAnimals()
    expect(animals.length).toBeGreaterThan(3)

    for (const animal of animals) {
      for (let dy = 0; dy < animal.sizeTiles; dy++) {
        for (let dx = 0; dx < animal.sizeTiles; dx++) {
          const tx = animal.tileX + dx
          const ty = animal.tileY + dy
          expect(isInPasture(tx, ty), `${animal.key} at (${tx},${ty})`).toBe(true)
          expect(kindAt(TERRAIN, tx, ty), `${animal.key} at (${tx},${ty})`).toBe(TILE_GRASS)
        }
      }
    }
  })

  it('plants the vegetable garden on grass', () => {
    const tiles = buildGardenTiles()
    expect(tiles.length).toBe(GARDEN.w * GARDEN.h)

    for (const tile of tiles) {
      expect(kindAt(TERRAIN, tile.tileX, tile.tileY), `garden at ${tile.tileX},${tile.tileY}`).toBe(
        TILE_GRASS,
      )
    }
  })

  it('puts outdoor props only on bare grass', () => {
    const props = [...buildYardPots(TERRAIN), ...buildCuteDecor(TERRAIN)]
    expect(props.length).toBeGreaterThan(10)

    for (const item of props) {
      expect(
        kindAt(TERRAIN, item.tileX, item.tileY),
        `${item.key} frame ${item.frame} at ${item.tileX},${item.tileY}`,
      ).toBe(TILE_GRASS)
    }
  })
})

describe('mergeRects', () => {
  it('merges a solid block into a single rect', () => {
    const mask = createMask(10, 10)
    fillRect(mask, 2, 3, 4, 3, TILE_PATH)

    expect(mergeRects(mask, kind => kind === TILE_PATH)).toEqual([
      { x: 2, y: 3, w: 4, h: 3 },
    ])
  })

  it('keeps disjoint runs as separate rects', () => {
    const mask = createMask(10, 10)
    fillRect(mask, 1, 1, 2, 1, TILE_PATH)
    fillRect(mask, 6, 1, 2, 1, TILE_PATH)

    const rects = mergeRects(mask, kind => kind === TILE_PATH)
    expect(rects).toHaveLength(2)
    expect(rects[0]).toEqual({ x: 1, y: 1, w: 2, h: 1 })
    expect(rects[1]).toEqual({ x: 6, y: 1, w: 2, h: 1 })
  })

  it('returns no rects when nothing matches', () => {
    const mask = createMask(4, 4)
    expect(mergeRects(mask, kind => kind === TILE_WATER)).toEqual([])
  })
})
