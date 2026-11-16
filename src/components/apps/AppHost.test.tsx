import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_APP_VIEW, emitAppState, type AppCommand, type AppView } from '../../lib/app-bridge'
import { HIDDEN_EDITOR_VIEW, emitEditorState } from '../../lib/editor-bridge'
import { HouseEditorOverlay } from '../house-editor/HouseEditorOverlay'
import { AppHost } from './AppHost'
import { AppErrorBoundary } from './AppErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OWNER_WEBSITE: AppView = { open: 'website', houseId: 'house-a', mode: 'owner' }
const VISITOR_PAINT: AppView = { open: 'paint', houseId: 'house-b', mode: 'visitor' }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  act(() => emitAppState(HIDDEN_APP_VIEW))
  container.remove()
})

const publish = (view: AppView): void => act(() => emitAppState(view))
const field = (): HTMLInputElement => container.querySelector('input')!

describe('AppHost', () => {
  it('shows nothing until an app is opened, and nothing after it closes', () => {
    act(() => root.render(<AppHost sendCommand={vi.fn()} />))
    expect(container.innerHTML).toBe('')
    publish(OWNER_WEBSITE)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    publish(HIDDEN_APP_VIEW)
    expect(container.innerHTML).toBe('')
  })

  it('shows the app, house and mode Phaser reported', () => {
    act(() => root.render(<AppHost sendCommand={vi.fn()} />))
    publish(OWNER_WEBSITE)
    expect(container.textContent).toContain('Computer')
    expect(container.querySelector('[data-testid="app-house"]')?.textContent).toBe('house-a')
    expect(container.querySelector('[data-testid="app-mode"]')?.textContent).toBe('owner')

    publish(VISITOR_PAINT)
    expect(container.textContent).toContain('Sketchbook')
    expect(container.querySelector('[data-testid="app-house"]')?.textContent).toBe('house-b')
    expect(container.querySelector('[data-testid="app-mode"]')?.textContent).toBe('visitor')
  })

  it('sends only close, from the button and from Escape', () => {
    const send = vi.fn<(c: AppCommand) => void>()
    act(() => root.render(<AppHost sendCommand={send} />))
    publish(OWNER_WEBSITE)

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(send.mock.calls).toEqual([[{ type: 'close' }], [{ type: 'close' }]])
  })

  it('moves focus into the window and puts it back on close', () => {
    const before = document.createElement('button')
    document.body.appendChild(before)
    before.focus()
    act(() => root.render(<AppHost sendCommand={vi.fn()} />))
    publish(OWNER_WEBSITE)
    expect(container.querySelector('[role="dialog"]')).toBe(document.activeElement)
    publish(HIDDEN_APP_VIEW)
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  it('does not stop W, A, S, D, E or the arrow keys from reaching a text field', () => {
    act(() => root.render(<AppHost sendCommand={vi.fn()} />))
    publish(OWNER_WEBSITE)
    for (const key of ['w', 'a', 's', 'd', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      field().dispatchEvent(event)
      expect(event.defaultPrevented, key).toBe(false)
    }
    // Only Escape is handled by the window, and only that one is prevented.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    field().dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
  })

  it('keeps Tab inside the window', () => {
    act(() => root.render(<AppHost sendCommand={vi.fn()} />))
    publish(OWNER_WEBSITE)
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    field().focus()
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    field().dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)

    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    close.dispatchEvent(back)
    expect(document.activeElement).toBe(field())
  })

  it('ignores malformed state', () => {
    act(() => root.render(<AppHost sendCommand={vi.fn()} />))
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
  it('hides Edit House, and brings it back after the app closes', () => {
    act(() => root.render(<HouseEditorOverlay sendCommand={vi.fn()} />))
    act(() => emitEditorState({ ...HIDDEN_EDITOR_VIEW, houseId: 'house-a', canEdit: true }))
    expect(container.textContent).toContain('Edit House')

    publish(OWNER_WEBSITE)
    expect(container.textContent).not.toContain('Edit House')

    publish(HIDDEN_APP_VIEW)
    expect(container.textContent).toContain('Edit House')
  })
})
