import type { Point } from '../../../lib/geometry'
import type { EditorView, SelectionView } from '../../../lib/editor-bridge'
import type { InteriorDefinition, InteriorPiece } from '../interior-layout'
import { catalogueEntries, isAddable } from './catalogue-view'
import { centreGrab, grabOffset, hitTest, movingGroup, sameTarget, targetFor } from './editor-geometry'
import { getFurnitureType } from './furniture-catalog'
import { cloneLayout, type HouseLayout, type InteriorTemplate, type PlacedItem } from './house-layout'
import type { HouseLayoutStore } from './house-layout-store'
import {
  addItem,
  itemsResting,
  moveItem,
  nextItemId,
  removeItem,
  type EditResult,
  type Target,
} from './layout-edits'
import { resolveInterior } from './resolve-interior'
import { itemName, primaryReason } from './violation-text'

/**
 * Everything the furniture editor knows, in one place, with no Phaser and no
 * React. The scene feeds it pointer input in room pixels and the UI's
 * commands; it answers with what to draw (`definition`, `preview`) and what to
 * show (`view`).
 *
 * Two layouts are held: `committed`, the house as stored, and `draft`, the
 * house being edited. Every change to the draft goes through `layout-edits`,
 * so an invalid draft cannot exist. Saving sends the whole draft to the store
 * in one call and adopts it only once the store accepts it; cancelling simply
 * drops the draft. The store is never touched by anything but `save`.
 */

export type EditorMode = 'play' | 'edit'

export type Gesture =
  | { kind: 'idle' }
  /** Pointer is down on an item but has not moved far enough to drag. */
  | { kind: 'pressed'; itemId: string; start: Point; grab: Point }
  | {
      kind: 'dragging'
      itemId: string
      grab: Point
      pointer: Point
      target: Target | null
      result: EditResult | null
    }
  | {
      kind: 'placing'
      type: string
      newId: string
      grab: Point
      pointer: Point | null
      target: Target | null
      result: EditResult | null
    }

/** What the scene draws while an item is being dragged or placed. */
export interface PreviewState {
  /** Pieces at their candidate position: the moving group, or the new item. */
  pieces: InteriorPiece[]
  /** Draft pieces to hide while their preview stands in for them. */
  hiddenIds: string[]
  valid: boolean
  /** Why it is red; null when it is green. */
  message: string | null
}

export interface SaveOutcome {
  ok: boolean
  error?: string
}

export interface EditorSessionOptions {
  houseId: string
  template: InteriorTemplate
  /** The house as stored. Never mutated. */
  layout: HouseLayout
  store: HouseLayoutStore
  canEdit: boolean
}

const NEEDS_SUPPORT = 'Must rest on a table or nightstand'

export class EditorSession {
  readonly houseId: string
  readonly canEdit: boolean
  private readonly template: InteriorTemplate
  private readonly store: HouseLayoutStore

  private committedLayout: HouseLayout
  private committedItemsJson: string
  private draftLayout: HouseLayout
  private draftVersion = 0
  private cachedDefinition: { version: number; def: InteriorDefinition } | null = null

  private currentMode: EditorMode = 'play'
  private currentGesture: Gesture = { kind: 'idle' }
  private selected: string | null = null
  private lastMessage: string | null = null
  private lastError: string | null = null
  private isSaving = false
  private disposed = false
  private dragThresholdPx = 1
  private readonly listeners = new Set<() => void>()
  private readonly catalogue = catalogueEntries()

