import { describe, expect, it } from 'vitest'
import { MAX_PREVIEWS, PREVIEW_MAX_VALUES, PREVIEW_TTL_MS, PreviewSender, Previews, parsePreview } from './preview'

const id = '0b6c1c4e-8f0e-4c7e-9d7a-1f2e3d4c5b6a'
const msg = (over: Record<string, unknown> = {}) => ({ v: 1, id, i: 0, p: [0, 0, 1, 1], t: 'pen', c: '#112233', w: 4, ...over })

describe('parsePreview', () => {
  it('accepts a well-formed message', () => {
    expect(parsePreview(msg())).toEqual(msg())
  })

  it('refuses anything else, as from an untrusted sender', () => {
    for (const raw of [null, [], 'x', msg({ v: 2 }), msg({ id: 'x' }), msg({ i: -2 }), msg({ i: 1 }), msg({ i: 4000 }), msg({ p: [] }),
      msg({ p: [1] }), msg({ p: [1, 2, 3] }), msg({ p: [0, 0.5] }), msg({ p: [0, 1_000_001] }), msg({ p: ['1', 2] }),
      msg({ p: Array.from({ length: PREVIEW_MAX_VALUES + 2 }, () => 0) }), msg({ i: 3800, p: Array.from({ length: 202 }, () => 0) }),
      msg({ t: 'spray' }), msg({ c: 'red' }), msg({ c: '#FFFFFF' }), msg({ w: 0 }), msg({ w: 65 }), msg({ w: 1.5 })]) {
      expect(parsePreview(raw), JSON.stringify(raw)?.slice(0, 80)).toBeNull()
    }
  })
})

describe('Previews', () => {
  it('grows a preview from where it is, ignoring gaps and starting only at the beginning', () => {
    const p = new Previews()
    expect(p.receive(parsePreview(msg({ i: 2 }))!, 0)).toBe(false) // the start was missed
    expect(p.receive(parsePreview(msg())!, 0)).toBe(true)
    expect(p.receive(parsePreview(msg({ i: 4, p: [2, 2] }))!, 1)).toBe(true)
    expect(p.receive(parsePreview(msg({ i: 8, p: [9, 9] }))!, 2)).toBe(false) // gap
    expect(p.receive(parsePreview(msg({ i: 2, p: [5, 5] }))!, 3)).toBe(true) // a repeat overwrites from there
    expect(p.all()[0]!.points).toEqual([0, 0, 5, 5])
  })

  it('goes quiet after a while, ends when told, and shows only so many at once', () => {
    const p = new Previews()
    p.receive(parsePreview(msg())!, 0)
    expect(p.expire(PREVIEW_TTL_MS)).toBe(false)
    expect(p.expire(PREVIEW_TTL_MS + 1)).toBe(true)
    expect(p.all()).toEqual([])
    for (let k = 0; k < MAX_PREVIEWS + 3; k++) p.receive(parsePreview(msg({ id: `0b6c1c4e-8f0e-4c7e-9d7a-${String(k).padStart(12, '0')}` }))!, 0)
    expect(p.all()).toHaveLength(MAX_PREVIEWS)
    expect(p.end(`0b6c1c4e-8f0e-4c7e-9d7a-${'0'.repeat(12)}`)).toBe(true)
  })
})

describe('PreviewSender', () => {
  it('sends what is new, at most 15 times a second, in messages small enough', () => {
    const s = new PreviewSender(id, 'marker', '#000000', 8)
    expect(s.take([0, 0, 1, 1], 0)).toEqual([{ v: 1, id, i: 0, p: [0, 0, 1, 1], t: 'marker', c: '#000000', w: 8 }])
    expect(s.take([0, 0, 1, 1, 2, 2], 10)).toEqual([]) // too soon
    expect(s.take([0, 0, 1, 1, 2, 2], 70)).toMatchObject([{ i: 4, p: [2, 2] }])
    expect(s.take([0, 0, 1, 1, 2, 2], 200)).toEqual([]) // nothing new
    const many = Array.from({ length: 1006 }, (_, i) => i)
    const parts = s.take(many, 300)
    expect(parts.map(m => [m.i, m.p.length])).toEqual([[6, 400], [406, 400], [806, 200]])
    for (const m of parts) expect(parsePreview(m)).not.toBeNull()
    expect(s.take([...many, 7, 7], 301, true)).toMatchObject([{ i: 1006 }]) // pen up: sent at once
  })
})
