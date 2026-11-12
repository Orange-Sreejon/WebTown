import { describe, expect, it } from 'vitest'
import { PLAYER_BODY_H, PLAYER_BODY_W, PLAYER_SPRITE_SCALE } from '../config/GameConfig'
import type { Rect } from '../../lib/geometry'
import {
  isFeetSafe,
  playerBodyRect,
  resolveReturnFeet,
  type TownReturnState,
} from './return-position'

const BOUNDS: Rect = { x: 0, y: 0, w: 200, h: 200 }

function saved(feetX: number, feetY: number): TownReturnState {
  return {
    houseId: 'house-a',
    feetX,
    feetY,
    facing: 'left',
    cameraScrollX: 10,
    cameraScrollY: 20,
    cameraZoom: 2,
  }
}

describe('playerBodyRect', () => {
  it('is the scaled physics body, centred on and resting on the feet', () => {
    const body = playerBodyRect(100, 80)
    expect(body.w).toBeCloseTo(PLAYER_BODY_W * PLAYER_SPRITE_SCALE)
    expect(body.h).toBeCloseTo(PLAYER_BODY_H * PLAYER_SPRITE_SCALE)
    expect(body.x + body.w / 2).toBeCloseTo(100)
    expect(body.y + body.h).toBeCloseTo(80)
  })
})

describe('isFeetSafe', () => {
  const wall: Rect = { x: 0, y: 0, w: 200, h: 50 }

  it('accepts open ground', () => {
    expect(isFeetSafe({ x: 100, y: 120 }, [wall], BOUNDS)).toBe(true)
  })

  it('accepts a body that only touches an obstacle', () => {
    const body = playerBodyRect(100, 120)
    const touching: Rect = { x: 0, y: 0, w: 200, h: body.y }
    expect(isFeetSafe({ x: 100, y: 120 }, [touching], BOUNDS)).toBe(true)
  })

  it('tolerates sub-pixel rounding left by physics separation', () => {
    const body = playerBodyRect(100, 120)
    const almost: Rect = { x: 0, y: 0, w: 200, h: body.y + 0.2 }
    expect(isFeetSafe({ x: 100, y: 120 }, [almost], BOUNDS)).toBe(true)
  })

  it('rejects a body inside an obstacle', () => {
    expect(isFeetSafe({ x: 100, y: 40 }, [wall], BOUNDS)).toBe(false)
  })

  it('rejects a body outside the bounds', () => {
    expect(isFeetSafe({ x: 2, y: 120 }, [], BOUNDS)).toBe(false)
    expect(isFeetSafe({ x: 100, y: 250 }, [], BOUNDS)).toBe(false)
  })
})

describe('resolveReturnFeet', () => {
  const fallback = { x: 150, y: 150 }

  it('restores the exact saved position when it is safe', () => {
    const result = resolveReturnFeet(saved(63.25, 121.5), [], BOUNDS, fallback)
    expect(result).toEqual({ feetX: 63.25, feetY: 121.5, usedFallback: false })
  })

  it('uses the fallback when something now occupies the saved spot', () => {
    const blocker: Rect = { x: 50, y: 100, w: 40, h: 40 }
    const result = resolveReturnFeet(saved(63, 121), [blocker], BOUNDS, fallback)
    expect(result).toEqual({ feetX: 150, feetY: 150, usedFallback: true })
  })

  it('uses the fallback when the saved spot is out of bounds', () => {
    const result = resolveReturnFeet(saved(-5, 40), [], BOUNDS, fallback)
    expect(result.usedFallback).toBe(true)
  })
})
