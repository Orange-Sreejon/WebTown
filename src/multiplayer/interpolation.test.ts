import { describe, expect, it } from 'vitest'
import { RENDER_DELAY_MS, STALE_WALK_MS, addSample, easeDelay, poseAt, renderDelay, type Sample } from './interpolation'

const walk = (t: number, x: number): Sample => ({ t, x, y: 100, f: 'right', w: true })

describe('interpolation', () => {
  it('draws the player between the two samples around the render time', () => {
    const buf: Sample[] = []
    addSample(buf, walk(0, 0))
    addSample(buf, walk(100, 8))
    addSample(buf, walk(200, 16))
    expect(poseAt(buf, 50 + RENDER_DELAY_MS)).toEqual({ x: 4, y: 100, f: 'right', walking: true })
    expect(poseAt(buf, 150 + RENDER_DELAY_MS)!.x).toBeCloseTo(12)
  })

  it('moves steadily frame by frame, without jumps, at 10 updates a second', () => {
    const buf: Sample[] = []
    for (let i = 0; i <= 20; i++) addSample(buf, walk(i * 100 + (i % 2 ? 15 : -10), i * 8)) // jittery arrival
    let last = poseAt(buf, 300)!.x
    for (let now = 316; now <= 2000; now += 16) {
      const x = poseAt(buf, now)!.x
      expect(x).toBeGreaterThanOrEqual(last)
      expect(x - last).toBeLessThan(4) // never more than a few pixels per frame
      last = x
    }
  })

  it('waits at the last sample, still walking for a moment, then stands', () => {
    const buf: Sample[] = [walk(0, 0), walk(100, 8)]
    const at = (ms: number) => poseAt(buf, 100 + RENDER_DELAY_MS + ms)!
    expect(at(50)).toEqual({ x: 8, y: 100, f: 'right', walking: true })
    expect(at(STALE_WALK_MS).walking).toBe(true)
    expect(at(STALE_WALK_MS + 1)).toEqual({ x: 8, y: 100, f: 'right', walking: false })
  })

  it('does not tween a jump, and ignores samples from the past', () => {
    const buf: Sample[] = [walk(0, 0), walk(100, 8)]
    expect(addSample(buf, walk(200, 400))).toBe(true)
    expect(buf).toEqual([walk(200, 400)])
    expect(addSample(buf, walk(150, 401))).toBe(false)
    expect(buf).toHaveLength(1)
  })

  it('keeps a slow, uneven sender moving forward when drawn far enough behind', () => {
    const buf: Sample[] = []
    let x = 0
    const steps = [30, 10, 45, 5, 25, 40, 8, 33]
    steps.forEach((d, i) => { x += d; addSample(buf, walk(i * 400 + (i % 3) * 37, x)) })
    let last = poseAt(buf, 900, renderDelay(400))!.x
    for (let now = 916; now <= 3400; now += 16) {
      const p = poseAt(buf, now, renderDelay(400))!
      expect(p.x).toBeGreaterThanOrEqual(last - 1e-9)
      last = p.x
    }
    expect(renderDelay(100)).toBe(170)
    expect(renderDelay(30)).toBe(RENDER_DELAY_MS)
    expect(renderDelay(5000)).toBe(700)
  })

  it('changes the delay without turning the drawing clock back', () => {
    let delay = RENDER_DELAY_MS
    let drawnTime = 1000 - delay
    for (let now = 1016; now < 3000; now += 16) {
      delay = easeDelay(delay, 620, 16)
      expect(now - delay).toBeGreaterThan(drawnTime)
      drawnTime = now - delay
    }
    expect(delay).toBe(620)
    expect(easeDelay(620, 170, 16)).toBe(616)
  })

  it('shows a standing player standing', () => {
    expect(poseAt([{ t: 0, x: 5, y: 6, f: 'up', w: false }], 1000)).toEqual({ x: 5, y: 6, f: 'up', walking: false })
    expect(poseAt([], 0)).toBeNull()
  })
})
