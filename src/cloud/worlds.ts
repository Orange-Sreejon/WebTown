import { CloudError, isUuid, toAppError, type CloudBackend } from './backend'
import { parseBootstrap, type PlayerContext } from './player'
import { PersonalSpacesError, StorageError } from '../personal-spaces/errors'

/**
 * Worlds you can be in (Phase 5): invitations, joining, leaving and the member list. Every call is a database
 * function that checks `auth.uid()`; nothing here decides who may do what. Answers are parsed strictly.
 */

/** The most players a world can hold (one per house slot; `private.max_world_members()`). */
export const MAX_WORLD_MEMBERS = 7

export type InviteProblem = 'invalid' | 'expired' | 'full'

/** An invitation that can't be used, with a sentence for the player. */
export class InviteError extends PersonalSpacesError {
  constructor(readonly problem: InviteProblem, message: string) {
    super('validation', message)
  }
}

export interface CreatedInvite { id: string; code: string; hint: string; expiresAt: string }
export interface InviteSummary { id: string; hint: string; uses: number; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean }
export interface InvitePreview { worldId: string; worldName: string; ownerName: string; members: number; max: number; alreadyMember: boolean }
export interface WorldSummary { id: string; name: string; role: 'owner' | 'resident' | 'visitor'; ownerName: string; members: number }
export interface WorldMember { userId: string; displayName: string; avatar: string; role: 'owner' | 'resident' | 'visitor'; slot: string | null }

const bad = (): never => {
  throw new StorageError('WebTown sent back something it should not have. Please try again.')
}
const str = (v: unknown): string => (typeof v === 'string' ? v : bad())
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : bad())
const uuid = (v: unknown): string => (isUuid(v) ? v : bad())
const role = (v: unknown): WorldMember['role'] => (v === 'owner' || v === 'resident' || v === 'visitor' ? v : bad())
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]).map(x => (x && typeof x === 'object' ? x : bad())) : bad())

async function call<T>(backend: CloudBackend, fn: string, args: Record<string, unknown>, parse: (raw: unknown) => T): Promise<T> {
  let raw: unknown
  try {
    raw = await backend.rpc(fn, args)
  } catch (error) {
    if (error instanceof CloudError) {
      if (error.code === 'WTINV') throw new InviteError('invalid', error.message || 'That invitation is not valid.')
      if (error.code === 'WTEXP') throw new InviteError('expired', error.message || 'That invitation has expired.')
      if (error.code === 'WTFUL') throw new InviteError('full', error.message || 'This town is full.')
    }
    throw toAppError(error)
  }
  return parse(raw)
}

/** The code as people type or paste it: from a link, with or without dashes, any case. Null if it can't be one. */
export function normaliseInviteCode(input: string): string | null {
  let text = input.trim()
  try {
    const url = new URL(text)
    text = url.searchParams.get('invite') ?? ''
  } catch {
    // Not a link: the code itself.
  }
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) return null
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`
}

/** The link that opens WebTown on this invitation. */
export function inviteLink(code: string, base: string): string {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  url.searchParams.set('invite', code)
  return url.href
}

export const createInvite = (backend: CloudBackend, worldId: string, days = 7): Promise<CreatedInvite> =>
  call(backend, 'create_world_invite', { p_world: worldId, p_days: days }, raw => {
    const r = raw as Record<string, unknown>
    const code = normaliseInviteCode(str(r?.['code']))
    return { id: uuid(r['id']), code: code ?? bad(), hint: str(r['hint']), expiresAt: str(r['expiresAt']) }
  })

export const listInvites = (backend: CloudBackend, worldId: string): Promise<InviteSummary[]> =>
  call(backend, 'list_world_invites', { p_world: worldId }, raw => list(raw).map(r => ({
    id: uuid(r['id']), hint: str(r['hint']), uses: num(r['uses']), createdAt: str(r['createdAt']),
    expiresAt: str(r['expiresAt']), revoked: r['revoked'] === true, expired: r['expired'] === true,
  })))

export const revokeInvite = (backend: CloudBackend, inviteId: string): Promise<void> =>
  call(backend, 'revoke_world_invite', { p_invite: inviteId }, () => undefined)

export const previewInvite = (backend: CloudBackend, code: string): Promise<InvitePreview> =>
  call(backend, 'preview_world_invite', { p_code: code }, raw => {
    const r = (raw ?? bad()) as Record<string, unknown>
    return {
      worldId: uuid(r['worldId']), worldName: str(r['worldName']), ownerName: str(r['ownerName']),
      members: num(r['members']), max: num(r['max']), alreadyMember: r['alreadyMember'] === true,
    }
  })

export const joinWorld = (backend: CloudBackend, code: string): Promise<{ worldId: string; joined: boolean }> =>
  call(backend, 'join_world', { p_code: code }, raw => {
    const r = (raw ?? bad()) as Record<string, unknown>
    return { worldId: uuid(r['worldId']), joined: r['joined'] === true }
  })

export const leaveWorld = (backend: CloudBackend, worldId: string): Promise<void> =>
  call(backend, 'leave_world', { p_world: worldId }, () => undefined)

export const removeMember = (backend: CloudBackend, worldId: string, userId: string): Promise<void> =>
  call(backend, 'remove_world_member', { p_world: worldId, p_user: userId }, () => undefined)

export const listMyWorlds = (backend: CloudBackend): Promise<WorldSummary[]> =>
  call(backend, 'list_my_worlds', {}, raw => list(raw).map(r => ({
    id: uuid(r['id']), name: str(r['name']), role: role(r['role']), ownerName: str(r['ownerName']), members: num(r['members']),
  })))

export const listMembers = (backend: CloudBackend, worldId: string): Promise<WorldMember[]> =>
  call(backend, 'list_world_members', { p_world: worldId }, raw => list(raw).map(r => ({
    userId: uuid(r['userId']), displayName: str(r['displayName']), avatar: str(r['avatar']), role: role(r['role']),
    slot: r['slot'] === null || r['slot'] === undefined ? null : str(r['slot']),
  })))

/** The player's context in a world they belong to (houses, their house, role). */
export const enterWorld = (backend: CloudBackend, userId: string, worldId: string): Promise<PlayerContext> =>
  call(backend, 'enter_world', { p_world: worldId }, raw => parseBootstrap(userId, raw))

/** The invitation code in the page address (`?invite=`), if it looks like one. */
export function inviteFromAddress(search: string): string | null {
  const raw = new URLSearchParams(search).get('invite')
  return raw ? normaliseInviteCode(raw) : null
}

/** Takes `?invite=` out of the address bar, so a reload doesn't ask again. */
export function clearInviteFromAddress(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('invite')) return
    url.searchParams.delete('invite')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // Nothing to do.
  }
}
