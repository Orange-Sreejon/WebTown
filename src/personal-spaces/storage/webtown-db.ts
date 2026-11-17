import type { DatabaseSpec } from './idb'

/**
 * The one IndexedDB database WebTown uses on this device (Phase 3a).
 *
 * Both stores are created in version 1, so the drawing repository (P3-11)
 * needs no schema change. Changing a store's shape later means a new version
 * and a step in `upgrade`.
 *
 * Browser-local only: this data lives in this browser profile and is not
 * visible from any other device or browser.
 */
export const DB_NAME = 'webtown'
export const DB_VERSION = 1

/** Websites, keyed by `houseId`. */
export const STORE_SITES = 'sites'
/** Drawings, keyed by `id`, with an index on `houseId`. Used from P3-11. */
export const STORE_ARTWORKS = 'artworks'
export const INDEX_ARTWORKS_BY_HOUSE = 'byHouse'

export const WEBTOWN_DB: DatabaseSpec = {
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db, oldVersion): void {
    if (oldVersion < 1) {
      db.createObjectStore(STORE_SITES, { keyPath: 'houseId' })
      const artworks = db.createObjectStore(STORE_ARTWORKS, { keyPath: 'id' })
      artworks.createIndex(INDEX_ARTWORKS_BY_HOUSE, 'houseId', { unique: false })
    }
  },
}
