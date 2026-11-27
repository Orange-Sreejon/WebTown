import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasTool } from '../../cloud/canvas'
import { HOME_VIEW, panBy, screenToWorld, zoomAt, type Size, type View } from '../../community-canvas/geometry'
import { paint } from '../../community-canvas/render'
import type { CanvasSession } from '../../community-canvas/session'
import { WindowFrame } from '../apps/WindowFrame'
import './community-canvas.css'

/**
 * The Community Canvas window (CH-04): the shared drawing for the whole town. Draws what the session knows and
 * turns pointer and keyboard input into session calls; holds no canvas data itself. The view (pan and zoom) lives
 * in a ref, so moving around redraws without re-rendering React.
 */

export type Tool = CanvasTool | 'eraser' | 'hand'

export const PALETTE = [
  '#1d1d1f', '#6b6b70', '#ffffff', '#d7263d', '#f46036', '#f2c14e',
  '#2e9e5b', '#1b998b', '#2364aa', '#6a4c93', '#c2678f', '#8d5a3b',
] as const
export const WIDTHS = [2, 4, 8, 16, 32] as const
/** The eraser's reach, in screen pixels. */
export const ERASER_PX = 8
const ZOOM_STEP = 1.25

const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
  { id: 'pen', label: 'Pen', key: 'p' },
  { id: 'marker', label: 'Marker', key: 'm' },
  { id: 'eraser', label: 'Eraser', key: 'e' },
  { id: 'hand', label: 'Move', key: 'h' },
]

interface Props {
  session: CanvasSession
  /** Asked to close; the host decides (it may ask about unsaved changes first). */
  onClose: () => void
  /** Shown over the canvas when closing would lose changes not saved yet. */
  confirming?: { count: number; keep: () => void; discard: () => void } | null
}

/** What the toolbar and status line show; recomputed when the session changes. */
function snapshot(s: CanvasSession) {
  return {
    status: s.status, unsaved: s.unsaved, stale: s.stale, locked: s.locked, moderator: s.moderator,
    canDraw: s.canDraw, canUndo: s.canUndo, canRedo: s.canRedo, tooFar: s.tooFar, truncated: s.truncated,
  }
}
type Snapshot = ReturnType<typeof snapshot>
const same = (a: Snapshot, b: Snapshot): boolean => (Object.keys(a) as Array<keyof Snapshot>).every(k => a[k] === b[k])

export function statusLine(s: Snapshot): string {
  if (s.status === 'removed') return "You're no longer in this town."
  if (s.status === 'failed') return "Couldn't join the canvas's live session. Close and try again."
  if (s.stale) return 'Not saved yet. WebTown keeps trying; keep this window open.'
  if (s.status === 'connecting') return 'Connecting...'
  if (s.status === 'reconnecting') return 'Reconnecting... your drawing is kept here until it is saved.'
  if (s.unsaved > 0) return 'Saving...'
  if (s.locked) return s.moderator ? 'Locked: only moderators can draw.' : 'A moderator has locked the canvas for now.'
  if (s.tooFar) return 'Zoom in to see the drawing here.'
  if (s.truncated) return 'There is more drawing here than can be shown at once.'
  return 'Everyone in town can draw here.'
}

