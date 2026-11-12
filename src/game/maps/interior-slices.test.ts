import { describe, expect, it } from 'vitest'
import {
  COMPUTERS,
  COMPUTERS_SIZE,
  FURNITURE,
  FURNITURE_SIZE,
  OFFICE_KIT,
  OFFICE_KIT_SIZE,
  type SheetSize,
  type SliceRect,
} from './interior-slices'

function expectInside(slices: Record<string, SliceRect>, sheet: SheetSize): void {
  for (const [name, r] of Object.entries(slices)) {
    expect(r.w, `${name} width`).toBeGreaterThan(0)
    expect(r.h, `${name} height`).toBeGreaterThan(0)
    expect(r.x, `${name} x`).toBeGreaterThanOrEqual(0)
    expect(r.y, `${name} y`).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w, `${name} right edge`).toBeLessThanOrEqual(sheet.w)
    expect(r.y + r.h, `${name} bottom edge`).toBeLessThanOrEqual(sheet.h)
  }
}

describe('interior slice tables', () => {
  it('keeps every office-kit slice inside work3.png', () => {
    expectInside(OFFICE_KIT, OFFICE_KIT_SIZE)
  })

  it('keeps every furniture slice inside work4.png', () => {
    expectInside(FURNITURE, FURNITURE_SIZE)
  })

  it('keeps every computer slice inside work.png', () => {
    expectInside(COMPUTERS, COMPUTERS_SIZE)
  })

  it('makes the wall tiles stack into one wall exactly as tall as the door', () => {
    expect(OFFICE_KIT.wallUpper.h + OFFICE_KIT.wallLower.h).toBe(OFFICE_KIT.door.h)
  })

  it('uses 16px-aligned tiles for the structural pieces', () => {
    const structural = [OFFICE_KIT.floor, OFFICE_KIT.wallUpper, OFFICE_KIT.wallLower, OFFICE_KIT.door]
    for (const tile of structural) {
      expect(tile.x % 16).toBe(0)
      expect(tile.y % 16).toBe(0)
      expect(tile.w % 16).toBe(0)
      expect(tile.h % 16).toBe(0)
    }
  })
})
