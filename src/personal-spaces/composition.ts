import type { AppView } from '../lib/app-bridge'
import { IdbDatabase, type IdbOptions } from './storage/idb'
import { WEBTOWN_DB } from './storage/webtown-db'
import { LOCAL_ONLY_LABEL, NOT_SAVED_NOTICE } from './labels'
import { IndexedDbSiteRepository } from './site-storage/indexeddb-site-repository'
import { MemorySiteRepository, type SiteRepositoryOptions } from './site-storage/memory-site-repository'
import { systemClock, type Clock, type SiteLoadReport } from './site-storage/site-record'
import { guardProjectWriter } from './site-project-storage/guarded-project-writer'
import { IndexedDbProjectRepository } from './site-project-storage/indexeddb-project-repository'
import { MemoryProjectRepository } from './site-project-storage/memory-project-repository'
import type { SiteProjectRepository, SiteProjectWriter } from './site-project-storage/project-repository'
import { resolveWebsite, type LegacySiteSource, type WebsiteState } from './site-project-storage/resolve-website'
import type { SiteRepository } from './website/site-repository'
import type { ArtworkReader, ArtworkRepository, ArtworkWriter } from './artwork-storage/artwork-repository'
import { guardArtworkWriter } from './artwork-storage/guarded-artwork-writer'
import { IndexedDbArtworkRepository } from './artwork-storage/indexeddb-artwork-repository'
import { MemoryArtworkRepository } from './artwork-storage/memory-artwork-repository'

/**
 * The one place that decides which storage the interface uses and what each
 * kind of player is handed. Moving to a shared backend in Phase 3b means
 * changing `createSiteStorage` here; nothing else needs to know.
 *
 * Phase 3a is a local demonstration. What is saved lives in this browser only.
 */

export { LOCAL_ONLY_LABEL, NOT_SAVED_NOTICE }

export interface SiteStorage {
  /** The old structured websites (version 1). Read for migration; written only by the old editor. */
  repository: SiteRepository & LegacySiteSource
  /** HTML/CSS websites. */
  projects: SiteProjectRepository
  /** Sketchbook drawings. */
  artworks: ArtworkRepository
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
      projects: new MemoryProjectRepository({ now: repositoryOptions.now }),
      artworks: new MemoryArtworkRepository({ now: repositoryOptions.now }),
      persistent: false,
      notice: NOT_SAVED_NOTICE,
      reason: error instanceof Error ? error : new Error(String(error)),
      close: () => undefined,
    }
  }

  return {
    repository: new IndexedDbSiteRepository(db, repositoryOptions),
    projects: new IndexedDbProjectRepository(db, { now: repositoryOptions.now }),
    artworks: new IndexedDbArtworkRepository(db, { now: repositoryOptions.now }),
    persistent: true,
    notice: null,
    reason: null,
    close: () => db.close(),
  }
}

// ── HTML/CSS websites: who gets what ────────────────────────────────────────

/** A visitor can look at the website and do nothing else. There is no writer to find. */
export interface VisitorWebsiteAccess {
  mode: 'visitor'
  houseId: string
  open(): Promise<WebsiteState>
}

/** The owner can also save, but only this house's website. */
export interface OwnerWebsiteAccess {
  mode: 'owner'
  houseId: string
  open(): Promise<WebsiteState>
  writer: SiteProjectWriter
}

export type WebsiteAccess = VisitorWebsiteAccess | OwnerWebsiteAccess

/**
 * What a website window may do, from the app bridge's answer (AppView.mode).
 * Anything other than exactly owner is a visitor, and a visitor is given no
 * writer at all. Phase 3a: this prevents mistakes; developer tools can bypass it.
 */
export function websiteAccessFor(
  view: Pick<AppView, 'houseId' | 'mode'>,
  storage: Pick<SiteStorage, 'repository' | 'projects'>,
  now: Clock = systemClock,
): WebsiteAccess {
  const houseId = view.houseId
  const projects = { load: (id: string) => storage.projects.load(id) }
  const legacy: LegacySiteSource = { loadWithReport: id => storage.repository.loadWithReport(id) }
  const open = (): Promise<WebsiteState> => resolveWebsite(houseId, { projects, legacy, now })
  if (view.mode !== 'owner') return { mode: 'visitor', houseId, open }

  const writer: SiteProjectWriter = { save: save => storage.projects.save(save) }
  return { mode: 'owner', houseId, open, writer: guardProjectWriter(writer, { houseId, mode: view.mode }) }
}

// ── Sketchbook drawings: who gets what ──────────────────────────────────────

/** A visitor can look at the house's drawings and nothing else. */
export interface VisitorPaintAccess {
  mode: 'visitor'
  houseId: string
  reader: ArtworkReader
}

/** The owner can also save and delete, but only this house's drawings. */
export interface OwnerPaintAccess {
  mode: 'owner'
  houseId: string
  reader: ArtworkReader
  writer: ArtworkWriter
}

export type PaintAccess = VisitorPaintAccess | OwnerPaintAccess

/**
 * What a Sketchbook window may do, from the app bridge's answer. Anything other
 * than exactly owner is a visitor, and a visitor is given no writer at all:
 * the reader is a plain object, not the repository. Phase 3a: client-side only.
 */
export function paintAccessFor(view: Pick<AppView, 'houseId' | 'mode'>, storage: Pick<SiteStorage, 'artworks'>): PaintAccess {
  const houseId = view.houseId
  const repo = storage.artworks
  const reader: ArtworkReader = { list: id => repo.list(id), get: (id, artworkId) => repo.get(id, artworkId) }
  if (view.mode !== 'owner') return { mode: 'visitor', houseId, reader }
  const writer: ArtworkWriter = { save: input => repo.save(input), delete: (id, artworkId) => repo.delete(id, artworkId) }
  return { mode: 'owner', houseId, reader, writer: guardArtworkWriter(writer, { houseId, mode: view.mode }) }
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
