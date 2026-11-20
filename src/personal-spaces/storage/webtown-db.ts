import type { DatabaseSpec } from './idb'

/**
 * The one IndexedDB database WebTown uses on this device (Phase 3a).
 *
 * Version 1: `sites` (structured websites; since version 2 read only, for
 * migration) and `artworks`. Version 2 adds `siteProjects` and `siteAssets`
 * for HTML/CSS websites. Each version only adds; earlier stores and their data
 * are never touched by an upgrade.
 *
 * Browser-local only: this data lives in this browser profile and is not
 * visible from any other device or browser.
 */
export const DB_NAME = 'webtown'
export const DB_VERSION = 2

/** Websites, keyed by `houseId`. */
export const STORE_SITES = 'sites'
/** Drawings, keyed by `id`, with an index on `houseId`. Used from P3-11. */
export const STORE_ARTWORKS = 'artworks'
export const INDEX_ARTWORKS_BY_HOUSE = 'byHouse'
/** HTML/CSS websites (version 2), keyed by `houseId`: pages, stylesheet, settings, asset list. */
export const STORE_SITE_PROJECTS = 'siteProjects'
/** Uploaded website images (version 2), keyed by `id`, with an index on `houseId`. */
export const STORE_SITE_ASSETS = 'siteAssets'
export const INDEX_SITE_ASSETS_BY_HOUSE = 'byHouse'

export const WEBTOWN_DB: DatabaseSpec = {
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db, oldVersion): void {
    if (oldVersion < 1) {
      db.createObjectStore(STORE_SITES, { keyPath: 'houseId' })
      const artworks = db.createObjectStore(STORE_ARTWORKS, { keyPath: 'id' })
      artworks.createIndex(INDEX_ARTWORKS_BY_HOUSE, 'houseId', { unique: false })
    }
    // Version 2 adds the HTML/CSS websites. Version 1 stores and their data are left exactly as they are.
    if (oldVersion < 2) {
      db.createObjectStore(STORE_SITE_PROJECTS, { keyPath: 'houseId' })
      const assets = db.createObjectStore(STORE_SITE_ASSETS, { keyPath: 'id' })
      assets.createIndex(INDEX_SITE_ASSETS_BY_HOUSE, 'houseId', { unique: false })
    }
  },
}
