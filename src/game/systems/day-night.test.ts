import { describe, it, expect } from 'vitest'
import { DAY_CYCLE_MS, skyAt } from './day-night'

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
})
