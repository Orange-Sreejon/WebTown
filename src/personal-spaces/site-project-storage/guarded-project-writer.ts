import { PermissionError } from '../errors'
import type { SiteProject, SiteSave } from '../site-project/types'
import type { WriteGrant } from '../site-storage/guarded-site-writer'
import type { SiteProjectWriter } from './project-repository'

/**
 * Wraps a website writer so it only saves the house the owner opened.
 *
 * Refuses with `PermissionError` when the mode is anything but exactly
 * `owner` (unknown values fail closed), and when the website or any image in
 * the save is for a different house. This stops a bug in the Studio from
 * writing one house's data into another's.
 *
 * **Client-side safeguard only.** Browser developer tools can skip it or edit
 * IndexedDB directly. Real enforcement is server-side, in Phase 3b.
 */
export function guardProjectWriter(writer: SiteProjectWriter, grant: WriteGrant): SiteProjectWriter {
  const houseId = grant.houseId
  const mode: unknown = grant.mode

  return {
    async save(save: SiteSave): Promise<SiteProject> {
      if (mode !== 'owner') throw new PermissionError('Only the owner of this house can change its website.')
      const ours = (id: unknown): boolean => typeof houseId === 'string' && houseId.length > 0 && id === houseId
      const assets = Array.isArray(save?.putAssets) ? save.putAssets : []
      if (!ours(save?.project?.houseId) || assets.some(a => !ours(a?.houseId))) {
        throw new PermissionError("This website belongs to a different house, so it can't be saved here.")
      }
      return writer.save(save)
    },
  }
}
