import { describe, expect, it } from 'vitest'
import { parseLockAnnouncement, type ModerationEntry } from '../cloud/community'
import { describeEntry, restorableStroke } from './log-text'

const ADA = '0b6c1c4e-8f0e-4c7e-9d7a-00000000000a'
const BO = '0b6c1c4e-8f0e-4c7e-9d7a-00000000000b'
const STROKE = '0b6c1c4e-8f0e-4c7e-9d7a-000000000099'
const entry = (action: ModerationEntry['action'], target: Record<string, unknown> = {}, over: Partial<ModerationEntry> = {}): ModerationEntry => ({
  id: 1, action, target, reason: null, actorId: ADA, actorName: 'Ada', targetName: null, createdAt: '2026-12-28T09:00:00.000Z', ...over,
})
const names = new Map([[BO, 'Bo']])

describe('describeEntry', () => {
  it('says every kind of action in words', () => {
    expect([
      entry('grant_moderator', { userId: BO }, { targetName: 'Bo' }), entry('revoke_moderator', { userId: BO }),
      entry('publish', { number: 3 }), entry('rollback', { number: 2 }), entry('hide_stroke', { strokeId: STROKE, authorId: BO }),
      entry('restore_stroke', { authorId: BO }), entry('clear_region', { strokes: 12 }), entry('clear_region', { strokes: 1 }),
      entry('lock_canvas'), entry('unlock_canvas'), entry('lock_draft'), entry('unlock_draft'),
    ].map(e => describeEntry(e, names))).toEqual([
      'Ada made Bo a moderator.', 'Ada removed Bo as a moderator.', 'Ada published version 3 of the Community Website.',
      'Ada went back to version 2 of the Community Website.', 'Ada removed a drawing by Bo.', 'Ada brought back a drawing by Bo.',
      'Ada cleared an area of the canvas (12 drawings).', 'Ada cleared an area of the canvas (1 drawing).',
      'Ada locked the canvas.', 'Ada unlocked the canvas.', "Ada locked the Community Website's draft.",
      "Ada unlocked the Community Website's draft.",
    ])
  })

  it('names people who left, or unknown or damaged targets, as "a former member"', () => {
    expect(describeEntry(entry('hide_stroke', { strokeId: STROKE, authorId: ADA.replace('a', 'c') }, { actorName: null }), names))
      .toBe('a former member removed a drawing by a former member.')
    expect(describeEntry(entry('publish', { number: 'x' }), names)).toBe('Ada published version ? of the Community Website.')
    expect(describeEntry(entry('grant_moderator', { userId: 'nope' }), names)).toBe('Ada made a former member a moderator.')
  })

  it('offers to bring back only strokes a moderator removed', () => {
    expect(restorableStroke(entry('hide_stroke', { strokeId: STROKE }))).toBe(STROKE)
    expect(restorableStroke(entry('hide_stroke', { strokeId: 'x' }))).toBeNull()
    expect(restorableStroke(entry('restore_stroke', { strokeId: STROKE }))).toBeNull()
  })
})

describe('parseLockAnnouncement', () => {
  it('accepts only a known lock and a boolean', () => {
    expect(parseLockAnnouncement({ what: 'canvas', locked: true })).toEqual({ what: 'canvas', locked: true })
    for (const junk of [null, [], {}, { what: 'door', locked: true }, { what: 'draft', locked: 'yes' }]) expect(parseLockAnnouncement(junk)).toBeNull()
  })
})
