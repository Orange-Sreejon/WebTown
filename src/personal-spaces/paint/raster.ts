import { sameColor, type Rgba } from './color'
import { fillSpan, getPixel, setPixel, type PixelBuffer } from './pixel-buffer'

/**
 * Drawing operations on a `PixelBuffer`. All aliased (every pixel is either
 * the colour or untouched), so the image stays sharp and Fill matches exactly.
 * Coordinates may lie outside the image; writes are clipped by `setPixel`.
 */

export interface Point {
  x: number
  y: number
}

export type FillStyle = 'outline' | 'both' | 'fill'

/** Pixel offsets of a round brush of the given diameter, cached by size. */
const discs = new Map<number, Array<[number, number]>>()
export function discOffsets(size: number): Array<[number, number]> {
  const d = Math.max(1, Math.round(size))
  let cached = discs.get(d)
  if (cached) return cached
  cached = []
  if (d <= 2) {
    for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) cached.push([x - (d > 1 ? 1 : 0), y - (d > 1 ? 1 : 0)])
  } else {
    // Pixel centres inside a circle of diameter d centred on the pixel.
    const r = d / 2
    const lo = -Math.floor(d / 2)
    const hi = lo + d - 1
    const c = d % 2 === 0 ? -0.5 : 0
    for (let y = lo; y <= hi; y++) {
      for (let x = lo; x <= hi; x++) {
        const dx = x - c
        const dy = y - c
        if (dx * dx + dy * dy <= r * r) cached.push([x, y])
      }
    }
  }
  discs.set(d, cached)
  return cached
}

export function stamp(b: PixelBuffer, x: number, y: number, size: number, c: Rgba): void {
  if (size <= 1) {
    setPixel(b, x, y, c)
    return
  }
  for (const [dx, dy] of discOffsets(size)) setPixel(b, x + dx, y + dy, c)
}

/** Every pixel of the Bresenham line from a to b, both ends included. */
export function linePoints(a: Point, b: Point): Point[] {
  const points: Point[] = []
  let x0 = Math.round(a.x)
  let y0 = Math.round(a.y)
  const x1 = Math.round(b.x)
  const y1 = Math.round(b.y)
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    points.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
  return points
}

/** A stroke segment: the brush stamped at every pixel of the line, so fast strokes have no gaps. */
export function strokeSegment(b: PixelBuffer, from: Point, to: Point, size: number, c: Rgba): void {
  for (const p of linePoints(from, to)) stamp(b, p.x, p.y, size, c)
}

/** Shift on Line: the nearest of 0, 45 and 90 degrees. */
export function snapLine(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const angle = Math.atan2(dy, dx)
  const step = Math.round(angle / (Math.PI / 4))
  if (step % 4 === 0) return { x: to.x, y: from.y }
  if (Math.abs(step) === 2) return { x: from.x, y: to.y }
  const d = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d }
}

/** Shift on Rectangle and Ellipse: a square box from the start point. */
export function squareBox(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: from.x + (dx < 0 ? -d : d), y: from.y + (dy < 0 ? -d : d) }
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const box = (a: Point, b: Point): Box => ({
  x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
})

/** A rectangle with corners a and b (inclusive). The outline lies inside the box. */
export function drawRectangle(b: PixelBuffer, a: Point, c: Point, style: FillStyle, width: number, line: Rgba, fill: Rgba): void {
  const r = box(a, c)
  const w = Math.max(1, Math.round(width))
  if (style !== 'outline') {
    const fx0 = style === 'both' ? r.x0 + w : r.x0
    const fx1 = style === 'both' ? r.x1 - w : r.x1
    const fy0 = style === 'both' ? r.y0 + w : r.y0
    const fy1 = style === 'both' ? r.y1 - w : r.y1
    const colour = style === 'both' ? fill : line
    for (let y = fy0; y <= fy1; y++) if (fx0 <= fx1) fillSpan(b, fx0, fx1, y, colour)
  }
  if (style === 'fill') return
  for (let y = r.y0; y <= r.y1; y++) {
    if (y < r.y0 + w || y > r.y1 - w) fillSpan(b, r.x0, r.x1, y, line)
    else {
      fillSpan(b, r.x0, Math.min(r.x1, r.x0 + w - 1), y, line)
      fillSpan(b, Math.max(r.x0, r.x1 - w + 1), r.x1, y, line)
    }
  }
}

