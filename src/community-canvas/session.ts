import { newUuid, type CloudBackend } from '../cloud/backend'
import {
  CANVAS_LIMITS, addCanvasStroke, canvasOpsSince, canvasStrokesIn, clearCanvasRegion, hideCanvasStroke, parseCanvasAnnouncement,
  restoreCanvasStroke, validateStroke, type CanvasBox, type CanvasOp, type CanvasTool, type HideReason, type StrokeInput,
} from '../cloud/canvas'
import { hallContext, parseLockAnnouncement } from '../cloud/community'
import { PersonalSpacesError } from '../personal-spaces/errors'
import type { RealtimeChannel, RealtimeTransport } from '../multiplayer/transport'
import { chunkBox, chunksFor, simplify, tooFarOut, unionBox, viewBox, type Size, type View } from './geometry'
import { PREVIEW_EVENT, PreviewSender, Previews, parsePreview } from './preview'
import { CanvasStore, toShown, type ShownStroke } from './store'

/**
 * One player's connection to their town's Community Canvas while the easel is open (CH-04, design 4.2).
 *
 * - Reads: loads the chunks around the view (`canvas_strokes_in`) and catches up from the operation log
 *   (`canvas_ops_since`), one read at a time, so the store's consistency rule holds (store.ts).
 * - Live: on `hall:<uuid>`, the database's `canvas` announcements are hints to catch up (members can send them too,
 *   so their content is never used); `preview` messages show strokes being drawn.
 * - Writes: an outbox, in order, retried with backoff while the network is down; the stroke id makes a retried add
 *   harmless. A refusal (limits, lock, permissions) undoes the change on screen and says why. Changes are shown at
 *   once and never advance `seq`: the catch-up that follows brings the stored version.
 * - Undo and redo of this player's own changes (draw, erase), as hide 'undone' / restore.
 *
 * Who may do what is decided by the database; `moderator` only decides what the eraser offers.
 */

export type CanvasStatus = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'removed'

export interface CanvasSessionOptions {
  backend: CloudBackend
  transport: RealtimeTransport
  worldId: string
  userId: string
  /** This connection's presence key on the Hall channel. */
  sessionId?: string
}

/** A change not yet confirmed by the database, longer than this, is reported as "not saved yet". */
export const UNSAVED_AFTER_MS = 60_000
/** Retry delays for the outbox and for reads while the network is down (the last one repeats). */
export const RETRY_MS = [1000, 2000, 5000, 10_000, 15_000] as const
/** Catch-up pages before giving up on catching up and loading the view again instead. */
export const MAX_CATCH_UP_PAGES = 5
/** Announcements trigger at most one catch-up per this long (a member flooding the channel costs little). */
export const ANNOUNCE_GAP_MS = 250
export const TICK_MS = 250
export const UNDO_DEPTH = 100
/** Pointer samples kept for the stroke being drawn, before simplifying. */
const MAX_RAW_VALUES = 40_000

type Job =
  | { kind: 'add'; input: StrokeInput; since: number }
  | { kind: 'hide'; id: string; reason: HideReason; stroke: ShownStroke; since: number }
  | { kind: 'restore'; id: string; stroke: ShownStroke; since: number }

type Undoable = { kind: 'draw'; stroke: ShownStroke } | { kind: 'erase'; stroke: ShownStroke; reason: HideReason }

interface Drawing { id: string; tool: CanvasTool; color: string; width: number; points: number[]; sender: PreviewSender }

const isRefusal = (e: unknown): e is PersonalSpacesError =>
  e instanceof PersonalSpacesError && (e.code === 'validation' || e.code === 'permission')
const message = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.')

export class CanvasSession {
  readonly store = new CanvasStore()
  readonly previews = new Previews()
  status: CanvasStatus = 'connecting'
  /** From the database at start: decides what the eraser offers (the database decides what is allowed). */
  moderator = false
  /** The canvas is locked (only moderators draw), as last known. */
  locked = false
  /** Zoomed out too far to load what is in view. */
  tooFar = false
  /** Some area in view has more drawing than one load returns. */
  truncated = false

