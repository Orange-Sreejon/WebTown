import type { AppView } from '../lib/app-bridge'
import { IdbDatabase, type IdbOptions } from './storage/idb'
import { WEBTOWN_DB } from './storage/webtown-db'
import { LOCAL_ONLY_LABEL, NOT_SAVED_NOTICE } from './labels'
import { guardSiteWriter } from './site-storage/guarded-site-writer'
import { IndexedDbSiteRepository } from './site-storage/indexeddb-site-repository'
import { MemorySiteRepository, type SiteRepositoryOptions } from './site-storage/memory-site-repository'
import type { SiteLoadReport } from './site-storage/site-record'
import type { SiteReader, SiteRepository, SiteWriter } from './website/site-repository'

/**
 * The one place that decides which storage the interface uses and what each
 * kind of player is handed. Moving to a shared backend in Phase 3b means
 * changing `createSiteStorage` here; nothing else needs to know.
 *
 * Phase 3a is a local demonstration. What is saved lives in this browser only.
 */

export { LOCAL_ONLY_LABEL, NOT_SAVED_NOTICE }

export interface SiteStorage {
  repository: SiteRepository
  /** False when the browser's storage is unusable and nothing survives a reload. */
  persistent: boolean
  /** Why storage is not persistent, for a banner; null when it is. */
  notice: string | null
  /** Why persistence failed, for the console. */
  reason: Error | null
  /** Releases the database connection. */
  close(): void
}

export interface SiteStorageOptions extends SiteRepositoryOptions, Pick<IdbOptions, 'factory' | 'blockedTimeoutMs'> {}

/**
 * Opens IndexedDB and builds the site repository on it. If the database
 * cannot be used (no IndexedDB, private mode, blocked, damaged), falls back to
 * an in-memory repository and says so, so nothing crashes and nothing is
 * silently lost: `persistent` is false and `notice` explains.
 */
export async function createSiteStorage(options: SiteStorageOptions = {}): Promise<SiteStorage> {
  const { factory, blockedTimeoutMs, ...repositoryOptions } = options
  const db = new IdbDatabase(WEBTOWN_DB, { factory, blockedTimeoutMs })

  try {
    await db.ready()
  } catch (error) {
    console.warn('[WebTown] Browser storage is unavailable; using memory only.', error)
    db.close()
    return {
      repository: new MemorySiteRepository(repositoryOptions),
      persistent: false,
      notice: NOT_SAVED_NOTICE,
      reason: error instanceof Error ? error : new Error(String(error)),
      close: () => undefined,
    }
  }

  return {
    repository: new IndexedDbSiteRepository(db, repositoryOptions),
    persistent: true,
    notice: null,
    reason: null,
    close: () => db.close(),
  }
}

// ── Who gets what ───────────────────────────────────────────────────────────

/** A visitor is given the means to read, and nothing else. There is no `writer` to find. */
export interface VisitorSiteAccess {
  mode: 'visitor'
  reader: SiteReader
}

/** The owner also gets a writer that only writes the house the window was opened for. */
export interface OwnerSiteAccess {
  mode: 'owner'
  reader: SiteReader
  writer: SiteWriter
}

export type SiteAccess = VisitorSiteAccess | OwnerSiteAccess

/**
 * What a window may do with websites, from the answer the app bridge already
 * gave (`AppView.mode`, decided by Phaser from `canEditHouse`). There is no
 * second ownership check.
 *
 * For a visitor, no writer is created at all, and the reader is a plain
 * object with a `load` method, not the repository, so a `save` is not even
 * present to be reached by mistake. Anything other than exactly `owner` is a
 * visitor.
 *
 * Phase 3a: this prevents mistakes; browser developer tools can bypass it.
 */
export function siteAccessFor(
  view: Pick<AppView, 'houseId' | 'mode'>,
  repository: SiteRepository,
): SiteAccess {
  const reader: SiteReader = { load: houseId => repository.load(houseId) }
  if (view.mode !== 'owner') return { mode: 'visitor', reader }

  const writer: SiteWriter = { save: site => repository.save(site) }
  return { mode: 'owner', reader, writer: guardSiteWriter(writer, { houseId: view.houseId, mode: view.mode }) }
}

// ── The shared instance ─────────────────────────────────────────────────────

let shared: Promise<SiteStorage> | null = null

const loadListeners = new Set<(report: SiteLoadReport) => void>()

/**
 * Hears about every website load made through the shared storage: where the
 * site came from (saved, default, or a damaged record that was replaced by the
 * default). The website window uses it to tell the owner about a recovery.
 * Returns the function that stops listening.
 */
export function onSiteLoad(handler: (report: SiteLoadReport) => void): () => void {
  loadListeners.add(handler)
  return () => void loadListeners.delete(handler)
}

/** The storage the game uses: opened once, on first use. */
export function getSiteStorage(): Promise<SiteStorage> {
  shared ??= createSiteStorage({
    onLoad: report => [...loadListeners].forEach(listener => listener(report)),
  })
  return shared
}

/** Forgets and closes the shared storage. For tests. */
export async function resetSiteStorage(): Promise<void> {
  const current = shared
  shared = null
  if (current) (await current).close()
}
