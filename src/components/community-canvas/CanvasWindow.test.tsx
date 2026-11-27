import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudError, type CloudBackend } from '../../cloud/backend'
import { HIDDEN_APP_VIEW, emitAppState, type AppCommand } from '../../lib/app-bridge'
import { MemoryHub } from '../../multiplayer/memory-hub.test-support'
import { CanvasSession } from '../../community-canvas/session'
import { AppHost } from '../apps/AppHost'
import { CanvasApp } from './CanvasApp'
import { CanvasWindow, statusLine } from './CanvasWindow'
import { CommunityCanvasHost } from './CommunityCanvasHost'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The Community Canvas window in the DOM (CH-04). The session underneath is real; the backend is a small fake of
 * the canvas functions (their real behaviour is tested on PostgreSQL in session.test.ts and canvas-schema.test.ts).
 */

const WORLD = '0b6c1c4e-8f0e-4c7e-9d7a-000000000001'
const ME = '0b6c1c4e-8f0e-4c7e-9d7a-000000000002'

interface Fake extends CloudBackend { calls: Array<{ fn: string; args: Record<string, unknown> }>; locked: boolean; offline: boolean }
function fakeBackend(): Fake {
  let seq = 0
  const b: Fake = {
    calls: [], locked: false, offline: false,
    rpc: async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
      b.calls.push({ fn, args })
      if (b.offline) throw new CloudError('network', 'Failed to fetch')
      const at = '2026-12-20T09:00:00.000Z'
      switch (fn) {
        case 'hall_context': return { worldId: WORLD, name: 'Community Hall', canvasLocked: b.locked, draftLocked: false, role: 'member' } as T
        case 'canvas_strokes_in': return { seq, strokes: [], truncated: false } as T
        case 'canvas_ops_since': return { ops: [], more: false } as T
        case 'add_canvas_stroke': {
          if (b.locked) throw new CloudError('22023', 'The canvas is locked by a moderator for now.')
          seq++
          const stroke = { id: args['p_id'], authorId: ME, authorName: 'Me', tool: args['p_tool'], color: args['p_color'], width: args['p_width'], points: args['p_points'], createdAt: at, hidden: false }
          return { seq, kind: 'add', strokeId: args['p_id'], actorId: ME, createdAt: at, stroke } as T
        }
        case 'hide_canvas_stroke': seq++; return { seq, kind: 'hide', strokeId: args['p_id'], actorId: ME, createdAt: at } as T
        default: throw new Error(`unexpected ${fn}`)
      }
    },
    upload: async () => undefined, download: async () => new ArrayBuffer(0), remove: async () => undefined,
  }
  return b
}

/** A 2D context that records what was painted (jsdom has none), so the renderer runs too. */
let painted: string[] = []
function fakeContext(): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (target, prop: string) => (prop in target ? target[prop] : (...args: unknown[]) => { painted.push(`${prop}(${args.join(',')})`) }),
    set: (target, prop: string, value) => { target[prop] = value; return true },
  }) as unknown as CanvasRenderingContext2D
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  painted = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(fakeContext as never)
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
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const button = (name: string): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)!
const canvas = (): HTMLCanvasElement => container.querySelector('canvas')!
const status = (): string => container.querySelector('[role="status"]')!.textContent!
// jsdom has no PointerEvent; React listens for the event names, so mouse events with those names do.
const pointer = (type: string, x: number, y: number): void =>
  act(() => { canvas().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })) })
const key = (k: string, extra: KeyboardEventInit = {}): void =>
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })) })

async function openWindow(backend = fakeBackend(), onClose = vi.fn()) {
  const session = new CanvasSession({ backend, transport: new MemoryHub().client(ME), worldId: WORLD, userId: ME })
  await session.start()
  act(() => root.render(<CanvasWindow session={session} onClose={onClose} />))
  await settle()
  return { session, backend, onClose }
}
const adds = (b: Fake) => b.calls.filter(c => c.fn === 'add_canvas_stroke')

