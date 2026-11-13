/**
 * Which house the local player owns.
 *
 * A stand-in until accounts exist: exactly one configured house is "yours" and
 * may be edited; every other house is visited read-only. When ownership becomes
 * real, `canEditHouse` turns into a permission check and its callers stay as
 * they are.
 */

/** The house the local player owns. */
export const LOCAL_PLAYER_HOUSE_ID = 'house-a'

/**
 * The owned house for this session. In development builds `?owner=<houseId>`
 * picks a different one for testing; production builds ignore the parameter.
 */
export function resolveOwnedHouseId(search: string, isDev: boolean): string {
  if (!isDev) return LOCAL_PLAYER_HOUSE_ID
  const query = search.startsWith('?') ? search.slice(1) : search
  const requested = new URLSearchParams(query).get('owner')?.trim()
  // House ids are simple slugs; anything else is ignored rather than trusted.
  return requested && /^[a-z0-9-]{1,40}$/.test(requested) ? requested : LOCAL_PLAYER_HOUSE_ID
}

function currentOwnedHouseId(): string {
  const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
  const search = typeof window === 'undefined' ? '' : window.location.search
  return resolveOwnedHouseId(search, isDev)
}

/** True when the local player may edit this house. */
export function canEditHouse(houseId: string, ownedHouseId: string = currentOwnedHouseId()): boolean {
  return houseId.length > 0 && houseId === ownedHouseId
}
