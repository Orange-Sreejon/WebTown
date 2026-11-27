import { describe, expect, it } from 'vitest'
import { COMMUNITY_HALL_ID } from '../../game/systems/community-hall'
import { HOUSES } from '../../game/config/houses'
import { resolveOwnedHouseId } from '../../game/config/ownership'
import { PermissionError } from '../errors'
import { guardProjectWriter } from '../site-project-storage/guarded-project-writer'
import { blankProject } from './templates'
import { COMMUNITY_SITE_KEY, hallTarget, houseTarget, siteKey, studioWording } from './site-target'
import type { SiteProject, SiteSave } from './types'

const NOW = '2026-12-21T00:00:00.000Z'
const WORLD = '0b6c1c4e-8f0e-4c7e-9d7a-000000000001'

describe('SiteTarget (CH-05a)', () => {
  it("gives a house its own slot as the site's key, unchanged", () => {
    for (const h of HOUSES) expect(siteKey(houseTarget(h.id))).toBe(h.id)
  })

  it("gives the Community Website a key no house can have", () => {
    expect(siteKey(hallTarget(WORLD))).toBe(COMMUNITY_SITE_KEY)
    expect(COMMUNITY_SITE_KEY).toBe(COMMUNITY_HALL_ID)
    expect(HOUSES.map(h => h.id)).not.toContain(COMMUNITY_SITE_KEY)
    expect(resolveOwnedHouseId(`?owner=${COMMUNITY_SITE_KEY}`, true)).not.toBe(COMMUNITY_SITE_KEY)
  })

  it("keeps a house's guarded writer from saving a Community Website, and the other way round", async () => {
    let saved = 0
    const writer = { save: async (s: SiteSave): Promise<SiteProject> => { saved++; return s.project } }
    const save = (houseId: string): SiteSave => ({ project: blankProject(houseId, NOW), baseRevision: 0, putAssets: [], deleteAssetIds: [] })
    const houseWriter = guardProjectWriter(writer, { houseId: 'house-a', mode: 'owner' })
    await expect(houseWriter.save(save(COMMUNITY_SITE_KEY))).rejects.toBeInstanceOf(PermissionError)
    await expect(houseWriter.save(save('house-a'))).resolves.toMatchObject({ houseId: 'house-a' })
    expect(saved).toBe(1)
  })

  it('words the Studio for one owner or for the whole town', () => {
    expect(studioWording(houseTarget('house-a')).conflict).toMatch(/another tab/)
    const hall = studioWording(hallTarget(WORLD))
    expect(hall.savedFor).toMatch(/moderator publishes/)
    expect(hall.conflict).toMatch(/Someone else in town/)
    expect(Object.values(hall).join(' ')).not.toMatch(/tab|your house/i)
  })
})
