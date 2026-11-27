import { CANVAS_LIMITS, CANVAS_TOOLS, type CanvasTool } from '../cloud/canvas'
import { isUuid } from '../cloud/backend'

/**
 * Live previews (CH-04, design 4.2): while someone draws, their client broadcasts the stroke's points on the Hall
 * channel so others see it forming. A preview is never stored and anyone in the town can send one, so it is
 * validated like any untrusted message, drawn faded, capped in size and number, and gone after a few seconds or as
 * soon as the stored stroke arrives (same id).
 *
 * Wire format (event `preview`): `{ v: 1, id, i, p, t, c, w }`: stroke id, index of the first value in `p` within
 * the stroke's flat point list, the new values, tool, colour, width.
 */

export const PREVIEW_EVENT = 'preview'
/** At most this many messages a second per stroke. */
export const PREVIEW_RATE_HZ = 15
/** A preview with nothing new for this long disappears. */
export const PREVIEW_TTL_MS = 5000
/** Values (x and y each count) one message may carry. */
export const PREVIEW_MAX_VALUES = 400
/** Previews shown at once; more are ignored until some end. */
export const MAX_PREVIEWS = 16

export interface PreviewMessage {
  v: 1
  id: string
  i: number
  p: number[]
  t: CanvasTool
  c: string
  w: number
}

const MAX_VALUES = CANVAS_LIMITS.maxPoints * 2

export function parsePreview(raw: unknown): PreviewMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const { v, id, i, p, t, c, w } = r
  if (v !== 1 || !isUuid(id)) return null
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i % 2 !== 0 || i >= MAX_VALUES) return null
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > PREVIEW_MAX_VALUES || i + p.length > MAX_VALUES) return null
  if (!p.every(x => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= CANVAS_LIMITS.coordinate)) return null
  if (typeof t !== 'string' || !(CANVAS_TOOLS as readonly string[]).includes(t)) return null
  if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/.test(c)) return null
  if (typeof w !== 'number' || !Number.isInteger(w) || w < CANVAS_LIMITS.minWidth || w > CANVAS_LIMITS.maxWidth) return null
  return { v: 1, id, i, p: p as number[], t: t as CanvasTool, c, w }
}

export interface Preview {
  id: string
  tool: CanvasTool
  color: string
  width: number
  points: number[]
  /** When the last message arrived (ms). */
  at: number
}

/**
 * The previews being drawn by others. A message continues a preview only from where it is (`i` at most its length:
 * a repeat overwrites, a gap is ignored, so a lost message leaves the preview short, never wrong).
 */
export class Previews {
  private readonly byId = new Map<string, Preview>()

  /** Returns whether anything changed. */
  receive(m: PreviewMessage, now: number): boolean {
    let p = this.byId.get(m.id)
    if (!p) {
      if (m.i !== 0 || this.byId.size >= MAX_PREVIEWS) return false
      p = { id: m.id, tool: m.t, color: m.c, width: m.w, points: [], at: now }
      this.byId.set(m.id, p)
    }
    if (m.i > p.points.length) return false
    p.points.splice(m.i, p.points.length - m.i, ...m.p)
    p.at = now
    return true
  }

  /** The stored stroke arrived (or was refused): its preview goes. */
  end(id: string): boolean {
    return this.byId.delete(id)
  }

  /** Drops previews that have gone quiet. Returns whether any went. */
  expire(now: number): boolean {
    let changed = false
    for (const [id, p] of this.byId) if (now - p.at > PREVIEW_TTL_MS) { this.byId.delete(id); changed = true }
    return changed
  }

  all(): Preview[] {
    return [...this.byId.values()]
  }

  clear(): void {
    this.byId.clear()
  }
}

/**
 * The sending side for the stroke being drawn: collects points and says what to send, at most PREVIEW_RATE_HZ times
 * a second, split into messages of at most PREVIEW_MAX_VALUES values.
 */
export class PreviewSender {
  private sent = 0
  private lastAt = -Infinity

  constructor(private readonly id: string, private readonly tool: CanvasTool, private readonly color: string, private readonly width: number) {}

  /** The messages to send now for `points` (the stroke so far), or none if it is too soon or nothing is new. */
  take(points: readonly number[], now: number, force = false): PreviewMessage[] {
    if (!force && now - this.lastAt < 1000 / PREVIEW_RATE_HZ) return []
    const limit = Math.min(points.length, MAX_VALUES)
    if (limit <= this.sent) return []
    const out: PreviewMessage[] = []
    for (let i = this.sent; i < limit; i += PREVIEW_MAX_VALUES) {
      out.push({ v: 1, id: this.id, i, p: points.slice(i, Math.min(limit, i + PREVIEW_MAX_VALUES)), t: this.tool, c: this.color, w: this.width })
    }
    this.sent = limit
    this.lastAt = now
    return out
  }
}
