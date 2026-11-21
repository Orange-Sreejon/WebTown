import { baseColor, type CanvasBase, type Rgba } from './color'
import { History, type ImageState } from './history'
import { cloneBuffer, copyInto, createBuffer, fillAll, getPixel, resizeBuffer, sameImage, type PixelBuffer } from './pixel-buffer'
import {
  drawEllipse,
  drawMask,
  drawRectangle,
  floodFill,
  snapLine,
  spray,
  squareBox,
  strokeSegment,
  type Mask,
  type Point,
} from './raster'
import type { ToolId, ToolSettings } from './tools'

/** What a pointer press uses: the tool, the colours and its settings at that moment. */
export interface StrokeInput {
  tool: ToolId
  /** Foreground and background colours. */
  primary: Rgba
  secondary: Rgba
  /** Which button: the primary draws in the foreground colour, the secondary in the background colour. */
  button: 'primary' | 'secondary'
  settings: ToolSettings
  shift: boolean
}

/** What a press turned out to be, so the interface can follow up. */
export type BeginResult =
  | { kind: 'drawing' }
  | { kind: 'done' }
  | { kind: 'picked'; color: Rgba | null }
  | { kind: 'text'; at: Point }
  | { kind: 'ignored' }

export interface DirtyRect { x: number; y: number; w: number; h: number }

interface Active {
  input: StrokeInput
  before: ImageState
  start: Point
  last: Point
  shape: boolean
}

export interface SessionOptions {
  historySteps?: number
  historyBytes?: number
  /** Random numbers for the airbrush. Injected in tests. */
  random?: () => number
}

/**
 * The open picture and everything that changes it. Pure: no DOM.
 *
 * One completed action (stroke, shape, fill, text, clear, resize) is one undo
 * step, recorded only if pixels actually changed. A cancelled action leaves
 * the picture exactly as it was. Shapes are previewed in a scratch copy, so
 * the preview is pixel for pixel what is committed.
 */
export class PaintSession {
  private state: ImageState
  private scratch: PixelBuffer | null = null
  private active: Active | null = null
  private readonly history: History
  private readonly random: () => number
  private dirty: DirtyRect | 'all' | null = 'all'
  private listeners = new Set<() => void>()
  /** +1 on every change to the committed picture (for autosave). */
  revision = 0

  constructor(image: PixelBuffer, base: CanvasBase, options: SessionOptions = {}) {
    this.state = { image, base }
    this.history = new History(options.historySteps, options.historyBytes)
    this.random = options.random ?? Math.random
  }

  static blank(width: number, height: number, base: CanvasBase, options?: SessionOptions): PaintSession {
    return new PaintSession(createBuffer(width, height, baseColor(base)), base, options)
  }

  get image(): PixelBuffer { return this.state.image }
  /** What to show: the shape preview while a shape is being dragged, else the picture. */
  get view(): PixelBuffer { return this.scratch ?? this.state.image }
  get base(): CanvasBase { return this.state.base }
  get width(): number { return this.state.image.width }
  get height(): number { return this.state.image.height }
  get canUndo(): boolean { return this.history.canUndo && !this.active }
  get canRedo(): boolean { return this.history.canRedo && !this.active }
  get busy(): boolean { return this.active !== null }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** The area changed since the last call, for the presenter. */
  takeDirty(): DirtyRect | 'all' | null {
    const d = this.dirty
    this.dirty = null
    return d
  }

  // ── Pointer ──────────────────────────────────────────────────────────────

  begin(p: Point, input: StrokeInput): BeginResult {
    if (this.active) return { kind: 'ignored' }
    const color = this.colorFor(input)
    switch (input.tool) {
      case 'picker':
        return { kind: 'picked', color: getPixel(this.image, p.x, p.y) }
      case 'text':
        return { kind: 'text', at: { x: p.x, y: p.y } }
      case 'fill': {
        const before = this.snapshot()
        if (floodFill(this.image, p, color)) this.commit(before)
        return { kind: 'done' }
      }
      default: {
        const before = this.snapshot()
        const shape = input.tool === 'line' || input.tool === 'rectangle' || input.tool === 'ellipse'
        this.active = { input, before, start: p, last: p, shape }
        if (shape) {
          this.scratch = cloneBuffer(this.image)
          this.drawShape(p, input.shift)
        } else {
          this.paintSegment(p, p)
        }
        return { kind: 'drawing' }
      }
    }
  }

  /** Further samples of the press, oldest first. */
  move(points: readonly Point[], shift = false): void {
    const a = this.active
    if (!a || points.length === 0) return
    if (a.shape) {
      a.last = points[points.length - 1]!
      this.drawShape(a.last, shift)
      return
    }
    for (const p of points) {
      this.paintSegment(a.last, p)
      a.last = p
    }
  }

  /** The airbrush keeps spraying while held still. */
  tick(): void {
    const a = this.active
    if (a?.input.tool === 'airbrush') this.paintSegment(a.last, a.last)
  }

  end(p?: Point, shift = false): void {
    const a = this.active
    if (!a) return
    if (p) this.move([p], shift)
    if (a.shape && this.scratch) {
      copyInto(this.state.image, this.scratch)
      this.scratch = null
    }
    this.active = null
    this.commit(a.before)
  }

