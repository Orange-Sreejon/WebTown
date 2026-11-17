import type { ReadonlySiteContent, SiteContent } from './site-types'

/**
 * What the website needs from storage, as contracts. No storage technology is
 * named here; the IndexedDB and in-memory versions arrive in P3-05, and a
 * remote one in Phase 3b.
 *
 * The interface is split on purpose. Visitor mode is given a `SiteReader`
 * only: it has no `save`, so a component written against it cannot change a
 * website, and the compiler says so. The owner's editor takes a `SiteWriter`.
 *
 * Phase 3a: handing a visitor only the reader prevents mistakes. It is not
 * authorisation, and browser developer tools can bypass it. Real enforcement
 * is on the server in Phase 3b.
 */
export interface SiteReader {
  /**
   * The house's website; the default site when the owner has not saved one.
   * Always read-only data, never the repository's own copy.
   */
  load(houseId: string): Promise<ReadonlySiteContent>
}

export interface SiteWriter {
  /**
   * Validates and stores a website, returning what was stored (cleaned, with
   * a new `updatedAt`). Rejects with the validation messages when it is invalid.
   */
  save(site: SiteContent): Promise<SiteContent>
}

export type SiteRepository = SiteReader & SiteWriter
