import { describe, expect, it } from 'vitest'
import { parseEmote, parseMove, parsePresence } from './protocol'

const S = '11111111-1111-4111-8111-111111111111'
const U = '22222222-2222-4222-8222-222222222222'
const move = { v: 1, s: S, q: 3, t: 1200, sc: 'town', x: 100.04, y: 200, f: 'left', w: 1 }
const presence = { v: 1, s: S, u: U, j: 1700000000000, q: 4, sc: 'house:house-b', x: 50, y: 60, f: 'down' }

describe('protocol', () => {
  it('accepts well-formed messages, rounding positions to a tenth of a pixel', () => {
    expect(parseMove(move)).toEqual({ ...move, x: 100 })
    expect(parsePresence(presence)).toEqual(presence)
    expect(parseEmote({ v: 1, s: S, q: 0, e: 'wave', to: U })).toEqual({ v: 1, s: S, q: 0, e: 'wave', to: U })
    expect(parseEmote({ v: 1, s: S, q: 9, e: 'heart' })).toEqual({ v: 1, s: S, q: 9, e: 'heart' })
  })

  it('drops anything malformed', () => {
    const broken: unknown[] = [
      null, 'mv', 42, [], {},
      { ...move, v: 2 }, { ...move, s: 'me' }, { ...move, q: -1 }, { ...move, q: 1.5 }, { ...move, q: '3' },
      { ...move, t: undefined }, { ...move, t: -5 }, { ...move, t: 1.5 },
      { ...move, f: 'north' }, { ...move, w: true }, { ...move, sc: 'house:' }, { ...move, sc: 'house:../x' },
      { ...move, sc: 'interior' }, { ...move, x: '100' }, { ...move, x: Number.NaN }, { ...move, y: Infinity },
    ]
    for (const raw of broken) expect(parseMove(raw), JSON.stringify(raw)).toBeNull()
    expect(parsePresence({ ...presence, u: 'admin' })).toBeNull()
    expect(parsePresence({ ...presence, j: -5 })).toBeNull()
    expect(parsePresence({ ...presence, q: undefined })).toBeNull()
    expect(parseEmote({ v: 1, s: S, q: 1, e: 'dance' })).toBeNull()
    expect(parseEmote({ v: 1, s: S, q: 1, e: 'wave', to: 'everyone' })).toBeNull()
  })

  it('drops coordinates outside the scene', () => {
    expect(parseMove({ ...move, x: -0.1 })).toBeNull()
    expect(parseMove({ ...move, x: 1280.1 })).toBeNull()
    expect(parseMove({ ...move, y: 1024.5 })).toBeNull()
    expect(parseMove({ ...move, x: 1280, y: 1024 })).not.toBeNull()
    expect(parseMove({ ...move, sc: 'house:house-a', x: 1100 })).toBeNull()
    expect(parseMove({ ...move, x: 1e300 })).toBeNull()
  })

  it('drops oversized payloads before reading them', () => {
    expect(parseMove({ ...move, junk: 'x'.repeat(600) })).toBeNull()
    expect(parsePresence({ ...presence, name: 'x'.repeat(600) })).toBeNull()
    const cyclic: Record<string, unknown> = { ...move }
    cyclic['self'] = cyclic
    expect(parseMove(cyclic)).toBeNull()
  })
})
