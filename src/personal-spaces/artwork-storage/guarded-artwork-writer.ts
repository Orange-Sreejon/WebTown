import { PermissionError } from '../errors'
import type { WriteGrant } from '../site-storage/guarded-site-writer'
import type { ArtworkInput, ArtworkSummary } from './artwork'
import type { ArtworkWriter } from './artwork-repository'

/**
 * Wraps a drawing writer so it only changes the house the owner opened.
 * Refuses anything but exactly `owner` (unknown values fail closed) and any
 * other house.
 *
 * **Client-side safeguard only.** Browser developer tools can skip it or edit
 * IndexedDB directly. Real enforcement is server-side, in Phase 3b.
 */
export function guardArtworkWriter(writer: ArtworkWriter, grant: WriteGrant): ArtworkWriter {
  const houseId = grant.houseId
  const mode: unknown = grant.mode
  const check = (id: unknown): void => {
    if (mode !== 'owner') throw new PermissionError('Only the owner of this house can change its Sketchbook.')
    if (typeof houseId !== 'string' || houseId.length === 0 || id !== houseId) {
      throw new PermissionError("This Sketchbook belongs to a different house, so it can't be changed here.")
    }
  }
  return {
    async save(input: ArtworkInput): Promise<ArtworkSummary> {
      check(input?.houseId)
      return writer.save(input)
    },
    async delete(id: string, artworkId: string): Promise<void> {
      check(id)
      return writer.delete(id, artworkId)
    },
  }
}