describe('CanvasWindow', () => {
  it('draws with the pointer: a stroke in world units, sent once, in the chosen colour and size', async () => {
    const { backend, session } = await openWindow()
    act(() => button('Colour #2364aa').click())
    act(() => button('Size 8').click())
    // The view is centred on (0, 0) in an 800 x 600 area: screen (400, 300) is the world's origin.
    pointer('pointerdown', 400, 300)
    pointer('pointermove', 410, 300)
    pointer('pointermove', 420, 310)
    pointer('pointerup', 420, 310)
    await settle()
    expect(adds(backend).map(c => c.args)).toEqual([expect.objectContaining({ p_tool: 'pen', p_color: '#2364aa', p_width: 8, p_points: [0, 0, 10, 0, 20, 10] })])
    expect(session.store.size).toBe(1)
    expect(button('Undo').disabled).toBe(false)
    // Painted: the stroke from the origin.
    await vi.waitFor(() => expect(painted).toContain('moveTo(0,0)'))
    expect(painted).toContain('lineTo(20,10)')
  })

  it('switches tools by button and key, erases, undoes and redoes', async () => {
    const { backend, session } = await openWindow()
    pointer('pointerdown', 400, 300)
    pointer('pointermove', 440, 300)
    pointer('pointerup', 440, 300)
    await settle()
    key('e')
    expect(button('Eraser').getAttribute('aria-pressed')).toBe('true')
    pointer('pointerdown', 420, 301)
    pointer('pointerup', 420, 301)
    await settle()
    expect(backend.calls.filter(c => c.fn === 'hide_canvas_stroke').map(c => c.args['p_reason'])).toEqual(['erased'])
    expect(session.store.size).toBe(0)
    key('z', { ctrlKey: true })
    expect(session.store.size).toBe(1)
    key('z', { ctrlKey: true, shiftKey: true })
    expect(session.store.size).toBe(0)
    act(() => button('Marker').click())
    expect(button('Marker').getAttribute('aria-pressed')).toBe('true')
  })

  it('pans with the Move tool without drawing, and zooms with the buttons', async () => {
    const { backend } = await openWindow()
    act(() => button('Move').click())
    pointer('pointerdown', 400, 300)
    pointer('pointermove', 300, 300)
    pointer('pointerup', 300, 300)
    act(() => button('Zoom in').click())
    expect(container.querySelector('.cc-zoom')!.textContent).toBe('125%')
    act(() => button('Centre').click())
    expect(container.querySelector('.cc-zoom')!.textContent).toBe('100%')
    await settle()
    expect(adds(backend)).toEqual([])
  })

  it('drops a stroke in progress on Escape, and closes on Escape otherwise', async () => {
    const { backend, onClose } = await openWindow()
    pointer('pointerdown', 400, 300)
    pointer('pointermove', 410, 300)
    key('Escape')
    pointer('pointerup', 410, 300)
    await settle()
    expect(adds(backend)).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says when the canvas is locked, and offers no pen', async () => {
    const backend = fakeBackend()
    backend.locked = true
    await openWindow(backend)
    expect(button('Pen').disabled).toBe(true)
    expect(status()).toBe('A moderator has locked the canvas for now.')
    pointer('pointerdown', 400, 300)
    pointer('pointerup', 400, 300)
    await settle()
    expect(adds(backend)).toEqual([])
  })

  it('shows a refusal and puts the drawing back', async () => {
    const backend = fakeBackend()
    const { session } = await openWindow(backend)
    backend.locked = true // locked after the window opened
    pointer('pointerdown', 400, 300)
    pointer('pointerup', 400, 300)
    await settle()
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/locked/)
    expect(session.store.size).toBe(0)
  })
})

describe('statusLine', () => {
  const base = { status: 'live', unsaved: 0, stale: false, locked: false, moderator: false, canDraw: true, canUndo: false, canRedo: false, tooFar: false, truncated: false } as const
  it('puts what needs the player first', () => {
    expect(statusLine(base)).toBe('Everyone in town can draw here.')
    expect(statusLine({ ...base, unsaved: 2 })).toBe('Saving...')
    expect(statusLine({ ...base, unsaved: 2, stale: true, status: 'reconnecting' })).toMatch(/^Not saved yet/)
    expect(statusLine({ ...base, status: 'reconnecting' })).toMatch(/^Reconnecting/)
    expect(statusLine({ ...base, locked: true, moderator: true })).toBe('Locked: only moderators can draw.')
    expect(statusLine({ ...base, tooFar: true })).toBe('Zoom in to see the drawing here.')
    expect(statusLine({ ...base, status: 'removed', stale: true })).toBe("You're no longer in this town.")
  })
})

describe('opening and closing', () => {
  it('asks before closing would lose unsaved drawing', async () => {
    const backend = fakeBackend()
    const onClosed = vi.fn()
    act(() => root.render(<CanvasApp transport={new MemoryHub().client(ME)} backend={backend} worldId={WORLD} userId={ME} onClosed={onClosed} />))
    await settle()
    backend.offline = true
    pointer('pointerdown', 400, 300)
    pointer('pointerup', 400, 300)
    await settle()
    act(() => button('Close').click())
    expect(onClosed).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')!.textContent).toMatch(/^1 change is not saved yet/)
    act(() => button('Keep drawing').click())
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    act(() => button('Close').click())
    act(() => button('Close anyway').click())
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('closes at once when everything is saved', async () => {
    const onClosed = vi.fn()
    act(() => root.render(<CanvasApp transport={new MemoryHub().client(ME)} backend={fakeBackend()} worldId={WORLD} userId={ME} onClosed={onClosed} />))
    await settle()
    act(() => button('Close').click())
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it("opens from the Hall's easel (app `canvas`), sends only close, and leaves houses' apps alone", async () => {
    const send = vi.fn<(c: AppCommand) => void>()
    act(() => root.render(<><AppHost sendCommand={vi.fn()} /><CommunityCanvasHost transport={new MemoryHub().client(ME)} backend={fakeBackend()} worldId={WORLD} userId={ME} sendCommand={send} /></>))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    act(() => emitAppState({ open: 'canvas', houseId: 'community-hall', mode: 'visitor' }))
    await vi.waitFor(() => expect(container.querySelector('canvas')).not.toBeNull())
    await settle()
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1) // the canvas only, no house app
    act(() => button('Close').click())
    expect(send).toHaveBeenCalledWith({ type: 'close' })
    act(() => emitAppState(HIDDEN_APP_VIEW))
    expect(container.querySelector('canvas')).toBeNull()
  })
})
