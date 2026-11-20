import type { SiteAsset, SiteProject, SiteSave } from '../site-project/types'
import { requireHouseId, systemClock, type Clock } from '../site-storage/site-record'
import {
  checkAgainstStored,
  copyAsset,
  copyProject,
  prepareProjectSave,
  readProjectRecord,
  storedRevision,
  type ProjectLoad,
} from './project-record'
import type { SiteProjectRepository } from './project-repository'

export interface ProjectRepositoryOptions {
  now?: Clock
}

/**
 * Websites kept in memory: gone on reload. Used when the browser's storage is
 * unusable (the interface then says "Not saved"), and by tests. Follows the
 * same rules as the IndexedDB repository; the shared contract tests check both.
 */
export class MemoryProjectRepository implements SiteProjectRepository {
  private readonly projects = new Map<string, unknown>()
  private readonly assets = new Map<string, SiteAsset>()
  private readonly now: Clock

  constructor(options: ProjectRepositoryOptions = {}) {
    this.now = options.now ?? systemClock
  }

  async load(houseId: string): Promise<ProjectLoad> {
    const id = requireHouseId(houseId)
    const raw = this.projects.get(id)
    const records = [...this.assets.values()].filter(a => a.houseId === id)
    return readProjectRecord(id, raw, records)
  }

  async save(save: SiteSave): Promise<SiteProject> {
    const prepared = prepareProjectSave(save, this.now)
    const owned = new Set([...this.assets.values()].filter(a => a.houseId === prepared.houseId).map(a => a.id))
    const foreign = new Set(prepared.putAssets.map(a => a.id).filter(id => this.assets.has(id) && !owned.has(id)))
    checkAgainstStored(prepared, {
      revision: storedRevision(this.projects.get(prepared.houseId)),
      ownedIds: owned,
      foreignIds: foreign,
    })
    for (const asset of prepared.putAssets) this.assets.set(asset.id, copyAsset(asset))
    for (const id of prepared.deleteAssetIds) this.assets.delete(id)
    this.projects.set(prepared.houseId, copyProject(prepared.project))
    return copyProject(prepared.project)
  }

  /** Puts a raw record in place, as if storage held it. For tests of damaged data. */
  seedRaw(houseId: string, record: unknown, assets: readonly SiteAsset[] = []): void {
    this.projects.set(houseId, record)
    for (const asset of assets) this.assets.set(asset.id, asset)
  }
}
