import { ValidationError } from '../personal-spaces/errors'
import { copyProject, prepareProjectSave, readProjectRecord, type ProjectLoad } from '../personal-spaces/site-project-storage/project-record'
import type { SiteProjectRepository } from '../personal-spaces/site-project-storage/project-repository'
import { SITE_PROJECT_SCHEMA_VERSION, type SiteAsset, type SiteProject, type SiteSave } from '../personal-spaces/site-project/types'
import { PermissionError } from '../personal-spaces/errors'
import { isUuid, toAppError, type CloudBackend } from './backend'
import { houseIdForSlot, type PlayerContext } from './player'

const BUCKET = 'website-assets'

interface StoredWebsite {
  title: string
  homePage: string
  css: string
  origin: SiteProject['origin']
  schemaVersion: number
  revision: number
  createdAt: string
  updatedAt: string
  pages: Array<{ name: string; html: string }>
  assets: Array<{ id: string; name: string; mimeType: string; size: number; path: string }>
}

/**
 * HTML/CSS websites in the player's account: pages and the stylesheet in the database, images in Storage.
 * Loading reads everything and checks it with the same rules as local storage (stored data is untrusted); a
 * missing or damaged image is left out and reported. Saving uploads new images first, then replaces the
 * website in one database transaction that refuses a stale revision, then removes images no longer used.
 */
export class CloudWebsiteRepository implements SiteProjectRepository {
  constructor(
    private readonly backend: CloudBackend,
    private readonly player: Pick<PlayerContext, 'houses' | 'world'>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(slot: string): Promise<ProjectLoad> {
    const house = houseIdForSlot(this.player, slot)
    if (!house) return { kind: 'none' }
    let stored: StoredWebsite | null
    try {
      stored = await this.backend.rpc<StoredWebsite | null>('get_website', { p_house: house })
    } catch (error) {
      throw toAppError(error)
    }
    if (!stored) return { kind: 'none' }

    const assets = Array.isArray(stored.assets) ? stored.assets : []
    const records = await Promise.all(assets.map(async a => {
      try {
        const bytes = await this.backend.download(BUCKET, a.path)
        return { id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, houseId: slot, bytes }
      } catch (error) {
        console.warn(`[WebTown] Image ${a.name} could not be downloaded.`, error)
        return null
      }
    }))
    const raw = {
      schemaVersion: SITE_PROJECT_SCHEMA_VERSION,
      houseId: slot,
      title: stored.title,
      homePage: stored.homePage,
      pages: stored.pages,
      css: stored.css,
      assets: assets.map(a => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size })),
      revision: stored.revision,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      origin: stored.origin,
    }
    return readProjectRecord(slot, raw, records.filter(r => r !== null))
  }

  /** Saves a website. `importKey` records it as copied from this device (see local-import.ts). */
  async save(save: SiteSave, options: { importKey?: string } = {}): Promise<SiteProject> {
    const prepared = prepareProjectSave(save, this.now)
    const house = houseIdForSlot(this.player, prepared.houseId)
    if (!house) throw new PermissionError('This house is not in your world.')
    for (const a of prepared.project.assets) {
      if (!isUuid(a.id)) throw new ValidationError([{ path: `asset:${a.name}`, message: `${a.name} cannot be saved to your account; upload it again.` }])
    }
    const folder = `${this.player.world.id}/${house}/`
    const uploaded: string[] = []
    try {
      for (const asset of prepared.putAssets) await this.uploadAsset(folder, asset, uploaded)
      const result = await this.backend.rpc<{ revision: number; removedPaths: string[]; createdAt: string; updatedAt: string }>('save_website', {
        p_house: house,
        p_base_revision: save.baseRevision,
        p_site: {
          title: prepared.project.title,
          homePage: prepared.project.homePage,
          css: prepared.project.css,
          origin: prepared.project.origin,
          pages: prepared.project.pages,
          assets: prepared.project.assets.map(a => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, path: folder + a.id })),
        },
        p_import_key: options.importKey ?? null,
      })
      void this.removeQuietly(result.removedPaths ?? [])
      const project = copyProject(prepared.project)
      project.revision = result.revision
      project.createdAt = result.createdAt ?? project.createdAt
      project.updatedAt = result.updatedAt ?? project.updatedAt
      return project
    } catch (error) {
      // New images nothing refers to: take them back out (best effort; the save is what matters).
      void this.removeQuietly(uploaded)
      throw toAppError(error)
    }
  }

  private async uploadAsset(folder: string, asset: SiteAsset, uploaded: string[]): Promise<void> {
    try {
      await this.backend.upload(BUCKET, folder + asset.id, asset.bytes, asset.mimeType)
      uploaded.push(folder + asset.id)
    } catch (error) {
      // Already there from an earlier attempt whose database step failed: the same id is the same bytes.
      if ((error as { code?: string }).code === '23505') return
      throw error
    }
  }

  private async removeQuietly(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    try {
      await this.backend.remove(BUCKET, paths)
    } catch (error) {
      console.warn('[WebTown] Unused website images could not be removed.', error)
    }
  }
}
