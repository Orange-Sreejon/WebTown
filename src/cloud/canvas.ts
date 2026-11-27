import { isUuid, toAppError, type CloudBackend } from './backend'
import { StorageError, ValidationError } from '../personal-spaces/errors'

/**
 * The Community Hall's shared canvas (CH-03): vector strokes on a large plane, and the operation log clients catch
 * up from. Every call is a database function that checks the caller against the world; the database also computes
 * each stroke's bounds and stamps its author. Answers are parsed strictly: anything unexpected is refused.
 *
 * Live updates: the database announces `{ seq, kind }` on the Hall's channel after each change. Members can
 * broadcast on that channel too, so an announcement is only a hint; what changed is always read with
 * `canvasOpsSince` (`parseCanvasAnnouncement` says whether a message is worth a catch-up).
 */

export const CANVAS_LIMITS = {
  /** Coordinates are whole world units within +-this. */
  coordinate: 1_000_000,
  /** Points in one stroke. */
  maxPoints: 2000,
  minWidth: 1,
  maxWidth: 64,
  /** Strokes one viewport load may ask for. */
  viewport: 5000,
  /** Operations one catch-up may ask for. */
  ops: 1000,
} as const

export const CANVAS_TOOLS = ['pen', 'marker'] as const
export type CanvasTool = (typeof CANVAS_TOOLS)[number]
export type HideReason = 'erased' | 'undone' | 'moderated'

export interface CanvasBox { x1: number; y1: number; x2: number; y2: number }

export interface CanvasStroke {
  id: string
  /** Null if the account no longer exists. */
  authorId: string | null
  /** Null when the author is no longer in the town ("a former member"). */
  authorName: string | null
  tool: CanvasTool
  color: string
  width: number
  /** x0, y0, x1, y1, ... */
  points: number[]
  createdAt: string
  hidden: boolean
}

interface OpBase { seq: number; actorId: string | null; createdAt: string }
export type CanvasOp =
  /** `stroke` is null when the stroke has been hidden again since (a later op in the log says so). */
  | (OpBase & { kind: 'add' | 'restore'; strokeId: string; stroke: CanvasStroke | null })
  | (OpBase & { kind: 'hide'; strokeId: string })
  | (OpBase & { kind: 'clear'; region: CanvasBox; strokeIds: string[] })

export interface StrokeInput {
  /** Made by the client (newUuid) once per stroke, and kept for retries: a resent stroke is not stored twice. */
  id: string
  tool: CanvasTool
  color: string
  width: number
  points: number[]
}

// ── Stroke encoding ────────────────────────────────────────────────────────────────────────────────────────────

const invalid = (path: string, message: string): never => {
  throw new ValidationError([{ path, message }])
}

/**
 * Pointer positions as the flat whole-number list the database stores: rounded, with repeated positions dropped.
 * Refuses a stroke that is empty, too long or goes outside the canvas (simplifying long strokes is CH-04's job).
 */
export function encodePoints(positions: ReadonlyArray<{ x: number; y: number }>): number[] {
  const out: number[] = []
  for (const p of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) invalid('points', 'The stroke is damaged.')
    const x = Math.round(p.x) || 0 // never -0
    const y = Math.round(p.y) || 0
    if (Math.abs(x) > CANVAS_LIMITS.coordinate || Math.abs(y) > CANVAS_LIMITS.coordinate) invalid('points', 'That stroke goes outside the canvas.')
    if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) continue
    out.push(x, y)
  }
  if (out.length === 0) invalid('points', 'The stroke is empty.')
  if (out.length / 2 > CANVAS_LIMITS.maxPoints) invalid('points', 'That stroke is too long. Try a shorter one.')
  return out
}

/** The checks the database makes, made first so a bad stroke never leaves the device. */
export function validateStroke(input: StrokeInput): StrokeInput {
  if (!isUuid(input.id)) invalid('id', 'The stroke is damaged.')
  if (!(CANVAS_TOOLS as readonly string[]).includes(input.tool)) invalid('tool', 'That pen is not one WebTown has.')
  if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/.test(input.color)) invalid('color', 'That colour is not one WebTown can use.')
  if (!Number.isInteger(input.width) || input.width < CANVAS_LIMITS.minWidth || input.width > CANVAS_LIMITS.maxWidth) {
    invalid('width', `Pen sizes go from ${CANVAS_LIMITS.minWidth} to ${CANVAS_LIMITS.maxWidth}.`)
  }
  const p = input.points
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length / 2 > CANVAS_LIMITS.maxPoints
      || !p.every(v => Number.isInteger(v) && Math.abs(v) <= CANVAS_LIMITS.coordinate)) {
    invalid('points', 'The stroke is damaged or too long.')
  }
  return input
}

