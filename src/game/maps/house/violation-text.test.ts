import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import { moveItem, type EditResult } from './layout-edits'
import type { Violation, ViolationCode } from './layout-rules'
import { describeViolation, itemName, primaryReason } from './violation-text'

const layout = createDefaultLayout('house-a')
const refused = (r: EditResult): Violation[] => (r.ok ? [] : r.violations)

describe('itemName', () => {
  it('names things the way a player sees them', () => {
    expect(itemName(layout, 'bed')).toBe('the bed')
    expect(itemName(layout, 'computer-desk')).toBe('the computer desk')
    expect(itemName(layout, 'door')).toBe('the door')
    expect(itemName(layout, 'ghost')).toBe('something')
    expect(itemName(layout, undefined)).toBe('something')
  })
})

describe('describeViolation', () => {
  it('names the other piece in an overlap, whichever side the moved item is on', () => {
    const a: Violation = { code: 'overlap', itemId: 'chest', otherId: 'bed', message: '' }
    const b: Violation = { code: 'overlap', itemId: 'bed', otherId: 'chest', message: '' }
    expect(describeViolation(a, layout, 'chest')).toBe('Overlaps the bed')
    expect(describeViolation(b, layout, 'chest')).toBe('Overlaps the bed')
  })

  it('explains real refused moves in plain words', () => {
    const T = DEFAULT_TEMPLATE
    expect(primaryReason(refused(moveItem(T, layout, 'chest', { kind: 'grid', col: 0, row: 7 })), layout, 'chest'))
      .toBe('Overlaps the bed')
    expect(primaryReason(refused(moveItem(T, layout, 'chest', { kind: 'grid', col: 8, row: 6 })), layout, 'chest'))
      .toBe('Blocks the way to the door')
    expect(primaryReason(refused(moveItem(T, layout, 'chest', { kind: 'grid', col: 30, row: 9 })), layout, 'chest'))
      .toBe("Doesn't fit on the floor here")
    expect(primaryReason(refused(moveItem(T, layout, 'clock', { kind: 'grid', col: 9, row: 8 })), layout, 'clock'))
      .toBe('Must hang on the back wall')
    expect(primaryReason(refused(moveItem(T, layout, 'clock', { kind: 'grid', col: 10, row: 2 })), layout, 'clock'))
      .toBe('Overlaps the landscape painting on the wall')
    expect(primaryReason(refused(moveItem(T, layout, 'notebook', { kind: 'grid', col: 3, row: 9 })), layout, 'notebook'))
      .toBe('Must rest on a table or nightstand')
  })

  it('has a sentence for every violation code', () => {
    const codes: ViolationCode[] = [
      'unknown-type', 'duplicate-id', 'bad-rotation', 'bad-placement', 'not-on-grid', 'bad-support',
      'out-of-bounds', 'overlap', 'wall-clash', 'blocks-exit', 'blocks-spawn', 'missing-mandatory',
      'unreachable',
    ]
    for (const code of codes) {
      const text = describeViolation({ code, message: '', itemId: 'chest' }, layout, 'chest')
      expect(text.length, code).toBeGreaterThan(5)
      expect(text, code).not.toMatch(/"|undefined/)
    }
    expect(describeViolation({ code: 'unreachable', message: '' }, layout)).toBe(
      'Would block the way to the door',
    )
    expect(describeViolation({ code: 'unreachable', message: '', itemId: 'notebook' }, layout)).toBe(
      'Would block the way to the notebook',
    )
  })
})

describe('primaryReason', () => {
  it('prefers a reason about the moved item', () => {
    const general: Violation = { code: 'blocks-spawn', message: '' }
    const mine: Violation = { code: 'overlap', itemId: 'bed', otherId: 'chest', message: '' }
    expect(primaryReason([general, mine], layout, 'chest')).toBe('Overlaps the bed')
    expect(primaryReason([general, mine], layout)).toBe('Blocks the spot inside the door')
  })

  it('is null when nothing is wrong', () => {
    expect(primaryReason([], layout, 'chest')).toBeNull()
  })
})
