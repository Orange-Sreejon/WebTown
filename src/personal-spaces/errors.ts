/**
 * The errors Personal Spaces storage can raise. The interface code catches
 * these and shows `message`, which is written for the person using WebTown;
 * `cause` keeps the underlying browser error for the console.
 *
 * Nothing here knows about IndexedDB, React or Phaser, so a remote repository
 * (Phase 3b) can raise the same errors.
 */

export type ErrorCode =
  | 'validation'
  | 'permission'
  | 'quota'
  | 'unavailable'
  | 'blocked'
  | 'storage'

/** One thing wrong with some data: where, and what to do about it. */
export interface Issue {
  path: string
  message: string
}

export class PersonalSpacesError extends Error {
  readonly code: ErrorCode
  readonly cause: unknown

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.cause = cause
  }
}

/** The data is not acceptable. `issues` says exactly what is wrong, field by field. */
export class ValidationError extends PersonalSpacesError {
  readonly issues: readonly Issue[]

  constructor(issues: readonly Issue[], message?: string) {
    super(
      'validation',
      message ?? (issues.length === 1 ? issues[0]!.message : `${issues.length} problems were found.`),
    )
    this.issues = issues
  }
}

/** The caller is not allowed to change this. Client-side only; see `guarded-site-writer.ts`. */
export class PermissionError extends PersonalSpacesError {
  constructor(message = 'Only the owner of this house can change it.') {
    super('permission', message)
  }
}

/** The device is out of storage space. */
export class QuotaError extends PersonalSpacesError {
  constructor(cause?: unknown) {
    super(
      'quota',
      "There isn't enough storage space left on this device. Free some space and try again.",
      cause,
    )
  }
}

/** The browser has no usable storage (no IndexedDB, private mode, blocked by settings). */
export class StorageUnavailableError extends PersonalSpacesError {
  constructor(message: string, cause?: unknown) {
    super('unavailable', message, cause)
  }
}

/** Another WebTown tab is holding the database open and will not let go. */
export class StorageBlockedError extends PersonalSpacesError {
  constructor(cause?: unknown) {
    super(
      'blocked',
      'WebTown storage is in use by another tab. Close your other WebTown tabs and try again.',
      cause,
    )
  }
}

/** A read or write failed for a reason that is not one of the above. */
export class StorageError extends PersonalSpacesError {
  constructor(message = "Your browser couldn't save or read WebTown data. Please try again.", cause?: unknown) {
    super('storage', message, cause)
  }
}
