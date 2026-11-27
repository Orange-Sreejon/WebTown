import type { AppId } from '../../lib/app-bridge'

/**
 * The Community Hall in the game (CH-02; .kiro/specs/community-hall/design.md 4.1): the church's door leads into a
 * shared room for the whole town. It is not a house: it has no owner, no furniture editing and no slot in `HOUSES`
 * (so the seven houses and the seven-member limit are unchanged). Its easel opens the Community Canvas (CH-04) and its
 * kiosk the Community Website (CH-06). Pure: no Phaser.
 */

/** The id the Hall uses where houses use their slot (scenes, transitions, the return position). */
export const COMMUNITY_HALL_ID = 'community-hall'

/** The multiplayer scene id of the Hall (houses are `house:<slot>`). */
export const HALL_SCENE = 'hall'

export const isCommunityHall = (id: string): boolean => id === COMMUNITY_HALL_ID

export const HALL_WELCOME = 'Community Hall: shared by everyone in this town.'

/** What the door says. Without an account there is no town to share, so the Hall stays closed. */
export function hallDoorPrompt(online: boolean): string {
  return online ? 'E: Enter Community Hall' : 'Community Hall: opens when you play online'
}

export const canEnterHall = (online: boolean): boolean => online

/** The Hall's objects are the room's kiosk (the computer desk) and easel (the notebook table). */
export function hallObjectPrompt(app: AppId): string {
  return app === 'website' ? 'E: Community Website' : 'E: Community Canvas'
}

/** What a Hall object opens: the easel the shared canvas, the kiosk the Community Website. */
export function hallObjectApp(app: AppId): AppId | null {
  return app === 'paint' ? 'canvas' : app === 'website' ? 'community-website' : null
}

/** Said when the kiosk is used, until the Community Website exists. */
export function hallObjectSoon(app: AppId): string {
  return app === 'website'
    ? 'The Community Website will open here soon.'
    : 'The shared drawing canvas will open here soon.'
}
