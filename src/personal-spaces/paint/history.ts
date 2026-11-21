import type { CanvasBase } from './color'
import type { PixelBuffer } from './pixel-buffer'

/** One state of the image: its pixels, and the base it was drawn on (so a resize can be undone). */
export interface ImageState {
  image: PixelBuffer
  base: CanvasBase
}

export const HISTORY_STEPS = 30
export const HISTORY_BYTES = 96_000_000

const bytes = (s: ImageState): number => s.image.data.byteLength

/**
 * Undo and redo by whole-image snapshots. One completed action is one entry.
 * Bounded by a number of steps and a memory budget; the oldest go first.
 */
export class History {
  private undoStack: ImageState[] = []
  private redoStack: ImageState[] = []

  constructor(
    private readonly steps = HISTORY_STEPS,
    private readonly budget = HISTORY_BYTES,
  ) {}

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get undoDepth(): number { return this.undoStack.length }

  /** Records the state from before a completed action. Clears redo. */
  push(before: ImageState): void {
    this.undoStack.push(before)
    this.redoStack = []
    this.trim()
  }

  /** The state to go back to, given the current one; null if there is none. */
  undo(current: ImageState): ImageState | null {
    const previous = this.undoStack.pop()
    if (!previous) return null
    this.redoStack.push(current)
    return previous
  }

  redo(current: ImageState): ImageState | null {
    const next = this.redoStack.pop()
    if (!next) return null
    this.undoStack.push(current)
    this.trim()
    return next
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  private trim(): void {
    while (this.undoStack.length > this.steps) this.undoStack.shift()
    let total = [...this.undoStack, ...this.redoStack].reduce((sum, s) => sum + bytes(s), 0)
    while (total > this.budget && this.undoStack.length > 0) total -= bytes(this.undoStack.shift()!)
  }
}
