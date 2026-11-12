/** Tiny shared geometry helpers. Pure, no Phaser. */

export interface Point {
  x: number
  y: number
}

/** Axis-aligned rectangle, top-left origin. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** True when the point lies inside the rectangle (left/top inclusive, right/bottom exclusive). */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.w &&
    point.y < rect.y + rect.h
  )
}

/**
 * True when two rectangles overlap by more than `tolerance` pixels on both axes.
 * Rectangles that merely touch do not overlap, and `tolerance` absorbs the
 * sub-pixel rounding left behind by physics separation.
 */
export function rectsOverlap(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    a.x + a.w - b.x > tolerance &&
    b.x + b.w - a.x > tolerance &&
    a.y + a.h - b.y > tolerance &&
    b.y + b.h - a.y > tolerance
  )
}

/** True when `inner` lies entirely inside `outer` (touching edges allowed). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}
