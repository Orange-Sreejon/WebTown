import type { CloudBackend } from './backend'
import { isUuid, toAppError } from './backend'
import { StorageError } from '../personal-spaces/errors'

/**
 * Who the player is in WebTown, as the database says after `bootstrap_player`: their profile, their world,
 * its houses and which one is theirs. The game keeps using map slots (`house-a`); this maps them to the
 * houses' stable ids.
 */
export interface Profile {
  id: string
  displayName: string
  avatar: string
  settings: Record<string, unknown>
  createdAt: string
}

export interface WorldHouse {
  id: string
  slot: string
  ownerId: string | null
}

export interface PlayerContext {
  userId: string
  profile: Profile
  world: { id: string; name: string; role: 'owner' | 'resident' | 'visitor' }
  houses: WorldHouse[]
  /** The slot of the player's own house in this world, or null. */
  ownedSlot: string | null
}

const SLOT = /^[a-z0-9-]{1,40}$/

/** Turns the function's answer into a context, refusing anything malformed (stored data is untrusted). */
export function parseBootstrap(userId: string, raw: unknown): PlayerContext {
  const fail = (): never => {
    throw new StorageError('WebTown sent back something it should not have. Please try again.')
  }
  const r = raw as Record<string, unknown> | null
  const p = r?.['profile'] as Record<string, unknown> | undefined
  const w = r?.['world'] as Record<string, unknown> | undefined
  const hs = r?.['houses']
  if (!p || !w || !Array.isArray(hs)) return fail()
  if (p['id'] !== userId || typeof p['displayName'] !== 'string' || typeof p['avatar'] !== 'string') return fail()
  const settings = p['settings']
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return fail()
  const role = w['role']
  if (!isUuid(w['id']) || typeof w['name'] !== 'string' || (role !== 'owner' && role !== 'resident' && role !== 'visitor')) return fail()
  const houses: WorldHouse[] = []
  for (const h of hs as unknown[]) {
    const x = h as Record<string, unknown> | null
    if (!x || !isUuid(x['id']) || typeof x['slot'] !== 'string' || !SLOT.test(x['slot'])) return fail()
    const owner = x['ownerId']
    if (owner !== null && !isUuid(owner)) return fail()
    houses.push({ id: x['id'], slot: x['slot'], ownerId: owner as string | null })
  }
  const owned = houses.filter(h => h.ownerId === userId)
  if (owned.length > 1) return fail()
  return {
    userId,
    profile: {
      id: userId,
      displayName: p['displayName'],
      avatar: p['avatar'],
      settings: { ...(settings as Record<string, unknown>) },
      createdAt: String(p['createdAt'] ?? ''),
    },
    world: { id: w['id'], name: w['name'], role },
    houses,
    ownedSlot: owned[0]?.slot ?? null,
  }
}

/** Creates or restores the player's profile, world and house. Safe to call on every start. */
export async function bootstrapPlayer(backend: CloudBackend, userId: string): Promise<PlayerContext> {
  try {
    return parseBootstrap(userId, await backend.rpc('bootstrap_player'))
  } catch (error) {
    throw toAppError(error)
  }
}

/** The stable id of the house on a map slot, or null if this world has no such house. */
export function houseIdForSlot(player: Pick<PlayerContext, 'houses'>, slot: string): string | null {
  return player.houses.find(h => h.slot === slot)?.id ?? null
}

/** Saves the profile fields the player may change. Returns the profile as stored. */
export async function updateProfile(backend: CloudBackend, userId: string, change: { displayName?: string; settings?: Record<string, unknown> }): Promise<Profile> {
  let raw: unknown
  try {
    raw = await backend.rpc('update_profile', {
      p_display_name: change.displayName ?? null,
      p_avatar: null,
      p_settings: change.settings ?? null,
    })
  } catch (error) {
    throw toAppError(error)
  }
  const p = raw as Record<string, unknown> | null
  if (!p || p['id'] !== userId || typeof p['displayName'] !== 'string') throw new StorageError('WebTown sent back something it should not have.')
  return {
    id: userId,
    displayName: p['displayName'],
    avatar: String(p['avatar'] ?? 'villager'),
    settings: (typeof p['settings'] === 'object' && p['settings'] !== null ? p['settings'] : {}) as Record<string, unknown>,
    createdAt: String(p['createdAt'] ?? ''),
  }
}
