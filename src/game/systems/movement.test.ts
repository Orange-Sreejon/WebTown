import { describe, it, expect } from 'vitest'
import { computeVelocity, inputToDirection, type InputState } from './movement'

const SPEED = 80
const TOLERANCE = 0.0001

const none: InputState  = { up: false, down: false, left: false, right: false }
const up: InputState    = { up: true,  down: false, left: false, right: false }
const down: InputState  = { up: false, down: true,  left: false, right: false }
const left: InputState  = { up: false, down: false, left: true,  right: false }
const right: InputState = { up: false, down: false, left: false, right: true  }

describe('computeVelocity', () => {
  it('no input → (0, 0)', () => {
    const v = computeVelocity(none, SPEED)
    expect(v.vx).toBe(0)
    expect(v.vy).toBe(0)
  })

  it('up only → (0, -speed)', () => {
    const v = computeVelocity(up, SPEED)
    expect(v.vx).toBe(0)
    expect(v.vy).toBeCloseTo(-SPEED, 4)
  })

  it('down only → (0, +speed)', () => {
    const v = computeVelocity(down, SPEED)
    expect(v.vx).toBe(0)
    expect(v.vy).toBeCloseTo(SPEED, 4)
  })

  it('left only → (-speed, 0)', () => {
    const v = computeVelocity(left, SPEED)
    expect(v.vx).toBeCloseTo(-SPEED, 4)
    expect(v.vy).toBe(0)
  })

  it('right only → (+speed, 0)', () => {
    const v = computeVelocity(right, SPEED)
    expect(v.vx).toBeCloseTo(SPEED, 4)
    expect(v.vy).toBe(0)
  })

  it('up + down cancel → (0, 0)', () => {
    const v = computeVelocity({ ...none, up: true, down: true }, SPEED)
    expect(v.vx).toBe(0)
    expect(v.vy).toBe(0)
  })

  it('left + right cancel → (0, 0)', () => {
    const v = computeVelocity({ ...none, left: true, right: true }, SPEED)
    expect(v.vx).toBe(0)
    expect(v.vy).toBe(0)
  })

  it('up + right diagonal: magnitude equals speed', () => {
    const v = computeVelocity({ ...none, up: true, right: true }, SPEED)
    const magnitude = Math.sqrt(v.vx * v.vx + v.vy * v.vy)
    expect(Math.abs(magnitude - SPEED)).toBeLessThan(TOLERANCE)
  })

  it('down + left diagonal: magnitude equals speed', () => {
    const v = computeVelocity({ ...none, down: true, left: true }, SPEED)
    const magnitude = Math.sqrt(v.vx * v.vx + v.vy * v.vy)
    expect(Math.abs(magnitude - SPEED)).toBeLessThan(TOLERANCE)
  })

  it('up + left diagonal: magnitude equals speed', () => {
    const v = computeVelocity({ ...none, up: true, left: true }, SPEED)
    const magnitude = Math.sqrt(v.vx * v.vx + v.vy * v.vy)
    expect(Math.abs(magnitude - SPEED)).toBeLessThan(TOLERANCE)
  })

  it('down + right diagonal: magnitude equals speed', () => {
    const v = computeVelocity({ ...none, down: true, right: true }, SPEED)
    const magnitude = Math.sqrt(v.vx * v.vx + v.vy * v.vy)
    expect(Math.abs(magnitude - SPEED)).toBeLessThan(TOLERANCE)
  })

  it('all four keys → (0, 0)', () => {
    const v = computeVelocity({ up: true, down: true, left: true, right: true }, SPEED)
    expect(v.vx).toBe(0)
    expect(v.vy).toBe(0)
  })

  it('speed = 0 → (0, 0)', () => {
    const v = computeVelocity(down, 0)
    expect(v.vx).toBe(0)
    expect(v.vy).toBe(0)
  })

  it('negative speed → (0, 0)', () => {
    const v = computeVelocity(down, -10)
    expect(v.vx).toBe(0)
    expect(v.vy).toBe(0)
  })
})

describe('inputToDirection', () => {
  it('no input → returns fallback', () => {
    expect(inputToDirection(none, 'right')).toBe('right')
    expect(inputToDirection(none, 'up')).toBe('up')
  })

  it('down pressed → down', () => {
    expect(inputToDirection(down, 'up')).toBe('down')
  })

  it('up pressed → up', () => {
    expect(inputToDirection(up, 'down')).toBe('up')
  })

  it('left pressed → left', () => {
    expect(inputToDirection(left, 'right')).toBe('left')
  })

  it('right pressed → right', () => {
    expect(inputToDirection(right, 'left')).toBe('right')
  })

  it('down takes priority over up when both pressed', () => {
    expect(inputToDirection({ ...none, up: true, down: true }, 'left')).toBe('down')
  })

  it('down takes priority over right when diagonal', () => {
    expect(inputToDirection({ ...none, down: true, right: true }, 'left')).toBe('down')
  })

  it('up takes priority over right when both pressed without down', () => {
    expect(inputToDirection({ ...none, up: true, right: true }, 'left')).toBe('up')
  })
})
