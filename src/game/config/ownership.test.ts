import { describe, expect, it } from 'vitest'
import { HOUSES } from './houses'
import { LOCAL_PLAYER_HOUSE_ID, canEditHouse, resolveOwnedHouseId } from './ownership'

describe('ownership stand-in', () => {
  it('owns exactly one real house', () => {
    expect(HOUSES.map(h => h.id)).toContain(LOCAL_PLAYER_HOUSE_ID)
    const editable = HOUSES.filter(h => canEditHouse(h.id, LOCAL_PLAYER_HOUSE_ID))
    expect(editable.map(h => h.id)).toEqual([LOCAL_PLAYER_HOUSE_ID])
  })

  it('treats every other house, and no house, as read-only', () => {
    expect(canEditHouse('house-b', 'house-a')).toBe(false)
    expect(canEditHouse('', '')).toBe(false)
  })

  it('lets ?owner= choose the house in development only', () => {
    expect(resolveOwnedHouseId('?owner=house-c', true)).toBe('house-c')
    expect(resolveOwnedHouseId('owner=house-d', true)).toBe('house-d')
    expect(resolveOwnedHouseId('?owner=house-c', false)).toBe(LOCAL_PLAYER_HOUSE_ID)
  })

  it('ignores a missing or malformed ?owner=', () => {
    expect(resolveOwnedHouseId('', true)).toBe(LOCAL_PLAYER_HOUSE_ID)
    expect(resolveOwnedHouseId('?owner=', true)).toBe(LOCAL_PLAYER_HOUSE_ID)
    expect(resolveOwnedHouseId('?owner=<script>', true)).toBe(LOCAL_PLAYER_HOUSE_ID)
    expect(resolveOwnedHouseId(`?owner=${'x'.repeat(41)}`, true)).toBe(LOCAL_PLAYER_HOUSE_ID)
  })
})
