/**
 * A resident's website, as files they write themselves: HTML pages, one shared
 * stylesheet, and uploaded images. Pure data; no storage, no UI.
 *
 * There is no structure here beyond "pages". What a page contains, how it is
 * laid out and what it looks like is entirely the resident's HTML and CSS.
 */

export const SITE_PROJECT_SCHEMA_VERSION = 1

export const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const
export type AssetMime = (typeof ASSET_MIME_TYPES)[number]

export interface SitePage {
  /** File name, for example `index.html`. Unique in the site, ignoring case. */
  name: string
  /** The page's whole HTML source, exactly as the resident wrote it. */
  html: string
}

/** What the project record keeps about an asset. The bytes live in their own store. */
export interface SiteAssetMeta {
  id: string
  /** File name, for example `my-banner.gif`. Used in pages as `assets/<name>`. */
  name: string
  mimeType: AssetMime
  /** Bytes. */
  size: number
}

/** An uploaded asset with its bytes. */
export interface SiteAsset extends SiteAssetMeta {
  houseId: string
  bytes: ArrayBuffer
}

export type ProjectOrigin =
  | { kind: 'blank' }
  | { kind: 'classic' }
  | { kind: 'migrated'; sourceUpdatedAt: string }

export interface SiteProject {
  schemaVersion: typeof SITE_PROJECT_SCHEMA_VERSION
  houseId: string
  /** Website name, plain text. */
  title: string
  /** Name of the page visitors see first. */
  homePage: string
  pages: SitePage[]
  /** `style.css`: shared by every page. */
  css: string
  assets: SiteAssetMeta[]
  /** Starts at 0 for a project never saved; +1 on every save. */
  revision: number
  createdAt: string
  updatedAt: string
  origin: ProjectOrigin
}

/** A project as loaded from storage: the record and its asset bytes. */
export interface SiteSnapshot {
  project: SiteProject
  assets: SiteAsset[]
}

/** What a save writes, all at once. */
export interface SiteSave {
  project: SiteProject
  /** The revision the draft started from. The save is refused if storage has moved on. */
  baseRevision: number
  /** Assets that are new in this save. */
  putAssets: SiteAsset[]
  /** Ids of assets removed in this save. */
  deleteAssetIds: string[]
}

/** The fixed name of the shared stylesheet, as pages refer to it. */
export const STYLESHEET_NAME = 'style.css'
/** The folder assets appear in, as pages refer to them. */
export const ASSET_FOLDER = 'assets'

/** Approved limits (decision SD-7), plus a page count. */
export const SITE_PROJECT_LIMITS = {
  title: 60,
  pageBytes: 1_000_000,
  cssBytes: 1_000_000,
  assetBytes: 5_000_000,
  totalBytes: 50_000_000,
  totalFiles: 500,
  pages: 100,
} as const
