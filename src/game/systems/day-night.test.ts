import { describe, it, expect } from 'vitest'
import { HALLOWEEN_FADE } from '../config/halloween'
import { DAY_CYCLE_MS, halloweenAt, skyAt, skyAtHour } from './day-night'

describe('day-night cycle', () => {
  it('takes 15 minutes for a full day', () => {
    expect(DAY_CYCLE_MS).toBe(900_000)
  })

  it('starts in full daylight', () => {
    const morning = skyAt(0)

    expect(morning.tint).toBe(0xffffff) // untouched world
    expect(morning.night).toBe(0)
    expect(morning.lamp).toBe(0) // lamps stay dark
  })

  it('keeps the night light enough to see the town', () => {
    const night = skyAt(0.85).tint

    for (const shift of [16, 8, 0]) {
      const channel = (night >> shift) & 0xff
      expect(channel, `channel ${shift}`).toBeGreaterThanOrEqual(0x80)
    }
  })

  it('lights the street lamps in the evening and at night only', () => {
    expect(skyAt(0.2).lamp).toBe(0) // morning: off
    expect(skyAt(0.42).lamp).toBe(0) // afternoon: off
    expect(skyAt(0.55).lamp).toBeGreaterThan(0.3) // evening: coming up
    expect(skyAt(0.78).lamp).toBe(1) // nightfall: full
    expect(skyAt(0.9).lamp).toBe(1) // deep night: full
    expect(skyAt(0.999).lamp).toBeLessThan(0.1) // dawn: out again
  })

  it('reaches full night in the middle of the dark stretch', () => {
    for (const t of [0.78, 0.85, 0.92]) {
      expect(skyAt(t).night, `t=${t}`).toBe(1)
    }
  })

  it('gets steadily darker from afternoon through sunset to night', () => {
    const samples = [0.42, 0.52, 0.6, 0.68, 0.78].map(t => skyAt(t).night)

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!, `sample ${i}`).toBeGreaterThan(samples[i - 1]!)
    }
  })

  it('warms the light at sunset before it goes blue', () => {
    const sunset = skyAt(0.6).tint

    const red = (sunset >> 16) & 0xff
    const blue = sunset & 0xff
    expect(red).toBeGreaterThan(blue)

    const night = skyAt(0.8).tint
    expect((night >> 16) & 0xff).toBeLessThan((night & 0xff) + 20) // blue-dominant
  })

  it('returns to daylight by the end of the cycle without a jump', () => {
    const justBefore = skyAt(0.999)
    const start = skyAt(0)

    expect(justBefore.night).toBeLessThan(0.05)
    expect(Math.abs(justBefore.night - start.night)).toBeLessThan(0.05)
  })

  it('wraps safely for values outside 0–1', () => {
    expect(skyAt(1.5)).toEqual(skyAt(0.5))
    expect(skyAt(-0.22)).toEqual(skyAt(0.78))
  })

  it('maps the legacy cycle onto the clock hour-by-hour', () => {
    expect(skyAt(0.5)).toEqual(skyAtHour(18))
    expect(skyAt(0)).toEqual(skyAtHour(6))
  })
})

describe('hour-based lighting curve', () => {
  it('is dark at midnight, daylight at midday, dusk in the evening', () => {
    expect(skyAtHour(0).night).toBe(1)
    expect(skyAtHour(12).tint).toBe(0xffffff)
    expect(skyAtHour(12).night).toBe(0)
    expect(skyAtHour(18.5).night).toBeGreaterThan(0)
    expect(skyAtHour(18.5).night).toBeLessThan(0.3)
  })

  it('keeps the night light enough to see the town', () => {
    for (const hour of [0, 2, 4, 22, 23, 4.9]) {
      const tint = skyAtHour(hour).tint
      for (const shift of [16, 8, 0]) {
        expect((tint >> shift) & 0xff, `hour ${hour} channel ${shift}`).toBeGreaterThanOrEqual(
          0x80,
        )
      }
    }
  })

  it('changes smoothly across every in-game minute of the day', () => {
    for (let minute = 0; minute < 24 * 60; minute++) {
      const a = skyAtHour(minute / 60)
      const b = skyAtHour((minute + 1) / 60)

      for (const shift of [16, 8, 0]) {
        const ca = (a.tint >> shift) & 0xff
        const cb = (b.tint >> shift) & 0xff
        expect(Math.abs(cb - ca), `tint at ${minute}`).toBeLessThanOrEqual(4)
      }

      expect(Math.abs(b.night - a.night), `night at ${minute}`).toBeLessThanOrEqual(0.05)
      expect(Math.abs(b.lamp - a.lamp), `lamp at ${minute}`).toBeLessThanOrEqual(0.05)
    }
  })

  it('has the street lamps up for the evening and full by nightfall', () => {
    expect(skyAtHour(12).lamp).toBe(0)
    expect(skyAtHour(18).lamp).toBeGreaterThan(0)
    expect(skyAtHour(20).lamp).toBe(1)
    expect(skyAtHour(23).lamp).toBe(1)
    expect(skyAtHour(5).lamp).toBe(1)
    expect(skyAtHour(6).lamp).toBe(0)
  })
})

describe('Halloween visibility', () => {
  it('is completely hidden through the day and the evening', () => {
    for (const hour of [6, 9, 12, 15, 17.99, 18, 19, 19.99]) {
      expect(halloweenAt(hour), `hour ${hour}`).toBe(0)
    }
  })

  it('fades in over 20:00–20:30 and out over 05:30–06:00', () => {
    expect(halloweenAt(HALLOWEEN_FADE.inStartHour)).toBe(0)
    expect(halloweenAt(HALLOWEEN_FADE.inEndHour)).toBe(1)
    expect(halloweenAt(HALLOWEEN_FADE.outStartHour)).toBe(1)
    expect(halloweenAt(HALLOWEEN_FADE.outEndHour)).toBe(0)

    let previous = -1
    for (let minute = 0; minute <= 30; minute++) {
      const value = halloweenAt(20 + minute / 60)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }

    previous = 2
    for (let minute = 30; minute <= 60; minute++) {
      const value = halloweenAt(5 + minute / 60)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })

  it('is fully visible at 22:00 and 02:00', () => {
    expect(skyAtHour(22).halloween).toBe(1)
    expect(skyAtHour(2).halloween).toBe(1)
    expect(skyAtHour(5.4).halloween).toBe(1)
  })

  it('is gone again by dawn', () => {
    expect(skyAtHour(6).halloween).toBe(0)
    expect(skyAtHour(5.99).halloween).toBeLessThan(0.01)
  })
})
