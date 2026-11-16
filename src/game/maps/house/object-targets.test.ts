import { describe, expect, it } from 'vitest'
import {
  INTERIOR_PROP_REACH_PX,
  PROMPT_COMPUTER_TEXT,
  PROMPT_SKETCHBOOK_TEXT,
  TILE_SIZE,
} from '../../config/GameConfig'
import { findNearbyTarget } from '../../systems/interaction'
import { pieceBounds } from '../interior-layout'
import { DEFAULT_INTERIOR, DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import { cloneLayout } from './house-layout'
import { buildObjectTargets } from './object-targets'
import { resolveInterior } from './resolve-interior'

const targetFor = (app: 'website' | 'paint') => {
  const found = buildObjectTargets(DEFAULT_INTERIOR).find(t => t.app === app)
  if (!found) throw new Error(`no ${app} target`)
  return found
}

describe('object targets', () => {
  it('finds the computer and the notebook by role, one each', () => {
    const targets = buildObjectTargets(DEFAULT_INTERIOR)
    expect(targets.map(t => [t.id, t.app, t.promptText])).toEqual([
      ['computer:computer-desk', 'website', PROMPT_COMPUTER_TEXT],
      ['notebook:notebook', 'paint', PROMPT_SKETCHBOOK_TEXT],
    ])
  })

  it('uses the same reach distance as the reachability rule', () => {
    for (const piece of DEFAULT_INTERIOR.pieces.filter(p => p.role)) {
      const b = pieceBounds(piece)
      const target = buildObjectTargets(DEFAULT_INTERIOR).find(t => t.id.endsWith(piece.id))!
      // The sprite box grown by the reach, then clipped to the room.
      const left = Math.max(0, b.x - INTERIOR_PROP_REACH_PX)
      const top = Math.max(0, b.y - INTERIOR_PROP_REACH_PX)
      const right = Math.min(DEFAULT_INTERIOR.widthPx, b.x + b.w + INTERIOR_PROP_REACH_PX)
      const bottom = Math.min(DEFAULT_INTERIOR.heightPx, b.y + b.h + INTERIOR_PROP_REACH_PX)
      expect(target.zone).toEqual({ x: left, y: top, w: right - left, h: bottom - top })
    }
  })

  it('puts each prompt on top of its object', () => {
    for (const piece of DEFAULT_INTERIOR.pieces.filter(p => p.role)) {
      const b = pieceBounds(piece)
      const target = buildObjectTargets(DEFAULT_INTERIOR).find(t => t.id.endsWith(piece.id))!
      expect(target.promptX).toBe(b.x + b.w / 2)
      expect(target.promptY).toBe(b.y)
    }
  })

  it('keeps every zone inside the room', () => {
    for (const { zone } of buildObjectTargets(DEFAULT_INTERIOR)) {
      expect(zone.x).toBeGreaterThanOrEqual(0)
      expect(zone.y).toBeGreaterThanOrEqual(0)
      expect(zone.x + zone.w).toBeLessThanOrEqual(DEFAULT_INTERIOR.widthPx)
      expect(zone.y + zone.h).toBeLessThanOrEqual(DEFAULT_INTERIOR.heightPx)
    }
  })

  it('follows the notebook when its table is moved', () => {
    const before = targetFor('paint')
    const layout = cloneLayout(createDefaultLayout('house-a'))
    const table = layout.items.find(i => i.id === 'table')!
    if (table.at.kind !== 'grid') throw new Error('the table stands on the floor')
    table.at.col -= 2
    const moved = buildObjectTargets(resolveInterior(DEFAULT_TEMPLATE, layout)).find(t => t.app === 'paint')!

    expect(moved.promptX).toBe(before.promptX - 2 * TILE_SIZE)
    expect(moved.zone.x).toBe(before.zone.x - 2 * TILE_SIZE)
    expect(moved.promptY).toBe(before.promptY)
  })

  it('finds no targets in a room without roles', () => {
    const bare = { ...DEFAULT_INTERIOR, pieces: DEFAULT_INTERIOR.pieces.filter(p => !p.role) }
    expect(buildObjectTargets(bare)).toEqual([])
  })

  it('lets the nearest zone win where zones overlap', () => {
    const targets = buildObjectTargets(DEFAULT_INTERIOR)
    const computer = targets.find(t => t.app === 'website')!
    const notebook = targets.find(t => t.app === 'paint')!
    const centre = (z: typeof computer.zone) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 })

    expect(findNearbyTarget(centre(computer.zone), targets)).toBe(computer)
    expect(findNearbyTarget(centre(notebook.zone), targets)).toBe(notebook)
    expect(findNearbyTarget({ x: 1, y: 1 }, targets)).toBeNull()
  })
})
