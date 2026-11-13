import { describe, expect, it } from 'vitest'
import { INTERIOR_BORDER_PX, INTERIOR_VIEW_MARGIN_PX } from '../config/GameConfig'
import { COZY_ROOM } from '../maps/interior-layout'
import { chooseIntegerZoom, widthFraction } from './view-fit'

const view = {
  w: COZY_ROOM.widthPx + INTERIOR_BORDER_PX * 2,
  h: COZY_ROOM.heightPx + INTERIOR_BORDER_PX,
}
const fit = (w: number, h: number) => chooseIntegerZoom(w, h, view, INTERIOR_VIEW_MARGIN_PX)

describe('chooseIntegerZoom', () => {
  it('frames the room at 280x236', () => {
    expect(view).toEqual({ w: 280, h: 236 })
  })

  it('uses zoom 3 on a 1280x720 canvas and fills about 66% of the width', () => {
    const { zoom, fits } = fit(1280, 720)
    expect(zoom).toBe(3)
    expect(fits).toBe(true)
    expect(view.w * zoom).toBe(840)
    expect(view.h * zoom).toBe(708)
    expect(widthFraction(1280, view, zoom)).toBeGreaterThan(0.65)
    expect(widthFraction(1280, view, zoom)).toBeLessThan(0.75)
  })

  it('uses zoom 4 on a 1920x1080 canvas', () => {
    const { zoom, fits } = fit(1920, 1080)
    expect(zoom).toBe(4)
    expect(fits).toBe(true)
    expect(view.h * zoom).toBeLessThanOrEqual(1080)
  })

  it('falls back to zoom 2 rather than clipping when the canvas is a little short', () => {
    // A real browser window is shorter than the screen (tabs, toolbars).
    expect(fit(1280, 650)).toEqual({ zoom: 2, fits: true })
    expect(fit(1920, 940)).toEqual({ zoom: 3, fits: true })
  })

  it('never returns a fractional or sub-1 zoom, and flags a canvas too small even at 1x', () => {
    for (const [w, h] of [[1280, 720], [1366, 657], [1000, 500], [300, 200]] as const) {
      const { zoom } = fit(w, h)
      expect(Number.isInteger(zoom)).toBe(true)
      expect(zoom).toBeGreaterThanOrEqual(1)
    }
    expect(fit(300, 200).fits).toBe(false)
  })

  it('always fits when it reports fits', () => {
    for (let h = 240; h <= 1400; h += 37) {
      const { zoom, fits } = fit(1280, h)
      if (fits) expect(view.h * zoom).toBeLessThanOrEqual(h)
    }
  })
})
