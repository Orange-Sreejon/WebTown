/** The on-screen box of the canvas element, as from `getBoundingClientRect()`. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The image pixel under a pointer. Reads the canvas's box as it is now, so zoom,
 * window size, scrolling and device pixel ratio never skew it. Not clamped:
 * a line or shape may run off the canvas and is clipped when drawn.
 */
export function clientToPixel(clientX: number, clientY: number, rect: ScreenRect, width: number, height: number): { x: number; y: number; inside: boolean } {
  const x = Math.floor(((clientX - rect.left) * width) / (rect.width || 1))
  const y = Math.floor(((clientY - rect.top) * height) / (rect.height || 1))
  return { x, y, inside: x >= 0 && y >= 0 && x < width && y < height }
}
