import { emit, off, on } from './event-bus'

/**
 * The typed channel between the in-house apps (website, WebTown Paint) and the
 * Phaser interior.
 *
 * Phaser publishes an `AppView` (plain JSON) when the player opens or closes an
 * app; React answers with an `AppCommand`. The only command is `close`, so React
 * can never ask Phaser to do anything else. No Phaser object crosses, and payloads
 * arrive as `unknown` and are narrowed by guards. Same pattern as `editor-bridge`.
 */

/** Which application is on screen. */
export type AppId = 'website' | 'paint'

/**
 * Whether the local player may edit this house's content.
 *
 * Decided once, in Phaser, from `canEditHouse`. In Phase 3a this is a client-side
 * stand-in: anyone with browser developer tools can bypass it. It is not
 * authorization.
 */
export type AccessMode = 'owner' | 'visitor'

/** Phaser → React. */
export interface AppView {
  /** The app to show; null when none is open. */
  open: AppId | null
  houseId: string
  mode: AccessMode
}

/** React → Phaser. */
export type AppCommand = { type: 'close' }

/** What the UI shows while no app is open. */
export const HIDDEN_APP_VIEW: AppView = { open: null, houseId: '', mode: 'visitor' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function isAppView(value: unknown): value is AppView {
  return isRecord(value) &&
    (value['open'] === null || value['open'] === 'website' || value['open'] === 'paint') &&
    typeof value['houseId'] === 'string' &&
    (value['mode'] === 'owner' || value['mode'] === 'visitor')
}

export function isAppCommand(value: unknown): value is AppCommand {
  return isRecord(value) && value['type'] === 'close'
}

/** Phaser → React. */
export function emitAppState(view: AppView): void {
  emit('APP_STATE', view)
}

/** Subscribes to app views; returns the unsubscribe function. Malformed payloads are ignored. */
export function onAppState(handler: (view: AppView) => void): () => void {
  const listener = (e: CustomEvent<unknown>): void => {
    if (isAppView(e.detail)) handler(e.detail)
  }
  on('APP_STATE', listener)
  return () => off('APP_STATE', listener)
}

/** React → Phaser. */
export function emitAppCommand(command: AppCommand): void {
  emit('APP_COMMAND', command)
}

/** Subscribes to app commands; returns the unsubscribe function. Malformed payloads are ignored. */
export function onAppCommand(handler: (command: AppCommand) => void): () => void {
  const listener = (e: CustomEvent<unknown>): void => {
    if (isAppCommand(e.detail)) handler(e.detail)
  }
  on('APP_COMMAND', listener)
  return () => off('APP_COMMAND', listener)
}
