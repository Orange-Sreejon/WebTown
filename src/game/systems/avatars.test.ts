import { describe, expect, it } from 'vitest'
import {
  AVATARS,
  RECOLOURED_LOOKS,
  SHEET_LOOKS,
  animKey,
  avatarFor,
  isAvatar,
  isClothing,
  recolour,
  sheetUrl,
} from './avatars'

describe('avatars', () => {
  it('uses the chosen look, and otherwise one that stays the same for the same player', () => {
    expect(avatarFor('red-cap', 'anyone')).toBe('red-cap')
    // An old colour choice is no longer a look of its own; it becomes one of the characters.
    expect(isAvatar(avatarFor('traveller-3', 'anyone'))).toBe(true)
    const id = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
    expect(AVATARS).toContain(avatarFor('villager', id))
    expect(avatarFor('villager', id)).toBe(avatarFor(null, id))
    expect(avatarFor('<script>', id)).toBe(avatarFor(undefined, id))
    const spread = new Set(Array.from({ length: 60 }, (_, i) => avatarFor(null, `user-${i}`)))
    expect(spread.size).toBeGreaterThanOrEqual(4)
  })

  it('takes whole character sheets as looks, keeping the recolours as the fallback', () => {
    expect(RECOLOURED_LOOKS).toHaveLength(6)
    expect(SHEET_LOOKS.length).toBeGreaterThanOrEqual(3)
    for (const sheet of SHEET_LOOKS) {
      expect(isAvatar(sheet.id)).toBe(true)
      // profiles.avatar stores exactly this shape (the Phase 4 migration's check constraint).
      expect(sheet.id).toMatch(/^[a-z0-9-]{1,32}$/)
      expect(sheetUrl(sheet.id)).toBe(`/assets/characters/tiny-cast/${sheet.id}.png`)
      expect((RECOLOURED_LOOKS as readonly string[]).includes(sheet.id)).toBe(false)
      expect(sheet.label).not.toBe('')
    }
    expect(AVATARS).toHaveLength(SHEET_LOOKS.length)
    expect(new Set(AVATARS).size).toBe(AVATARS.length)
    expect(avatarFor('red-cap', 'anyone')).toBe('red-cap')
    // Unknown looks fall back to a look that is always there.
    expect(AVATARS).toContain(avatarFor('villager', 'anyone'))
    expect(isAvatar('unknown-character')).toBe(false)
    expect(isAvatar('villager')).toBe(false)
    expect(isAvatar('traveller-4')).toBe(false)
    expect(RECOLOURED_LOOKS).toContain('traveller-4')
    expect(RECOLOURED_LOOKS as readonly string[]).not.toContain('red-cap')
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
