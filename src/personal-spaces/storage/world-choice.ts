import { isUuid } from '../../cloud/backend'

/**
 * Which town this device opens for an account (Phase 5): the id of a world they joined, or nothing for their
 * own. A hint only; the database decides whether they are still in it.
 */
const worldKey = (userId: string): string => `webtown.world.${userId}`

export function rememberedWorld(userId: string): string | null {
  try {
    const v = window.localStorage.getItem(worldKey(userId))
    return isUuid(v) ? v : null
  } catch {
    return null
  }
}

export function rememberWorld(userId: string, worldId: string | null): void {
  try {
    if (worldId) window.localStorage.setItem(worldKey(userId), worldId)
    else window.localStorage.removeItem(worldKey(userId))
  } catch {
    // Storage blocked: the personal world opens next time.
  }
}
