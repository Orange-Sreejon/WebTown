import { storageWhere } from '../labels'

/**
 * Whose website the Site Studio is editing (CH-05a; .kiro/specs/community-hall/design.md 4.3): a resident's house, or
 * a town's Community Website (the Hall). Pure: no storage, no UI.
 *
 * Stored records keep their `houseId` field as the site's key, so nothing already saved changes shape and needs no
 * migration: a house's key is its slot (`house-a`...), the Community Website's is COMMUNITY_SITE_KEY. No house can
 * ever have that key (game/config/ownership.ts refuses it), and a Hall's draft is never kept with houses' websites:
 * its writer (CH-06) sends it to that world's Community Hall on the server.
 */

export type SiteTarget =
  | { kind: 'house'; houseId: string }
  | { kind: 'hall'; worldId: string }

/** The key a Community Website's records carry where a house's carry its slot. Equal to COMMUNITY_HALL_ID. */
export const COMMUNITY_SITE_KEY = 'community-hall'

export const houseTarget = (houseId: string): SiteTarget => ({ kind: 'house', houseId })
export const hallTarget = (worldId: string): SiteTarget => ({ kind: 'hall', worldId })

/** The key stamped on the project and its images (`SiteProject.houseId`, `SiteAsset.houseId`). */
export function siteKey(target: SiteTarget): string {
  return target.kind === 'house' ? target.houseId : COMMUNITY_SITE_KEY
}

/** What the Studio says where it differs between one owner's website and the town's shared one. */
export interface StudioWording {
  /** Under the editor: who sees what is saved. */
  savedFor: string
  /** The conflict dialog: someone saved after this draft was opened. */
  conflict: string
  /** After loading the newer version. */
  reloaded: string
}

export function studioWording(target: SiteTarget): StudioWording {
  if (target.kind === 'hall') {
    return {
      savedFor: 'Everyone in town can edit this draft. Visitors see the Community Website only once a moderator publishes it.',
      conflict: 'Someone else in town saved the draft after you opened it. Saving now would replace their version.',
      reloaded: 'Showing the draft as it was last saved.',
    }
  }
  return {
    savedFor: storageWhere() === 'device' ? 'Visitors on this device see the saved version.' : 'Visitors to your town see the saved version.',
    conflict: 'This website was saved in another tab after you opened it. Saving now would replace that version.',
    reloaded: 'Showing the version saved in the other tab.',
  }
}
