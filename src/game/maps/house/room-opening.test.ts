import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import type { HouseLayout } from './house-layout'
import { resolveInterior } from './resolve-interior'
import { validateLayout } from './layout-rules'
import { openRoom } from './room-opening'

const legal = (houseId = 'house-a'): HouseLayout => createDefaultLayout(houseId)

/** The default room minus the sketchbook: a real thing an owner can do to a layout. */
function withoutNotebook(houseId = 'house-a'): HouseLayout {
  const layout = legal(houseId)
  layout.items = layout.items.filter(item => item.id !== 'notebook')
  return layout
}

describe('openRoom', () => {
  it('opens the house layout when it is legal', () => {
    const opening = openRoom('house-a', 'cozy-room', legal())
    if (!opening.ok) throw new Error('expected the room to open')
    expect(opening.restored).toBe(false)
    expect(opening.violations).toEqual([])
    expect(opening.layout).toEqual(legal())
    expect(opening.definition.pieces.length).toBeGreaterThan(15)
  })

  it('opens the standard room when no layout could be loaded', () => {
    const opening = openRoom('house-b', 'cozy-room', undefined)
    if (!opening.ok) throw new Error('expected the room to open')
    expect(opening.restored).toBe(true)
    expect(opening.layout).toEqual(legal('house-b'))
    expect(opening.definition).toEqual(resolveInterior(DEFAULT_TEMPLATE, legal('house-b')))
  })

  it('opens the standard room when the layout breaks a rule, and says which', () => {
    const opening = openRoom('house-c', 'cozy-room', withoutNotebook('house-c'))
    if (!opening.ok) throw new Error('expected the room to open')
    expect(opening.restored).toBe(true)
    expect(opening.layout).toEqual(legal('house-c'))
    expect(opening.violations.map(v => v.code)).toContain('missing-mandatory')
    expect(opening.definition.pieces.some(piece => piece.role === 'notebook')).toBe(true)
  })

  it('does not draw a restored room in place of a legal one', () => {
    const opening = openRoom('house-d', 'cozy-room', legal('house-d'))
    if (!opening.ok) throw new Error('expected the room to open')
    expect(opening.layout.items).toEqual(legal('house-d').items)
    expect(opening.violations).toEqual([])
  })

  it('knows when the store already had to fall back, even for a legal layout', () => {
    const opening = openRoom('house-e', 'cozy-room', legal('house-e'), true)
    if (!opening.ok) throw new Error('expected the room to open')
    expect(opening.restored).toBe(true)
    expect(opening.violations).toEqual([])
  })

  it('refuses only an unknown template, because there is no room to draw', () => {
    expect(openRoom('house-a', 'mansion', legal())).toEqual({ ok: false, reason: 'unknown-template' })
  })

  it('never hands back a room that would bounce on the next visit', () => {
    const opening = openRoom('house-f', 'cozy-room', withoutNotebook('house-f'))
    if (!opening.ok) throw new Error('expected the room to open')
    expect(validateLayout(DEFAULT_TEMPLATE, opening.layout)).toEqual([])
  })
})
