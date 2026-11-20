import { normalizeText } from '../website/site-text'
import { HOUSE_ID_PATTERN } from '../website/site-types'
import {
  ASSET_MIME_TYPES,
  SITE_PROJECT_LIMITS,
  SITE_PROJECT_SCHEMA_VERSION,
  type AssetMime,
  type SiteAsset,
  type SiteAssetMeta,
  type SiteProject,
} from './types'

/**
 * The rules a website must follow: names, limits, and what an upload really is.
 * Pure. Every check returns plain sentences an owner can act on.
 */

export interface Problem {
  /** Where: `title`, `page:about.html`, `asset:cat.gif`, `site`. */
  where: string
  message: string
}

const PAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.html$/
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpe?g|gif|webp|svg)$/i
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

const encoder = new TextEncoder()
/** Size of text as stored (UTF-8 bytes). */
export const textBytes = (text: string): number => encoder.encode(text).length

/** Why a page name cannot be used, or null. `others` are the site's other page names. */
export function pageNameProblem(name: string, others: readonly string[]): string | null {
  if (!name.endsWith('.html')) return 'A page name must end in .html, for example about.html.'
  if (!PAGE_NAME.test(name)) {
    return 'A page name can use letters, digits, - _ and . (start with a letter or digit), up to 64 characters before .html.'
  }
  if (others.some(other => other.toLowerCase() === name.toLowerCase())) return `There is already a page called ${name}.`
  return null
}

/** Why an asset name cannot be used, or null. */
export function assetNameProblem(name: string, others: readonly string[]): string | null {
  if (!ASSET_NAME.test(name)) {
    return 'An image name can use letters, digits, - _ and ., and must end in .png, .jpg, .jpeg, .gif, .webp or .svg.'
  }
  if (others.some(other => other.toLowerCase() === name.toLowerCase())) return `There is already an image called ${name}.`
  return null
}

/** Turns an uploaded file's name into an acceptable asset name: spaces and odd characters become `-`. */
export function cleanAssetName(original: string): string {
  const dot = original.lastIndexOf('.')
  const stem = (dot > 0 ? original.slice(0, dot) : original).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-._]+/, '').replace(/-+/g, '-').slice(0, 60) || 'image'
  const ext = (dot > 0 ? original.slice(dot + 1) : '').toLowerCase()
  return `${stem}.${ext}`
}

/** Picks `name`, or `name-2`, `name-3` ... so it does not clash. */
export function uniqueName(name: string, others: readonly string[]): string {
  const taken = new Set(others.map(o => o.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  const dot = name.lastIndexOf('.')
  const stem = name.slice(0, dot)
  const ext = name.slice(dot)
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

// ── What a file really is ────────────────────────────────────────────────

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  signature.every((value, i) => bytes[at + i] === value)

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)))

/**
 * The image type the bytes actually are, from their signature, or null.
 * SVG counts only as UTF-8 text whose first element is `<svg`.
 */
export function sniffImage(buffer: ArrayBuffer): AssetMime | null {
  const bytes = new Uint8Array(buffer)
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  return looksLikeSvg(bytes) ? 'image/svg+xml' : null
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 4096))
  } catch {
    return false
  }
  // Skip a byte-order mark, an XML declaration, comments and a doctype, then expect <svg.
  const rest = text.replace(/^\uFEFF/, '').replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*/i, '')
  return /^<svg[\s>]/i.test(rest)
}

const EXTENSION_TYPE: Record<string, AssetMime> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

/** The type a name claims by its extension, or null. */
export function typeFromName(name: string): AssetMime | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return EXTENSION_TYPE[ext] ?? null
}

/**
 * Checks an upload before it joins the site. The content decides the type; the
 * name must agree with it. Returns the type, or a reason it is refused.
 */
