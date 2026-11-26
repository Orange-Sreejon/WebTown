import { describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../game/config/GameConfig'
import { TERRAIN } from '../game/maps/town-layout'
import { TILE_GRASS, TILE_PATH, kindAt } from '../game/maps/terrain'
import { isStepFrame, stepSound, townSurfaceAt } from './footsteps'

function firstTile(kind: number): { x: number; y: number } {
  for (let ty = 0; ty < TERRAIN.height; ty++) {
    for (let tx = 0; tx < TERRAIN.width; tx++) {
      if (kindAt(TERRAIN, tx, ty) === kind) return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 }
    }
  }
  throw new Error(`no tile of kind ${kind}`)
}

describe('footsteps', () => {
  it('step on the two foot-down frames of a walk, and never while standing', () => {
    expect([1, 2, 3, 4].map(i => isStepFrame('walk-down', i))).toEqual([true, false, true, false])
    expect(isStepFrame('walk-left@red-cap', 3)).toBe(true)
    for (const i of [1, 2, 3, 4]) expect(isStepFrame('idle-down', i)).toBe(false)
    expect(isStepFrame('idle-left@red-cap', 1)).toBe(false)
  })

  it('sound like the road on the road and like grass elsewhere in the town', () => {
    expect(townSurfaceAt(firstTile(TILE_PATH))).toBe('path')
    expect(townSurfaceAt(firstTile(TILE_GRASS))).toBe('grass')
    expect(townSurfaceAt({ x: -50, y: -50 })).toBe('grass')
    expect([stepSound('grass'), stepSound('path'), stepSound('wood')]).toEqual(['step-grass', 'step-path', 'step-wood'])
  })
})