  private channel: RealtimeChannel | null = null
  private stopped = false
  private readonly listeners = new Set<() => void>()
  private readonly noticeListeners = new Set<(text: string) => void>()
  private view: { view: View; size: Size } | null = null
  private ticker: ReturnType<typeof setInterval> | null = null

  private reading = false
  private wantLoad = false
  private wantCatchUp = false
  private readRetry: ReturnType<typeof setTimeout> | null = null
  private readFailures = 0
  private lastAnnounceCatchUp = -Infinity
  private announceTimer: ReturnType<typeof setTimeout> | null = null

  private readonly jobs: Job[] = []
  private sending = false
  private sendRetry: ReturnType<typeof setTimeout> | null = null
  private sendFailures = 0

  private undoStack: Undoable[] = []
  private redoStack: Undoable[] = []
  private drawing: Drawing | null = null

  constructor(private readonly options: CanvasSessionOptions) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.refreshHall()
    if (this.stopped || this.status === 'removed') return
    this.channel = this.options.transport.open(`hall:${this.options.worldId}`, this.options.sessionId ?? newUuid(), ['canvas', PREVIEW_EVENT, 'lock'], {
      onStatus: (status, detail) => {
        if (status === 'joined') {
          this.setStatus('live')
          // After a reconnect: whatever was announced meanwhile, and anything queued.
          if (this.store.seq !== null) this.requestCatchUp()
          this.retrySendingNow()
        } else if (status === 'error' && detail?.fatal) {
          this.setStatus('failed')
        } else if (this.status === 'live') {
          this.setStatus('reconnecting')
        }
      },
      onPresence: () => undefined,
      onBroadcast: (event, payload) => this.onBroadcast(event, payload),
    })
    this.ticker = setInterval(() => this.tick(), TICK_MS)
    this.pump()
  }

  /**
   * Reads this player's role and the canvas lock again (at start, after a `lock` hint, after a moderator changed it
   * here). A failure other than "not in this town" keeps what was known: the database still decides.
   */
  async refreshHall(): Promise<void> {
    try {
      const hall = await hallContext(this.options.backend, this.options.worldId)
      if (this.stopped) return
      const changed = this.moderator !== (hall.role !== 'member') || this.locked !== hall.canvasLocked
      this.moderator = hall.role !== 'member'
      this.locked = hall.canvasLocked
      if (changed) this.changed()
    } catch (error) {
      if (this.stopped) return
      if (error instanceof PersonalSpacesError && error.code === 'permission') this.setStatus('removed')
    }
  }

  stop(): void {
    this.stopped = true
    this.channel?.leave()
    this.channel = null
    for (const t of [this.readRetry, this.sendRetry, this.announceTimer]) if (t) clearTimeout(t)
    if (this.ticker) clearInterval(this.ticker)
    this.listeners.clear()
    this.noticeListeners.clear()
  }

  /** Called on any change worth redrawing or re-rendering. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Messages for the player (a refusal, a limit). Returns the unsubscribe. */
  onNotice(listener: (text: string) => void): () => void {
    this.noticeListeners.add(listener)
    return () => this.noticeListeners.delete(listener)
  }

  private changed(): void {
    for (const l of [...this.listeners]) l()
  }

  private notice(text: string): void {
    for (const l of [...this.noticeListeners]) l(text)
  }

  private setStatus(status: CanvasStatus): void {
    if (this.status === status || this.status === 'removed') return
    this.status = status
    this.changed()
  }

  /** Changes this client made that the database has not confirmed yet. */
  get unsaved(): number {
    return this.jobs.length
  }

  /** Some change has waited longer than UNSAVED_AFTER_MS. */
  get stale(): boolean {
    return this.jobs.length > 0 && Date.now() - this.jobs[0]!.since > UNSAVED_AFTER_MS
  }

  private wasStale = false
  private tick(): void {
    let changed = this.previews.expire(Date.now())
    if (this.stale !== this.wasStale) { this.wasStale = this.stale; changed = true }
    if (this.drawing) this.sendPreview(false)
    if (changed) this.changed()
  }

  // ── Live messages ────────────────────────────────────────────────────────────────────────────────────────────

  private onBroadcast(event: string, payload: unknown): void {
    if (event === 'canvas') {
      const hint = parseCanvasAnnouncement(payload)
      if (!hint || this.store.seq === null || hint.seq <= this.store.seq) return
      const wait = this.lastAnnounceCatchUp + ANNOUNCE_GAP_MS - Date.now()
      if (wait <= 0) {
        this.lastAnnounceCatchUp = Date.now()
        this.requestCatchUp()
      } else if (!this.announceTimer) {
        this.announceTimer = setTimeout(() => {
          this.announceTimer = null
          this.lastAnnounceCatchUp = Date.now()
          this.requestCatchUp()
        }, wait)
      }
    } else if (event === 'lock') {
      if (parseLockAnnouncement(payload)?.what === 'canvas') void this.refreshHall()
    } else if (event === PREVIEW_EVENT) {
      const m = parsePreview(payload)
      // Never a preview for a stroke already here (a late message after the stored one arrived).
      if (m && !this.store.get(m.id) && this.previews.receive(m, Date.now())) this.changed()
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The player panned, zoomed or resized: load what is now near, forget what is far. */
  setView(view: View, size: Size): void {
    this.view = { view, size }
    const far = tooFarOut(view, size)
    if (far !== this.tooFar) { this.tooFar = far; this.changed() }
    if (far) return
    const box = viewBox(view, size)
    if (this.store.unloadExcept(new Set(chunksFor(box, 2)))) this.changed()
    if (this.missingChunks().length > 0) {
      this.wantLoad = true
      this.pump()
    }
  }

  private missingChunks(): string[] {
    if (!this.view || this.tooFar) return []
    return chunksFor(viewBox(this.view.view, this.view.size), 1).filter(k => !this.store.isLoaded(k))
  }

  private requestCatchUp(): void {
    this.wantCatchUp = true
    this.pump()
  }

  /** Runs the wanted reads, one at a time: loads first (they may need a catch-up after), then the catch-up. */
  private pump(): void {
    if (this.reading || this.stopped || this.readRetry || this.status === 'removed') return
    this.reading = true
    void this.readLoop().finally(() => { this.reading = false })
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.stopped) {
        if (this.wantLoad) {
          this.wantLoad = false
          await this.loadMissing()
        } else if (this.wantCatchUp) {
          this.wantCatchUp = false
          await this.catchUp()
        } else {
          break
        }
      }
      this.readFailures = 0
    } catch (error) {
      if (this.stopped) return
      if (error instanceof PersonalSpacesError && error.code === 'permission') return this.setStatus('removed')
      // Offline or a server hiccup: try the same again shortly.
      const delay = RETRY_MS[Math.min(this.readFailures++, RETRY_MS.length - 1)]!
      this.readRetry = setTimeout(() => {
        this.readRetry = null
        this.pump()
      }, delay)
    }
  }

  private async loadMissing(): Promise<void> {
    const missing = this.missingChunks()
    if (missing.length === 0) return
    try {
      const result = await canvasStrokesIn(this.options.backend, this.options.worldId, unionBox(missing.map(chunkBox)), CANVAS_LIMITS.viewport)
      if (this.stopped) return
      const before = this.store.seq
      this.store.load(missing, result.strokes, result.seq)
      for (const s of result.strokes) this.previews.end(s.id)
      if (result.truncated !== this.truncated) this.truncated = result.truncated
      if (before !== null && result.seq > before) this.wantCatchUp = true
      this.changed()
    } catch (error) {
      this.wantLoad = true
      throw error
    }
  }

  private async catchUp(): Promise<void> {
    try {
      for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
        if (this.store.seq === null) return
        const { ops, more } = await canvasOpsSince(this.options.backend, this.options.worldId, this.store.seq)
        if (this.stopped) return
        for (const op of ops) this.applyOp(op)
        if (ops.length > 0) this.changed()
        if (!more) return
      }
      // Too much happened while away: loading the view again is cheaper than replaying it all.
      this.store.reset()
      this.wantLoad = true
      this.changed()
    } catch (error) {
      this.wantCatchUp = true
      throw error
    }
  }

  private applyOp(op: CanvasOp): void {
    if (!this.store.apply(op)) return
    if (op.kind === 'add' || op.kind === 'restore' || op.kind === 'hide') this.previews.end(op.strokeId)
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Whether this player may draw now (as last known; the database decides). */
  get canDraw(): boolean {
    return this.status !== 'removed' && this.status !== 'failed' && (!this.locked || this.moderator)
  }

  /** The stroke being drawn, for drawing it. */
  get current(): Readonly<Drawing> | null {
    return this.drawing
  }

  begin(tool: CanvasTool, color: string, width: number, x: number, y: number): void {
    if (!this.canDraw) return
    const id = newUuid()
    this.drawing = { id, tool, color, width, points: [], sender: new PreviewSender(id, tool, color, width) }
    this.extend(x, y)
  }

  extend(x: number, y: number): void {
    const d = this.drawing
    if (!d || d.points.length >= MAX_RAW_VALUES) return
    const rx = Math.round(x) || 0
    const ry = Math.round(y) || 0
    if (Math.abs(rx) > CANVAS_LIMITS.coordinate || Math.abs(ry) > CANVAS_LIMITS.coordinate) return
    const n = d.points.length
    if (n >= 2 && d.points[n - 2] === rx && d.points[n - 1] === ry) return
    d.points.push(rx, ry)
    this.sendPreview(false)
    this.changed()
  }

  cancel(): void {
    if (this.drawing) {
      this.drawing = null
      this.changed()
    }
  }

  /** Pen up: simplified for the zoom it was drawn at, shown at once, and queued to be stored. */
  end(): void {
    const d = this.drawing
    if (!d) return
    this.sendPreview(true) // the rest, so others see it whole until the stored stroke arrives
    this.drawing = null
    if (d.points.length === 0) return this.changed()
    let tolerance = 0.5 / (this.view?.view.zoom ?? 1)
    let points = simplify(d.points, tolerance)
    while (points.length / 2 > CANVAS_LIMITS.maxPoints) {
      tolerance *= 2
      points = simplify(d.points, tolerance)
    }
    let input: StrokeInput
    try {
      input = validateStroke({ id: d.id, tool: d.tool, color: d.color, width: d.width, points })
    } catch (error) {
      this.notice(message(error))
      return this.changed()
    }
    const stroke = toShown({
      id: d.id, authorId: this.options.userId, authorName: null, tool: d.tool, color: d.color, width: d.width,
      points, createdAt: new Date().toISOString(), hidden: false,
    }, true)
    this.store.putLocal(stroke)
    this.remember({ kind: 'draw', stroke })
    this.enqueue({ kind: 'add', input, since: Date.now() })
    this.changed()
  }

  private sendPreview(force: boolean): void {
    const d = this.drawing
    if (!d || !this.channel) return
    for (const m of d.sender.take(d.points, Date.now(), force)) this.channel.send(PREVIEW_EVENT, { ...m })
  }

  /** Erases the newest stroke under (x, y) that this player may erase. Returns whether one was. */
  eraseAt(x: number, y: number, radius: number): boolean {
    if (this.status === 'removed') return false
    const own = (s: ShownStroke): boolean => s.authorId === this.options.userId
    const s = this.store.hit(x, y, radius, s => own(s) ? this.canDraw : this.moderator)
    if (!s) return false
    const reason: HideReason = own(s) ? 'erased' : 'moderated'
    this.store.remove(s.id)
    this.remember({ kind: 'erase', stroke: s, reason })
    this.enqueue({ kind: 'hide', id: s.id, reason, stroke: s, since: Date.now() })
    this.changed()
    return true
  }

  // ── Undo and redo ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Moderators: hides every visible stroke touching `area` (CH-07). Online only, not queued: the moderator sees the
   * result or the refusal at once. Returns how many strokes it hid. Strokes go from the screen at once; `seq`
   * moves on with the catch-up that follows, as for any change.
   */
  async clearArea(area: CanvasBox, note?: string): Promise<number> {
    const op = await clearCanvasRegion(this.options.backend, this.options.worldId, area, note)
    if (!op || op.kind !== 'clear') return 0
    for (const id of op.strokeIds) this.store.remove(id)
    this.requestCatchUp()
    this.changed()
    return op.strokeIds.length
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  private remember(u: Undoable): void {
    this.undoStack.push(u)
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): void {
    const u = this.undoStack.pop()
    if (!u) return
    this.redoStack.push(u)
    if (u.kind === 'draw') this.hideLocally(u.stroke, 'undone')
    else this.showLocally(u.stroke)
    this.changed()
  }

  redo(): void {
    const u = this.redoStack.pop()
    if (!u) return
    this.undoStack.push(u)
    if (u.kind === 'draw') this.showLocally(u.stroke)
    else this.hideLocally(u.stroke, u.reason)
    this.changed()
  }

  private hideLocally(stroke: ShownStroke, reason: HideReason): void {
    this.store.remove(stroke.id)
    this.enqueue({ kind: 'hide', id: stroke.id, reason, stroke, since: Date.now() })
  }

  private showLocally(stroke: ShownStroke): void {
    this.store.putLocal(stroke)
    this.enqueue({ kind: 'restore', id: stroke.id, stroke, since: Date.now() })
  }

  // ── Outbox ───────────────────────────────────────────────────────────────────────────────────────────────────

  private enqueue(job: Job): void {
    this.jobs.push(job)
    this.send()
  }

  private retrySendingNow(): void {
    if (this.sendRetry) {
      clearTimeout(this.sendRetry)
      this.sendRetry = null
    }
    this.send()
  }

  private send(): void {
    if (this.sending || this.sendRetry || this.stopped || this.jobs.length === 0) return
    this.sending = true
    void this.sendLoop().finally(() => { this.sending = false })
  }

  private async sendLoop(): Promise<void> {
    while (!this.stopped && this.jobs.length > 0) {
      const job = this.jobs[0]!
      try {
        await this.run(job)
        this.jobs.shift()
        this.sendFailures = 0
        this.requestCatchUp()
      } catch (error) {
        if (this.stopped) return
        if (isRefusal(error)) {
          this.jobs.shift()
          this.refused(job, error)
          continue
        }
        const delay = RETRY_MS[Math.min(this.sendFailures++, RETRY_MS.length - 1)]!
        this.sendRetry = setTimeout(() => {
          this.sendRetry = null
          this.send()
        }, delay)
        return
      } finally {
        this.changed()
      }
    }
  }

  private async run(job: Job): Promise<void> {
    const { backend, worldId } = this.options
    if (job.kind === 'add') {
      const op = await addCanvasStroke(backend, worldId, job.input)
      if (op.kind === 'add' && op.stroke) this.store.confirm(op.stroke)
    } else if (job.kind === 'hide') {
      await hideCanvasStroke(backend, worldId, job.id, job.reason)
    } else {
      const op = await restoreCanvasStroke(backend, worldId, job.id)
      if (op && op.kind === 'restore' && op.stroke) this.store.putLocal(toShown(op.stroke))
    }
  }

  /** The database said no: put the screen back as it was, drop what depended on it, and say why. */
  private refused(job: Job, error: PersonalSpacesError): void {
    const id = job.kind === 'add' ? job.input.id : job.id
    if (/locked/i.test(error.message)) this.locked = true
    if (job.kind === 'add') {
      this.store.remove(id)
      // Later changes to a stroke that was never stored can only fail too.
      for (let i = this.jobs.length - 1; i >= 0; i--) {
        const j = this.jobs[i]!
        if (j.kind !== 'add' && j.id === id) this.jobs.splice(i, 1)
      }
      this.undoStack = this.undoStack.filter(u => u.stroke.id !== id)
      this.redoStack = this.redoStack.filter(u => u.stroke.id !== id)
    } else if (job.kind === 'hide') {
      this.store.putLocal({ ...job.stroke, pending: false })
    } else {
      this.store.remove(id)
    }
    this.notice(error.message)
  }
}