export function checkUpload(
  name: string,
  buffer: ArrayBuffer,
): { ok: true; mimeType: AssetMime } | { ok: false; reason: string } {
  if (buffer.byteLength === 0) return { ok: false, reason: `${name} is empty.` }
  if (buffer.byteLength > SITE_PROJECT_LIMITS.assetBytes) {
    return { ok: false, reason: `${name} is ${formatBytes(buffer.byteLength)}; the limit for one image is ${formatBytes(SITE_PROJECT_LIMITS.assetBytes)}.` }
  }
  const claimed = typeFromName(name)
  if (claimed === null) return { ok: false, reason: `${name} is not a supported image type (PNG, JPEG, GIF, WebP or SVG).` }
  const actual = sniffImage(buffer)
  if (actual === null) return { ok: false, reason: `${name} does not contain a valid PNG, JPEG, GIF, WebP or SVG image.` }
  if (actual !== claimed) {
    return { ok: false, reason: `${name} is named like ${label(claimed)} but contains ${label(actual)}. Rename it to match.` }
  }
  return { ok: true, mimeType: actual }
}

const label = (mime: AssetMime): string =>
  ({ 'image/png': 'a PNG', 'image/jpeg': 'a JPEG', 'image/gif': 'a GIF', 'image/webp': 'a WebP', 'image/svg+xml': 'an SVG' })[mime]

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

// ── The whole project ──────────────────────────────────────────────────────

/** How much of the site's budget is used: text plus assets, and the file count. */
export function projectUsage(project: Pick<SiteProject, 'pages' | 'css' | 'assets'>): { bytes: number; files: number } {
  const text = project.pages.reduce((sum, page) => sum + textBytes(page.html), 0) + textBytes(project.css)
  const assets = project.assets.reduce((sum, asset) => sum + asset.size, 0)
  return { bytes: text + assets, files: project.pages.length + 1 + project.assets.length }
}

/** Cleans the website name the way every other WebTown text is cleaned. */
export const cleanTitle = (title: string): string => normalizeText(title, false)

/**
 * Every problem with a project, as sentences. Checks shape, names, limits and
 * that the homepage exists. Untrusted input (for example a stored record) is
 * fine: anything malformed is reported, never thrown.
 */
