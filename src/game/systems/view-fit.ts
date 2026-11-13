import type { Rect } from '../../lib/geometry'

export interface ZoomFit {
  /** Whole-number camera zoom, never below 1. */
  zoom: number
  /** True when the whole view rectangle (plus margin) fits at that zoom. */
  fits: boolean
}

/**
 * Largest whole-number zoom at which `view` plus `marginPx` fits inside the
 * canvas. Only integers are used so 16px pixel art stays crisp.
 *
 * `canvasW`/`canvasH` are the real Phaser canvas size in screen pixels.
 * `marginPx` is in world pixels (view units), so the slack on screen is
 * `marginPx * zoom`. If even zoom 1 does not fit, `fits` is false and the
 * caller should follow the player instead of centring the room.
 */
export function chooseIntegerZoom(
  canvasW: number,
  canvasH: number,
  view: Pick<Rect, 'w' | 'h'>,
  marginPx: number,
): ZoomFit {
  const zoom = Math.max(
    1,
    Math.floor(Math.min(canvasW / (view.w + marginPx), canvasH / (view.h + marginPx))),
  )
  const fits = view.w * zoom <= canvasW && view.h * zoom <= canvasH
  return { zoom, fits }
}

/** Fraction of the canvas width the view occupies at a given zoom. */
export function widthFraction(canvasW: number, view: Pick<Rect, 'w'>, zoom: number): number {
  return (view.w * zoom) / canvasW
}
