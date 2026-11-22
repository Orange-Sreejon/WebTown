import { afterEach, describe, expect, it } from 'vitest'
import { HOUSES } from './houses'
import { setPlayerHouse } from '../../lib/player-identity'
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

describe('ownership with an account (Phase 4)', () => {
  afterEach(() => setPlayerHouse(null))

  it('is the house the database assigned, whatever the URL says', () => {
    setPlayerHouse({ ownedSlot: 'house-c' })
    expect(canEditHouse('house-c')).toBe(true)
    expect(canEditHouse('house-a')).toBe(false)
  })

  it('is no house at all when the account owns none in this world', () => {
    setPlayerHouse({ ownedSlot: null })
    for (const house of HOUSES) expect(canEditHouse(house.id)).toBe(false)
  })

  it('falls back to the local rule when signed out', () => {
    setPlayerHouse(null)
    expect(canEditHouse(LOCAL_PLAYER_HOUSE_ID)).toBe(true)
  })
})
