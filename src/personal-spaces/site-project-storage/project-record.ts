import { ConflictError, PermissionError, ValidationError } from '../errors'
import { assetProblem, cleanTitle, toArrayBuffer, validateProject, type Problem } from '../site-project/rules'
import type { SiteAsset, SiteAssetMeta, SiteProject, SiteSave, SiteSnapshot } from '../site-project/types'
import { requireHouseId, type Clock } from '../site-storage/site-record'

/**
 * The storage rules for HTML/CSS websites, shared by every repository so the
 * memory and IndexedDB versions behave identically. Pure functions: no I/O.
 *
 * Stored data is untrusted. A damaged project record is reported and never
 * deleted or overwritten silently; a damaged or missing image is left out of
 * the loaded website and reported, and its stored record is left alone.
 */

/** What loading a house's website found. */
export type ProjectLoad =
  | { kind: 'none' }
  | {
      kind: 'saved'
      snapshot: SiteSnapshot
      /** Images listed by the website whose data is missing or damaged, in words. They were left out. */
      skipped: string[]
    }
  | {
      kind: 'damaged'
      /** What is wrong with the stored record. */
      problems: string[]
      /** The revision to pass as `baseRevision` to save over it. */
      revision: number
    }

/** The revision a save must start from, given whatever is stored. Nothing stored is revision 0. */
export function storedRevision(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0
  const revision = (raw as { revision?: unknown }).revision
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0
}

const toIssues = (problems: readonly Problem[]): { path: string; message: string }[] =>
  problems.map(p => ({ path: p.where, message: p.message }))

const copyMeta = (a: SiteAssetMeta): SiteAssetMeta => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size })

/** A deep copy of a project, so callers never share objects with storage. */
export function copyProject(p: SiteProject): SiteProject {
  return {
    schemaVersion: p.schemaVersion,
    houseId: p.houseId,
    title: p.title,
    homePage: p.homePage,
    pages: p.pages.map(page => ({ name: page.name, html: page.html })),
    css: p.css,
    assets: p.assets.map(copyMeta),
    revision: p.revision,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    origin: { ...p.origin },
  }
}

/** A copy of an asset with its own bytes. */
export function copyAsset(a: SiteAsset): SiteAsset {
  const bytes = toArrayBuffer(a.bytes)
  return { ...copyMeta(a), houseId: a.houseId, bytes: bytes ? bytes.slice(0) : new ArrayBuffer(0) }
}

/** Turns stored records into a website, or says why it cannot. */
export function readProjectRecord(houseId: string, raw: unknown, rawAssets: readonly unknown[]): ProjectLoad {
  if (raw === undefined || raw === null) return { kind: 'none' }
  const problems = validateProject(raw)
  if (problems.length === 0 && (raw as SiteProject).houseId !== houseId) {
    problems.push({ where: 'site', message: 'The stored website belongs to another house.' })
  }
  if (problems.length > 0) {
    return { kind: 'damaged', problems: problems.map(p => p.message), revision: storedRevision(raw) }
  }

  const project = copyProject(raw as SiteProject)
  const byId = new Map<string, unknown>()
  for (const record of rawAssets) {
    const id = (record as { id?: unknown } | null)?.id
    if (typeof id === 'string') byId.set(id, record)
  }

  const kept: SiteAssetMeta[] = []
  const assets: SiteAsset[] = []
  const skipped: string[] = []
  for (const meta of project.assets) {
    const record = byId.get(meta.id)
    if (record === undefined) {
      skipped.push(`${meta.name} is missing from this browser's storage.`)
      continue
    }
    const problem = assetProblem(record, houseId)
    const stored = record as SiteAsset
    if (problem) skipped.push(problem)
    else if (stored.mimeType !== meta.mimeType || stored.size !== meta.size) skipped.push(`${meta.name} is damaged (does not match the website).`)
    else {
      kept.push(meta)
      assets.push(copyAsset({ ...stored, name: meta.name }))
    }
  }
  project.assets = kept
  return { kind: 'saved', snapshot: { project, assets }, skipped }
}

