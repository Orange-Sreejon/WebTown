import { describe, expect, it } from 'vitest'
import { spriteSize } from '../interior-layout'
import { FURNITURE_CATALOG } from './furniture-catalog'

const ENTRIES = Object.entries(FURNITURE_CATALOG)

describe('furniture catalogue', () => {
  it('uses only sprites that exist', () => {
    for (const [id, type] of ENTRIES) expect(spriteSize(type.sprite), id).not.toBeNull()
  })

  it('matches layer to mount: wall items are decor, resting items sort, floor items never decor', () => {
    for (const [id, type] of ENTRIES) {
      if (type.mount === 'wall') expect(type.layer, id).toBe('decor')
      if (type.mount === 'surface') expect(type.layer, id).toBe('sorted')
      if (type.mount === 'floor') expect(type.layer, id).not.toBe('decor')
    }
  })

  it('keeps every collision footprint inside its own sprite', () => {
    for (const [id, type] of ENTRIES) {
      if (!type.solid) continue
      const size = spriteSize(type.sprite)!
      expect(type.solid.dx, `${id} dx`).toBeGreaterThanOrEqual(0)
      expect(type.solid.dx + type.solid.w, `${id} right`).toBeLessThanOrEqual(size.w)
      expect(type.solid.dy, `${id} dy`).toBeLessThan(0)
      expect(-type.solid.dy, `${id} height`).toBeLessThanOrEqual(size.h)
      expect(type.solid.dy + type.solid.h, `${id} bottom`).toBeLessThanOrEqual(0)
    }
  })

  it('makes only floor furniture solid; walkable and resting things never block', () => {
    for (const [id, type] of ENTRIES) {
      if (type.mount !== 'floor') expect(type.solid, id).toBeUndefined()
      if (type.layer === 'flat') expect(type.solid, id).toBeUndefined()
    }
  })

  it('makes the computer and the notebook mandatory: one type each, and not removable', () => {
    const computers = ENTRIES.filter(([, t]) => t.role === 'computer')
    const notebooks = ENTRIES.filter(([, t]) => t.role === 'notebook')
    expect(computers).toHaveLength(1)
    expect(notebooks).toHaveLength(1)
    expect(computers[0]![1].removable).toBe(false)
    expect(notebooks[0]![1].removable).toBe(false)
    for (const [id, type] of ENTRIES) {
      if (!type.role) expect(type.removable, id).toBe(true)
    }
  })

  it('keeps the notebook resting on a support, and the computer on the floor', () => {
    expect(FURNITURE_CATALOG['notebook']!.mount).toBe('surface')
    expect(FURNITURE_CATALOG['computer-desk']!.mount).toBe('floor')
  })

  it('offers surfaces to rest on, and only furniture that can support things does', () => {
    const supports = ENTRIES.filter(([, t]) => t.supports).map(([id]) => id)
    expect(supports).toEqual(expect.arrayContaining(['table', 'nightstand']))
    for (const [id] of ENTRIES.filter(([, t]) => t.supports)) {
      expect(FURNITURE_CATALOG[id]!.mount, id).toBe('floor')
    }
  })

  it('always allows the unrotated facing', () => {
    for (const [id, type] of ENTRIES) expect(type.rotations, id).toContain(0)
  })
})
