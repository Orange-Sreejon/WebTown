import type { SiteProject, SiteSave } from '../site-project/types'
import type { ProjectLoad } from './project-record'

/**
 * Where HTML/CSS websites are kept. Phase 3a: this browser's IndexedDB (or
 * memory when it is unusable). A shared backend in Phase 3b implements the
 * same two interfaces.
 */

/** Reads a house's website. Every visitor and owner gets one. */
export interface SiteProjectReader {
  load(houseId: string): Promise<ProjectLoad>
}

/**
 * Saves a whole website at once: the pages, stylesheet and settings, the new
 * images and the removed ones. All of it is written, or none of it.
 *
 * Throws `ConflictError` when the website was saved elsewhere (another tab)
 * after `baseRevision`, `ValidationError` for data that breaks the rules, and
 * `PermissionError` when an image belongs to another house. Resolves with the
 * project as stored, with its new `revision`.
 */
export interface SiteProjectWriter {
  save(save: SiteSave): Promise<SiteProject>
}

export interface SiteProjectRepository extends SiteProjectReader, SiteProjectWriter {}