/** A save, checked on its own and ready to write: the next project record and the new asset records. */
export interface PreparedSave {
  houseId: string
  baseRevision: number
  project: SiteProject
  putAssets: SiteAsset[]
  deleteAssetIds: string[]
}

/**
 * Checks everything about a save that does not depend on what is stored, and
 * builds the records to write. Throws `ValidationError` on any problem.
 */
export function prepareProjectSave(save: SiteSave, now: Clock): PreparedSave {
  if (typeof save !== 'object' || save === null) throw new ValidationError([{ path: 'site', message: 'Nothing to save.' }])
  const houseId = requireHouseId(save.project?.houseId)
  if (!Number.isInteger(save.baseRevision) || save.baseRevision < 0) {
    throw new ValidationError([{ path: 'site', message: 'The save does not say which version it started from.' }])
  }
  const problems = validateProject(save.project)
  if (problems.length > 0) throw new ValidationError(toIssues(problems))

  const listed = new Map(save.project.assets.map(a => [a.id, a]))
  const putAssets: SiteAsset[] = []
  const issues: { path: string; message: string }[] = []
  const putIds = new Set<string>()
  for (const asset of Array.isArray(save.putAssets) ? save.putAssets : []) {
    const problem = assetProblem(asset, houseId)
    const meta = listed.get(asset?.id)
    if (problem) issues.push({ path: `asset:${String(asset?.name)}`, message: problem })
    else if (!meta || meta.name !== asset.name || meta.mimeType !== asset.mimeType || meta.size !== asset.size) {
      issues.push({ path: `asset:${asset.name}`, message: `${asset.name} is not listed in the website.` })
    } else if (putIds.has(asset.id)) {
      issues.push({ path: `asset:${asset.name}`, message: 'The same image was added twice.' })
    } else {
      putIds.add(asset.id)
      putAssets.push(copyAsset(asset))
    }
  }
  const deleteAssetIds = Array.isArray(save.deleteAssetIds) ? [...new Set(save.deleteAssetIds)] : []
  for (const id of deleteAssetIds) {
    if (typeof id !== 'string' || listed.has(id) || putIds.has(id)) {
      issues.push({ path: 'site', message: 'An image is both removed and kept.' })
    }
  }
  if (issues.length > 0) throw new ValidationError(issues)

  const time = now()
  const project = copyProject(save.project)
  project.title = cleanTitle(project.title)
  project.revision = save.baseRevision + 1
  project.updatedAt = time
  return { houseId, baseRevision: save.baseRevision, project, putAssets, deleteAssetIds }
}

/**
 * Checks a prepared save against what is stored right now, inside the same
 * transaction as the write. `ownedIds` are the asset ids stored for this house;
 * `foreignIds` are any of the new ids already used by another house.
 */
export function checkAgainstStored(
  prepared: PreparedSave,
  stored: { revision: number; ownedIds: ReadonlySet<string>; foreignIds: ReadonlySet<string> },
): void {
  if (stored.revision !== prepared.baseRevision) throw new ConflictError()
  if (prepared.putAssets.some(a => stored.foreignIds.has(a.id))) {
    throw new PermissionError("An image belongs to a different house, so it can't be saved here.")
  }
  for (const id of prepared.deleteAssetIds) {
    if (!stored.ownedIds.has(id)) throw new PermissionError("An image belongs to a different house, so it can't be removed here.")
  }
  const putIds = new Set(prepared.putAssets.map(a => a.id))
  for (const meta of prepared.project.assets) {
    if (!putIds.has(meta.id) && !stored.ownedIds.has(meta.id)) {
      throw new ValidationError([{ path: `asset:${meta.name}`, message: `${meta.name} has no image data. Upload it again.` }])
    }
  }
}