  constructor(options: EditorSessionOptions) {
    this.houseId = options.houseId
    this.canEdit = options.canEdit
    this.template = options.template
    this.store = options.store
    this.committedLayout = cloneLayout(options.layout)
    this.committedItemsJson = JSON.stringify(this.committedLayout.items)
    this.draftLayout = cloneLayout(options.layout)
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  get mode(): EditorMode {
    return this.currentMode
  }

  get gesture(): Gesture {
    return this.currentGesture
  }

  get selectedId(): string | null {
    return this.selected
  }

  get saving(): boolean {
    return this.isSaving
  }

  /** Changes every time the draft is replaced, so the scene knows when to rebuild. */
  get version(): number {
    return this.draftVersion
  }

  /** A copy of the house as stored. */
  get committed(): HouseLayout {
    return cloneLayout(this.committedLayout)
  }

  /** A copy of the house being edited (equal to `committed` outside edit mode). */
  get draft(): HouseLayout {
    return cloneLayout(this.draftLayout)
  }

  get dirty(): boolean {
    return JSON.stringify(this.draftLayout.items) !== this.committedItemsJson
  }

  /** The room as it should be drawn now: the draft, resolved. */
  definition(): InteriorDefinition {
    if (this.cachedDefinition?.version !== this.draftVersion) {
      this.cachedDefinition = {
        version: this.draftVersion,
        def: resolveInterior(this.template, this.draftLayout),
      }
    }
    return this.cachedDefinition.def
  }

  /** Room pixels the pointer must travel before a press becomes a drag. */
  setDragThreshold(px: number): void {
    this.dragThresholdPx = Math.max(0, px)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Stops all notifications. An unsaved draft is simply dropped; the store is untouched. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Enters edit mode on a fresh draft. False when this house cannot be edited. */
  beginEdit(): boolean {
    if (!this.canEdit || this.currentMode === 'edit' || this.disposed) return false
    this.currentMode = 'edit'
    this.replaceDraft(cloneLayout(this.committedLayout))
    this.resetEditing()
    this.notify()
    return true
  }

  /** Drops the draft and returns to play. Never touches the store. */
  cancel(): void {
    if (this.currentMode !== 'edit' || this.isSaving) return
    this.replaceDraft(cloneLayout(this.committedLayout))
    this.currentMode = 'play'
    this.resetEditing()
    this.notify()
  }

  /**
   * Saves the whole draft with one store call. The draft is adopted only if
   * the store accepts it; otherwise edit mode and the draft remain, with the
   * error. A save while one is running is refused.
   */
  async save(): Promise<SaveOutcome> {
    if (this.currentMode !== 'edit' || this.isSaving || this.disposed) {
      return { ok: false, error: 'Not saving right now' }
    }
    this.currentGesture = { kind: 'idle' }

    if (!this.dirty) {
      this.currentMode = 'play'
      this.resetEditing()
      this.notify()
      return { ok: true }
    }

    const toSave = cloneLayout(this.draftLayout)
    this.isSaving = true
    this.lastError = null
    this.notify()

    try {
      await this.store.save(toSave)
    } catch (error: unknown) {
      this.isSaving = false
      const message = error instanceof Error ? error.message : String(error)
      this.lastError = `Could not save: ${message}`
      this.notify()
      return { ok: false, error: message }
    }

    this.isSaving = false
    this.committedLayout = cloneLayout(toSave)
    this.committedItemsJson = JSON.stringify(this.committedLayout.items)
    this.replaceDraft(cloneLayout(toSave))
    this.currentMode = 'play'
    this.resetEditing()
    this.notify()
    return { ok: true }
  }

  // ── Pointer (room pixels) ──────────────────────────────────────────────

  pointerDown(p: Point): void {
    if (!this.accepting()) return
    const gesture = this.currentGesture

    if (gesture.kind === 'placing') {
      this.trackPointer(p)
      const placed = this.currentGesture
      if (placed.kind === 'placing' && placed.result?.ok) {
        this.replaceDraft(placed.result.layout)
        this.selected = placed.newId
        this.currentGesture = { kind: 'idle' }
        this.lastMessage = null
      } else if (placed.kind === 'placing') {
        this.lastMessage = this.previewMessage() ?? NEEDS_SUPPORT
      }
      this.notify()
      return
    }

    const hit = hitTest(this.definition(), p)
    this.lastMessage = null
    if (hit) {
      this.selected = hit.id
      this.currentGesture = { kind: 'pressed', itemId: hit.id, start: p, grab: grabOffset(p, hit) }
    } else {
      this.selected = null
      this.currentGesture = { kind: 'idle' }
    }
    this.notify()
  }

  pointerMove(p: Point): void {
    if (!this.accepting()) return
    const gesture = this.currentGesture

    if (gesture.kind === 'pressed') {
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) < this.dragThresholdPx) return
      this.currentGesture = {
        kind: 'dragging',
        itemId: gesture.itemId,
        grab: gesture.grab,
        pointer: p,
        target: null,
        result: null,
      }
      this.retarget(p, true)
      this.notify()
      return
    }

    if (gesture.kind === 'dragging' || gesture.kind === 'placing') {
      if (this.trackPointer(p)) this.notify()
    }
  }

