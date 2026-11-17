import type { AccessMode } from '../../lib/app-bridge'
import { PermissionError } from '../errors'
import type { SiteWriter } from '../website/site-repository'
import type { SiteContent } from '../website/site-types'

/**
 * What the app bridge told the interface: this window was opened for `houseId`
 * and the player is an `owner` or a `visitor` there. Phaser decides that once
 * (see `app-session.ts`) and passes it down. There is no second ownership
 * check here, only the answer that was already given.
 */
export interface WriteGrant {
  houseId: string
  mode: AccessMode
}

/**
 * Wraps a writer so it only writes the website of the house the owner opened.
 *
 * It refuses, with a `PermissionError`, when the mode is anything but exactly
 * `owner` (so an unknown value fails closed) and when the site belongs to a
 * different house than the one the window was opened for. That stops a bug in
 * an editor from saving one house's data into another's.
 *
 * **This is a client-side safeguard.** Anyone with browser developer tools can
 * skip it, or edit IndexedDB directly. It is not authorisation; real
 * enforcement is server-side in Phase 3b.
 */
export function guardSiteWriter(writer: SiteWriter, grant: WriteGrant): SiteWriter {
  const houseId = grant.houseId
  const mode: unknown = grant.mode

  return {
    async save(site: SiteContent): Promise<SiteContent> {
      if (mode !== 'owner') {
        throw new PermissionError("Only the owner of this house can change its website.")
      }
      if (typeof houseId !== 'string' || houseId.length === 0 || site?.houseId !== houseId) {
        throw new PermissionError("This website belongs to a different house, so it can't be saved here.")
      }
      return writer.save(site)
    },
  }
}
