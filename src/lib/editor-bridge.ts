import { emit, off, on } from './event-bus'

/**
 * The typed channel between the React editor UI and the Phaser interior.
 *
 * Phaser publishes an `EditorView` (plain JSON describing what the UI should
 * show) whenever it changes; React sends back an `EditorCommand`. Nothing else
 * crosses: React never touches the game object, and no Phaser object ever
 * reaches React state. Payloads arrive as `unknown` and are narrowed by guards.
 */

/** Where a catalogue picture comes from: one rectangle of a sheet image. */
export interface CatalogueThumbnail {
  /** Same-origin URL of the sheet (from `AssetPaths`). */
  url: string
  x: number
  y: number
  w: number
  h: number
  sheetW: number
  sheetH: number
}

export interface CatalogueEntryView {
  type: string
  label: string
  /** Null when the sprite has no clean thumbnail; the label is shown alone. */
  thumbnail: CatalogueThumbnail | null
}

export interface SelectionView {
  id: string
  label: string
  canRemove: boolean
  /** Why Remove is disabled, in plain words; null when it is allowed. */
  removeBlockedReason: string | null
}

export interface PreviewView {
  valid: boolean
  /** Why the preview is red; null when it is green. */
  message: string | null
}

export type EditorModeView = 'play' | 'edit'

export interface EditorView {
  houseId: string
  /** The local player owns this house and may edit it right now. */
  canEdit: boolean
  mode: EditorModeView
  /** The draft differs from the saved layout. */
  dirty: boolean
  saving: boolean
  selected: SelectionView | null
  /** The catalogue type being placed, if any. */
  placingType: string | null
  /** Live validity while dragging or placing. */
  preview: PreviewView | null
  /** The last refused action (an invalid drop, a blocked removal). */
  message: string | null
  /** A failed save. */
  error: string | null
  catalogue: CatalogueEntryView[]
}

export type EditorCommand =
  | { type: 'enter-edit' }
  | { type: 'save' }
  | { type: 'cancel' }
  | { type: 'remove-selected' }
  | { type: 'escape' }
  | { type: 'start-placing'; furnitureType: string }

/** What the UI shows outside a house, or in one it cannot edit. */
export const HIDDEN_EDITOR_VIEW: EditorView = {
  houseId: '',
  canEdit: false,
  mode: 'play',
  dirty: false,
  saving: false,
  selected: null,
  placingType: null,
  preview: null,
  message: null,
  error: null,
  catalogue: [],
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function isEditorView(value: unknown): value is EditorView {
  return isRecord(value) &&
    typeof value['houseId'] === 'string' &&
    typeof value['canEdit'] === 'boolean' &&
    (value['mode'] === 'play' || value['mode'] === 'edit') &&
    typeof value['dirty'] === 'boolean' &&
    typeof value['saving'] === 'boolean' &&
    Array.isArray(value['catalogue'])
}

const SIMPLE_COMMANDS = new Set(['enter-edit', 'save', 'cancel', 'remove-selected', 'escape'])

export function isEditorCommand(value: unknown): value is EditorCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string') return false
  if (SIMPLE_COMMANDS.has(value['type'])) return true
  return value['type'] === 'start-placing' && typeof value['furnitureType'] === 'string'
}

/** Phaser → React. */
export function emitEditorState(view: EditorView): void {
  emit('EDITOR_STATE', view)
}

/** Subscribes to editor views; returns the unsubscribe function. Malformed payloads are ignored. */
export function onEditorState(handler: (view: EditorView) => void): () => void {
  const listener = (e: CustomEvent<unknown>): void => {
    if (isEditorView(e.detail)) handler(e.detail)
  }
  on('EDITOR_STATE', listener)
  return () => off('EDITOR_STATE', listener)
}

/** React → Phaser. */
export function emitEditorCommand(command: EditorCommand): void {
  emit('EDITOR_COMMAND', command)
}

/** Subscribes to editor commands; returns the unsubscribe function. Malformed payloads are ignored. */
export function onEditorCommand(handler: (command: EditorCommand) => void): () => void {
  const listener = (e: CustomEvent<unknown>): void => {
    if (isEditorCommand(e.detail)) handler(e.detail)
  }
  on('EDITOR_COMMAND', listener)
  return () => off('EDITOR_COMMAND', listener)
}
