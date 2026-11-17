import { ValidationError } from '../errors'
import { createDefaultSite } from '../website/default-site'
import { toReadonlySite } from '../website/site-readonly'
import {
  HOUSE_ID_PATTERN,
  type ReadonlySiteContent,
  type SiteContent,
} from '../website/site-types'
import { validateSite } from '../website/site-validation'

/**
 * The rules every site repository shares, so memory and IndexedDB behave
 * identically: what may be saved, and what a load makes of what it finds.
 * Pure functions; no storage in here.
 */

/** Where a loaded site came from. Reported, never stored. */
export type SiteLoadOrigin = 'saved' | 'default' | 'recovered'

export interface SiteLoadReport {
  houseId: string
  origin: SiteLoadOrigin
  /** For `recovered`: what was wrong with the stored record, in words. */
  problems: readonly string[]
}

export type Clock = () => string

export const systemClock: Clock = () => new Date().toISOString()

/** A house id, checked before it is used as a storage key. */
export function requireHouseId(houseId: unknown): string {
  if (typeof houseId !== 'string' || !HOUSE_ID_PATTERN.test(houseId)) {
    throw new ValidationError([{ path: 'houseId', message: 'That is not a valid house.' }])
  }
  return houseId
}

/**
 * Checks a site about to be saved and stamps it. The result is a new object
 * built from known fields only, so what is stored never shares anything with
 * what the caller passed in.
 */
export function prepareSave(site: unknown, now: Clock): SiteContent {
  const checked = validateSite(site)
  if (!checked.ok) throw new ValidationError(checked.errors)

  const stamped: SiteContent = { ...checked.value, updatedAt: now() }
  // The stamp is ours, but it goes through the same gate as everything else.
  const again = validateSite(stamped)
  if (!again.ok) throw new ValidationError(again.errors)
  return again.value
}

/**
 * Makes a read-only site from whatever a store returned for `houseId`.
 *
 * Stored data is untrusted. Nothing there: the default site. Something there
 * that is not a valid site for this very house: the default site too, reported
 * as `recovered`, and the stored record is left exactly as it was, so a repair
 * or a newer version can still read it. Only a later save replaces it.
 */
export function readRecord(
  houseId: string,
  raw: unknown,
  now: Clock,
): { site: ReadonlySiteContent; report: SiteLoadReport } {
  if (raw === undefined || raw === null) {
    return {
      site: toReadonlySite(createDefaultSite(houseId, now())),
      report: { houseId, origin: 'default', problems: [] },
    }
  }

  const checked = validateSite(raw)
  if (checked.ok && checked.value.houseId === houseId) {
    return {
      site: toReadonlySite(checked.value),
      report: { houseId, origin: 'saved', problems: [] },
    }
  }

  const problems = checked.ok
    ? ['The saved website belongs to a different house.']
    : checked.errors.map(error => error.message)
  return {
    site: toReadonlySite(createDefaultSite(houseId, now())),
    report: { houseId, origin: 'recovered', problems },
  }
}
