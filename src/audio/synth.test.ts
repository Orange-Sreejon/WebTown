import { describe, expect, it } from 'vitest'
import {
  birdChirp, bookClose, computerOff, computerOn, cricketLoop, doorClose, doorOpen, footstep, keyClick, pageTurn,
  pencil, windLoop,
} from './synth'

const SR = 22050
const peak = (d: Float32Array): number => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (d: Float32Array): number => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length)
/** Rough brightness: how much the signal changes from sample to sample, relative to its level. */
const brightness = (d: Float32Array): number => {
  let diff = 0
  for (let i = 1; i < d.length; i++) diff += Math.abs(d[i]! - d[i - 1]!)
  return diff / d.reduce((s, v) => s + Math.abs(v), 0)
}

const EFFECTS: Array<[string, () => Float32Array, number, number]> = [
  // name, sound, max length (s), max peak (quiet by construction)
  ['grass step', () => footstep('grass', 0, SR), 0.2, 0.25],
  ['path step', () => footstep('path', 1, SR), 0.2, 0.25],
  ['wood step', () => footstep('wood', 2, SR), 0.2, 0.25],
  ['door open', () => doorOpen(SR), 1, 0.3],
  ['door close', () => doorClose(SR), 0.6, 0.3],
  ['computer on', () => computerOn(SR), 1.2, 0.2],
  ['computer off', () => computerOff(SR), 0.8, 0.2],
  ['key click', () => keyClick(3, SR), 0.06, 0.15],
  ['page turn', () => pageTurn(SR), 0.6, 0.2],
  ['pencil', () => pencil(1, SR), 0.25, 0.1],
  ['book close', () => bookClose(SR), 0.5, 0.25],
  ['bird', () => birdChirp(2, SR), 0.6, 0.25],
]

describe('the synthesised sounds', () => {
  for (const [name, make, maxSeconds, maxPeak] of EFFECTS) {
    it(`${name}: short, quiet, audible, clean at both ends, and the same every time`, () => {
      const d = make()
      expect(d.length).toBeGreaterThan(SR * 0.02)
      expect(d.length / SR).toBeLessThanOrEqual(maxSeconds)
      expect(d.every(Number.isFinite)).toBe(true)
      expect(peak(d)).toBeLessThanOrEqual(maxPeak + 1e-6)
      expect(peak(d)).toBeGreaterThan(maxPeak * 0.5)
      expect(Math.abs(d[0]!)).toBeLessThan(1e-3)
      expect(Math.abs(d[d.length - 1]!)).toBeLessThan(1e-3)
      expect(Array.from(make())).toEqual(Array.from(d))
    })
  }

  it('makes grass brighter than the road, and the road brighter than the wooden floor', () => {
    const avg = (s: 'grass' | 'path' | 'wood') => [0, 1, 2, 3].reduce((a, v) => a + brightness(footstep(s, v, SR)), 0) / 4
    expect(avg('grass')).toBeGreaterThan(avg('path'))
    expect(avg('path')).toBeGreaterThan(avg('wood'))
  })

  it('varies each footstep slightly, so no two in a row are identical', () => {
    const a = footstep('grass', 0, SR)
    const b = footstep('grass', 1, SR)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  for (const [name, make, seconds] of [['wind', windLoop, 8], ['crickets', cricketLoop, 6]] as const) {
    it(`${name} loops without a seam`, () => {
      const d = make(SR)
      expect(d.length).toBe(SR * seconds)
      expect(d.every(Number.isFinite)).toBe(true)
      expect(rms(d)).toBeGreaterThan(0.01)
      // The jump across the loop point is no bigger than an ordinary step inside the loop.
      const typical = d.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - d[i]!)), 0)
      expect(Math.abs(d[0]! - d[d.length - 1]!)).toBeLessThanOrEqual(typical + 1e-6)
    })
  }
})
