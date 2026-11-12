import { describe, it, expect } from 'vitest'
import { PLAYER_START_TILE_X, PLAYER_START_TILE_Y } from '../config/GameConfig'
import {
  BATS,
  PUMPKIN_COLLIDER,
  PUMPKIN_PLACEMENTS,
  WINDOW_LAYOUTS,
  pumpkinFrameIndex,
  PUMPKIN_FRAMES,
  PUMPKIN_SHEET,
} from '../config/halloween'
import { isFreePumpkinTile, validatePumpkinPlacements } from './halloween-placement'
import { STRUCTURES, TERRAIN } from './town-layout'
import { TILE_WATER, kindAt } from './terrain'

describe('Halloween placements', () => {
  it('places every pumpkin on safe, free grass', () => {
    expect(validatePumpkinPlacements()).toEqual([])
  })

  it('rejects the player spawn, a building, water and a fence', () => {
    expect(isFreePumpkinTile(PLAYER_START_TILE_X, PLAYER_START_TILE_Y)).toBe(false)
    expect(isFreePumpkinTile(14, 5)).toBe(false) // inside house-a
    expect(isFreePumpkinTile(13, 12)).toBe(false) // on house-a's yard fence

    // No pond tile is ever usable.
    for (let ty = 0; ty < 64; ty++) {
      for (let tx = 0; tx < 80; tx++) {
        if (kindAt(TERRAIN, tx, ty) === TILE_WATER) {
          expect(isFreePumpkinTile(tx, ty), `water at ${tx},${ty}`).toBe(false)
        }
      }
    }

    expect(isFreePumpkinTile(44, 12)).toBe(true) // grass by the church path
  })

  it('has a village-wide spread, not one cluster', () => {
    expect(PUMPKIN_PLACEMENTS.length).toBeGreaterThanOrEqual(18)

    const north = PUMPKIN_PLACEMENTS.filter(spot => spot.tileY < 20).length
    const middle = PUMPKIN_PLACEMENTS.filter(spot => spot.tileY >= 20 && spot.tileY < 40).length
    const south = PUMPKIN_PLACEMENTS.filter(spot => spot.tileY >= 40).length

    for (const [area, count] of [['north', north], ['middle', middle], ['south', south]] as const) {
      expect(count, area).toBeGreaterThan(0)
    }
  })

  it('never puts two pumpkins on the same tile', () => {
    const keys = PUMPKIN_PLACEMENTS.map(spot => `${spot.tileX},${spot.tileY}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses frames inside the loaded sheet', () => {
    const frameCount = PUMPKIN_SHEET.cols * 14

    for (const spot of PUMPKIN_PLACEMENTS) {
      const index = pumpkinFrameIndex(PUMPKIN_FRAMES[spot.frame])
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(frameCount)
    }
  })

  it('has window panes for every inhabited building, inside its sprite', () => {
    const dimensions: Record<string, { w: number; h: number }> = {
      'house-1': { w: 80, h: 112 },
      'house-2': { w: 128, h: 112 },
      'cute-house': { w: 96, h: 128 },
      church: { w: 128, h: 112 },
    }

    for (const structure of STRUCTURES) {
      if (!structure.solid) continue

      const panes = WINDOW_LAYOUTS[structure.key]
      expect(panes, `${structure.label} (${structure.key})`).toBeDefined()
      expect(panes!.length).toBeGreaterThan(0)

      const size = dimensions[structure.key]
      expect(size, structure.key).toBeDefined()

      for (const pane of panes!) {
        expect(pane.x).toBeGreaterThanOrEqual(0)
        expect(pane.y).toBeGreaterThanOrEqual(0)
        expect(pane.x + pane.w).toBeLessThanOrEqual(size!.w)
        expect(pane.y + pane.h).toBeLessThanOrEqual(size!.h)
      }
    }
  })

  it('keeps the bats sparse', () => {
    expect(BATS.length).toBeLessThanOrEqual(3)
  })

  it('gives each pumpkin a small footprint that is solid only while visible', () => {
    expect(PUMPKIN_COLLIDER.width).toBeGreaterThan(0)
    expect(PUMPKIN_COLLIDER.height).toBeGreaterThan(0)
    expect(PUMPKIN_COLLIDER.width).toBeLessThanOrEqual(16)
    expect(PUMPKIN_COLLIDER.height).toBeLessThanOrEqual(16)

    // Never solid before the decorations have faded in, never off at full night.
    expect(PUMPKIN_COLLIDER.solidAt).toBeGreaterThan(0)
    expect(PUMPKIN_COLLIDER.solidAt).toBeLessThanOrEqual(1)
  })
})
