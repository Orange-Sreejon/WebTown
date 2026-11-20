import type { IdbDatabase } from '../storage/idb'
import { STORE_SITES } from '../storage/webtown-db'
import { cloneSite } from '../website/site-readonly'
import type { SiteRepository } from '../website/site-repository'
import type { ReadonlySiteContent, SiteContent } from '../website/site-types'
import type { SiteRepositoryOptions } from './memory-site-repository'
import {
  prepareSave,
  readRecord,
  requireHouseId,
  systemClock,
  type Clock,
  type SiteLoadReport,
} from './site-record'

/**
 * Websites stored in this browser's IndexedDB (`sites` store, keyed by house).
 *
 * Browser-local: other devices and browsers cannot see these records. A
 * remote repository in Phase 3b implements the same `SiteRepository`, and the
 * rest of the app does not change.
 *
 * Everything read back is untrusted. A record that fails validation is never
 * shown and never deleted: the load falls back to the default site, reports
 * `recovered`, and the damaged record stays until the owner saves over it.
 * Writes are one transaction each, so a save either fully happens or does not.
 */
export class IndexedDbSiteRepository implements SiteRepository {
  private readonly now: Clock
  private readonly onLoad: ((report: SiteLoadReport) => void) | undefined

  constructor(
    private readonly db: IdbDatabase,
    options: SiteRepositoryOptions = {},
  ) {
    this.now = options.now ?? systemClock
    this.onLoad = options.onLoad
  }

  async load(houseId: string): Promise<ReadonlySiteContent> {
    const { site, report } = await this.loadWithReport(houseId)
    this.onLoad?.(report)
    return site
  }

  /** The site and where it came from (saved, default or recovered), without telling `onLoad`. */
  async loadWithReport(houseId: string): Promise<{ site: ReadonlySiteContent; report: SiteLoadReport }> {
    const id = requireHouseId(houseId)
    const raw = await this.db.get(STORE_SITES, id)
    return readRecord(id, raw, this.now)
  }

  async save(site: SiteContent): Promise<SiteContent> {
    const record = prepareSave(site, this.now)
    await this.db.put(STORE_SITES, record)
    return cloneSite(record)
  }
}