  pointerUp(p: Point): void {
    if (!this.accepting()) return
    const gesture = this.currentGesture

    if (gesture.kind === 'pressed') {
      this.currentGesture = { kind: 'idle' }
      this.notify()
      return
    }
    if (gesture.kind !== 'dragging') return

    this.trackPointer(p)
    const dropped = this.currentGesture
    if (dropped.kind === 'dragging' && dropped.result?.ok) {
      this.replaceDraft(dropped.result.layout)
      this.lastMessage = null
    } else {
      // An invalid drop changes nothing; the reason stays on screen.
      this.lastMessage = this.previewMessage() ?? NEEDS_SUPPORT
    }
    this.currentGesture = { kind: 'idle' }
    this.notify()
  }

  /** Cancels the current drag or placement; with nothing in progress, clears the selection. */
  escape(): void {
    if (this.currentMode !== 'edit' || this.isSaving) return
    if (this.currentGesture.kind !== 'idle') {
      this.currentGesture = { kind: 'idle' }
    } else {
      this.selected = null
    }
    this.lastMessage = null
    this.notify()
  }

  // ── Panel commands ─────────────────────────────────────────────────────

  /** Starts placing a catalogue type; choosing the type being placed again stops. */
  startPlacing(type: string): void {
    if (!this.accepting() || !isAddable(type)) return
    const gesture = this.currentGesture
    if (gesture.kind === 'placing' && gesture.type === type) {
      this.currentGesture = { kind: 'idle' }
    } else {
      this.currentGesture = {
        kind: 'placing',
        type,
        newId: nextItemId(this.draftLayout, type),
        grab: centreGrab(type),
        pointer: null,
        target: null,
        result: null,
      }
      this.selected = null
    }
    this.lastMessage = null
    this.notify()
  }

  removeSelected(): void {
    if (!this.accepting() || this.currentGesture.kind !== 'idle' || !this.selected) return
    const id = this.selected
    const blocked = this.removeBlockedReason(id)
    if (blocked) {
      this.lastMessage = blocked
      this.notify()
      return
    }
    const result = removeItem(this.template, this.draftLayout, id)
    if (result.ok) {
      this.replaceDraft(result.layout)
      this.selected = null
      this.lastMessage = null
    } else {
      this.lastMessage = primaryReason(result.violations, this.draftLayout, id)
    }
    this.notify()
  }

  /** Why an item cannot be removed, in plain words; null when it can. */
  removeBlockedReason(itemId: string): string | null {
    const item = this.draftLayout.items.find(i => i.id === itemId)
    const type = item ? getFurnitureType(item.type) : undefined
    if (!item || !type) return 'That is not in the room'
    if (!type.removable) {
      return type.role === 'computer' ? 'Every house needs a computer' : 'Every house needs a notebook'
    }
    const resting = itemsResting(this.draftLayout, itemId)
    if (resting.length > 0) {
      const names = resting.map(r => itemName(this.draftLayout, r.id))
      const list = names.length === 1
        ? names[0]!
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
      return `Move ${list} off it first`
    }
    return null
  }

  // ── What to draw and show ──────────────────────────────────────────────

  /** The dragged or placed item at its candidate spot, or null when nothing is moving. */
  preview(): PreviewState | null {
    const g = this.currentGesture
    if (g.kind !== 'dragging' && g.kind !== 'placing') return null
    if (!g.pointer) return null

    const moving = g.kind === 'dragging' ? movingGroup(this.draftLayout, g.itemId) : new Set([g.newId])
    const pieces = this.candidatePieces(g, moving)
    return {
      pieces,
      hiddenIds: g.kind === 'dragging' ? [...moving] : [],
      valid: g.result?.ok === true,
      message: this.previewMessage(),
    }
  }

