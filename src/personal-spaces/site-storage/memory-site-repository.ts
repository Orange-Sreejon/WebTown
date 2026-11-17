import type { SiteRepository } from '../website/site-repository'
import { cloneSite, toReadonlySite } from '../website/site-readonly'
import type { ReadonlySiteContent, SiteContent } from '../website/site-types'
import {
  prepareSave,
  readRecord,
  requireHouseId,
  systemClock,
  type Clock,
  type SiteLoadReport,
} from './site-record'

export interface SiteRepositoryOptions {
  /** The time source for `updatedAt`. Injected by tests. */
  now?: Clock
  /** Called after every load, saying where the site came from. */
  onLoad?: (report: SiteLoadReport) => void
}

/**
 * Websites held in memory. Nothing survives a reload.
 *
 * Used when IndexedDB is unavailable (the interface then says "Not saved"),
 * and as the reference the IndexedDB repository is tested against. Records
 * are validated on the way in and on the way out, exactly like the real thing.
 */
export class MemorySiteRepository implements SiteRepository {
  private readonly records = new Map<string, unknown>()
  private readonly now: Clock
  private readonly onLoad: ((report: SiteLoadReport) => void) | undefined

  constructor(options: SiteRepositoryOptions = {}) {
    this.now = options.now ?? systemClock
    this.onLoad = options.onLoad
  }

  async load(houseId: string): Promise<ReadonlySiteContent> {
    const id = requireHouseId(houseId)
    const { site, report } = readRecord(id, this.records.get(id), this.now)
    this.onLoad?.(report)
    return site
  }

  async save(site: SiteContent): Promise<SiteContent> {
    const record = prepareSave(site, this.now)
    // Stored as its own copy; the caller's object and the returned one stay separate from it.
    this.records.set(record.houseId, toReadonlySite(record))
    return cloneSite(record)
  }

  /**
   * Puts raw data in the store with no checks, to stand in for a damaged or
   * hand-edited record. Only tests should call this.
   */
  seedUnchecked(houseId: string, raw: unknown): void {
    this.records.set(houseId, raw)
  }
}
