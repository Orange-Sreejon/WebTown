import type { CloudBackend } from './backend'
import type { PlayerContext } from './player'

/**
 * The account the app is running as right now, for the composition root (`personal-spaces/composition.ts`) to
 * build account-backed storage from. Set by the session gate before the game starts; null without an account.
 */
export interface ActiveCloud {
  backend: CloudBackend
  player: PlayerContext
}

let active: ActiveCloud | null = null

export function setActiveCloud(next: ActiveCloud | null): void {
  active = next
}

export const activeCloud = (): ActiveCloud | null => active
