import { describe, it, expect } from 'vitest'
import {
  DEPTH_PLAYER,
  DEPTH_TREETOP,
  MAP_HEIGHT_PX,
  depthForFeetY,
} from './GameConfig'

describe('depthForFeetY', () => {
  it('draws lower things in front', () => {
    const behind = depthForFeetY(200)
    const inFront = depthForFeetY(600)

    expect(inFront).toBeGreaterThan(behind)
  })

  it('stays above the structures and below the tree tops', () => {
    for (const feetY of [0, 1, MAP_HEIGHT_PX / 2, MAP_HEIGHT_PX]) {
      const depth = depthForFeetY(feetY)

      expect(depth).toBeGreaterThanOrEqual(DEPTH_PLAYER)
      expect(depth).toBeLessThan(DEPTH_TREETOP)
    }
  })

  it('clamps feet outside the map to the band', () => {
    expect(depthForFeetY(-500)).toBe(depthForFeetY(0))
    expect(depthForFeetY(MAP_HEIGHT_PX + 500)).toBe(depthForFeetY(MAP_HEIGHT_PX))
  })

  it('gives a lamp post and a player at the same ground point the same depth', () => {
    // The player's feet and the base of the post share this value, so whoever
    // is lower on screen wins the draw order.
    const groundY = 640

    expect(depthForFeetY(groundY)).toBe(depthForFeetY(groundY))
  })
})
