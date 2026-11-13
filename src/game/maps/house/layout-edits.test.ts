import { describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../../config/GameConfig'
import { DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import type { HouseLayout } from './house-layout'
import { addItem, itemsResting, moveItem, nextItemId, removeItem, type EditResult } from './layout-edits'
import { validateLayout } from './layout-rules'
import { resolveInterior } from './resolve-interior'

const T = DEFAULT_TEMPLATE
const fresh = (id = 'house-a'): HouseLayout => createDefaultLayout(id)

function layoutOf(result: EditResult): HouseLayout {
  if (!result.ok) throw new Error(`edit refused: ${result.violations.map(x => x.message).join('; ')}`)
  return result.layout
}
function violationsOf(result: EditResult): string[] {
  if (result.ok) throw new Error('edit unexpectedly succeeded')
  return result.violations.map(x => x.code)
}
const piece = (layout: HouseLayout, id: string) =>
  resolveInterior(T, layout).pieces.find(p => p.id === id)!

describe('moveItem', () => {
  it('moves an item to the grid cell and snaps it, dropping the default room nudge', () => {
    const before = fresh()
    const bedBefore = before.items.find(i => i.id === 'bed')!.at
    expect(bedBefore).toMatchObject({ kind: 'grid', nudge: { x: 12, y: 12 } })

    // Chest from the foot of the bed to an open patch of floor on the rug.
    const after = layoutOf(moveItem(T, before, 'chest', { kind: 'grid', col: 5, row: 13 }))
    const chest = after.items.find(i => i.id === 'chest')!
    expect(chest.at).toEqual({ kind: 'grid', col: 5, row: 13 })
    expect(piece(after, 'chest').x).toBe(5 * TILE_SIZE)
    expect(piece(after, 'chest').bottom).toBe(13 * TILE_SIZE)
  })

  it('leaves untouched items on their original nudged pixels', () => {
    const after = layoutOf(moveItem(T, fresh(), 'chest', { kind: 'grid', col: 5, row: 13 }))
    const base = resolveInterior(T, fresh())
    for (const id of ['bed', 'table', 'bookshelf', 'computer-desk']) {
      expect(piece(after, id), id).toEqual(base.pieces.find(p => p.id === id))
    }
  })

  it('never mutates the layout it was given', () => {
    const original = fresh()
    const snapshot = JSON.stringify(original)
    moveItem(T, original, 'chest', { kind: 'grid', col: 5, row: 13 })
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('carries what rests on a table when the table moves', () => {
    const before = fresh()
    const after = layoutOf(moveItem(T, before, 'table', { kind: 'grid', col: 5, row: 11 }))
    const dx = piece(after, 'table').x - piece(before, 'table').x
    const dy = piece(after, 'table').bottom - piece(before, 'table').bottom
    expect(dx).not.toBe(0)
    for (const id of ['notebook', 'books']) {
      expect(piece(after, id).x - piece(before, id).x, id).toBe(dx)
      expect(piece(after, id).bottom - piece(before, id).bottom, id).toBe(dy)
    }
  })

  it('refuses a move that would break a rule, and says why', () => {
    const original = fresh()
    const result = moveItem(T, original, 'chest', { kind: 'grid', col: 0, row: 7 })
    expect(violationsOf(result)).toContain('overlap')
    expect(validateLayout(T, original)).toEqual([])
  })

  it('refuses to put the notebook anywhere that is not a support', () => {
    const result = moveItem(T, fresh(), 'notebook', { kind: 'grid', col: 3, row: 9 })
    expect(violationsOf(result)).toContain('bad-placement')
  })

  it('lets the notebook move from one support to another', () => {
    const moved = layoutOf(moveItem(T, fresh(), 'notebook', {
      kind: 'attached', to: 'nightstand', dx: 0, dy: -10,
    }))
    expect(moved.items.find(i => i.id === 'notebook')!.at).toMatchObject({ to: 'nightstand' })
    expect(itemsResting(moved, 'table').map(i => i.id)).toEqual(['books'])
  })

  it('reports an unknown item', () => {
    expect(violationsOf(moveItem(T, fresh(), 'ghost', { kind: 'grid', col: 1, row: 1 })))
      .toEqual(['bad-placement'])
  })
})

describe('removeItem', () => {
  it('removes ordinary furniture', () => {
    const after = layoutOf(removeItem(T, fresh(), 'chest'))
    expect(after.items.some(i => i.id === 'chest')).toBe(false)
    expect(after.items).toHaveLength(fresh().items.length - 1)
  })

  it('never removes the computer or the notebook', () => {
    expect(violationsOf(removeItem(T, fresh(), 'computer-desk'))).toEqual(['missing-mandatory'])
    expect(violationsOf(removeItem(T, fresh(), 'notebook'))).toEqual(['missing-mandatory'])
  })

  it('blocks removing a table until its contents are relocated', () => {
    const blocked = removeItem(T, fresh(), 'table')
    expect(violationsOf(blocked)).toEqual(['bad-support'])
    if (!blocked.ok) expect(blocked.violations[0]!.message).toMatch(/Notebook.*Books|Books.*Notebook/)

    // Move the notebook and then the books to the nightstand; the table is then free to go.
    let layout = layoutOf(moveItem(T, fresh(), 'notebook', {
      kind: 'attached', to: 'nightstand', dx: 0, dy: -10,
    }))
    expect(violationsOf(removeItem(T, layout, 'table'))).toEqual(['bad-support'])
    layout = layoutOf(moveItem(T, layout, 'books', {
      kind: 'attached', to: 'nightstand', dx: 4, dy: -8,
    }))
    const removed = layoutOf(removeItem(T, layout, 'table'))
    expect(removed.items.some(i => i.id === 'table')).toBe(false)
    expect(removed.items.find(i => i.id === 'notebook')).toBeDefined()
  })

  it('removes something resting on furniture without touching the furniture', () => {
    const after = layoutOf(removeItem(T, fresh(), 'lamp'))
    expect(after.items.some(i => i.id === 'nightstand')).toBe(true)
  })

  it('never mutates its input', () => {
    const original = fresh()
    const snapshot = JSON.stringify(original)
    removeItem(T, original, 'chest')
    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('addItem', () => {
  it('adds furniture from the catalogue at a grid cell', () => {
    const id = nextItemId(fresh(), 'stool')
    const after = layoutOf(addItem(T, fresh(), id, 'stool', { kind: 'grid', col: 6, row: 13 }))
    expect(after.items[after.items.length - 1]).toMatchObject({ id: 'stool', type: 'stool' })
    expect(piece(after, 'stool').x).toBe(6 * TILE_SIZE)
  })

  it('numbers repeated ids', () => {
    let layout = fresh()
    expect(nextItemId(layout, 'barrel')).toBe('barrel')
    layout = layoutOf(addItem(T, layout, 'barrel', 'barrel', { kind: 'grid', col: 6, row: 13 }))
    expect(nextItemId(layout, 'barrel')).toBe('barrel-2')
    layout = layoutOf(addItem(T, layout, 'barrel-2', 'barrel', { kind: 'grid', col: 9, row: 13 }))
    expect(nextItemId(layout, 'barrel')).toBe('barrel-3')
  })

  it('rejects duplicate ids, unknown types, and a second computer', () => {
    expect(violationsOf(addItem(T, fresh(), 'bed', 'stool', { kind: 'grid', col: 6, row: 13 })))
      .toEqual(['duplicate-id'])
    expect(violationsOf(addItem(T, fresh(), 'x', 'jetpack', { kind: 'grid', col: 6, row: 13 })))
      .toEqual(['unknown-type'])
    expect(violationsOf(addItem(T, fresh(), 'pc-2', 'computer-desk', { kind: 'grid', col: 6, row: 13 })))
      .toContain('missing-mandatory')
  })

  it('rejects furniture placed where it collides', () => {
    expect(violationsOf(addItem(T, fresh(), 'stool', 'stool', { kind: 'grid', col: 2, row: 8 })))
      .toContain('overlap')
  })

  it('orders a new support before what is moved onto it', () => {
    let layout = layoutOf(addItem(T, fresh(), 'table-2', 'table', { kind: 'grid', col: 4, row: 14 }))
    layout = layoutOf(moveItem(T, layout, 'books', {
      kind: 'attached', to: 'table-2', dx: 6, dy: -22,
    }))
    const order = layout.items.map(i => i.id)
    expect(order.indexOf('table-2')).toBeLessThan(order.indexOf('books'))
  })
})

describe('houses are independent', () => {
  it('editing one house changes no other house, and not the template', () => {
    const a = fresh('house-a')
    const b = fresh('house-b')
    const c = fresh('house-c')

    const editedA = layoutOf(moveItem(T, a, 'chest', { kind: 'grid', col: 5, row: 13 }))
    const removedB = layoutOf(removeItem(T, b, 'plant-red'))

    expect(editedA.items.find(i => i.id === 'chest')!.at).toMatchObject({ col: 5, row: 13 })
    expect(removedB.items.some(i => i.id === 'plant-red')).toBe(false)

    // The originals, and a house nobody touched, still match the default exactly.
    expect(a.items).toEqual(fresh('x').items)
    expect(b.items).toEqual(fresh('x').items)
    expect(c.items).toEqual(fresh('x').items)
    expect(resolveInterior(T, c)).toEqual(resolveInterior(T, fresh('other')))
  })
})