/** The x range of row y inside the ellipse inscribed in the box, by pixel centres, or null. */
function ellipseRow(r: Box, y: number, inset: number): [number, number] | null {
  const rx = (r.x1 - r.x0 + 1) / 2 - inset
  const ry = (r.y1 - r.y0 + 1) / 2 - inset
  if (rx <= 0 || ry <= 0) return null
  const cx = (r.x0 + r.x1 + 1) / 2
  const cy = (r.y0 + r.y1 + 1) / 2
  const t = (y + 0.5 - cy) / ry
  if (t * t > 1) return null
  const half = rx * Math.sqrt(1 - t * t)
  const from = Math.ceil(cx - half - 0.5)
  const to = Math.floor(cx + half - 0.5)
  return from <= to ? [from, to] : null
}

/** An ellipse inscribed in the box with corners a and c. */
export function drawEllipse(b: PixelBuffer, a: Point, c: Point, style: FillStyle, width: number, line: Rgba, fill: Rgba): void {
  const r = box(a, c)
  const w = Math.max(1, Math.round(width))
  for (let y = r.y0; y <= r.y1; y++) {
    const outer = ellipseRow(r, y, 0)
    if (!outer) continue
    const inner = ellipseRow(r, y, w)
    if (style === 'fill') { fillSpan(b, outer[0], outer[1], y, line); continue }
    if (style === 'both' && inner) fillSpan(b, inner[0], inner[1], y, fill)
    if (!inner) { fillSpan(b, outer[0], outer[1], y, line); continue }
    fillSpan(b, outer[0], inner[0] - 1, y, line)
    fillSpan(b, inner[1] + 1, outer[1], y, line)
  }
  // Rows where the ring is thin can leave a column without a pixel near the sides: join neighbouring rows.
  if (style !== 'fill') closeEllipseGaps(b, r, w, line)
}

function closeEllipseGaps(b: PixelBuffer, r: Box, w: number, line: Rgba): void {
  let prev: [number, number] | null = null
  for (let y = r.y0; y <= r.y1; y++) {
    const outer = ellipseRow(r, y, 0)
    if (!outer) { prev = null; continue }
    if (prev) {
      // Left edge: if this row starts more than one pixel away from the last, bridge with a span.
      if (outer[0] < prev[0] - 1) fillSpan(b, outer[0], prev[0] - 1, y, line)
      if (prev[0] < outer[0] - 1) fillSpan(b, prev[0], outer[0] - 1, y - 1, line)
      if (outer[1] > prev[1] + 1) fillSpan(b, prev[1] + 1, outer[1], y, line)
      if (prev[1] > outer[1] + 1) fillSpan(b, outer[1] + 1, prev[1], y - 1, line)
    }
    prev = outer
    void w
  }
}

/** Fills the 4-connected area of the colour at the start with `c`. Returns false if nothing changed. */
export function floodFill(b: PixelBuffer, start: Point, c: Rgba): boolean {
  const x = Math.floor(start.x)
  const y = Math.floor(start.y)
  const target = getPixel(b, x, y)
  if (!target || sameColor(target, c)) return false
  const w = b.width
  const d = b.data
  const matches = (px: number, py: number): boolean => {
    const i = (py * w + px) * 4
    return d[i] === target.r && d[i + 1] === target.g && d[i + 2] === target.b && d[i + 3] === target.a
  }
  const stack: number[] = [x, y]
  while (stack.length > 0) {
    const py = stack.pop()!
    let px = stack.pop()!
    while (px > 0 && matches(px - 1, py)) px--
    let above = false
    let below = false
    for (; px < w && matches(px, py); px++) {
      setPixel(b, px, py, c)
      if (py > 0) {
        const m = matches(px, py - 1)
        if (m && !above) stack.push(px, py - 1)
        above = m
      }
      if (py < b.height - 1) {
        const m = matches(px, py + 1)
        if (m && !below) stack.push(px, py + 1)
        below = m
      }
    }
  }
  return true
}

/** Airbrush: `count` dots spread uniformly over a disc of the given diameter. */
export function spray(b: PixelBuffer, at: Point, diameter: number, c: Rgba, random: () => number, count = Math.max(4, Math.round(diameter * 0.8))): void {
  const radius = diameter / 2
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(random())
    const t = random() * Math.PI * 2
    setPixel(b, Math.round(at.x + r * Math.cos(t)), Math.round(at.y + r * Math.sin(t)), c)
  }
}

/** A one-bit mask (text) drawn at x, y in colour c. */
export interface Mask {
  width: number
  height: number
  /** 1 where the colour goes, row by row. */
  bits: Uint8Array
}

export function drawMask(b: PixelBuffer, mask: Mask, x: number, y: number, c: Rgba): boolean {
  let any = false
  for (let my = 0; my < mask.height; my++) {
    for (let mx = 0; mx < mask.width; mx++) {
      if (mask.bits[my * mask.width + mx]) {
        setPixel(b, x + mx, y + my, c)
        any = true
      }
    }
  }
  return any
}
