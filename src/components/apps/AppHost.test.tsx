import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_APP_VIEW, emitAppState, type AppCommand, type AppView } from '../../lib/app-bridge'
import { HIDDEN_EDITOR_VIEW, emitEditorState } from '../../lib/editor-bridge'
import { createSiteStorage, type SiteStorage } from '../../personal-spaces/composition'
import { HouseEditorOverlay } from '../house-editor/HouseEditorOverlay'
import { AppHost } from './AppHost'
import { AppErrorBoundary } from './AppErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The window behaviour every app shares, shown here with a visitor's Sketchbook (it loads no lazy chunk).
// The website and WebTown Paint have their own tests.
const VISITOR_PAINT: AppView = { open: 'paint', houseId: 'house-b', mode: 'visitor' }
const OTHER_VISITOR_PAINT: AppView = { open: 'paint', houseId: 'house-c', mode: 'visitor' }

let container: HTMLDivElement
let root: Root
let storage: Promise<SiteStorage>

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  storage = createSiteStorage() // jsdom has no IndexedDB: memory storage
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  act(() => emitAppState(HIDDEN_APP_VIEW))
  container.remove()
  vi.restoreAllMocks()
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const mount = (send: (c: AppCommand) => void = vi.fn()): void =>
  act(() => root.render(<AppHost sendCommand={send} getSiteStorage={() => storage} />))
const publish = async (view: AppView): Promise<void> => {
  act(() => emitAppState(view))
  await settle()
}
const closeButton = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!

describe('AppHost', () => {
  it('shows nothing until an app is opened, and nothing after it closes', async () => {
    mount()
    expect(container.innerHTML).toBe('')
    await publish(VISITOR_PAINT)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await publish(HIDDEN_APP_VIEW)
    expect(container.innerHTML).toBe('')
  })

  it('opens the Sketchbook for the house Phaser reported, view-only for a visitor', async () => {
    mount()
    await publish(VISITOR_PAINT)
    expect(container.textContent).toContain('Sketchbook (view only)')
    expect(container.textContent).toContain('No drawings yet')
    await publish(OTHER_VISITOR_PAINT)
    expect(container.textContent).toContain('Sketchbook (view only)')
  })

  it('sends only close, from the button and from Escape', async () => {
    const send = vi.fn<(c: AppCommand) => void>()
    mount(send)
    await publish(VISITOR_PAINT)
    act(() => closeButton().click())
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(send.mock.calls).toEqual([[{ type: 'close' }], [{ type: 'close' }]])
  })

  it('moves focus into the window and puts it back on close', async () => {
    const before = document.createElement('button')
    document.body.appendChild(before)
    before.focus()
    mount()
    await publish(VISITOR_PAINT)
    expect(container.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
    await publish(HIDDEN_APP_VIEW)
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  it('does not stop W, A, S, D, E or the arrow keys from reaching the page', async () => {
    mount()
    await publish(VISITOR_PAINT)
    for (const key of ['w', 'a', 's', 'd', 'e', 'ArrowUp', 'ArrowDown', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      closeButton().dispatchEvent(event)
      expect(event.defaultPrevented, key).toBe(false)
    }
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    closeButton().dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
  })

  it('keeps Tab inside the window', async () => {
    mount()
    await publish(VISITOR_PAINT)
    // The visitor's window with no drawings has one button: Tab stays on it.
    closeButton().focus()
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    closeButton().dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(closeButton())
  })

  it('ignores malformed state', () => {
    mount()
    act(() => emitAppState({ open: 'browser', houseId: 'x', mode: 'owner' } as unknown as AppView))
    expect(container.innerHTML).toBe('')
  })

  it('asks Phaser to close when the app crashes, instead of leaving the player frozen', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onError = vi.fn()
    const Bomb = (): React.ReactElement => {
      throw new Error('boom')
    }
    act(() => root.render(<AppErrorBoundary onError={onError}><Bomb /></AppErrorBoundary>))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
    error.mockRestore()
  })
})

describe('HouseEditorOverlay while an app is open', () => {
  it('hides Edit House, and brings it back after the app closes', async () => {
    act(() => root.render(<HouseEditorOverlay sendCommand={vi.fn()} />))
    act(() => emitEditorState({ ...HIDDEN_EDITOR_VIEW, houseId: 'house-a', canEdit: true }))
    expect(container.textContent).toContain('Edit House')

    act(() => emitAppState(VISITOR_PAINT))
    expect(container.textContent).not.toContain('Edit House')

    act(() => emitAppState(HIDDEN_APP_VIEW))
    expect(container.textContent).toContain('Edit House')
  })
})