  /** Abandons the press in progress: the picture goes back to how it was. */
  cancel(): boolean {
    const a = this.active
    if (!a) return false
    this.active = null
    this.scratch = null
    copyInto(this.state.image, a.before.image)
    this.markAll()
    return true
  }

  // ── Whole-picture actions ────────────────────────────────────────────────

  pick(p: Point): Rgba | null {
    return getPixel(this.image, p.x, p.y)
  }

  /** Text: a one-bit mask drawn at x, y. */
  applyMask(mask: Mask, x: number, y: number, color: Rgba): boolean {
    if (this.active) return false
    const before = this.snapshot()
    drawMask(this.image, mask, x, y, color)
    return this.commit(before)
  }

  clear(): boolean {
    if (this.active) return false
    const before = this.snapshot()
    fillAll(this.image, baseColor(this.base))
    return this.commit(before)
  }

  /** Image > Attributes: new size and base. The picture stays at the top left. */
  setAttributes(width: number, height: number, base: CanvasBase): boolean {
    if (this.active) return false
    if (width === this.width && height === this.height && base === this.base) return false
    const before = this.snapshot()
    const image = width === this.width && height === this.height
      ? this.image
      : resizeBuffer(this.image, width, height, baseColor(base))
    this.state = { image, base }
    this.history.push(before)
    this.changed('all')
    return true
  }

  undo(): boolean {
    if (this.active) return false
    const previous = this.history.undo(this.state)
    if (!previous) return false
    this.state = previous
    this.changed('all')
    return true
  }

  redo(): boolean {
    if (this.active) return false
    const next = this.history.redo(this.state)
    if (!next) return false
    this.state = next
    this.changed('all')
    return true
  }

  /** Opens another picture: history starts again. */
  load(image: PixelBuffer, base: CanvasBase): void {
    this.active = null
    this.scratch = null
    this.state = { image, base }
    this.history.clear()
    this.markAll()
  }

  // ── Inside ───────────────────────────────────────────────────────────────

  private colorFor(input: StrokeInput): Rgba {
    if (input.tool === 'eraser') return baseColor(this.base)
    return input.button === 'secondary' ? input.secondary : input.primary
  }

  private snapshot(): ImageState {
    return { image: cloneBuffer(this.image), base: this.base }
  }

  private commit(before: ImageState): boolean {
    if (before.base === this.base && sameImage(before.image, this.image)) {
      this.markAll()
      return false
    }
    this.history.push(before)
    this.changed('all')
    return true
  }

  private paintSegment(from: Point, to: Point): void {
    const a = this.active!
    const { tool, settings } = a.input
    const color = this.colorFor(a.input)
    const size = tool === 'pencil' ? 1 : tool === 'brush' ? settings.brushSize : tool === 'eraser' ? settings.eraserSize : settings.airbrushSize
    if (tool === 'airbrush') {
      spray(this.image, to, size, color, this.random)
      this.mark(to, size)
      return
    }
    strokeSegment(this.image, from, to, size, color)
    this.markLine(from, to, size)
  }

  private drawShape(to: Point, shift: boolean): void {
    const a = this.active!
    const scratch = this.scratch!
    copyInto(scratch, a.before.image)
    const { tool, settings } = a.input
    const line = this.colorFor(a.input)
    const fill = a.input.button === 'secondary' ? a.input.primary : a.input.secondary
    if (tool === 'line') {
      strokeSegment(scratch, a.start, shift ? snapLine(a.start, to) : to, settings.lineWidth, line)
    } else {
      const corner = shift ? squareBox(a.start, to) : to
      const draw = tool === 'rectangle' ? drawRectangle : drawEllipse
      draw(scratch, a.start, corner, settings.fillStyle, settings.lineWidth, line, fill)
    }
    this.markAll()
  }

  private mark(p: Point, size: number): void {
    const r = Math.ceil(size / 2) + 1
    this.addDirty({ x: p.x - r, y: p.y - r, w: 2 * r + 1, h: 2 * r + 1 })
  }

  private markLine(a: Point, b: Point, size: number): void {
    const r = Math.ceil(size / 2) + 1
    const x = Math.min(a.x, b.x) - r
    const y = Math.min(a.y, b.y) - r
    this.addDirty({ x, y, w: Math.abs(a.x - b.x) + 2 * r + 1, h: Math.abs(a.y - b.y) + 2 * r + 1 })
  }

  private addDirty(rect: DirtyRect): void {
    const x0 = Math.max(0, rect.x)
    const y0 = Math.max(0, rect.y)
    const x1 = Math.min(this.width, rect.x + rect.w)
    const y1 = Math.min(this.height, rect.y + rect.h)
    if (x1 <= x0 || y1 <= y0) return
    if (this.dirty === 'all') { this.notify(); return }
    if (this.dirty === null) this.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    else {
      const d = this.dirty
      const nx = Math.min(d.x, x0)
      const ny = Math.min(d.y, y0)
      this.dirty = { x: nx, y: ny, w: Math.max(d.x + d.w, x1) - nx, h: Math.max(d.y + d.h, y1) - ny }
    }
    this.notify()
  }

  private markAll(): void {
    this.dirty = 'all'
    this.notify()
  }

  private changed(dirty: 'all'): void {
    this.revision++
    this.dirty = dirty
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
