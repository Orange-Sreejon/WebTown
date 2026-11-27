import { PermissionError, StorageError, ValidationError } from '../personal-spaces/errors'
import { copyProject, prepareProjectSave, readProjectRecord, type ProjectLoad } from '../personal-spaces/site-project-storage/project-record'
import type { SiteProjectWriter } from '../personal-spaces/site-project-storage/project-repository'
import { COMMUNITY_SITE_KEY } from '../personal-spaces/site-project/site-target'
import { SITE_PROJECT_SCHEMA_VERSION, type SiteAsset, type SiteProject, type SiteSave } from '../personal-spaces/site-project/types'
import { isUuid, toAppError, type CloudBackend } from './backend'

/**
 * The Community Website (CH-05): one shared draft every member edits in the Site Studio, numbered revisions, and the
 * version visitors see, which moderators publish. Every call is a database function that checks the caller against
 * the world; this module only moves data and parses it strictly (stored data is untrusted, as for houses).
 *
 * In the Studio's terms the draft's revision number is its `revision`: a save is based on it, and the database
 * refuses a save based on an older one (ConflictError, "Someone else saved..."). Records carry the site key
 * COMMUNITY_SITE_KEY where a house's carry its slot (site-target.ts).
 */

export const COMMUNITY_BUCKET = 'community-assets' as const
export type WebsiteVersion = 'draft' | 'published'

export interface CommunityVersionInfo {
  /** This revision's number. */
  number: number
  /** Null if the account no longer exists. */
  authorId: string | null
  /** Null when the author is no longer in the town ("a former member"). */
  authorName: string | null
  savedAt: string
  /** The draft's and the published version's numbers now (null: none). */
  draftNumber: number | null
  publishedNumber: number | null
  publishedAt: string | null
}

export interface CommunityRevision {
  number: number
  authorId: string | null
  authorName: string | null
  savedAt: string
  lastPublishedAt: string | null
  isDraft: boolean
  isPublished: boolean
}

const bad = (): never => {
  throw new StorageError('WebTown sent back something it should not have. Please try again.')
}
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad())
const str = (v: unknown): string => (typeof v === 'string' ? v : bad())
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v))
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad())
const uuidOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : isUuid(v) ? v : bad())
const num = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : bad())
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))

async function call<T>(backend: CloudBackend, fn: string, args: Record<string, unknown>, parse: (raw: unknown) => T): Promise<T> {
  let raw: unknown
  try {
    raw = await backend.rpc(fn, args)
  } catch (error) {
    throw toAppError(error)
  }
  return parse(raw)
}

export function parseVersionInfo(raw: Record<string, unknown>): CommunityVersionInfo {
  return {
    number: num(raw['number']), authorId: uuidOrNull(raw['authorId']), authorName: strOrNull(raw['authorName']),
    savedAt: str(raw['savedAt']), draftNumber: numOrNull(raw['draftNumber']), publishedNumber: numOrNull(raw['publishedNumber']),
    publishedAt: strOrNull(raw['publishedAt']),
  }
}

/** What loading a version found: the website as the Studio and the viewer read it, and who saved it. */
export type CommunityLoad = { load: ProjectLoad; info: CommunityVersionInfo | null }

/**
 * Loads the draft, the published version, or one kept revision (`number`). Images are downloaded; one that is
 * missing or damaged is left out and reported, as for houses.
 */
export async function loadCommunityWebsite(backend: CloudBackend, worldId: string, which: WebsiteVersion | { number: number }): Promise<CommunityLoad> {
  const args = typeof which === 'string'
    ? { p_world: worldId, p_which: which }
    : { p_world: worldId, p_which: 'revision', p_number: which.number }
  const raw = await call(backend, 'get_community_website', args, r => (r === null ? null : record(r)))
  if (raw === null) return { load: { kind: 'none' }, info: null }
  const info = parseVersionInfo(raw)
  const assets = Array.isArray(raw['assets']) ? raw['assets'].map(record) : bad()
  const files = await Promise.all(assets.map(async a => {
    const path = str(a['path'])
    if (path !== `${worldId}/${String(a['id'])}`) return null // not this town's file: never fetched
    try {
      const bytes = await backend.download(COMMUNITY_BUCKET, path)
      return { id: a['id'], name: a['name'], mimeType: a['mimeType'], size: a['size'], houseId: COMMUNITY_SITE_KEY, bytes }
    } catch (error) {
      console.warn(`[WebTown] Image ${String(a['name'])} could not be downloaded.`, error)
      return null
    }
  }))
  const project = {
    schemaVersion: SITE_PROJECT_SCHEMA_VERSION,
    houseId: COMMUNITY_SITE_KEY,
    title: raw['title'],
    homePage: raw['homePage'],
    pages: raw['pages'],
    css: raw['css'],
    assets: assets.map(a => ({ id: a['id'], name: a['name'], mimeType: a['mimeType'], size: a['size'] })),
    revision: info.number,
    createdAt: info.savedAt,
    updatedAt: info.savedAt,
    origin: raw['origin'],
  }
  return { load: readProjectRecord(COMMUNITY_SITE_KEY, project, files.filter(f => f !== null)), info }
}

