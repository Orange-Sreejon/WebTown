import { CANVAS_LIMITS, type CanvasBox } from '../cloud/canvas'

/**
 * The Community Canvas's geometry (CH-04): simplifying strokes, bounding boxes, the chunks the plane is loaded in,
 * the view (pan and zoom) and hit testing for the eraser. Pure: no DOM, no network.
 * Points are flat `[x0, y0, x1, y1, ...]` lists in world units, as stored.
 */

/** Chunks are squares of this many world units; the view loads the ones it overlaps plus one ring. */
export const CHUNK = 1024
/** Beyond this many chunks across the view, nothing new is loaded until the player zooms in. */
export const MAX_CHUNKS_ACROSS = 16
export const MIN_ZOOM = 1 / 16
export const MAX_ZOOM = 8

const LIMIT = CANVAS_LIMITS.coordinate

/**
 * Ramer-Douglas-Peucker: drops points closer than `tolerance` to the line through their neighbours. Keeps the first
 * and last point. Iterative, so a long stroke can't overflow the stack.
 */
export function simplify(points: readonly number[], tolerance: number): number[] {
  const n = points.length / 2
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  const t2 = tolerance * tolerance
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    let worst = -1
    let worstD = t2
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance2(points[i * 2]!, points[i * 2 + 1]!, points[a * 2]!, points[a * 2 + 1]!, points[b * 2]!, points[b * 2 + 1]!)
      if (d > worstD) { worstD = d; worst = i }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2]!, points[i * 2 + 1]!)
  return out
}

/** Squared distance from (px, py) to the segment (ax, ay)-(bx, by). */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** The stroke's bounds as the database computes them: the points, padded by half the width (rounded up). */
export function strokeBox(points: readonly number[], width: number): CanvasBox {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!, y = points[i + 1]!
    if (x < x1) x1 = x
    if (x > x2) x2 = x
    if (y < y1) y1 = y
    if (y > y2) y2 = y
  }
  const pad = Math.ceil(width / 2)
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad }
}

export const overlaps = (a: CanvasBox, b: CanvasBox): boolean => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2

/** Whether (x, y) is within `radius` of the stroke's line, counting its width. */
export function hitsStroke(points: readonly number[], width: number, x: number, y: number, radius: number): boolean {
  const reach = radius + width / 2
  const r2 = reach * reach
  if (points.length === 2) return segmentDistance2(x, y, points[0]!, points[1]!, points[0]!, points[1]!) <= r2
  for (let i = 0; i + 3 < points.length; i += 2) {
    if (segmentDistance2(x, y, points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!) <= r2) return true
  }
  return false
}

// ── Chunks ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ChunkKey = string
export const chunkKey = (cx: number, cy: number): ChunkKey => `${cx},${cy}`
const LAST_CHUNK = Math.floor(LIMIT / CHUNK)

export function chunkBox(key: ChunkKey): CanvasBox {
  const [cx, cy] = key.split(',').map(Number) as [number, number]
  const clamp = (v: number): number => Math.max(-LIMIT, Math.min(LIMIT, v))
  return { x1: clamp(cx * CHUNK), y1: clamp(cy * CHUNK), x2: clamp((cx + 1) * CHUNK - 1), y2: clamp((cy + 1) * CHUNK - 1) }
}

/** The chunks a box overlaps, grown by `ring` chunks on every side, inside the plane. */
export function chunksFor(box: CanvasBox, ring = 0): ChunkKey[] {
  const lo = (v: number): number => Math.max(-LAST_CHUNK - 1, Math.floor(v / CHUNK) - ring)
  const hi = (v: number): number => Math.min(LAST_CHUNK, Math.floor(v / CHUNK) + ring)
  const keys: ChunkKey[] = []
  for (let cy = lo(box.y1); cy <= hi(box.y2); cy++) for (let cx = lo(box.x1); cx <= hi(box.x2); cx++) keys.push(chunkKey(cx, cy))
  return keys
}

/** One box around several chunks: what a single viewport load asks for. */
export function unionBox(boxes: readonly CanvasBox[]): CanvasBox {
  return boxes.reduce((u, b) => ({ x1: Math.min(u.x1, b.x1), y1: Math.min(u.y1, b.y1), x2: Math.max(u.x2, b.x2), y2: Math.max(u.y2, b.y2) }))
}

// ── View ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the view is: the world point at its centre, and screen pixels per world unit. */
export interface View { x: number; y: number; zoom: number }
export interface Size { width: number; height: number }

export const HOME_VIEW: View = { x: 0, y: 0, zoom: 1 }

const clampView = (v: View): View => ({
  x: Math.max(-LIMIT, Math.min(LIMIT, v.x)),
  y: Math.max(-LIMIT, Math.min(LIMIT, v.y)),
  zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom)),
})

export const screenToWorld = (v: View, s: Size, sx: number, sy: number): { x: number; y: number } =>
  ({ x: v.x + (sx - s.width / 2) / v.zoom, y: v.y + (sy - s.height / 2) / v.zoom })

export const worldToScreen = (v: View, s: Size, x: number, y: number): { x: number; y: number } =>
  ({ x: (x - v.x) * v.zoom + s.width / 2, y: (y - v.y) * v.zoom + s.height / 2 })

/** Moves the view by a drag of (dx, dy) screen pixels. */
export const panBy = (v: View, dx: number, dy: number): View => clampView({ ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom })

/** Zooms by `factor`, keeping the world point under the screen point (sx, sy) where it is. */
export function zoomAt(v: View, s: Size, factor: number, sx: number, sy: number): View {
  const before = screenToWorld(v, s, sx, sy)
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor))
  const after = screenToWorld({ ...v, zoom }, s, sx, sy)
  return clampView({ x: v.x + before.x - after.x, y: v.y + before.y - after.y, zoom })
}

/** The world box the view shows. */
export function viewBox(v: View, s: Size): CanvasBox {
  const a = screenToWorld(v, s, 0, 0)
  const b = screenToWorld(v, s, s.width, s.height)
  return { x1: Math.floor(a.x), y1: Math.floor(a.y), x2: Math.ceil(b.x), y2: Math.ceil(b.y) }
}

/** Zoomed too far out to load: the view spans more than MAX_CHUNKS_ACROSS chunks. */
export const tooFarOut = (v: View, s: Size): boolean => Math.max(s.width, s.height) / v.zoom > MAX_CHUNKS_ACROSS * CHUNK
