import { ValidationError, type Issue } from '../errors'
import { MAX_HEIGHT, MAX_WIDTH } from '../paint/pixel-buffer'
import { toArrayBuffer } from '../site-project/rules'
import { HOUSE_ID_PATTERN } from '../website/site-types'

/**
 * A drawing in a house's Sketchbook, as stored: a PNG and what describes it.
 * Pure data and rules; no storage, no DOM.
 */
export const ARTWORK_SCHEMA_VERSION = 1
export const ARTWORK_LIMITS = { title: 60, bytes: 5_000_000, perHouse: 50 } as const
export const DEFAULT_TITLE = 'Untitled'

export interface ArtworkSummary {
  id: string
  houseId: string
  title: string
  width: number
  height: number
  /** True when the canvas base is transparent (Eraser and new area clear to transparent). */
  transparent: boolean
  byteSize: number
  createdAt: string
  updatedAt: string
}

export interface Artwork extends ArtworkSummary {
  /** The image, PNG-encoded. */
  png: ArrayBuffer
}

export interface ArtworkRecord extends Artwork {
  schemaVersion: typeof ARTWORK_SCHEMA_VERSION
}

/** What the Sketchbook asks to store. `id: null` makes a new drawing. */
export interface ArtworkInput {
  id: string | null
  houseId: string
  title: string
  width: number
  height: number
  transparent: boolean
  png: ArrayBuffer
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const ID = /^[A-Za-z0-9-]{1,64}$/
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The size a PNG says it is (from its IHDR chunk), or null if the bytes are not a PNG. */
export function pngSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null
  const view = new DataView(bytes)
  for (let i = 0; i < 8; i++) if (view.getUint8(i) !== PNG_SIGNATURE[i]) return null
  const type = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))
  if (type !== 'IHDR') return null
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** A drawing title as stored: control characters removed, spaces collapsed, trimmed. */
export const cleanArtworkTitle = (title: string): string =>
  title.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()

export const validHouseId = (houseId: unknown): houseId is string => typeof houseId === 'string' && HOUSE_ID_PATTERN.test(houseId)
export const validArtworkId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)

/** Every problem with something the Sketchbook wants to save. */
export function inputProblems(input: ArtworkInput): Issue[] {
  const issues: Issue[] = []
  const fail = (path: string, message: string): void => void issues.push({ path, message })
  if (!validHouseId(input?.houseId)) fail('houseId', 'That is not a valid house.')
  if (input?.id !== null && !validArtworkId(input?.id)) fail('id', 'That is not a valid drawing.')
  const title = typeof input?.title === 'string' ? cleanArtworkTitle(input.title) : ''
  if (title.length === 0) fail('title', 'Give the drawing a name.')
  else if (Array.from(title).length > ARTWORK_LIMITS.title) fail('title', `A drawing name can be at most ${ARTWORK_LIMITS.title} characters.`)
  const sizeOk = Number.isInteger(input?.width) && Number.isInteger(input?.height) &&
    input.width >= 1 && input.height >= 1 && input.width <= MAX_WIDTH && input.height <= MAX_HEIGHT
  if (!sizeOk) fail('size', `A drawing must be 1 to ${MAX_WIDTH} by 1 to ${MAX_HEIGHT} pixels.`)
  if (typeof input?.transparent !== 'boolean') fail('transparent', 'The canvas type is missing.')
  const png = toArrayBuffer(input?.png)
  if (!png) fail('image', 'The drawing has no image.')
  else if (png.byteLength > ARTWORK_LIMITS.bytes) fail('image', `The drawing is too big to save (the limit is ${ARTWORK_LIMITS.bytes / 1_000_000} MB).`)
  else {
    const size = pngSize(png)
    if (!size) fail('image', 'The drawing is not a PNG image.')
    else if (sizeOk && (size.width !== input.width || size.height !== input.height)) fail('image', 'The image does not match the drawing size.')
  }
  return issues
}

/** Throws `ValidationError` unless the input can be stored. */
export function requireValidInput(input: ArtworkInput): void {
  const issues = inputProblems(input)
  if (issues.length > 0) throw new ValidationError(issues)
}

/** Why a stored record cannot be used, or null. Stored data is untrusted. */
export function recordProblem(raw: unknown, houseId: string): string | null {
  if (typeof raw !== 'object' || raw === null) return 'A drawing record is damaged.'
  const r = raw as Partial<ArtworkRecord>
  if (r.schemaVersion !== ARTWORK_SCHEMA_VERSION) return 'A drawing was saved by a different version of WebTown.'
  if (r.houseId !== houseId) return 'A drawing belongs to another house.'
  const title = typeof r.title === 'string' ? r.title : 'A drawing'
  if (!validArtworkId(r.id) || typeof r.title !== 'string' || typeof r.transparent !== 'boolean') return `${title} is damaged.`
  if (typeof r.createdAt !== 'string' || !ISO.test(r.createdAt) || typeof r.updatedAt !== 'string' || !ISO.test(r.updatedAt)) return `${title} is damaged (dates).`
  const issues = inputProblems({ id: r.id, houseId: r.houseId, title: r.title, width: r.width!, height: r.height!, transparent: r.transparent, png: r.png! })
  return issues.length > 0 ? `${title} is damaged (${issues[0]!.message})` : null
}

/** A copy of a stored record, with its own bytes. */
export function toArtwork(r: ArtworkRecord): Artwork {
  const png = toArrayBuffer(r.png)!.slice(0)
  return {
    id: r.id, houseId: r.houseId, title: r.title, width: r.width, height: r.height, transparent: r.transparent,
    byteSize: png.byteLength, createdAt: r.createdAt, updatedAt: r.updatedAt, png,
  }
}

/** The record to store for an input, given the stored one it replaces (or none). */
export function toRecord(input: ArtworkInput, id: string, existing: ArtworkRecord | null, now: string): ArtworkRecord {
  const png = toArrayBuffer(input.png)!.slice(0)
  return {
    schemaVersion: ARTWORK_SCHEMA_VERSION,
    id,
    houseId: input.houseId,
    title: cleanArtworkTitle(input.title),
    width: input.width,
    height: input.height,
    transparent: input.transparent,
    png,
    byteSize: png.byteLength,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export const summaryOf = (a: Artwork): ArtworkSummary => {
  const { png: _png, ...summary } = a
  void _png
  return summary
}

/** Newest first; equal times by id, so the order is stable. */
export const newestFirst = (a: ArtworkSummary, b: ArtworkSummary): number =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)
