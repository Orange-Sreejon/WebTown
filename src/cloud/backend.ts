import { ConflictError, PermissionError, PersonalSpacesError, StorageError, ValidationError } from '../personal-spaces/errors'

/**
 * What WebTown needs from its backend, and nothing more: call a database function, and put, get and remove
 * files. The Supabase implementation is in `supabase-backend.ts`; tests drive the same calls against real
 * PostgreSQL. Who may do what is decided by the database (RLS and the functions), never here.
 */
export interface CloudBackend {
  /** Calls a database function with named arguments, as the signed-in user. Rejects with `CloudError`. */
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
  /** Stores a new file. Never overwrites: a path is used once. */
  upload(bucket: Bucket, path: string, bytes: ArrayBuffer, contentType: string): Promise<void>
  download(bucket: Bucket, path: string): Promise<ArrayBuffer>
  /** Removes files. Missing files are not an error. */
  remove(bucket: Bucket, paths: string[]): Promise<void>
}

export type Bucket = 'website-assets' | 'artworks'

/** A failure as the backend reported it: a PostgreSQL SQLSTATE (or `network`, `storage`), and its message. */
export class CloudError extends Error {
  constructor(readonly code: string, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'CloudError'
  }
}

export const OFFLINE_MESSAGE = "Couldn't reach WebTown. Check your connection; your changes are still here, so try again."

/**
 * The backend's answer as one of the app's own errors, with a message for the player.
 * `WTCON` is WebTown's compare-and-swap failure; `42501` is "not allowed"; `22023` carries a message written for
 * players; other constraint failures (lengths, sizes) get a general one.
 */
export function toAppError(error: unknown, conflictMessage?: string): PersonalSpacesError {
  if (error instanceof PersonalSpacesError) return error
  if (!(error instanceof CloudError)) return new StorageError(undefined, error)
  switch (error.code) {
    case 'WTCON':
      return new ConflictError(conflictMessage ?? error.message)
    case '42501':
    case '23505':
      return new PermissionError(error.code === '42501' && error.message ? error.message : "This belongs to someone else, so it can't be changed here.")
    case '22023':
      return new ValidationError([{ path: 'server', message: error.message }])
    case '23514':
    case '22001':
    case '22P02':
      return new ValidationError([{ path: 'server', message: 'WebTown refused this: something is longer or bigger than allowed.' }])
    case 'network':
      return new StorageError(OFFLINE_MESSAGE, error)
    default:
      return new StorageError("WebTown couldn't save or read this. Please try again.", error)
  }
}

/** A fresh, unguessable id, as the database expects (UUID). */
export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
