import { HIDDEN_APP_VIEW, type AccessMode, type AppId, type AppView } from '../../lib/app-bridge'
import { accessModeFor } from '../../personal-spaces/access/access-policy'

/** What the scene lends the session; every effect on Phaser goes through here. */
export interface AppSessionPorts {
  /** Stops the player dead (velocity and walking animation). */
  haltPlayer(): void
  hidePrompt(): void
  /** `false` hands the keyboard to the page so React inputs can be typed into. */
  setKeyboardCaptured(captured: boolean): void
  /** Tells React what to show. */
  publish(view: AppView): void
  /** Called after the app closed; starts the cooldown so the closing key cannot re-trigger anything. */
  appClosed(): void
}

/**
 * Decides who may edit. Fails **closed**: if the check throws or answers
 * anything but `true`, the player is a visitor.
 *
 * Client-side only; browser developer tools can bypass it (Phase 3a).
 */
export function resolveAccessMode(houseId: string, canEdit: (houseId: string) => boolean): AccessMode {
  try {
    return accessModeFor(canEdit(houseId) === true)
  } catch (error) {
    console.error('[AppSession] permission check failed; treating the player as a visitor', error)
    return 'visitor'
  }
}

/**
 * Whether an in-house app (website or Paint) is open, and what opening and
 * closing it does to the scene. Pure of Phaser so it can be tested directly.
 *
 * Only one app can be open, only `close` ends it, and `close` is safe to call
 * any number of times.
 */
export class AppSession {
  private current: AppId | null = null

  constructor(
    private readonly ports: AppSessionPorts,
    private readonly canEdit: (houseId: string) => boolean,
  ) {}

  get openApp(): AppId | null {
    return this.current
  }

  get isOpen(): boolean {
    return this.current !== null
  }

  /** Opens an app. Returns false, changing nothing, if one is already open. */
  open(app: AppId, houseId: string): boolean {
    if (this.current !== null) return false
    this.current = app

    // The player is frozen and the keyboard handed over before React is told,
    // so there is no frame where a typed letter both moves the player and
    // lands in a field.
    this.ports.haltPlayer()
    this.ports.hidePrompt()
    this.ports.setKeyboardCaptured(false)
    this.ports.publish({ open: app, houseId, mode: resolveAccessMode(houseId, this.canEdit) })
    return true
  }

  /** Closes the open app. Returns false, changing nothing, if none is open. */
  close(): boolean {
    if (this.current === null) return false
    this.current = null

    this.ports.setKeyboardCaptured(true)
    this.ports.publish(HIDDEN_APP_VIEW)
    this.ports.appClosed()
    return true
  }

  /** Scene teardown: close anything still open so the keyboard is always given back. */
  dispose(): void {
    this.close()
  }
}