export function validateProject(input: unknown): Problem[] {
  const out: Problem[] = []
  const fail = (where: string, message: string): void => void out.push({ where, message })
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ where: 'site', message: 'The website data is missing or damaged.' }]
  }
  const p = input as Record<string, unknown>
  if (p['schemaVersion'] !== SITE_PROJECT_SCHEMA_VERSION) fail('site', 'This website was saved by a different version of WebTown.')
  if (typeof p['houseId'] !== 'string' || !HOUSE_ID_PATTERN.test(p['houseId'])) fail('site', 'The website is not attached to a valid house.')
  if (typeof p['revision'] !== 'number' || !Number.isInteger(p['revision']) || p['revision'] < 0) fail('site', 'The website revision is damaged.')
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (typeof p[key] !== 'string' || !ISO.test(p[key] as string)) fail('site', 'A website date is missing or damaged.')
  }
  const origin = p['origin'] as Record<string, unknown> | undefined
  if (!origin || !['blank', 'classic', 'migrated'].includes(String(origin['kind']))) fail('site', 'The website origin is damaged.')

  const title = p['title']
  if (typeof title !== 'string' || cleanTitle(title).length === 0) fail('title', 'Give your website a name.')
  else if (Array.from(cleanTitle(title)).length > SITE_PROJECT_LIMITS.title) {
    fail('title', `The website name is too long; the limit is ${SITE_PROJECT_LIMITS.title} characters.`)
  }

  const pages = p['pages']
  const names: string[] = []
  if (!Array.isArray(pages) || pages.length === 0) {
    fail('site', 'A website needs at least one page.')
  } else {
    if (pages.length > SITE_PROJECT_LIMITS.pages) fail('site', `A website can have at most ${SITE_PROJECT_LIMITS.pages} pages.`)
    for (const page of pages as unknown[]) {
      const pg = page as Record<string, unknown> | null
      if (!pg || typeof pg['name'] !== 'string' || typeof pg['html'] !== 'string') {
        fail('site', 'A page is damaged.')
        continue
      }
      const nameProblem = pageNameProblem(pg['name'], names)
      if (nameProblem) fail(`page:${pg['name']}`, nameProblem)
      names.push(pg['name'])
      const size = textBytes(pg['html'])
      if (size > SITE_PROJECT_LIMITS.pageBytes) {
        fail(`page:${pg['name']}`, `${pg['name']} is ${formatBytes(size)}; a page can be at most ${formatBytes(SITE_PROJECT_LIMITS.pageBytes)}.`)
      }
    }
  }
  if (typeof p['homePage'] !== 'string' || !names.includes(p['homePage'])) fail('site', 'The homepage must be one of the pages.')

  if (typeof p['css'] !== 'string') fail('css', 'The stylesheet is damaged.')
  else if (textBytes(p['css']) > SITE_PROJECT_LIMITS.cssBytes) {
    fail('css', `style.css is ${formatBytes(textBytes(p['css']))}; the limit is ${formatBytes(SITE_PROJECT_LIMITS.cssBytes)}.`)
  }

  const assets = p['assets']
  const assetNames: string[] = []
  const ids = new Set<string>()
  if (!Array.isArray(assets)) {
    fail('site', 'The image list is damaged.')
  } else {
    for (const asset of assets as unknown[]) {
      const problem = assetMetaProblem(asset)
      const a = asset as SiteAssetMeta
      if (problem) { fail(`asset:${String(a?.name)}`, problem); continue }
      const nameProblem = assetNameProblem(a.name, assetNames)
      if (nameProblem) fail(`asset:${a.name}`, nameProblem)
      if (ids.has(a.id)) fail(`asset:${a.name}`, 'Two images share an id.')
      ids.add(a.id)
      assetNames.push(a.name)
    }
  }

  if (out.length === 0) {
    const usage = projectUsage(input as SiteProject)
    if (usage.bytes > SITE_PROJECT_LIMITS.totalBytes) {
      fail('site', `The website is ${formatBytes(usage.bytes)}; the limit is ${formatBytes(SITE_PROJECT_LIMITS.totalBytes)}.`)
    }
    if (usage.files > SITE_PROJECT_LIMITS.totalFiles) fail('site', `The website has ${usage.files} files; the limit is ${SITE_PROJECT_LIMITS.totalFiles}.`)
  }
  return out
}

function assetMetaProblem(input: unknown): string | null {
  const a = input as Record<string, unknown> | null
  if (!a || typeof a['id'] !== 'string' || a['id'].length === 0 || a['id'].length > 64) return 'An image record is damaged.'
  if (typeof a['name'] !== 'string') return 'An image record is damaged.'
  if (!(ASSET_MIME_TYPES as readonly string[]).includes(String(a['mimeType']))) return `${a['name']} has an unsupported type.`
  if (typeof a['size'] !== 'number' || a['size'] <= 0 || a['size'] > SITE_PROJECT_LIMITS.assetBytes) return `${a['name']} has an impossible size.`
  if (typeFromName(a['name']) !== a['mimeType']) return `${a['name']} does not match its type.`
  return null
}

/**
 * Bytes as an `ArrayBuffer`, whatever realm or view they came in (IndexedDB, a file, a test). Null if not bytes.
 * Checked by tag rather than `instanceof`, which fails across realms.
 */
export function toArrayBuffer(value: unknown): ArrayBuffer | null {
  const tag = Object.prototype.toString.call(value)
  if (tag === '[object ArrayBuffer]') return value as ArrayBuffer
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer
  }
  return null
}

/** Checks a stored asset with its bytes. A record that fails is skipped, never deleted. */
export function assetProblem(input: unknown, houseId: string): string | null {
  const meta = assetMetaProblem(input)
  if (meta) return meta
  const a = input as SiteAsset
  if (a.houseId !== houseId) return `${a.name} belongs to another house.`
  const buffer = toArrayBuffer(a.bytes)
  if (buffer === null) return `${a.name} has no image data.`
  if (buffer.byteLength !== a.size) return `${a.name} is damaged (wrong size).`
  if (sniffImage(buffer) !== a.mimeType) return `${a.name} is damaged (not the image it claims to be).`
  return null
}
