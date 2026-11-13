import { describe, expect, it } from 'vitest'
import { PLAYER_BODY_H, PLAYER_BODY_W, PLAYER_SPRITE_SCALE } from '../config/GameConfig'
import type { Rect } from '../../lib/geometry'
import {
  captureReturnState,
  isFeetSafe,
  planReturn,
  playerBodyRect,
  resolveReturnFeet,
  type TownReturnState,
} from './return-position'
import { GameClock } from './game-clock'

const BOUNDS: Rect = { x: 0, y: 0, w: 200, h: 200 }

function saved(feetX: number, feetY: number): TownReturnState {
  return captureReturnState('house-a', { x: feetX, y: feetY }, 'left', 2)
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

describe('captureReturnState and planReturn', () => {
  const fallback = { x: 150, y: 150 }

  it('round-trips the exact position, facing and zoom', () => {
    const state = captureReturnState('house-b', { x: 63.25, y: 121.5 }, 'up', 2)
    expect(state).toEqual({
      houseId: 'house-b',
      feetX: 63.25,
      feetY: 121.5,
      facing: 'up',
      cameraZoom: 2,
    })
    expect(planReturn(state, [], BOUNDS, fallback)).toEqual({
      feetX: 63.25,
      feetY: 121.5,
      usedFallback: false,
      facing: 'up',
      cameraZoom: 2,
    })
  })

  it('restores every facing direction unchanged when the spot is safe', () => {
    for (const facing of ['up', 'down', 'left', 'right'] as const) {
      const state = captureReturnState('house-a', { x: 80, y: 80 }, facing, 2)
      expect(planReturn(state, [], BOUNDS, fallback).facing).toBe(facing)
    }
  })

  it('faces down at the fallback spot, and still keeps the zoom', () => {
    const blocker: Rect = { x: 50, y: 100, w: 40, h: 40 }
    const state = captureReturnState('house-a', { x: 63, y: 121 }, 'up', 2)
    expect(planReturn(state, [blocker], BOUNDS, fallback)).toMatchObject({
      feetX: 150,
      feetY: 150,
      usedFallback: true,
      facing: 'down',
      cameraZoom: 2,
    })
  })

  it('does not carry camera scroll, which the follow camera recomputes', () => {
    expect(Object.keys(captureReturnState('h', { x: 1, y: 2 }, 'left', 2)).sort()).toEqual([
      'cameraZoom', 'facing', 'feetX', 'feetY', 'houseId',
    ])
  })
})

describe('town clock across a house visit', () => {
  // Mirrors TownScene: onSleep freezes the clock; onWake freezes it only when
  // `?timeFrozen=1` asked for that, otherwise it resumes.
  const sleep = (clock: GameClock): void => clock.freeze(true)
  const wake = (clock: GameClock, frozenByOverride: boolean): void => clock.freeze(frozenByOverride)

  it('does not advance indoors, however long the visit', () => {
    const clock = new GameClock(12)
    clock.tick(250)
    const before = clock.hour
    sleep(clock)
    for (let i = 0; i < 10_000; i++) clock.tick(250)
    expect(clock.hour).toBe(before)
  })

  it('resumes from the same time after the visit', () => {
    const clock = new GameClock(12)
    sleep(clock)
    clock.tick(250)
    const frozenAt = clock.hour
    wake(clock, false)
    expect(clock.isFrozen).toBe(false)
    clock.tick(250)
    expect(clock.hour).toBeGreaterThan(frozenAt)
  })

  it('stays frozen after a visit when the developer override is on', () => {
    const clock = new GameClock(21.5)
    clock.freeze(true)
    sleep(clock)
    wake(clock, true)
    clock.tick(250)
    expect(clock.hour).toBe(21.5)
  })
})
