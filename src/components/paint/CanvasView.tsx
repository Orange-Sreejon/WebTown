import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { toHex, type Rgba } from '../../personal-spaces/paint/color'
import { clientToPixel } from '../../personal-spaces/paint/coords'
import type { PaintSession, StrokeInput } from '../../personal-spaces/paint/paint-session'
import type { Point } from '../../personal-spaces/paint/raster'
import type { ToolId } from '../../personal-spaces/paint/tools'
import type { ValueStore } from './StatusBar'
import { TEXT_FONT, lineHeightFor } from './text-raster'

export type Zoom = 'auto' | 1 | 2 | 4
export const AIRBRUSH_TICK_MS = 30

export interface TextBox {
  at: Point
  value: string
  size: number
  color: Rgba
}

export interface CanvasViewProps {
  session: PaintSession
  /** Size, to lay out; changes with Image > Attributes and undo. */
  width: number
  height: number
  transparent: boolean
  tool: ToolId
  zoom: Zoom
  /** The tool, colours and settings at the moment of a press. */
  inputFor: (button: StrokeInput['button'], shift: boolean) => StrokeInput
  onPicked: (color: Rgba | null) => void
  onTextRequest: (at: Point) => void
  pointer: ValueStore<string>
  textBox: TextBox | null
  onTextChange: (value: string) => void
  onTextCommit: () => void
  onTextCancel: () => void
}

const CURSORS: Record<ToolId, string> = {
  pencil: 'crosshair', brush: 'crosshair', eraser: 'cell', airbrush: 'crosshair', fill: 'crosshair', picker: 'crosshair',
  text: 'text', line: 'crosshair', rectangle: 'crosshair', ellipse: 'crosshair',
}

const raf = (fn: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number)
const cancelRaf = (id: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id)
}

/**
 * The drawing surface. The `<canvas>` has exactly the picture's pixels and is
 * scaled by CSS; every pointer position is converted with the canvas's box as
 * it is at that moment, so zoom and window size never skew the drawing.
 */
export function CanvasView(props: CanvasViewProps): React.ReactElement {
  const { session, width, height, transparent, tool, zoom, textBox } = props
  const areaRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerId = useRef<number | null>(null)
  const sprayTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const frame = useRef<number | null>(null)
  const [fit, setFit] = useState(1)
  const propsRef = useRef(props)
  propsRef.current = props

  // ── Presenting the picture ─────────────────────────────────────────────
  const present = useCallback((all: boolean) => {
    frame.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const dirty = session.takeDirty()
    if (!canvas || !ctx) return
    const view = session.view
    if (canvas.width !== view.width || canvas.height !== view.height) {
      canvas.width = view.width
      canvas.height = view.height
      all = true
    }
    if (!dirty && !all) return
    const image = new ImageData(view.data, view.width, view.height)
    if (all || dirty === 'all' || dirty === null) ctx.putImageData(image, 0, 0)
    else ctx.putImageData(image, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h)
  }, [session])

  useLayoutEffect(() => {
    present(true)
    const stop = session.onChange(() => {
      if (frame.current === null) frame.current = raf(() => present(false))
    })
    return () => {
      stop()
      if (frame.current !== null) cancelRaf(frame.current)
      frame.current = null
    }
  }, [session, present, width, height])

  // ── Fitting the window ─────────────────────────────────────────────────
  useEffect(() => {
    const area = areaRef.current
    if (!area || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const w = area.clientWidth - 16
      const h = area.clientHeight - 16
      if (w > 0 && h > 0) setFit(Math.min(w / width, h / height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [width, height])

  const scale = zoom === 'auto' ? Math.min(1, fit) : zoom

  // ── Pointer ────────────────────────────────────────────────────────────
  const pixelAt = (clientX: number, clientY: number): Point & { inside: boolean } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return clientToPixel(clientX, clientY, rect, session.width, session.height)
  }

  const stopSpray = (): void => {
    if (sprayTimer.current !== null) clearInterval(sprayTimer.current)
    sprayTimer.current = null
  }

  const finish = (): void => {
    stopSpray()
    pointerId.current = null
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const p = propsRef.current
    if (pointerId.current !== null) return
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    if (p.textBox) {
      // A click outside the text box places the text, as in the classic program.
      p.onTextCommit()
      return
    }
    const at = pixelAt(event.clientX, event.clientY)
    const button = event.pointerType === 'mouse' && event.button === 2 ? 'secondary' : 'primary'
    const result = session.begin({ x: at.x, y: at.y }, p.inputFor(button, event.shiftKey))
    if (result.kind === 'picked') p.onPicked(result.color)
    else if (result.kind === 'text') p.onTextRequest(result.at)
    else if (result.kind === 'drawing') {
      pointerId.current = event.pointerId
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not capturable (tests) */ }
      if (p.tool === 'airbrush') sprayTimer.current = setInterval(() => session.tick(), AIRBRUSH_TICK_MS)
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const at = pixelAt(event.clientX, event.clientY)
    props.pointer.set(at.inside ? `${at.x}, ${at.y}` : '')
    if (pointerId.current !== event.pointerId) return
    const native = event.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    const samples = native.getCoalescedEvents?.() ?? []
    const points = (samples.length > 0 ? samples : [native]).map(e => {
      const q = pixelAt(e.clientX, e.clientY)
      return { x: q.x, y: q.y }
    })
    session.move(points, event.shiftKey)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (pointerId.current !== event.pointerId) return
    const at = pixelAt(event.clientX, event.clientY)
    session.end({ x: at.x, y: at.y }, event.shiftKey)
    finish()
  }

  const onCancel = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (pointerId.current !== event.pointerId) return
    session.cancel()
    finish()
  }

  // Leaving the browser window mid-stroke abandons it rather than leaving a stroke half-drawn and stuck.
  useEffect(() => {
    const onBlur = (): void => {
      if (pointerId.current === null) return
      session.cancel()
      finish()
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      stopSpray()
    }
  }, [session])

  const shownW = Math.max(1, Math.round(width * scale))
  const shownH = Math.max(1, Math.round(height * scale))

  return (
    <div className="pt-canvas-area" ref={areaRef}>
      <div className={transparent ? 'pt-sheet pt-sheet--transparent' : 'pt-sheet'} style={{ width: shownW, height: shownH }}>
        <canvas
          ref={canvasRef}
          className="pt-canvas"
          width={width}
          height={height}
          style={{
            width: shownW,
            height: shownH,
            cursor: CURSORS[tool],
            imageRendering: scale >= 1 ? 'pixelated' : 'auto',
          }}
          role="img"
          aria-label={`Drawing canvas, ${width} by ${height} pixels. Draw with the mouse, a pen or touch.`}
          data-scale={scale}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onCancel}
          onPointerLeave={() => props.pointer.set('')}
          onContextMenu={event => event.preventDefault()}
        />
        {textBox && (
          <textarea
            className="pt-textbox"
            aria-label="Text to add to the picture (Ctrl+Enter to place it, Escape to cancel)"
            autoFocus
            spellCheck={false}
            value={textBox.value}
            onChange={event => props.onTextChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                props.onTextCancel()
              } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                props.onTextCommit()
              }
            }}
            style={{
              left: textBox.at.x * scale,
              top: textBox.at.y * scale,
              fontFamily: TEXT_FONT,
              fontSize: textBox.size * scale,
              lineHeight: `${lineHeightFor(textBox.size) * scale}px`,
              color: toHex(textBox.color),
              minWidth: Math.max(40, 6 * textBox.size * scale),
              minHeight: lineHeightFor(textBox.size) * scale + 4,
            }}
          />
        )}
      </div>
    </div>
  )
}
