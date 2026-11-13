import { describe, expect, it } from 'vitest'
import { getInteriorCollisionRects } from '../interior-layout'
import { DEFAULT_INTERIOR, DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import type { GridPlacement, HouseLayout, PlacedItem } from './house-layout'
import { isLayoutValid, reachableFeet, validateLayout, type ViolationCode } from './layout-rules'

const codes = (layout: HouseLayout): ViolationCode[] =>
  validateLayout(DEFAULT_TEMPLATE, layout).map(x => x.code)

function edited(change: (layout: HouseLayout) => void): HouseLayout {
  const layout = createDefaultLayout('test')
  change(layout)
  return layout
}

const item = (layout: HouseLayout, id: string): PlacedItem => layout.items.find(i => i.id === id)!
const grid = (layout: HouseLayout, id: string): GridPlacement => {
  const at = item(layout, id).at
  if (at.kind !== 'grid') throw new Error(`${id} is not on the grid`)
  return at
}
const put = (layout: HouseLayout, id: string, col: number, row: number): void => {
  item(layout, id).at = { kind: 'grid', col, row }
}

describe('the default layout', () => {
  it('breaks no rule', () => {
    expect(validateLayout(DEFAULT_TEMPLATE, createDefaultLayout('a'))).toEqual([])
    expect(isLayoutValid(DEFAULT_TEMPLATE, createDefaultLayout('a'))).toBe(true)
  })
})

describe('structural rules', () => {
  it('rejects an unknown furniture type', () => {
    expect(codes(edited(l => { item(l, 'chest').type = 'teleporter' }))).toEqual(['unknown-type'])
  })

  it('rejects duplicate ids', () => {
    expect(codes(edited(l => { item(l, 'chest').id = 'bed' }))).toContain('duplicate-id')
  })

  it('rejects a rotation the type does not allow', () => {
    expect(codes(edited(l => { item(l, 'chest').rotation = 90 }))).toEqual(['bad-rotation'])
  })

  it('keeps resting items on furniture and standing items on the floor', () => {
    expect(codes(edited(l => put(l, 'notebook', 3, 9)))).toContain('bad-placement')
    expect(codes(edited(l => {
      item(l, 'chest').at = { kind: 'attached', to: 'table', dx: 0, dy: -10 }
    }))).toContain('bad-placement')
  })

  it('requires a grid cell, not a fractional position', () => {
    expect(codes(edited(l => { grid(l, 'chest').col = 2.5 }))).toContain('not-on-grid')
  })

  it('only lets things rest on furniture that can hold them', () => {
    const onChest = edited(l => {
      item(l, 'notebook').at = { kind: 'attached', to: 'chest', dx: 0, dy: -5 }
    })
    expect(codes(onChest)).toContain('bad-support')

    const onMissing = edited(l => {
      item(l, 'notebook').at = { kind: 'attached', to: 'ghost', dx: 0, dy: 0 }
    })
    expect(codes(onMissing)).toContain('bad-support')
  })

  it('keeps a resting item on top of its support, not floating beside it', () => {
    const off = edited(l => {
      item(l, 'notebook').at = { kind: 'attached', to: 'table', dx: 70, dy: -20 }
    })
    expect(codes(off)).toEqual(['bad-support'])
  })
})

describe('room boundary rules', () => {
  it('keeps floor furniture inside the room, on the floor', () => {
    expect(codes(edited(l => put(l, 'chest', 30, 9)))).toContain('out-of-bounds')
    expect(codes(edited(l => put(l, 'chest', 0, 40)))).toContain('out-of-bounds')
    expect(codes(edited(l => put(l, 'bed', 0, 2)))).toContain('out-of-bounds')
  })

  it('keeps wall hangings on the back wall', () => {
    expect(codes(edited(l => put(l, 'painting', 9, 8)))).toContain('out-of-bounds')
    expect(codes(edited(l => put(l, 'clock', 40, 2)))).toContain('out-of-bounds')
  })

  it('does not let wall hangings overlap each other or the door', () => {
    expect(codes(edited(l => put(l, 'clock', 9, 2)))).toContain('wall-clash')
    // The door spans x 116-148; a window dropped there collides with it.
    expect(codes(edited(l => put(l, 'window-blue', 7, 3)))).toContain('wall-clash')
  })
})

describe('furniture collision rules', () => {
  it('rejects furniture whose collision overlaps other furniture', () => {
    expect(codes(edited(l => put(l, 'chest', 0, 7)))).toContain('overlap')
  })

  it('allows walkable and resting things to overlap furniture freely', () => {
    expect(isLayoutValid(DEFAULT_TEMPLATE, edited(l => put(l, 'rug', 4, 12)))).toBe(true)
  })

  it('keeps the doorway clear', () => {
    expect(codes(edited(l => put(l, 'chest', 8, 6)))).toContain('blocks-exit')
  })

  it('keeps the arrival spot clear', () => {
    expect(codes(edited(l => put(l, 'chest', 8, 7)))).toContain('blocks-spawn')
  })

  it('requires exactly one computer and one notebook', () => {
    expect(codes(edited(l => { l.items = l.items.filter(i => i.id !== 'notebook') })))
      .toContain('missing-mandatory')
    expect(codes(edited(l => { l.items = l.items.filter(i => i.id !== 'computer-desk') })))
      .toContain('missing-mandatory')
    const twoComputers = edited(l => {
      l.items.push({ id: 'computer-2', type: 'computer-desk', rotation: 0, at: { kind: 'grid', col: 9, row: 9 } })
    })
    expect(codes(twoComputers)).toContain('missing-mandatory')
  })

  it('refuses a layout that walls the player off from the notebook', () => {
    // A line of chests across the room, 8px apart: narrower than the player's body.
    const walled = edited(l => {
      for (let col = 0; col <= 14; col += 2) {
        l.items.push({ id: `wall-${col}`, type: 'chest', rotation: 0, at: { kind: 'grid', col, row: 8 } })
      }
    })
    const found = validateLayout(DEFAULT_TEMPLATE, walled)
    expect(found.some(x => x.code === 'unreachable' && x.itemId === 'notebook')).toBe(true)
  })
})

describe('reachableFeet', () => {
  it('reaches the door and the whole open floor of the default room', () => {
    const obstacles = getInteriorCollisionRects(DEFAULT_INTERIOR)
    const { reached, free } = reachableFeet(DEFAULT_INTERIOR, { x: 132, y: 100 }, obstacles)
    expect(reached.has('132,100')).toBe(true)
    expect(reached.has('132,74')).toBe(true)
    expect(free - reached.size).toBeLessThanOrEqual(12)
  })

  it('cannot squeeze through a gap narrower than the player', () => {
    const wall = { x: 0, y: 150, w: 120, h: 20 }
    const wall2 = { x: 128, y: 150, w: 128, h: 20 } // 8px gap: too narrow
    const { reached } = reachableFeet({ widthPx: 256, heightPx: 224 }, { x: 60, y: 120 }, [wall, wall2])
    expect(reached.has('60,120')).toBe(true)
    expect(reached.has('60,200')).toBe(false)
  })

  it('does pass through a gap wider than the player', () => {
    const wall = { x: 0, y: 150, w: 100, h: 20 }
    const wall2 = { x: 130, y: 150, w: 126, h: 20 } // 30px gap
    const { reached } = reachableFeet({ widthPx: 256, heightPx: 224 }, { x: 60, y: 120 }, [wall, wall2])
    expect(reached.has('60,200')).toBe(true)
  })
})
