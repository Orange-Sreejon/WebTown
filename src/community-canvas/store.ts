import type { CanvasBox, CanvasOp, CanvasStroke } from '../cloud/canvas'
import { CHUNK, chunkBox, chunksFor, hitsStroke, overlaps, strokeBox, type ChunkKey } from './geometry'

/** A stroke on screen: as stored, with its bounds; `pending` while this client's add has not been confirmed. */
export interface ShownStroke extends CanvasStroke {
  box: CanvasBox
  pending: boolean
}

export const toShown = (s: CanvasStroke, pending = false): ShownStroke => ({ ...s, box: strokeBox(s.points, s.width), pending })

/**
 * What this client knows of the canvas (CH-04): the visible strokes in the chunks it has loaded, and the newest
 * operation applied (`seq`). Pure: the session feeds it loads and operations.
 *
 * Consistency: every load returns the newest `seq` at the time of reading, which is never older than anything this
 * client has seen (operations of a Hall commit in sequence order, migration 20261220090000). So after a load the
 * session catches up from the store's `seq`; applying an operation again is harmless (adds put, hides remove), and
 * operations at or below `seq` are ignored, so nothing is applied twice and nothing in between is missed.
 */
export class CanvasStore {
  /** The newest operation applied; null until the first load. */
  seq: number | null = null
  /** Bumped on every change, for redrawing. */
  version = 0
  private readonly strokes = new Map<string, ShownStroke>()
  private readonly loaded = new Set<ChunkKey>()

  get size(): number {
    return this.strokes.size
  }

  isLoaded(key: ChunkKey): boolean {
    return this.loaded.has(key)
  }

  loadedChunks(): ChunkKey[] {
    return [...this.loaded]
  }

  get(id: string): ShownStroke | undefined {
    return this.strokes.get(id)
  }

  /** Whether a box touches any loaded chunk (only strokes there are kept). */
  covers(box: CanvasBox): boolean {
    const across = (Math.floor(box.x2 / CHUNK) - Math.floor(box.x1 / CHUNK) + 1) * (Math.floor(box.y2 / CHUNK) - Math.floor(box.y1 / CHUNK) + 1)
    if (across <= this.loaded.size) return chunksFor(box).some(k => this.loaded.has(k))
    for (const k of this.loaded) if (overlaps(chunkBox(k), box)) return true
    return false
  }

  /** A viewport load: these chunks are now known, with these visible strokes, as of operation `seq`. */
  load(keys: readonly ChunkKey[], strokes: readonly CanvasStroke[], seq: number): void {
    for (const k of keys) this.loaded.add(k)
    for (const s of strokes) {
      const shown = toShown(s)
      if (this.covers(shown.box)) this.strokes.set(s.id, shown)
    }
    if (this.seq === null) this.seq = seq
    this.version++
  }

  /** Applies one operation from the log. Returns false for one already applied (or before the first load). */
  apply(op: CanvasOp): boolean {
    if (this.seq === null || op.seq <= this.seq) return false
    this.seq = op.seq
    if (op.kind === 'add' || op.kind === 'restore') {
      if (op.stroke) this.putIfCovered(op.stroke)
      else this.strokes.delete(op.strokeId) // hidden again since; a later op says so too
    } else if (op.kind === 'hide') {
      this.strokes.delete(op.strokeId)
    } else if (op.kind === 'clear') {
      for (const id of op.strokeIds) this.strokes.delete(id)
    }
    this.version++
    return true
  }

  private putIfCovered(s: CanvasStroke): void {
    const shown = toShown(s)
    if (this.covers(shown.box) || this.strokes.has(s.id)) this.strokes.set(s.id, shown)
  }

  /** This client's own change, shown before the database confirms it. */
  putLocal(stroke: ShownStroke): void {
    this.strokes.set(stroke.id, stroke)
    this.version++
  }

  /** The database stored it: shown as stored. */
  confirm(stroke: CanvasStroke): void {
    if (this.strokes.get(stroke.id)?.pending) {
      this.strokes.set(stroke.id, toShown(stroke))
      this.version++
    }
  }

  remove(id: string): ShownStroke | undefined {
    const s = this.strokes.get(id)
    if (s) {
      this.strokes.delete(id)
      this.version++
    }
    return s
  }

  /** Forgets chunks not in `keep`, and strokes no longer in any loaded chunk (never this client's unsaved ones). */
  unloadExcept(keep: ReadonlySet<ChunkKey>): boolean {
    let dropped = false
    for (const k of [...this.loaded]) if (!keep.has(k)) { this.loaded.delete(k); dropped = true }
    if (!dropped) return false
    for (const [id, s] of this.strokes) if (!s.pending && !this.covers(s.box)) this.strokes.delete(id)
    this.version++
    return true
  }

  /** Visible strokes touching a box, in the order they arrived. */
  inBox(box: CanvasBox): ShownStroke[] {
    const out: ShownStroke[] = []
    for (const s of this.strokes.values()) if (overlaps(s.box, box)) out.push(s)
    return out
  }

  /** The newest stroke under (x, y) that `may` allows, or null. */
  hit(x: number, y: number, radius: number, may: (s: ShownStroke) => boolean): ShownStroke | null {
    const probe = { x1: x - radius, y1: y - radius, x2: x + radius, y2: y + radius }
    let found: ShownStroke | null = null
    for (const s of this.strokes.values()) {
      if (overlaps(s.box, probe) && may(s) && hitsStroke(s.points, s.width, x, y, radius)) found = s
    }
    return found
  }

  /** Back to nothing known (a catch-up too long to be worth it: everything is loaded again). */
  reset(): void {
    const pending = [...this.strokes.values()].filter(s => s.pending)
    this.strokes.clear()
    for (const s of pending) this.strokes.set(s.id, s)
    this.loaded.clear()
    this.seq = null
    this.version++
  }
}
