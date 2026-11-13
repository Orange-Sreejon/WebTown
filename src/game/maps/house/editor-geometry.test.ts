import { describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../../config/GameConfig'
import { pieceBounds, type InteriorPiece } from '../interior-layout'
import { DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import {
  SURFACE_STEP_PX,
  centreGrab,
  grabOffset,
  hitTest,
  movingGroup,
  sameTarget,
  snapGrid,
  snapOnSupport,
  targetFor,
} from './editor-geometry'
import { resolveInterior } from './resolve-interior'

const layout = createDefaultLayout('house-a')
const def = resolveInterior(DEFAULT_TEMPLATE, layout)
const piece = (id: string): InteriorPiece => def.pieces.find(p => p.id === id)!
const centre = (id: string): { x: number; y: number } => {
  const b = pieceBounds(piece(id))
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

describe('snapGrid', () => {
  it('rounds an anchor to the nearest 16px grid line', () => {
    expect(snapGrid({ x: 0, y: 0 })).toEqual({ kind: 'grid', col: 0, row: 0 })
    expect(snapGrid({ x: 7.9, y: 8 })).toEqual({ kind: 'grid', col: 0, row: 1 })
    expect(snapGrid({ x: 8, y: 23.9 })).toEqual({ kind: 'grid', col: 1, row: 1 })
    expect(snapGrid({ x: 5 * TILE_SIZE + 3, y: 13 * TILE_SIZE - 5 })).toEqual({
      kind: 'grid', col: 5, row: 13,
    })
  })

  it('gives cells outside the room too, so the rules can say why they do not fit', () => {
    expect(snapGrid({ x: -40, y: 900 })).toEqual({ kind: 'grid', col: -2, row: 56 })
  })

  it('never produces negative zero', () => {
    const target = snapGrid({ x: -3, y: -2 })
    expect(Object.is(target.kind === 'grid' && target.col, 0)).toBe(true)
    expect(Object.is(target.kind === 'grid' && target.row, 0)).toBe(true)
  })
})

describe('grab offsets', () => {
  it('keeps the grabbed point under the pointer, so a drag starts without a jump', () => {
    const chest = piece('chest')
    const grab = grabOffset({ x: chest.x + 5, y: chest.bottom - 3 }, chest)
    expect(grab).toEqual({ x: 5, y: -3 })
    const target = targetFor('chest', { x: chest.x + 5, y: chest.bottom - 3 }, grab, def, layout)
    // The nudged chest snaps to its own cell when picked up and put straight back.
    expect(target).toEqual(snapGrid({ x: chest.x, y: chest.bottom }))
  })

  it('holds a new catalogue item by its centre', () => {
    // The stool is 14 x 19.
    expect(centreGrab('stool')).toEqual({ x: 7, y: -10 })
    expect(centreGrab('no-such-type')).toEqual({ x: 0, y: 0 })
  })
})

describe('snapOnSupport', () => {
  const table = piece('table')
  const top = pieceBounds(table)
  const notebookSize = { w: 26, h: 17 }

  it('snaps a resting item to a 4px step on its support', () => {
    const target = snapOnSupport({ x: table.x + 21, y: table.bottom - 19 }, notebookSize, table)
    expect(target).toEqual({ kind: 'attached', to: 'table', dx: 20, dy: -20 })
    if (target?.kind === 'attached') {
      expect(Math.abs(target.dx % SURFACE_STEP_PX)).toBe(0)
      expect(Math.abs(target.dy % SURFACE_STEP_PX)).toBe(0)
    }
  })

  it('keeps the item on the support near its edge', () => {
    const target = snapOnSupport({ x: top.x + top.w - 14, y: table.bottom - 2 }, notebookSize, table)
    expect(target?.kind).toBe('attached')
    if (target?.kind === 'attached') {
      expect(target.dx + notebookSize.w).toBeLessThanOrEqual(top.w)
      expect(target.dy).toBeLessThanOrEqual(0)
    }
  })

  it('returns null when the base is not over the support', () => {
    expect(snapOnSupport({ x: top.x - 40, y: table.bottom - 10 }, notebookSize, table)).toBeNull()
    expect(snapOnSupport({ x: table.x + 10, y: table.bottom + 20 }, notebookSize, table)).toBeNull()
  })
})

describe('targetFor', () => {
  it('puts floor and wall items on the grid', () => {
    expect(targetFor('chest', { x: 100, y: 200 }, { x: 0, y: 0 }, def, layout)).toEqual({
      kind: 'grid', col: 6, row: 13,
    })
    expect(targetFor('clock', { x: 40, y: 30 }, { x: 0, y: 0 }, def, layout)?.kind).toBe('grid')
  })

  it('puts a resting item on the support under the pointer, or nowhere', () => {
    const grab = centreGrab('notebook')
    expect(targetFor('notebook', centre('nightstand'), grab, def, layout)).toMatchObject({
      kind: 'attached', to: 'nightstand',
    })
    expect(targetFor('notebook', centre('table'), grab, def, layout)).toMatchObject({
      kind: 'attached', to: 'table',
    })
    // Over open floor, and over a chest, which cannot hold things.
    expect(targetFor('notebook', { x: 120, y: 120 }, grab, def, layout)).toBeNull()
    expect(targetFor('notebook', centre('chest'), grab, def, layout)).toBeNull()
  })

  it('never rests an item on itself or on what rests on it', () => {
    const grab = centreGrab('book-stack')
    const exclude = movingGroup(layout, 'table')
    expect(targetFor('book-stack', centre('table'), grab, def, layout, exclude)).toBeNull()
  })

  it('returns null for an unknown type', () => {
    expect(targetFor('teleporter', { x: 1, y: 1 }, { x: 0, y: 0 }, def, layout)).toBeNull()
  })
})

describe('hitTest', () => {
  it('selects the piece under the point', () => {
    expect(hitTest(def, centre('chest'))?.id).toBe('chest')
    expect(hitTest(def, centre('bed'))?.id).toBe('bed')
  })

  it('selects the piece drawn on top where pieces overlap', () => {
    // The notebook and the books sit on the table; the lamp on the nightstand.
    expect(hitTest(def, centre('notebook'))?.id).toBe('notebook')
    expect(hitTest(def, centre('books'))?.id).toBe('books')
    expect(hitTest(def, centre('lamp'))?.id).toBe('lamp')
    // The rug lies under the table's corner and loses to it.
    const table = pieceBounds(piece('table'))
    expect(hitTest(def, { x: table.x + 2, y: table.y + table.h - 2 })?.id).toBe('table')
  })

  it('selects the rug on bare rug, and nothing on bare floor', () => {
    expect(hitTest(def, { x: 100, y: 160 })?.id).toBe('rug')
    expect(hitTest(def, { x: 90, y: 110 })).toBeNull()
  })

  it('never selects the door', () => {
    expect(hitTest(def, centre('door'))).toBeNull()
  })
})

describe('movingGroup', () => {
  it('includes everything resting on an item', () => {
    expect([...movingGroup(layout, 'table')].sort()).toEqual(['books', 'notebook', 'table'])
    expect([...movingGroup(layout, 'nightstand')].sort()).toEqual(['lamp', 'nightstand'])
    expect([...movingGroup(layout, 'chest')]).toEqual(['chest'])
  })
})

describe('sameTarget', () => {
  it('compares placements by value', () => {
    expect(sameTarget({ kind: 'grid', col: 1, row: 2 }, { kind: 'grid', col: 1, row: 2 })).toBe(true)
    expect(sameTarget({ kind: 'grid', col: 1, row: 2 }, { kind: 'grid', col: 2, row: 2 })).toBe(false)
    expect(sameTarget(
      { kind: 'attached', to: 'table', dx: 4, dy: -8 },
      { kind: 'attached', to: 'table', dx: 4, dy: -8 },
    )).toBe(true)
    expect(sameTarget({ kind: 'grid', col: 1, row: 2 }, null)).toBe(false)
    expect(sameTarget(null, null)).toBe(true)
  })
})