/**
 * The Studio's writer for the town's draft: uploads new images to `{world}/{image id}`, then saves the draft as a new
 * revision in one database transaction (refused if someone saved since `baseRevision`), then removes images no
 * kept revision uses any more (best effort).
 */
export class CommunityDraftWriter implements SiteProjectWriter {
  constructor(
    private readonly backend: CloudBackend,
    private readonly worldId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async save(save: SiteSave): Promise<SiteProject> {
    if (save?.project?.houseId !== COMMUNITY_SITE_KEY || (Array.isArray(save.putAssets) && save.putAssets.some(a => a?.houseId !== COMMUNITY_SITE_KEY))) {
      throw new PermissionError("This website is not the town's Community Website, so it can't be saved here.")
    }
    const prepared = prepareProjectSave(save, this.now)
    for (const a of prepared.project.assets) {
      if (!isUuid(a.id)) throw new ValidationError([{ path: `asset:${a.name}`, message: `${a.name} cannot be saved here; upload it again.` }])
    }
    const folder = `${this.worldId}/`
    try {
      for (const asset of prepared.putAssets) await this.upload(folder, asset)
      const result = await this.backend.rpc<unknown>('save_community_draft', {
        p_world: this.worldId,
        p_base_number: save.baseRevision,
        p_site: {
          title: prepared.project.title,
          homePage: prepared.project.homePage,
          css: prepared.project.css,
          origin: prepared.project.origin,
          pages: prepared.project.pages,
          assets: prepared.project.assets.map(a => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size })),
        },
      })
      const r = record(result)
      const removed = Array.isArray(r['removedPaths']) ? r['removedPaths'].map(str) : bad()
      void this.removeQuietly(removed.filter(p => p.startsWith(folder)))
      const project = copyProject(prepared.project)
      project.revision = num(r['number'])
      project.updatedAt = str(r['savedAt'])
      return project
    } catch (error) {
      // Images uploaded for a save that failed stay until a later save uses them (same ids on a retry).
      throw toAppError(error, 'Someone else in town saved the draft after you opened it.')
    }
  }

  private async upload(folder: string, asset: SiteAsset): Promise<void> {
    try {
      await this.backend.upload(COMMUNITY_BUCKET, folder + asset.id, asset.bytes, asset.mimeType)
    } catch (error) {
      // Already there from an earlier attempt (23505), or already recorded by a save whose answer was lost, which
      // Storage refuses to replace (42501). Either way the same id is the same bytes, and the save checks the file.
      const code = (error as { code?: string }).code
      if (code === '23505' || code === '42501') return
      throw error
    }
  }

  private async removeQuietly(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    try {
      await this.backend.remove(COMMUNITY_BUCKET, paths)
    } catch (error) {
      console.warn('[WebTown] Unused Community Website images could not be removed.', error)
    }
  }
}

/** Moderators: visitors now see revision `number` (an older one is a rollback). */
export const publishCommunityWebsite = (backend: CloudBackend, worldId: string, number: number, note?: string): Promise<{ number: number; publishedAt: string; changed: boolean }> =>
  call(backend, 'publish_community_website', { p_world: worldId, p_number: number, p_note: note ?? null }, raw => {
    const r = record(raw)
    return { number: num(r['number']), publishedAt: str(r['publishedAt']), changed: bool(r['changed']) }
  })

/** The kept revisions, newest first; pass the last one's number as `before` for more. */
export const listCommunityRevisions = (backend: CloudBackend, worldId: string, page: { before?: number; limit?: number } = {}): Promise<CommunityRevision[]> =>
  call(backend, 'list_community_revisions', { p_world: worldId, p_before: page.before ?? null, p_limit: page.limit ?? 30 }, raw =>
    (Array.isArray(raw) ? raw : bad()).map(x => {
      const r = record(x)
      return {
        number: num(r['number']), authorId: uuidOrNull(r['authorId']), authorName: strOrNull(r['authorName']),
        savedAt: str(r['savedAt']), lastPublishedAt: strOrNull(r['lastPublishedAt']), isDraft: bool(r['isDraft']),
        isPublished: bool(r['isPublished']),
      }
    }))

/** A `website` message on the Hall channel, as a hint only (anyone in the town can send one): what to reload. */
export function parseWebsiteAnnouncement(payload: unknown): { kind: 'draft' | 'published'; number: number } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as Record<string, unknown>
  const n = p['number']
  if ((p['kind'] !== 'draft' && p['kind'] !== 'published') || typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return null
  return { kind: p['kind'], number: n }
}
