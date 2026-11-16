import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setKeyboardCaptured, type KeyboardControl } from './keyboard-capture'

/**
 * These tests run Phaser's REAL keyboard manager (the code that calls
 * `preventDefault` on captured keys) and its REAL `enableGlobalCapture` /
 * `disableGlobalCapture`, driven by real DOM key events on a text field. Only the
 * game around them is stubbed. Phaser 3.90.
 */

interface ManagerLike {
  boot(): void
  stopListeners(): void
  preventDefault: boolean
}

const KEY = { W: 87, A: 65, S: 83, D: 68, E: 69, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, SPACE: 32 }
const TYPED = Object.entries(KEY)
// Everything the game could capture: WASD and the cursor keys (which also add Space and
// Shift) are captured today; E is included in case a later change captures it.
const CAPTURED = [...Object.values(KEY), 16]

let manager: ManagerLike
let keyboard: KeyboardControl & { manager: ManagerLike }
let field: HTMLInputElement

beforeEach(async () => {
  const managerPath = 'phaser/src/input/keyboard/KeyboardManager.js'
  const pluginPath = 'phaser/src/input/keyboard/KeyboardPlugin.js'
  const ManagerClass = ((await import(/* @vite-ignore */ managerPath)) as { default: new (input: unknown) => ManagerLike }).default
  const PluginClass = ((await import(/* @vite-ignore */ pluginPath)) as {
    default: { prototype: Pick<KeyboardControl, 'enableGlobalCapture' | 'disableGlobalCapture'> }
  }).default

  manager = new ManagerClass({
    config: { inputKeyboard: true, inputKeyboardEventTarget: window, inputKeyboardCapture: CAPTURED },
    events: { once: vi.fn(), emit: vi.fn() },
    game: { events: { on: vi.fn() } },
  })
  manager.boot()

  keyboard = {
    manager,
    enabled: true,
    resetKeys: vi.fn(),
    enableGlobalCapture: PluginClass.prototype.enableGlobalCapture,
    disableGlobalCapture: PluginClass.prototype.disableGlobalCapture,
  }

  field = document.createElement('input')
  document.body.appendChild(field)
})

afterEach(() => {
  manager.stopListeners()
  field.remove()
})

function press(keyCode: number, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true, ...init })
  field.dispatchEvent(event)
  return event
}

describe('setKeyboardCaptured', () => {
  it('baseline: Phaser swallows the movement keys, so a text field would lose them', () => {
    for (const [name, code] of TYPED) {
      expect(press(code).defaultPrevented, name).toBe(true)
    }
  })

  it('lets W, A, S, D, E, the arrow keys and Space reach a text field once handed over', () => {
    setKeyboardCaptured(keyboard, false)
    for (const [name, code] of TYPED) {
      expect(press(code).defaultPrevented, name).toBe(false)
    }
    expect(keyboard.enabled).toBe(false)
  })

  it('takes the keys back on close', () => {
    setKeyboardCaptured(keyboard, false)
    setKeyboardCaptured(keyboard, true)
    expect(keyboard.enabled).toBe(true)
    for (const [name, code] of TYPED) {
      expect(press(code).defaultPrevented, name).toBe(true)
    }
  })

  it('does not capture modified keys, before or after (Ctrl+S stays the browser\'s)', () => {
    expect(press(KEY.S, { ctrlKey: true }).defaultPrevented).toBe(false)
    setKeyboardCaptured(keyboard, false)
    expect(press(KEY.S, { ctrlKey: true }).defaultPrevented).toBe(false)
  })

  it('clears stale key states on the way out and on the way back', () => {
    setKeyboardCaptured(keyboard, false)
    expect(keyboard.resetKeys).toHaveBeenCalledTimes(2)
    setKeyboardCaptured(keyboard, true)
    expect(keyboard.resetKeys).toHaveBeenCalledTimes(4)
  })

  it('survives repeated open and close', () => {
    for (let i = 0; i < 20; i++) {
      setKeyboardCaptured(keyboard, false)
      expect(press(KEY.W).defaultPrevented).toBe(false)
      setKeyboardCaptured(keyboard, true)
      expect(press(KEY.W).defaultPrevented).toBe(true)
    }
    expect(manager.preventDefault).toBe(true)
    expect(keyboard.enabled).toBe(true)
  })

  it('is idempotent in each direction', () => {
    setKeyboardCaptured(keyboard, false)
    setKeyboardCaptured(keyboard, false)
    expect(press(KEY.A).defaultPrevented).toBe(false)
    setKeyboardCaptured(keyboard, true)
    setKeyboardCaptured(keyboard, true)
    expect(press(KEY.A).defaultPrevented).toBe(true)
  })
})
