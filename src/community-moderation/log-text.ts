import { displayNameOr, type ModerationEntry } from '../cloud/community'
import { isUuid } from '../cloud/backend'

/**
 * The moderation log in words (CH-07). Pure. `names` maps member ids to names (for a stroke's author, which the log
 * stores only as an id); anyone not in the town is "a former member".
 */

const uuidAt = (target: Record<string, unknown>, key: string): string | null => {
  const v = target[key]
  return isUuid(v) ? v : null
}
const numberAt = (target: Record<string, unknown>, key: string): number | null => {
  const v = target[key]
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
}

/** The stroke a log entry is about, if it can be brought back from there (a moderator removed it). */
export function restorableStroke(entry: ModerationEntry): string | null {
  return entry.action === 'hide_stroke' ? uuidAt(entry.target, 'strokeId') : null
}

export function describeEntry(entry: ModerationEntry, names: ReadonlyMap<string, string>): string {
  const actor = displayNameOr(entry.actorName)
  const person = (id: string | null, fallback: string | null = null): string =>
    displayNameOr(fallback ?? (id ? names.get(id) ?? null : null))
  const t = entry.target
  switch (entry.action) {
    case 'grant_moderator': return `${actor} made ${person(uuidAt(t, 'userId'), entry.targetName)} a moderator.`
    case 'revoke_moderator': return `${actor} removed ${person(uuidAt(t, 'userId'), entry.targetName)} as a moderator.`
    case 'publish': return `${actor} published version ${numberAt(t, 'number') ?? '?'} of the Community Website.`
    case 'rollback': return `${actor} went back to version ${numberAt(t, 'number') ?? '?'} of the Community Website.`
    case 'hide_stroke': return `${actor} removed a drawing by ${person(uuidAt(t, 'authorId'))}.`
    case 'restore_stroke': return `${actor} brought back a drawing by ${person(uuidAt(t, 'authorId'))}.`
    case 'clear_region': {
      const n = numberAt(t, 'strokes')
      return `${actor} cleared an area of the canvas${n !== null ? ` (${n} ${n === 1 ? 'drawing' : 'drawings'})` : ''}.`
    }
    case 'lock_canvas': return `${actor} locked the canvas.`
    case 'unlock_canvas': return `${actor} unlocked the canvas.`
    case 'lock_draft': return `${actor} locked the Community Website's draft.`
    case 'unlock_draft': return `${actor} unlocked the Community Website's draft.`
  }
}
