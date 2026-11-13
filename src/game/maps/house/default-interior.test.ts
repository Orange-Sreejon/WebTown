import { describe, expect, it } from 'vitest'
import { TILE_SIZE } from '../../config/GameConfig'
import { getInteriorCollisionRects, spriteSize } from '../interior-layout'
import {
  DEFAULT_INTERIOR,
  DEFAULT_TEMPLATE,
  createDefaultLayout,
  getTemplate,
} from './default-interior'
import { getFurnitureType } from './furniture-catalog'
import { cloneLayout } from './house-layout'
import { LEGACY_DEFAULT_ROOM } from './legacy-default-room.fixture'
import { itemAnchor, resolveInterior, solidRect } from './resolve-interior'

describe('default interior is pixel-identical to the original hand-placed room', () => {
  it('resolves to exactly the original definition, piece by piece and in draw order', () => {
    expect(DEFAULT_INTERIOR).toEqual(LEGACY_DEFAULT_ROOM)
    expect(DEFAULT_INTERIOR.pieces.map(p => p.id)).toEqual(LEGACY_DEFAULT_ROOM.pieces.map(p => p.id))
  })

  it('reproduces every sprite position, depth override and role', () => {
    for (const [i, legacy] of LEGACY_DEFAULT_ROOM.pieces.entries()) {
      const piece = DEFAULT_INTERIOR.pieces[i]!
      expect(piece.x, `${legacy.id} x`).toBe(legacy.x)
      expect(piece.bottom, `${legacy.id} bottom`).toBe(legacy.bottom)
      expect(piece.layer, `${legacy.id} layer`).toBe(legacy.layer)
      expect(piece.sortBottom, `${legacy.id} sortBottom`).toBe(legacy.sortBottom)
      expect(piece.role, `${legacy.id} role`).toBe(legacy.role)
      expect(piece.sprite, `${legacy.id} sprite`).toEqual(legacy.sprite)
    }
  })

  it('reproduces every collision rectangle, including the wall', () => {
    expect(getInteriorCollisionRects(DEFAULT_INTERIOR)).toEqual(
      getInteriorCollisionRects(LEGACY_DEFAULT_ROOM),
    )
  })
})

describe('default layout data', () => {
  const layout = createDefaultLayout('house-x')

  it('belongs to the house it was made for and to the default template', () => {
    expect(layout.houseId).toBe('house-x')
    expect(layout.templateId).toBe(DEFAULT_TEMPLATE.id)
    expect(getTemplate(layout.templateId)).toBe(DEFAULT_TEMPLATE)
    expect(getTemplate('nope')).toBeUndefined()
  })

  it('uses unique ids and only known furniture types', () => {
    const ids = layout.items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of layout.items) expect(getFurnitureType(item.type), item.id).toBeDefined()
  })

  it('keeps nudges smaller than a grid cell, so the grid cell is the true location', () => {
    for (const item of layout.items) {
      if (item.at.kind !== 'grid' || !item.at.nudge) continue
      expect(item.at.nudge.x, item.id).toBeGreaterThanOrEqual(0)
      expect(item.at.nudge.x, item.id).toBeLessThan(TILE_SIZE)
      expect(item.at.nudge.y, item.id).toBeGreaterThanOrEqual(0)
      expect(item.at.nudge.y, item.id).toBeLessThan(TILE_SIZE)
    }
  })

  it('lists every support before the items resting on it', () => {
    const seen = new Set<string>()
    for (const item of layout.items) {
      if (item.at.kind === 'attached') expect(seen.has(item.at.to), item.id).toBe(true)
      seen.add(item.id)
    }
  })

  it('rests the notebook on the table and the lamp on the nightstand', () => {
    const at = (id: string): unknown => layout.items.find(i => i.id === id)!.at
    expect(at('notebook')).toMatchObject({ kind: 'attached', to: 'table' })
    expect(at('books')).toMatchObject({ kind: 'attached', to: 'table' })
    expect(at('lamp')).toMatchObject({ kind: 'attached', to: 'nightstand' })
  })
})