function validateBox(box: CanvasBox): CanvasBox {
  for (const v of [box.x1, box.y1, box.x2, box.y2]) {
    if (!Number.isInteger(v) || Math.abs(v) > CANVAS_LIMITS.coordinate) invalid('area', 'That area is outside the canvas.')
  }
  return box
}

// ── Parsing ────────────────────────────────────────────────────────────────────────────────────────────────────

const bad = (): never => {
  throw new StorageError('WebTown sent back something it should not have. Please try again.')
}
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad())
const str = (v: unknown): string => (typeof v === 'string' ? v : bad())
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v))
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad())
const uuid = (v: unknown): string => (isUuid(v) ? v : bad())
const uuidOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : uuid(v))
const int = (v: unknown, min: number, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : bad())
const seqOf = (v: unknown): number => int(v, 0, Number.MAX_SAFE_INTEGER)
const coord = (v: unknown): number => int(v, -CANVAS_LIMITS.coordinate, CANVAS_LIMITS.coordinate)

export function parseCanvasStroke(raw: unknown): CanvasStroke {
  const r = record(raw)
  const tool = r['tool']
  if (tool !== 'pen' && tool !== 'marker') return bad()
  const color = str(r['color'])
  if (!/^#[0-9a-f]{6}$/.test(color)) return bad()
  const points = r['points']
  if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0 || points.length / 2 > CANVAS_LIMITS.maxPoints) return bad()
  return {
    id: uuid(r['id']), authorId: uuidOrNull(r['authorId']), authorName: strOrNull(r['authorName']), tool, color,
    width: int(r['width'], CANVAS_LIMITS.minWidth, CANVAS_LIMITS.maxWidth), points: points.map(coord),
    createdAt: str(r['createdAt']), hidden: bool(r['hidden']),
  }
}

const parseBox = (raw: unknown): CanvasBox => {
  const r = record(raw)
  return { x1: coord(r['x1']), y1: coord(r['y1']), x2: coord(r['x2']), y2: coord(r['y2']) }
}

export function parseCanvasOp(raw: unknown): CanvasOp {
  const r = record(raw)
  const base: OpBase = { seq: int(r['seq'], 1, Number.MAX_SAFE_INTEGER), actorId: uuidOrNull(r['actorId']), createdAt: str(r['createdAt']) }
  const kind = r['kind']
  if (kind === 'add' || kind === 'restore') {
    const strokeId = uuid(r['strokeId'])
    const stroke = r['stroke'] === null || r['stroke'] === undefined ? null : parseCanvasStroke(r['stroke'])
    if (stroke && stroke.id !== strokeId) return bad()
    return { ...base, kind, strokeId, stroke }
  }
  if (kind === 'hide') return { ...base, kind, strokeId: uuid(r['strokeId']) }
  if (kind === 'clear') {
    const ids = r['strokeIds']
    if (!Array.isArray(ids)) return bad()
    return { ...base, kind, region: parseBox(r['region']), strokeIds: ids.map(uuid) }
  }
  return bad()
}

const opOrNull = (raw: unknown): CanvasOp | null => (raw === null ? null : parseCanvasOp(raw))

/**
 * A message from the Hall's channel (event `canvas`) as a hint: the sequence number it claims, or null if it is not
 * one. Anyone in the town can send such a message, so it only ever triggers `canvasOpsSince`.
 */
export function parseCanvasAnnouncement(payload: unknown): { seq: number } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const seq = (payload as Record<string, unknown>)['seq']
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 ? { seq } : null
}

// ── Calls ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function call<T>(backend: CloudBackend, fn: string, args: Record<string, unknown>, parse: (raw: unknown) => T): Promise<T> {
  let raw: unknown
  try {
    raw = await backend.rpc(fn, args)
  } catch (error) {
    throw toAppError(error)
  }
  return parse(raw)
}

