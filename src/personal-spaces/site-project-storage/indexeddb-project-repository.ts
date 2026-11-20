import { PersonalSpacesError, StorageError } from '../errors'
import type { IdbDatabase } from '../storage/idb'
import { INDEX_SITE_ASSETS_BY_HOUSE, STORE_SITE_ASSETS, STORE_SITE_PROJECTS } from '../storage/webtown-db'
import type { SiteProject, SiteSave } from '../site-project/types'
import { requireHouseId, systemClock, type Clock } from '../site-storage/site-record'
import type { ProjectRepositoryOptions } from './memory-project-repository'
import {
  checkAgainstStored,
  copyProject,
  prepareProjectSave,
  readProjectRecord,
  storedRevision,
  type ProjectLoad,
} from './project-record'
import type { SiteProjectRepository } from './project-repository'

/**
 * HTML/CSS websites in this browser's IndexedDB: the project record in
 * `siteProjects` (keyed by house) and each image in `siteAssets`.
 *
 * Browser-local: other devices and browsers cannot see these records.
 *
 * A save is one transaction over both stores. Inside it, the stored revision
 * is read and compared with the one the draft started from, so two tabs
 * cannot silently overwrite each other; then the images and the project are
 * written. If anything fails, nothing is written.
 */
export class IndexedDbProjectRepository implements SiteProjectRepository {
  private readonly now: Clock

  constructor(
    private readonly db: IdbDatabase,
    options: ProjectRepositoryOptions = {},
  ) {
    this.now = options.now ?? systemClock
  }

  async load(houseId: string): Promise<ProjectLoad> {
    const id = requireHouseId(houseId)
    const raw = await this.db.get(STORE_SITE_PROJECTS, id)
    if (raw === undefined) return { kind: 'none' }
    const records = await this.db.getAllByIndex(STORE_SITE_ASSETS, INDEX_SITE_ASSETS_BY_HOUSE, id)
    return readProjectRecord(id, raw, records)
  }

  async save(save: SiteSave): Promise<SiteProject> {
    const prepared = prepareProjectSave(save, this.now)
    const { houseId } = prepared

    await this.db.atomic<null>([STORE_SITE_PROJECTS, STORE_SITE_ASSETS], (tx, done, abort) => {
      const projects = tx.objectStore(STORE_SITE_PROJECTS)
      const assets = tx.objectStore(STORE_SITE_ASSETS)
      let stopped = false
      const fail = (error: unknown): void => {
        if (stopped) return
        stopped = true
        abort(error instanceof PersonalSpacesError ? error : new StorageError(undefined, error))
      }

      projects.get(houseId).onsuccess = (event): void => {
        const revision = storedRevision((event.target as IDBRequest).result)
        assets.index(INDEX_SITE_ASSETS_BY_HOUSE).getAllKeys(houseId).onsuccess = (keysEvent): void => {
          const ownedIds = new Set(((keysEvent.target as IDBRequest).result as IDBValidKey[]).map(String))
          // A new image id that is already stored but not ours belongs to another house.
          const foreignIds = new Set<string>()
          let pending = prepared.putAssets.length

          const write = (): void => {
            try {
              checkAgainstStored(prepared, { revision, ownedIds, foreignIds })
            } catch (error) {
              fail(error)
              return
            }
            for (const asset of prepared.putAssets) assets.put(asset)
            for (const id of prepared.deleteAssetIds) assets.delete(id)
            projects.put(prepared.project)
            done(null)
          }

          if (pending === 0) {
            write()
            return
          }
          for (const asset of prepared.putAssets) {
            if (ownedIds.has(asset.id)) {
              if (--pending === 0) write()
              continue
            }
            assets.getKey(asset.id).onsuccess = (keyEvent): void => {
              if (stopped) return
              if ((keyEvent.target as IDBRequest).result !== undefined) foreignIds.add(asset.id)
              if (--pending === 0) write()
            }
          }
        }
      }
    })

    return copyProject(prepared.project)
  }
}
