/**
 * What players of one world send each other over the realtime channel (design 3), and the checks every
 * incoming message must pass. Everything that arrives is untrusted: it is parsed into these types or dropped.
 * Pure: no network, no Phaser.
 */

export type Facing = 'up' | 'down' | 'left' | 'right'
export type EmoteKind = 'wave' | 'heart' | 'laugh' | 'surprise'

/** Where a player is: the town, or inside the house on a map slot. */
export type SceneId = 'town' | `house:${string}`

/** Presence: who is connected, and where they last stood. Key = `s`. */
export interface PresenceMeta {
  v: 1
  /** Session id (one per open game). */
  s: string
  /** User id; the name and look come from the member list for this id, never from here. */
  u: string
  /** When the session started (ms); the newest session of a user is the one shown. */
  j: number
  /** The sender's latest move sequence when this was published: older than a received move means stale. */
  q: number
  sc: SceneId
  x: number
  y: number
  f: Facing
}

/** A movement update (event `mv`). */
export interface MoveMessage {
  v: 1
  s: string
  /** Sequence number, increasing per session. */
  q: number
  /** The sender's clock: ms since their session started. Spaces the samples as they were taken. */
  t: number
  sc: SceneId
  x: number
  y: number
  f: Facing
  /** 1 walking, 0 standing. */
  w: 0 | 1
}

/** An emote (event `em`); `to` is the session it is aimed at (a wave). */
export interface EmoteMessage {
  v: 1
  s: string
  q: number
  e: EmoteKind
  to?: string
}

export const EVENT_MOVE = 'mv'
export const EVENT_EMOTE = 'em'

/** The town map (`MAP_WIDTH_PX` x `MAP_HEIGHT_PX`); houses are smaller than this bound. */
export const TOWN_BOUNDS = { w: 1280, h: 1024 } as const
export const HOUSE_BOUNDS = { w: 1024, h: 1024 } as const
/** Larger serialised messages are dropped unread. */
export const MAX_MESSAGE_BYTES = 512

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right']
const EMOTES: readonly EmoteKind[] = ['wave', 'heart', 'laugh', 'surprise']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SCENE = /^(town|house:[a-z0-9-]{1,40})$/

export const isSessionId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
export const isScene = (v: unknown): v is SceneId => typeof v === 'string' && SCENE.test(v)
export const isFacing = (v: unknown): v is Facing => typeof v === 'string' && (FACINGS as readonly string[]).includes(v)
export const isEmote = (v: unknown): v is EmoteKind => typeof v === 'string' && (EMOTES as readonly string[]).includes(v)

export function boundsOf(scene: SceneId): { w: number; h: number } {
  return scene === 'town' ? TOWN_BOUNDS : HOUSE_BOUNDS
}

/** A coordinate inside the scene, rounded to a tenth of a pixel. Null if outside or not a number. */
function coord(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return null
  return Math.round(v * 10) / 10
}

const record = (raw: unknown): Record<string, unknown> | null =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null

/** Rough size of a payload as sent (JSON); oversize payloads are not even looked at. */
export function tooLarge(raw: unknown): boolean {
  try {
    return JSON.stringify(raw).length > MAX_MESSAGE_BYTES
  } catch {
    return true
  }
}

const seq = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER ? v : null

export function parsePresence(raw: unknown): PresenceMeta | null {
  const r = record(raw)
  if (!r || tooLarge(r) || r['v'] !== 1) return null
  const { s, u, j, sc, f } = r
  if (!isSessionId(s) || !isSessionId(u) || !isScene(sc) || !isFacing(f)) return null
  if (typeof j !== 'number' || !Number.isFinite(j) || j < 0) return null
  const q = seq(r['q'])
  if (q === null) return null
  const b = boundsOf(sc)
  const x = coord(r['x'], b.w)
  const y = coord(r['y'], b.h)
  if (x === null || y === null) return null
  return { v: 1, s, u, j, q, sc, x, y, f }
}

export function parseMove(raw: unknown): MoveMessage | null {
  const r = record(raw)
  if (!r || tooLarge(r) || r['v'] !== 1) return null
  const { s, sc, f, w } = r
  const q = seq(r['q'])
  const t = seq(r['t'])
  if (!isSessionId(s) || q === null || t === null || !isScene(sc) || !isFacing(f) || (w !== 0 && w !== 1)) return null
  const b = boundsOf(sc)
  const x = coord(r['x'], b.w)
  const y = coord(r['y'], b.h)
  if (x === null || y === null) return null
  return { v: 1, s, q, t, sc, x, y, f, w }
}

export function parseEmote(raw: unknown): EmoteMessage | null {
  const r = record(raw)
  if (!r || tooLarge(r) || r['v'] !== 1) return null
  const { s, e, to } = r
  const q = seq(r['q'])
  if (!isSessionId(s) || q === null || !isEmote(e)) return null
  if (to !== undefined && !isSessionId(to)) return null
  return to === undefined ? { v: 1, s, q, e } : { v: 1, s, q, e, to }
}
