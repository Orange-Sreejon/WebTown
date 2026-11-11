import { describe, it, expect } from 'vitest'
import { AssetKeys } from '../config/AssetKeys'
import { MAP_TILES_H, MAP_TILES_W, TILE_SIZE } from '../config/GameConfig'
import { getCollisionRects } from './collision-objects'
import { kindAt, TILE_GRASS } from './terrain'
import {
  FENCES,
  isInGarden,
  isInPasture,
  propCoversTile,
  STRUCTURES,
  TERRAIN,
  TREES,
  VILLAGE_PROPS,
  type VillagePropPlacement,
} from './town-layout'

function isFenceTile(tx: number, ty: number): boolean {
  return FENCES.some(fence => {
    if (fence.lenH > 0) {
      return ty === fence.y && tx >= fence.x && tx < fence.x + fence.lenH
    }
    return tx === fence.x && ty >= fence.y && ty < fence.y + fence.lenV
  })
}

function isOnStructure(tx: number, ty: number): boolean {
  return STRUCTURES.some(
    s =>
      tx >= s.tileX &&
      ty >= s.tileY &&
      tx < s.tileX + s.wTiles &&
      ty < s.tileY + s.hTiles,
  )
}

/** Every tile a prop's scaled sprite sits on (grown up and to the right). */
function coveredTiles(prop: VillagePropPlacement): Array<[number, number]> {
  const span = Math.max(1, Math.ceil(prop.scale))
  const tiles: Array<[number, number]> = []

  for (let dx = 0; dx < span; dx++) {
    for (let dy = 0; dy < span; dy++) {
      tiles.push([prop.tileX + dx, prop.tileY - dy])
    }
  }

  return tiles
}

