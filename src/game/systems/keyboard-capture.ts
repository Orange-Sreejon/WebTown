/**
 * The few Phaser `KeyboardPlugin` members this needs. Phaser's own plugin
 * satisfies it, and tests can pass a stand-in.
 */
export interface KeyboardControl {
  enabled: boolean
  enableGlobalCapture(): unknown
  disableGlobalCapture(): unknown
  resetKeys(): unknown
}

/**
 * Hands the keyboard to the page (`captured = false`) or takes it back
 * (`captured = true`).
 *
 * Why both switches: Phaser calls `preventDefault` on every key it captured
 * (W, A, S, D, arrows, Space, Shift, and anything else added), and that setting
 * is global to the game, so a React text field would silently lose those
 * letters. `disableGlobalCapture` stops the `preventDefault`; `enabled = false`
 * stops Phaser reacting to keys typed into the page at all.
 *
 * `resetKeys` runs both ways. While the page owns the keyboard Phaser misses
 * key-up events, so a key held when an app opened would otherwise still read as
 * down afterwards and make the player walk by itself.
 */
export function setKeyboardCaptured(keyboard: KeyboardControl, captured: boolean): void {
  keyboard.resetKeys()
  if (captured) {
    keyboard.enableGlobalCapture()
    keyboard.enabled = true
  } else {
    keyboard.enabled = false
    keyboard.disableGlobalCapture()
  }
  keyboard.resetKeys()
}