  /** Plain data for the React UI. */
  view(): EditorView {
    const g = this.currentGesture
    const moving = g.kind === 'dragging' || (g.kind === 'placing' && g.pointer !== null)
    return {
      houseId: this.houseId,
      canEdit: this.canEdit && !this.disposed,
      mode: this.currentMode,
      dirty: this.dirty,
      saving: this.isSaving,
      selected: this.selectionView(),
      placingType: g.kind === 'placing' ? g.type : null,
      preview: moving ? { valid: g.result?.ok === true, message: this.previewMessage() } : null,
      message: this.lastMessage,
      error: this.lastError,
      catalogue: this.currentMode === 'edit' ? this.catalogue : [],
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private accepting(): boolean {
    return this.currentMode === 'edit' && !this.isSaving && !this.disposed
  }

  private resetEditing(): void {
    this.currentGesture = { kind: 'idle' }
    this.selected = null
    this.lastMessage = null
    this.lastError = null
  }

  private replaceDraft(layout: HouseLayout): void {
    this.draftLayout = layout
    this.draftVersion++
  }

  /** Updates the pointer of a drag or placement; true when anything visible changed. */
  private trackPointer(p: Point): boolean {
    const g = this.currentGesture
    if (g.kind !== 'dragging' && g.kind !== 'placing') return false
    return this.retarget(p, false)
  }

  /**
   * Re-snaps the moving item to the pointer and, only if its snapped position
   * changed, re-validates. Returns true when the preview moved.
   */
  private retarget(p: Point, force: boolean): boolean {
    const g = this.currentGesture
    if (g.kind !== 'dragging' && g.kind !== 'placing') return false

    const def = this.definition()
    const type = g.kind === 'dragging' ? this.typeOf(g.itemId) : g.type
    const exclude = g.kind === 'dragging' ? movingGroup(this.draftLayout, g.itemId) : new Set<string>()
    const target = type ? targetFor(type, p, g.grab, def, this.draftLayout, exclude) : null

    const unchanged = !force && g.pointer !== null && sameTarget(target, g.target)
    g.pointer = p
    if (unchanged) {
      // A support-less resting item follows the pointer freely, so it still moved.
      return target === null
    }

    g.target = target
    if (!target) {
      g.result = null
    } else if (g.kind === 'dragging') {
      g.result = moveItem(this.template, this.draftLayout, g.itemId, target)
    } else {
      g.result = addItem(this.template, this.draftLayout, g.newId, g.type, target)
    }
    return true
  }

  private previewMessage(): string | null {
    const g = this.currentGesture
    if (g.kind !== 'dragging' && g.kind !== 'placing') return null
    if (!g.target) return NEEDS_SUPPORT
    if (!g.result || g.result.ok) return null
    const focus = g.kind === 'dragging' ? g.itemId : g.newId
    return primaryReason(g.result.violations, this.layoutWithCandidate(g), focus)
  }

  /** The draft with the moving item at its candidate spot, unvalidated, for drawing and naming. */
  private layoutWithCandidate(g: Extract<Gesture, { kind: 'dragging' | 'placing' }>): HouseLayout {
    const layout = cloneLayout(this.draftLayout)
    if (!g.target) return layout
    const at: PlacedItem['at'] = g.target.kind === 'grid'
      ? { kind: 'grid', col: g.target.col, row: g.target.row }
      : { kind: 'attached', to: g.target.to, dx: g.target.dx, dy: g.target.dy }

    if (g.kind === 'dragging') {
      const item = layout.items.find(i => i.id === g.itemId)
      if (item) item.at = at
    } else {
      layout.items.push({ id: g.newId, type: g.type, rotation: 0, at })
    }
    return layout
  }

  private candidatePieces(
    g: Extract<Gesture, { kind: 'dragging' | 'placing' }>,
    moving: ReadonlySet<string>,
  ): InteriorPiece[] {
    if (g.target) {
      try {
        const def = resolveInterior(this.template, this.layoutWithCandidate(g))
        return def.pieces.filter(piece => moving.has(piece.id))
      } catch {
        // Fall through to drawing the item loose under the pointer.
      }
    }
    // No valid support under a resting item: draw it loose under the pointer.
    const type = g.kind === 'dragging' ? this.typeOf(g.itemId) : g.type
    const entry = type ? getFurnitureType(type) : undefined
    if (!entry || !g.pointer) return []
    return [{
      id: g.kind === 'dragging' ? g.itemId : g.newId,
      sprite: entry.sprite,
      x: Math.round(g.pointer.x - g.grab.x),
      bottom: Math.round(g.pointer.y - g.grab.y),
      layer: entry.layer,
    }]
  }

  private typeOf(itemId: string): string | undefined {
    return this.draftLayout.items.find(i => i.id === itemId)?.type
  }

  private selectionView(): SelectionView | null {
    if (!this.selected) return null
    const type = this.typeOf(this.selected)
    const label = (type && getFurnitureType(type)?.label) ?? this.selected
    const reason = this.removeBlockedReason(this.selected)
    return { id: this.selected, label, canRemove: reason === null, removeBlockedReason: reason }
  }

  private notify(): void {
    if (this.disposed) return
    for (const listener of [...this.listeners]) listener()
  }
}
