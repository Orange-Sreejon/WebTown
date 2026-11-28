import type { CanvasBox, CanvasTool } from '../cloud/canvas'
import { viewBox, type Size, type View } from './geometry'
import type { Preview } from './preview'
import type { CanvasStore } from './store'

/** How the canvas is painted (CH-04). Pure apart from the 2D context it is given. */

export const PAPER = '#fbf8f1'
const GRID = 'rgba(60, 50, 40, 0.08)'
const GRID_STEP = 64

interface Line { tool: CanvasTool; color: string; width: number; points: readonly number[] }

/** The ink's opacity: markers are translucent; previews (someone else, still drawing) fainter still. */
export function alphaFor(tool: CanvasTool, preview: boolean): number {
  const base = tool === 'marker' ? 0.45 : 1
  return preview ? base * 0.4 : base
}

function line(ctx: CanvasRenderingContext2D, l: Line, alpha: number): void {
  const p = l.points
  if (p.length < 2) return
  ctx.globalAlpha = alpha
  ctx.strokeStyle = l.color
  ctx.fillStyle = l.color
  ctx.lineWidth = l.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (p.length === 2) {
    ctx.beginPath()
    ctx.arc(p[0]!, p[1]!, l.width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(p[0]!, p[1]!)
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!)
  ctx.stroke()
}

export interface Scene {
  store: CanvasStore
  previews: readonly Preview[]
  current: Line | null
  view: View
  size: Size
  /** Device pixels per CSS pixel. */
  dpr: number
  /** A moderator's "Clear area" rectangle being dragged (world units). */
  selection?: CanvasBox | null
}

/** Paints everything in view. */
export function paint(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { view, size, dpr } = scene
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, size.width, size.height)

  const z = view.zoom * dpr
  ctx.setTransform(z, 0, 0, z, dpr * (size.width / 2 - view.x * view.zoom), dpr * (size.height / 2 - view.y * view.zoom))
  const box = viewBox(view, size)

  // A faint grid while it is useful (not so dense it turns grey).
  if (GRID_STEP * view.zoom >= 12) {
    ctx.globalAlpha = 1
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1 / view.zoom
    ctx.beginPath()
    for (let x = Math.floor(box.x1 / GRID_STEP) * GRID_STEP; x <= box.x2; x += GRID_STEP) { ctx.moveTo(x, box.y1); ctx.lineTo(x, box.y2) }
    for (let y = Math.floor(box.y1 / GRID_STEP) * GRID_STEP; y <= box.y2; y += GRID_STEP) { ctx.moveTo(box.x1, y); ctx.lineTo(box.x2, y) }
    ctx.stroke()
  }

  for (const s of scene.store.inBox(box)) line(ctx, s, alphaFor(s.tool, false))
  for (const p of scene.previews) line(ctx, p, alphaFor(p.tool, true))
  if (scene.current) line(ctx, scene.current, alphaFor(scene.current.tool, false))
  if (scene.selection) {
    const s = scene.selection
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(215, 38, 61, 0.08)'
    ctx.strokeStyle = '#d7263d'
    ctx.lineWidth = 1.5 / view.zoom
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom])
    ctx.fillRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1)
    ctx.strokeRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1)
    ctx.setLineDash([])
  }
  ctx.globalAlpha = 1
}
