import type { ArtworkReader } from '../personal-spaces/artwork-storage/artwork-repository'
import { ValidationError } from '../personal-spaces/errors'
import type { SiteProjectReader } from '../personal-spaces/site-project-storage/project-repository'
import { toAppError, type CloudBackend } from './backend'
import type { CloudArtworkRepository } from './cloud-artworks'
import type { CloudWebsiteRepository } from './cloud-websites'
import { houseIdForSlot, type PlayerContext } from './player'

/**
 * The one-time copy of this device's work (Phase 3a: IndexedDB) into the player's account.
 *
 * - Idempotent: every item has an import key, recorded in the account in the same transaction as the copy, and
 *   keys already there are skipped before anything is uploaded. A failed run is simply run again next start.
 * - Conflicts: if the account already has a website, the account's wins and the device's copy is left as it is.
 *   Drawings are added (up to the Sketchbook's limit).
 * - One account per device: when everything is copied, the device remembers which account received it; another
 *   account signing in on this device later does not get a copy.
 * - Furniture was never kept on the device (memory only), so there is none to copy.
 */

/** Where the device's data lives, and the device's memory of whom it was copied to. */
export interface LocalSources {
  projects: SiteProjectReader
  artworks: ArtworkReader
  marker: {
    get(): Promise<DeviceMarker | null>
    set(marker: DeviceMarker): Promise<void>
  }
}

/** Which account this device's data belongs to now, and whether all of it has been copied. */
export interface DeviceMarker {
  userId: string
  complete: boolean
}

export interface ImportReport {
  /** `copied`: the device's website is now in the account. `kept-account`: the account already had one. */
  website: 'copied' | 'kept-account' | 'none'
  drawings: number
  /** Device items that were not copied, in words. */
  skipped: string[]
  /** Set when the run stopped early; it is retried next start. */
  failed: string | null
  /** True when there was nothing to do (already copied, another account's device, no house). */
  idle: boolean
}

/** The house the player had on this device before accounts (Phase 3a's single local house). */
export const LOCAL_SLOT = 'house-a'

const websiteKey = (slot: string): string => `website:${slot}`
const artworkKey = (id: string): string => `artwork:${id}`

export async function importLocalData(deps: {
  local: LocalSources
  backend: CloudBackend
  player: PlayerContext
  websites: CloudWebsiteRepository
  artworks: CloudArtworkRepository
}): Promise<ImportReport> {
  const { local, backend, player, websites, artworks } = deps
  const report: ImportReport = { website: 'none', drawings: 0, skipped: [], failed: null, idle: false }
  const target = player.ownedSlot
  const house = target ? houseIdForSlot(player, target) : null
  if (!target || !house) return { ...report, idle: true }

  const marker = await local.marker.get().catch(() => null)
  // Done already, or this device's data went to another account: nothing to do.
  if (marker && (marker.complete || marker.userId !== player.userId)) return { ...report, idle: true }

  try {
    // Claim the device for this account first, so a retry after a failure cannot go to another account.
    if (!marker) await local.marker.set({ userId: player.userId, complete: false })
    const site = await local.projects.load(LOCAL_SLOT)
    const drawings = await local.artworks.list(LOCAL_SLOT)
    report.skipped.push(...drawings.skipped)
    const keys = [websiteKey(LOCAL_SLOT), ...drawings.items.map(d => artworkKey(d.id))]
    const done = new Set(await backend.rpc<string[]>('imported_keys', { p_keys: keys }))

    if (site.kind === 'saved' && !done.has(websiteKey(LOCAL_SLOT))) {
      const existing = await websites.load(target)
      if (existing.kind === 'none') {
        const { project, assets } = site.snapshot
        const moved = { ...project, houseId: target }
        await websites.save(
          { project: moved, baseRevision: 0, putAssets: assets.map(a => ({ ...a, houseId: target })), deleteAssetIds: [] },
          { importKey: websiteKey(LOCAL_SLOT) },
        )
        report.website = 'copied'
      } else {
        await backend.rpc('record_import', { p_key: websiteKey(LOCAL_SLOT), p_target: house })
        report.website = 'kept-account'
      }
    } else if (site.kind === 'damaged') {
      report.skipped.push("This device's website could not be read, so it was not copied. It is still on this device.")
    }

    for (const drawing of drawings.items) {
      if (done.has(artworkKey(drawing.id))) continue
      try {
        await artworks.save(
          { id: null, houseId: target, title: drawing.title, width: drawing.width, height: drawing.height, transparent: drawing.transparent, png: drawing.png },
          { importKey: artworkKey(drawing.id) },
        )
        report.drawings++
      } catch (error) {
        if (error instanceof ValidationError) {
          report.skipped.push(`${drawing.title}: ${error.message}`)
          continue
        }
        throw error
      }
    }

    await local.marker.set({ userId: player.userId, complete: true })
    return report
  } catch (error) {
    const reason = toAppError(error).message
    console.warn('[WebTown] Copying this device\'s work into the account stopped; it will be tried again next time.', error)
    return { ...report, failed: reason }
  }
}

// ── This browser's IndexedDB as the source ──────────────────────────────────

const MARKER_KEY = 'cloud-import'

/** The device's Phase 3a storage, or null if this browser has none (nothing to copy then). */
export async function deviceSources(): Promise<(LocalSources & { close(): void }) | null> {
  const [{ IdbDatabase }, { WEBTOWN_DB, STORE_META }, { IndexedDbProjectRepository }, { IndexedDbArtworkRepository }] = await Promise.all([
    import('../personal-spaces/storage/idb'),
    import('../personal-spaces/storage/webtown-db'),
    import('../personal-spaces/site-project-storage/indexeddb-project-repository'),
    import('../personal-spaces/artwork-storage/indexeddb-artwork-repository'),
  ])
  const db = new IdbDatabase(WEBTOWN_DB)
  try {
    await db.ready()
  } catch {
    db.close()
    return null
  }
  return {
    projects: new IndexedDbProjectRepository(db),
    artworks: new IndexedDbArtworkRepository(db),
    marker: {
      async get() {
        const raw = (await db.get(STORE_META, MARKER_KEY)) as { userId?: unknown; complete?: unknown } | undefined
        return raw && typeof raw.userId === 'string' ? { userId: raw.userId, complete: raw.complete === true } : null
      },
      async set(marker) {
        await db.put(STORE_META, { key: MARKER_KEY, userId: marker.userId, complete: marker.complete })
      },
    },
    close: () => db.close(),
  }
}