/** Stores a stroke. Safe to retry with the same id: the stored stroke's 'add' comes back, unchanged. */
export async function addCanvasStroke(backend: CloudBackend, worldId: string, input: StrokeInput): Promise<CanvasOp> {
  const s = validateStroke(input)
  return call(backend, 'add_canvas_stroke',
    { p_world: worldId, p_id: s.id, p_tool: s.tool, p_color: s.color, p_width: s.width, p_points: s.points }, parseCanvasOp)
}

/** Erase or undo your own stroke, or (moderators) remove anyone's. Null when it was already hidden. */
export const hideCanvasStroke = (backend: CloudBackend, worldId: string, strokeId: string, reason: HideReason, note?: string): Promise<CanvasOp | null> =>
  call(backend, 'hide_canvas_stroke', { p_world: worldId, p_id: strokeId, p_reason: reason, p_note: note ?? null }, opOrNull)

/** Redo your own erase or undo, or (moderators) bring back what a moderator removed. Null when it was visible. */
export const restoreCanvasStroke = (backend: CloudBackend, worldId: string, strokeId: string, note?: string): Promise<CanvasOp | null> =>
  call(backend, 'restore_canvas_stroke', { p_world: worldId, p_id: strokeId, p_note: note ?? null }, opOrNull)

/** Moderators: hides the visible strokes touching an area (up to 5,000 at a time). Null when there were none. */
export async function clearCanvasRegion(backend: CloudBackend, worldId: string, area: CanvasBox, note?: string): Promise<CanvasOp | null> {
  const b = validateBox(area)
  return call(backend, 'clear_canvas_region',
    { p_world: worldId, p_x1: b.x1, p_y1: b.y1, p_x2: b.x2, p_y2: b.y2, p_note: note ?? null }, opOrNull)
}

/** Moderators: lock or unlock the canvas or the website draft. */
export const setHallLock = (backend: CloudBackend, worldId: string, what: 'canvas' | 'draft', locked: boolean, note?: string): Promise<void> =>
  call(backend, 'set_hall_lock', { p_world: worldId, p_what: what, p_locked: locked, p_note: note ?? null }, () => undefined)

export interface CanvasView {
  /** The newest operation when the strokes were read: catch up from here with `canvasOpsSince`. */
  seq: number
  strokes: CanvasStroke[]
  /** More strokes touch the area than were returned. */
  truncated: boolean
}

/** The visible strokes touching an area, oldest first. */
export async function canvasStrokesIn(backend: CloudBackend, worldId: string, area: CanvasBox, limit = 2000): Promise<CanvasView> {
  const b = validateBox(area)
  if (!Number.isInteger(limit) || limit < 1 || limit > CANVAS_LIMITS.viewport) invalid('limit', `Ask for 1 to ${CANVAS_LIMITS.viewport} strokes.`)
  return call(backend, 'canvas_strokes_in',
    { p_world: worldId, p_x1: b.x1, p_y1: b.y1, p_x2: b.x2, p_y2: b.y2, p_limit: limit }, raw => {
      const r = record(raw)
      const strokes = r['strokes']
      if (!Array.isArray(strokes)) return bad()
      return { seq: seqOf(r['seq']), strokes: strokes.map(parseCanvasStroke), truncated: bool(r['truncated']) }
    })
}

/** What changed after `seq`, oldest first. `more`: call again from the last op's `seq`. */
export async function canvasOpsSince(backend: CloudBackend, worldId: string, seq: number, limit = 500): Promise<{ ops: CanvasOp[]; more: boolean }> {
  if (!Number.isSafeInteger(seq) || seq < 0) invalid('seq', 'That is not a place in the canvas history.')
  if (!Number.isInteger(limit) || limit < 1 || limit > CANVAS_LIMITS.ops) invalid('limit', `Ask for 1 to ${CANVAS_LIMITS.ops} changes.`)
  return call(backend, 'canvas_ops_since', { p_world: worldId, p_seq: seq, p_limit: limit }, raw => {
    const r = record(raw)
    const ops = r['ops']
    if (!Array.isArray(ops)) return bad()
    const parsed = ops.map(parseCanvasOp)
    // In order and after `seq`, or the catch-up can't be trusted.
    for (let i = 0; i < parsed.length; i++) if (parsed[i]!.seq <= (i === 0 ? seq : parsed[i - 1]!.seq)) return bad()
    return { ops: parsed, more: bool(r['more']) }
  })
}
