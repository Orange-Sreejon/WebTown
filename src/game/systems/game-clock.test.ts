import { describe, it, expect } from 'vitest'
import { CYCLE_DURATION_MS } from '../config/halloween'
import {
  GameClock,
  MAX_FRAME_MS,
  parseFrozenOverride,
  parseTimeOverride,
  periodAt,
} from './game-clock'

/** Real milliseconds that equal one in-game hour. */
const HOUR_MS = CYCLE_DURATION_MS / 24

/** Advance a clock by `ms` in normal 60 fps frames. */
function play(clock: GameClock, ms: number, frame = 16): GameClock {
  let left = ms
  while (left > 0) {
    const step = Math.min(frame, left)
    clock.tick(step)
    left -= step
  }
  return clock
}

describe('in-game clock', () => {
  it('takes 15 minutes of played time for a full day', () => {
    expect(CYCLE_DURATION_MS).toBe(900_000)

    const clock = new GameClock(9)
    play(clock, CYCLE_DURATION_MS)

    expect(clock.state.hour).toBe(9)
    expect(clock.state.minute).toBe(0)
  })

  it('rolls over midnight correctly', () => {
    const clock = new GameClock(23.9)
    expect(clock.state.period).toBe('night')

    play(clock, HOUR_MS * 0.2)

    expect(clock.state.hour).toBe(0)
    expect(clock.state.period).toBe('night')
    expect(clock.state.minute).toBeLessThan(10)
  })

  it('uses the default start hour when none is given', () => {
    const clock = new GameClock()

    expect(clock.hour).toBe(9)
    expect(clock.state.period).toBe('day')
  })

  it('only advances from tick, never from the system clock', () => {
    const clock = new GameClock(12)
    const before = clock.state

    expect(clock.state).toEqual(before)
  })

  it('reports the period at every boundary', () => {
    expect(periodAt(6)).toBe('day')
    expect(periodAt(17.999)).toBe('day')
    expect(periodAt(18)).toBe('evening')
    expect(periodAt(19.999)).toBe('evening')
    expect(periodAt(20)).toBe('night')
    expect(periodAt(23.5)).toBe('night')
    expect(periodAt(0)).toBe('night')
    expect(periodAt(5.999)).toBe('night')
  })

  it('freezes: a frozen clock ignores ticks, and resumes', () => {
    const clock = new GameClock(22)
    clock.freeze()

    play(clock, 120_000)

    expect(clock.hour).toBe(22)
    expect(clock.isFrozen).toBe(true)

    clock.freeze(false)
    play(clock, HOUR_MS)

    expect(clock.hour).toBeGreaterThan(22.9)
  })

  it('jumps with setHour without carrying drift over', () => {
    const clock = new GameClock(9)
    play(clock, 30_000)

    clock.setHour(22)

    expect(clock.hour).toBe(22)
    expect(clock.state.minute).toBe(0)

    play(clock, HOUR_MS)
    expect(clock.hour).toBeGreaterThan(22.9)
    expect(clock.hour).toBeLessThan(23.1)
  })

  it('caps a single frame so a backgrounded tab cannot skip the night', () => {
    const clock = new GameClock(21)

    // An hour of hidden time arriving as one delta must only advance the
    // capped frame's worth, not a whole in-game hour.
    clock.tick(3_600_000)

    const advancedHours = clock.hour - 21
    expect(advancedHours).toBeGreaterThan(0)
    expect(advancedHours).toBeLessThan((MAX_FRAME_MS / CYCLE_DURATION_MS) * 24 + 0.01)
  })

  it('parses the time override and rejects bad values', () => {
    expect(parseTimeOverride('?time=21:30')).toBe(21.5)
    expect(parseTimeOverride('time=5:05')).toBeCloseTo(5 + 5 / 60)
    expect(parseTimeOverride('?time=0:00')).toBe(0)
    expect(parseTimeOverride('?time=24:00')).toBeUndefined()
    expect(parseTimeOverride('?time=21:60')).toBeUndefined()
    expect(parseTimeOverride('?time=evening')).toBeUndefined()
    expect(parseTimeOverride('')).toBeUndefined()
    expect(parseTimeOverride('?foo=1')).toBeUndefined()
  })

  it('parses the frozen override', () => {
    expect(parseFrozenOverride('?timeFrozen=1')).toBe(true)
    expect(parseFrozenOverride('?timeFrozen=true')).toBe(true)
    expect(parseFrozenOverride('?timeFrozen=0')).toBe(false)
    expect(parseFrozenOverride('')).toBe(false)
  })
})
