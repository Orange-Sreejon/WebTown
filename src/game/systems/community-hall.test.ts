import { describe, expect, it } from 'vitest'
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, TILE_SIZE } from '../config/GameConfig'
import { COMMUNITY_HALL, DEFAULT_INTERIOR_ID, HOUSES } from '../config/houses'
import { canEditHouse, resolveOwnedHouseId } from '../config/ownership'
import { getCollisionRects } from '../maps/collision-objects'
import { buildObjectTargets } from '../maps/house/object-targets'
import { openRoom } from '../maps/house/room-opening'
import { STRUCTURES, doorColumn } from '../maps/town-layout'
import { rectContains, rectsOverlap } from '../../lib/geometry'
import { parseMove, parsePresence } from '../../multiplayer/protocol'
import {
  COMMUNITY_HALL_ID, HALL_SCENE, canEnterHall, hallDoorPrompt, hallObjectApp, hallObjectPrompt, hallObjectSoon, isCommunityHall,
} from './community-hall'
import { buildEntrances, findNearbyTarget } from './interaction'
import { playerBodyRect } from './return-position'

/** CH-02: the church's door leads into the Community Hall; houses are exactly as before. */

const ENTRANCES = buildEntrances([...HOUSES, COMMUNITY_HALL], STRUCTURES)
const HALL = ENTRANCES.find(e => e.id === COMMUNITY_HALL_ID)!

describe('the Community Hall entrance', () => {
  it('is the church, and not a house: the seven houses and their slots are unchanged', () => {
    expect(COMMUNITY_HALL).toMatchObject({ id: COMMUNITY_HALL_ID, structureLabel: 'church', interiorId: DEFAULT_INTERIOR_ID })
    expect(HOUSES.map(h => h.id)).toEqual(['house-a', 'house-b', 'house-c', 'house-d', 'house-e', 'house-f', 'house-g'])
    expect(HOUSES.some(h => h.structureLabel === 'church' || h.id === COMMUNITY_HALL_ID)).toBe(false)
    expect(isCommunityHall(COMMUNITY_HALL_ID)).toBe(true)
    expect(isCommunityHall('house-a')).toBe(false)
  })

  it("sits on the church's door, inside the map, without overlapping any house's door", () => {
    const church = STRUCTURES.find(s => s.label === 'church')!
    const bottom = (church.tileY + church.hTiles) * TILE_SIZE
    expect(HALL.zone.x + HALL.zone.w / 2).toBe(doorColumn(church) * TILE_SIZE + TILE_SIZE / 2)
    expect(HALL.zone.y).toBe(bottom - 8)
    expect(rectContains({ x: 0, y: 0, w: MAP_WIDTH_PX, h: MAP_HEIGHT_PX }, HALL.zone)).toBe(true)
    for (const e of ENTRANCES) if (e !== HALL) expect(rectsOverlap(e.zone, HALL.zone), e.id).toBe(false)
    expect(findNearbyTarget(HALL.fallbackFeet, ENTRANCES)?.id).toBe(COMMUNITY_HALL_ID)
  })

  it('can be walked up to: the spot in front of the door is free of colliders', () => {
    const colliders = getCollisionRects()
    const bottom = HALL.zone.y + HALL.zone.h - 32
    for (const spot of [HALL.fallbackFeet, { x: HALL.zone.x + HALL.zone.w / 2, y: bottom + 16 }]) {
      const hit = colliders.find(c => rectsOverlap(playerBodyRect(spot.x, spot.y), c, 0.5))
      expect(hit, `blocked by ${hit?.label} at (${spot.x},${spot.y})`).toBeUndefined()
    }
  })

  it('opens online only, and says so at the door', () => {
    expect(canEnterHall(true)).toBe(true)
    expect(canEnterHall(false)).toBe(false)
    expect(hallDoorPrompt(true)).toBe('E: Enter Community Hall')
    expect(hallDoorPrompt(false)).toBe('Community Hall: opens when you play online')
  })
})

describe('inside the Community Hall', () => {
  it('opens the standard room, with no rule broken and nothing "restored"', () => {
    const opening = openRoom(COMMUNITY_HALL_ID, COMMUNITY_HALL.interiorId, undefined)
    expect(opening.ok).toBe(true)
    if (!opening.ok) return
    expect(opening.violations).toEqual([])
  })

  it('has a kiosk and an easel, with their own prompts and placeholder messages', () => {
    const opening = openRoom(COMMUNITY_HALL_ID, COMMUNITY_HALL.interiorId, undefined)
    if (!opening.ok) throw new Error('no room')
    const apps = buildObjectTargets(opening.definition).map(t => t.app)
    expect(apps).toEqual(['website', 'paint'])
    expect(apps.map(hallObjectPrompt)).toEqual(['E: Community Website', 'E: Community Canvas'])
    expect(hallObjectSoon('website')).toMatch(/Community Website/)
    // The easel opens the shared canvas (CH-04); the kiosk opens nothing yet.
    expect(apps.map(hallObjectApp)).toEqual([null, 'canvas'])
  })

  it('belongs to nobody: not even the developer ?owner= switch can make it editable', () => {
    expect(resolveOwnedHouseId('?owner=community-hall', true)).toBe('house-a')
    expect(resolveOwnedHouseId('?owner=house-c', true)).toBe('house-c')
    expect(canEditHouse(COMMUNITY_HALL_ID, 'house-a')).toBe(false)
  })

  it('is a multiplayer scene of its own, so players see each other there and nowhere else', () => {
    const s = crypto.randomUUID()
    const move = { v: 1, s, q: 1, t: 10, sc: HALL_SCENE, x: 100, y: 120, f: 'down', w: 1 }
    expect(parseMove(move)).toMatchObject({ sc: 'hall' })
    expect(parsePresence({ v: 1, s, u: crypto.randomUUID(), j: 1, q: 0, sc: HALL_SCENE, x: 5, y: 5, f: 'up' })).not.toBeNull()
    for (const sc of ['halls', 'hall:x', 'Hall', 'house:']) expect(parseMove({ ...move, sc }), sc).toBeNull()
  })
})
