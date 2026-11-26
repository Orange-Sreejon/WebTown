import { isUuid, toAppError, type CloudBackend } from './backend'
import { StorageError } from '../personal-spaces/errors'

/**
 * The Community Hall's foundation (CH-01): the Hall of a world, its moderators and the moderation log. Every call
 * is a database function that checks `auth.uid()` against the world given; nothing here decides who may do what.
 * Answers are parsed strictly: anything unexpected is refused rather than shown.
 */

export type HallRole = 'owner' | 'moderator' | 'member'

export interface HallContext {
  worldId: string
  name: string
  canvasLocked: boolean
  draftLocked: boolean
  role: HallRole
}

export interface HallModerator {
  userId: string
  /** Null when they are no longer in the town ("a former member"). */
  displayName: string | null
  isOwner: boolean
  grantedAt: string
}

export const MODERATION_ACTIONS = [
  'grant_moderator', 'revoke_moderator', 'publish', 'rollback', 'hide_stroke', 'restore_stroke', 'clear_region',
  'lock_canvas', 'unlock_canvas', 'lock_draft', 'unlock_draft',
] as const
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]

export interface ModerationEntry {
  id: number
  action: ModerationAction
  target: Record<string, unknown>
  reason: string | null
  actorId: string | null
  /** Null for "a former member" (or an account that no longer exists). */
  actorName: string | null
  targetName: string | null
  createdAt: string
}

/** How a missing name is shown: content from people who left stays, without their name. */
export const FORMER_MEMBER = 'a former member'
export const displayNameOr = (name: string | null): string => name ?? FORMER_MEMBER

const bad = (): never => {
  throw new StorageError('WebTown sent back something it should not have. Please try again.')
}
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad())
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(record) : bad())
const str = (v: unknown): string => (typeof v === 'string' ? v : bad())
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v))
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad())
const uuid = (v: unknown): string => (isUuid(v) ? v : bad())
const uuidOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : uuid(v))
const role = (v: unknown): HallRole => (v === 'owner' || v === 'moderator' || v === 'member' ? v : bad())
const action = (v: unknown): ModerationAction =>
  (typeof v === 'string' && (MODERATION_ACTIONS as readonly string[]).includes(v) ? (v as ModerationAction) : bad())

async function call<T>(backend: CloudBackend, fn: string, args: Record<string, unknown>, parse: (raw: unknown) => T): Promise<T> {
  let raw: unknown
  try {
    raw = await backend.rpc(fn, args)
  } catch (error) {
    throw toAppError(error)
  }
  return parse(raw)
}

export function parseHallContext(raw: unknown): HallContext {
  const r = record(raw)
  return {
    worldId: uuid(r['worldId']), name: str(r['name']), canvasLocked: bool(r['canvasLocked']),
    draftLocked: bool(r['draftLocked']), role: role(r['role']),
  }
}

export const hallContext = (backend: CloudBackend, worldId: string): Promise<HallContext> =>
  call(backend, 'hall_context', { p_world: worldId }, parseHallContext)

export const listHallModerators = (backend: CloudBackend, worldId: string): Promise<HallModerator[]> =>
  call(backend, 'list_hall_moderators', { p_world: worldId }, raw => list(raw).map(r => ({
    userId: uuid(r['userId']), displayName: strOrNull(r['displayName']), isOwner: bool(r['isOwner']), grantedAt: str(r['grantedAt']),
  })))

export const grantModerator = (backend: CloudBackend, worldId: string, userId: string, reason?: string): Promise<void> =>
  call(backend, 'grant_moderator', { p_world: worldId, p_user: userId, p_reason: reason ?? null }, () => undefined)

export const revokeModerator = (backend: CloudBackend, worldId: string, userId: string, reason?: string): Promise<void> =>
  call(backend, 'revoke_moderator', { p_world: worldId, p_user: userId, p_reason: reason ?? null }, () => undefined)

/** Newest first; pass the last entry's id as `before` for the next page. */
export const listModerationLog = (backend: CloudBackend, worldId: string, page: { before?: number; limit?: number } = {}): Promise<ModerationEntry[]> =>
  call(backend, 'list_moderation_log', { p_world: worldId, p_before: page.before ?? null, p_limit: page.limit ?? 50 }, raw => list(raw).map(r => {
    const id = r['id']
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) return bad()
    return {
      id, action: action(r['action']), target: record(r['target']), reason: strOrNull(r['reason']),
      actorId: uuidOrNull(r['actorId']), actorName: strOrNull(r['actorName']), targetName: strOrNull(r['targetName']),
      createdAt: str(r['createdAt']),
    }
  }))