describe('layout copies are independent', () => {
  it('gives each call to createDefaultLayout its own objects', () => {
    const a = createDefaultLayout('a')
    const b = createDefaultLayout('b')
    expect(a.items).toEqual(b.items)

    a.items[0]!.id = 'changed'
    const bed = a.items.find(i => i.id === 'bed')!
    if (bed.at.kind === 'grid') {
      bed.at.col = 9
      if (bed.at.nudge) bed.at.nudge.x = 99
    }
    a.items.pop()

    expect(b.items[0]!.id).toBe('window-blue')
    expect(b.items).toHaveLength(createDefaultLayout('c').items.length)
    expect(b.items).toEqual(createDefaultLayout('b').items)
  })

  it('cloneLayout deep-copies, including nudges and attachments', () => {
    const original = createDefaultLayout('a')
    const copy = cloneLayout(original)
    expect(copy).toEqual(original)
    expect(copy).not.toBe(original)

    for (let i = 0; i < original.items.length; i++) {
      expect(copy.items[i]).not.toBe(original.items[i])
      expect(copy.items[i]!.at).not.toBe(original.items[i]!.at)
    }
    const bed = copy.items.find(i => i.id === 'bed')!
    if (bed.at.kind === 'grid' && bed.at.nudge) bed.at.nudge.x = 77
    const originalBed = original.items.find(i => i.id === 'bed')!
    expect(originalBed.at.kind === 'grid' && originalBed.at.nudge?.x).toBe(12)
  })
})

describe('resolveInterior', () => {
  it('moves a supported item with its support', () => {
    const layout = createDefaultLayout('a')
    const before = resolveInterior(DEFAULT_TEMPLATE, layout)
    const table = layout.items.find(i => i.id === 'table')!
    if (table.at.kind === 'grid') table.at.col += 1
    const after = resolveInterior(DEFAULT_TEMPLATE, layout)

    for (const id of ['table', 'notebook', 'books']) {
      const a = before.pieces.find(p => p.id === id)!
      const b = after.pieces.find(p => p.id === id)!
      expect(b.x - a.x, id).toBe(TILE_SIZE)
      expect(b.bottom - a.bottom, id).toBe(0)
    }
  })

  it('rejects unknown furniture types, unknown supports and attachment loops', () => {
    const unknownType = createDefaultLayout('a')
    unknownType.items[0]!.type = 'no-such-thing'
    expect(() => resolveInterior(DEFAULT_TEMPLATE, unknownType)).toThrow(/unknown furniture type/)

    const noSupport = createDefaultLayout('a')
    noSupport.items.find(i => i.id === 'notebook')!.at = {
      kind: 'attached', to: 'ghost', dx: 0, dy: 0,
    }
    expect(() => resolveInterior(DEFAULT_TEMPLATE, noSupport)).toThrow(/unknown item "ghost"/)

    const loop = createDefaultLayout('a')
    loop.items.find(i => i.id === 'table')!.at = { kind: 'attached', to: 'notebook', dx: 0, dy: 0 }
    const notebook = loop.items.find(i => i.id === 'notebook')!
    expect(() => itemAnchor(loop, notebook)).toThrow(/loop/)
  })

  it('closes a sliver behind furniture near the wall, but not a real gap', () => {
    const bed = getFurnitureType('bed-blue')!
    const wall = DEFAULT_TEMPLATE.wallHeightPx
    const size = spriteSize(bed.sprite)!
    // Top of the solid is 11px under the wall: wedge-sized, so it is filled up.
    expect(solidRect(bed, { x: 0, y: wall + size.h + 11 }, wall)).toMatchObject({ y: wall })
    // Top is 40px under the wall: a real gap, left alone.
    expect(solidRect(bed, { x: 0, y: wall + size.h + 40 }, wall)).toMatchObject({ y: wall + 40 })
    // Touching the wall already.
    expect(solidRect(bed, { x: 0, y: wall + size.h }, wall)).toMatchObject({ y: wall })
  })
})