export function CanvasWindow({ session, onClose, confirming = null }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const view = useRef<View>(HOME_VIEW)
  const size = useRef<Size>({ width: 800, height: 600 })
  const frame = useRef<number | null>(null)
  const gesture = useRef<null | { kind: 'draw' | 'erase' | 'pan'; x: number; y: number; id: number }>(null)
  const spaceDown = useRef(false)

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [width, setWidth] = useState<number>(4)
  const [ui, setUi] = useState<Snapshot>(() => snapshot(session))
  const [notice, setNotice] = useState<string | null>(null)
  const [zoomText, setZoomText] = useState('100%')

  const draw = useCallback((): void => {
    frame.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(size.current.width * dpr)
    const h = Math.round(size.current.height * dpr)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    paint(ctx, { store: session.store, previews: session.previews.all(), current: session.current, view: view.current, size: size.current, dpr })
  }, [session])

  const schedule = useCallback((): void => {
    if (frame.current !== null) return
    frame.current = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (setTimeout(draw, 16) as unknown as number)
  }, [draw])

  const viewChanged = useCallback((): void => {
    session.setView(view.current, size.current)
    setZoomText(`${Math.round(view.current.zoom * 100)}%`)
    schedule()
  }, [session, schedule])

  // Session changes: redraw, and re-render the toolbar only when what it shows changed.
  useEffect(() => {
    const stop = session.subscribe(() => {
      schedule()
      setUi(prev => {
        const next = snapshot(session)
        return same(prev, next) ? prev : next
      })
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    const stopNotice = session.onNotice(text => {
      setNotice(text)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setNotice(null), 5000)
    })
    return () => {
      stop()
      stopNotice()
      if (timer) clearTimeout(timer)
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current)
    }
  }, [session, schedule])

  // Size: follow the window's drawing area.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = (): void => {
      const r = wrap.getBoundingClientRect()
      size.current = { width: Math.max(1, r.width || 800), height: Math.max(1, r.height || 600) }
      viewChanged()
    }
    measure()
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure)
      ro.observe(wrap)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [viewChanged])

  const local = (e: { clientX: number; clientY: number }): { sx: number; sy: number } => {
    const r = canvasRef.current?.getBoundingClientRect()
    return { sx: e.clientX - (r?.left ?? 0), sy: e.clientY - (r?.top ?? 0) }
  }
  const world = (sx: number, sy: number) => screenToWorld(view.current, size.current, sx, sy)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (gesture.current) return
    const { sx, sy } = local(e)
    const pan = tool === 'hand' || e.button === 1 || spaceDown.current
    if (!pan && e.button !== 0) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture?.(e.pointerId)
    if (pan) {
      gesture.current = { kind: 'pan', x: sx, y: sy, id: e.pointerId }
      return
    }
    const w = world(sx, sy)
    if (tool === 'eraser') {
      gesture.current = { kind: 'erase', x: sx, y: sy, id: e.pointerId }
      session.eraseAt(w.x, w.y, ERASER_PX / view.current.zoom)
      return
    }
    if (!session.canDraw) return
    gesture.current = { kind: 'draw', x: sx, y: sy, id: e.pointerId }
    session.begin(tool, color, tool === 'marker' ? Math.max(width, 8) : width, w.x, w.y)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const { sx, sy } = local(e)
    if (g.kind === 'pan') {
      view.current = panBy(view.current, sx - g.x, sy - g.y)
      g.x = sx
      g.y = sy
      viewChanged()
      return
    }
    const w = world(sx, sy)
    if (g.kind === 'erase') session.eraseAt(w.x, w.y, ERASER_PX / view.current.zoom)
    else session.extend(w.x, w.y)
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    if (g.kind === 'draw') {
      if (e.type === 'pointercancel') session.cancel()
      else session.end()
    }
  }

  const zoomBy = (factor: number, sx = size.current.width / 2, sy = size.current.height / 2): void => {
    view.current = zoomAt(view.current, size.current, factor, sx, sy)
    viewChanged()
  }

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      view.current = zoomAt(view.current, size.current, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
      viewChanged()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [viewChanged])

  // Keyboard: undo/redo, tool keys, Space to move, Escape to drop a stroke in progress (else close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) session.redo()
        else session.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        session.redo()
      } else if (e.key === ' ') {
        spaceDown.current = true
        e.preventDefault()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (gesture.current?.kind === 'draw') {
          gesture.current = null
          session.cancel()
        } else {
          onClose()
        }
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find(x => x.key === k)
        if (t) setTool(t.id)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => { if (e.key === ' ') spaceDown.current = false }
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [session, onClose])

  const drawing = tool === 'pen' || tool === 'marker'
  return (
    <WindowFrame title="Community Canvas" size="full" onClose={onClose} closeOnEscape={false}>
      <div className="cc">
        <div className="cc-bar" role="toolbar" aria-label="Drawing tools">
          <div className="cc-group">
            {TOOLS.map(t => (
              <button key={t.id} type="button" className="cc-tool" aria-pressed={tool === t.id} title={`${t.label} (${t.key.toUpperCase()})`}
                onClick={() => setTool(t.id)} disabled={(t.id === 'pen' || t.id === 'marker') && !ui.canDraw}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="cc-group" role="radiogroup" aria-label="Colour">
            {PALETTE.map(c => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} className="cc-swatch"
                style={{ background: c }} onClick={() => setColor(c)} disabled={!drawing} />
            ))}
          </div>
          <div className="cc-group" role="radiogroup" aria-label="Size">
            {WIDTHS.map(w => (
              <button key={w} type="button" role="radio" aria-checked={width === w} aria-label={`Size ${w}`} className="cc-width"
                onClick={() => setWidth(w)} disabled={!drawing}>
                <span style={{ width: Math.min(w, 20), height: Math.min(w, 20) }} />
              </button>
            ))}
          </div>
          <div className="cc-group">
            <button type="button" onClick={() => session.undo()} disabled={!ui.canUndo} title="Undo (Ctrl+Z)">Undo</button>
            <button type="button" onClick={() => session.redo()} disabled={!ui.canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
          </div>
          <div className="cc-group">
            <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">-</button>
            <span className="cc-zoom" aria-label="Zoom">{zoomText}</span>
            <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => { view.current = HOME_VIEW; viewChanged() }}>Centre</button>
          </div>
        </div>
        <div className="cc-stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className={`cc-canvas cc-${tool}`}
            role="img"
            aria-label="The town's shared drawing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          />
          {notice && <p className="cc-notice" role="alert">{notice}</p>}
          {confirming && (
            <div className="cc-confirm" role="alertdialog" aria-label="Close without saving?">
              <p>{confirming.count === 1 ? '1 change is' : `${confirming.count} changes are`} not saved yet. If you close now, {confirming.count === 1 ? 'it' : 'they'} will be lost.</p>
              <div>
                <button type="button" onClick={confirming.keep} autoFocus>Keep drawing</button>
                <button type="button" onClick={confirming.discard}>Close anyway</button>
              </div>
            </div>
          )}
        </div>
        <p className="cc-status" role="status">{statusLine(ui)}</p>
      </div>
    </WindowFrame>
  )
}
