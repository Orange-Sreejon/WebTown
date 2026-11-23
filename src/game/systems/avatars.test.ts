import { describe, expect, it } from 'vitest'
import { AVATARS, animKey, avatarFor, isClothing, recolour } from './avatars'

describe('avatars', () => {
  it('uses the chosen look, and otherwise one that stays the same for the same player', () => {
    expect(avatarFor('traveller-3', 'anyone')).toBe('traveller-3')
    const id = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
    expect(AVATARS).toContain(avatarFor('villager', id))
    expect(avatarFor('villager', id)).toBe(avatarFor(null, id))
    expect(avatarFor('<script>', id)).toBe(avatarFor(undefined, id))
    const spread = new Set(Array.from({ length: 60 }, (_, i) => avatarFor(null, `user-${i}`)))
    expect(spread.size).toBeGreaterThanOrEqual(4)
  })

  it('keeps the Phase 1 animation names for the original look', () => {
    expect(animKey('walk', 'down', 'traveller')).toBe('walk-down')
    expect(animKey('idle', 'up', 'traveller-2')).toBe('idle-up@traveller-2')
  })

  it('recolours the hat and shirt yellows only', () => {
    const hat = [232, 184, 48, 255]
    const skin = [242, 194, 150, 255]
    const hair = [110, 64, 32, 255]
    const outline = [40, 24, 16, 255]
    const clear = [232, 184, 48, 0]
    expect(isClothing(...(hat as [number, number, number, number]))).toBe(true)
    for (const px of [skin, hair, outline, clear]) expect(isClothing(...(px as [number, number, number, number]))).toBe(false)

    const data = new Uint8ClampedArray([...hat, ...skin, ...hair, ...outline, ...clear])
    recolour(data, 'traveller-1')
    expect(Array.from(data.slice(0, 4))).not.toEqual(hat)
    expect(Array.from(data.slice(4))).toEqual([...skin, ...hair, ...outline, ...clear])

    const original = new Uint8ClampedArray(hat)
    recolour(original, 'traveller')
    expect(Array.from(original)).toEqual(hat)
  })
})