describe('village props', () => {
  it('spreads the shops around the village instead of one square', () => {
    const STALL_KEYS: readonly string[] = [
      AssetKeys.MARKET_STALL_RED,
      AssetKeys.MARKET_STALL_GREEN,
      AssetKeys.MARKET_STALL_BLUE,
    ]
    const stalls = VILLAGE_PROPS.filter(p => STALL_KEYS.includes(p.key))

    expect(stalls).toHaveLength(3)

    // No two stalls may be near neighbours: each is its own little market.
    for (let i = 0; i < stalls.length; i++) {
      for (let j = i + 1; j < stalls.length; j++) {
        const a = stalls[i]!
        const b = stalls[j]!
        const distance = Math.hypot(a.tileX - b.tileX, a.tileY - b.tileY)
        expect(distance, `${a.key} vs ${b.key}`).toBeGreaterThan(10)
      }
    }

    const keys: string[] = VILLAGE_PROPS.map(p => p.key)
    for (const expected of [
      AssetKeys.MARKET_TABLE,
      AssetKeys.MARKET_WELL,
      AssetKeys.MARKET_TENT,
      AssetKeys.MARKET_BENCH,
      AssetKeys.MARKET_SIGN_POST,
      AssetKeys.MARKET_HAY_BALE,
      AssetKeys.MARKET_CART,
    ]) {
      expect(keys).toContain(expected)
    }
  })

  it('keeps the food off the grass — only shops and furniture', () => {
    const FOOD_KEYS: readonly string[] = [
      AssetKeys.MARKET_BASKET_APPLES,
      AssetKeys.MARKET_BASKET_BREAD,
      AssetKeys.MARKET_PUMPKIN,
      AssetKeys.MARKET_CHEESE,
      AssetKeys.MARKET_EGG_BASKET,
      AssetKeys.MARKET_WHEAT,
      AssetKeys.MARKET_SACK_GRAIN,
    ]

    for (const prop of VILLAGE_PROPS) {
      expect(FOOD_KEYS.includes(prop.key), `${prop.key} is food on the ground`).toBe(false)
    }
  })

  it('scales props to the size the town implies', () => {
    const byKey = (key: string) => VILLAGE_PROPS.find(p => p.key === key)

    // Only the shop stalls keep the big size (40px = 2.5 tiles).
    expect(byKey(AssetKeys.MARKET_STALL_RED)?.scale).toBe(2.5)
    expect(byKey(AssetKeys.MARKET_STALL_GREEN)?.scale).toBe(2.5)
    expect(byKey(AssetKeys.MARKET_STALL_BLUE)?.scale).toBe(2.5)

    // Every other prop from the pack is smaller, so nothing competes with the
    // stalls except the landmarks (well, tent, lamp, hay).
    expect(byKey(AssetKeys.MARKET_WELL)?.scale).toBe(2)
    expect(byKey(AssetKeys.MARKET_LAMP)?.scale).toBe(2)
    expect(byKey(AssetKeys.MARKET_BENCH)?.scale).toBe(1.5)
    expect(byKey(AssetKeys.MARKET_BARREL)?.scale).toBe(1.5)
    expect(byKey(AssetKeys.MARKET_CRATE)?.scale).toBe(1.5)

    // Nothing from the pack may be larger than a stall.
    for (const prop of VILLAGE_PROPS) {
      expect(prop.scale, `${prop.key} is bigger than a stall`).toBeLessThanOrEqual(2.5)
    }
  })

  it('stands every prop on bare grass, sprite and all', () => {
    for (const prop of VILLAGE_PROPS) {
      for (const [tx, ty] of coveredTiles(prop)) {
        expect(propCoversTile(prop, tx, ty), `${prop.key} covers (${tx},${ty})`).toBe(true)
        expect(kindAt(TERRAIN, tx, ty), `${prop.key} over (${tx},${ty})`).toBe(TILE_GRASS)
      }
    }
  })

  it('never covers a building, fence, animal pen or crop patch', () => {
    for (const prop of VILLAGE_PROPS) {
      for (const [tx, ty] of coveredTiles(prop)) {
        const where = `${prop.key} covers (${tx},${ty})`
        expect(isOnStructure(tx, ty), where).toBe(false)
        expect(isFenceTile(tx, ty), where).toBe(false)
        expect(isInPasture(tx, ty), where).toBe(false)
        expect(isInGarden(tx, ty), where).toBe(false)
      }
    }
  })

  it('stays inside the map and never overlaps another prop', () => {
    const seen = new Set<string>()

    for (const prop of VILLAGE_PROPS) {
      for (const [tx, ty] of coveredTiles(prop)) {
        expect(tx).toBeGreaterThanOrEqual(0)
        expect(ty).toBeGreaterThanOrEqual(0)
        expect(tx).toBeLessThan(MAP_TILES_W)
        expect(ty).toBeLessThan(MAP_TILES_H)

        const tile = `${tx},${ty}`
        expect(seen.has(tile), `two props share tile ${tile}`).toBe(false)
        seen.add(tile)
      }
    }
  })

  it('makes shops solid but leaves furniture walkable', () => {
    const rects = getCollisionRects()
    const solid = VILLAGE_PROPS.filter(p => p.solid)
    const walkable = VILLAGE_PROPS.filter(p => !p.solid)

    expect(solid.length).toBeGreaterThan(3)
    expect(walkable.length).toBeGreaterThan(3)

    for (const prop of solid) {
      if (prop.key === AssetKeys.MARKET_LAMP) continue // lamp posts are thin

      const label = `prop-${prop.key}-${VILLAGE_PROPS.indexOf(prop)}`
      const rect = rects.find(r => r.label === label)
      expect(rect, `missing collider for ${label}`).toBeDefined()

      // The box covers the ground contact: its own width, anchored on the
      // bottom edge of the prop's tile.
      const size = TILE_SIZE * prop.scale
      expect(rect!.w).toBeGreaterThanOrEqual(TILE_SIZE)
      expect(rect!.x).toBeGreaterThanOrEqual(prop.tileX * TILE_SIZE)
      expect(rect!.x + rect!.w).toBeLessThanOrEqual(prop.tileX * TILE_SIZE + size + 1)
      expect(rect!.y + rect!.h).toBe(prop.tileY * TILE_SIZE + TILE_SIZE)
    }

    for (const prop of walkable) {
      const label = `prop-${prop.key}-${VILLAGE_PROPS.indexOf(prop)}`
      expect(rects.some(r => r.label === label), `${label} should not collide`).toBe(false)
    }
  })

  it('makes the lamp posts solid, but only by the post itself', () => {
    const rects = getCollisionRects()
    const lamps = VILLAGE_PROPS.filter(p => p.key === AssetKeys.MARKET_LAMP)

    expect(lamps.length).toBeGreaterThan(3)

    for (const lamp of lamps) {
      const label = `prop-${lamp.key}-${VILLAGE_PROPS.indexOf(lamp)}`
      const rect = rects.find(r => r.label === label)
      expect(rect, `missing collider for ${label}`).toBeDefined()

      // Thin post on the ground: walkable within the tile, blocked at the pole.
      expect(rect!.w).toBeLessThanOrEqual(12)
      expect(rect!.h).toBeLessThanOrEqual(12)
      expect(rect!.x + rect!.w / 2).toBe(lamp.tileX * TILE_SIZE + TILE_SIZE / 2)
      expect(rect!.y + rect!.h).toBe((lamp.tileY + 1) * TILE_SIZE)
    }
  })

  it('keeps trees from growing through the shops', () => {
    for (const tree of TREES) {
      for (let dy = 0; dy < tree.hTiles; dy++) {
        for (let dx = 0; dx < tree.wTiles; dx++) {
          const tx = tree.tileX + dx
          const ty = tree.tileY + dy

          expect(
            VILLAGE_PROPS.some(prop => propCoversTile(prop, tx, ty)),
            `${tree.key} covers prop tile (${tx},${ty})`,
          ).toBe(false)
        }
      }
    }
  })
})
