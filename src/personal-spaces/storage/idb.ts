import {
  PersonalSpacesError,
  QuotaError,
  StorageBlockedError,
  StorageError,
  StorageUnavailableError,
} from '../errors'

/**
 * A small promise wrapper over IndexedDB.
 *
 * It knows nothing about websites or drawings. A repository gives it a
 * `DatabaseSpec` and calls `get`, `put`, `delete` and `getAll`. Whatever comes
 * back is typed `unknown` on purpose: stored data is untrusted, and the caller
 * must validate it before use.
 *
 * What it takes care of:
 * - no IndexedDB, or the browser refuses to open it (private mode): `StorageUnavailableError`
 * - an upgrade blocked by another tab: `StorageBlockedError`, after a timeout
 * - a write that fails because the device is full: `QuotaError`
 * - any other failed or aborted transaction: `StorageError`
 * - a connection the browser closed or another tab asked us to drop: the next call reopens
 *
 * Writes resolve only when the transaction has committed.
 */

export interface DatabaseSpec {
  name: string
  version: number
  /** Creates the stores. Runs inside the upgrade transaction. */
  upgrade(db: IDBDatabase, oldVersion: number): void
}

export interface IdbOptions {
  /** The factory to use; the browser's `indexedDB` when omitted. Injected by tests. */
  factory?: IDBFactory | undefined
  /** How long to wait on a blocked upgrade before giving up. */
  blockedTimeoutMs?: number
}

export const DEFAULT_BLOCKED_TIMEOUT_MS = 4000

/** Raised inside this module when the connection was closed under us, so the call is retried once. */
class ConnectionClosed extends Error {}

const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''

/** Turns whatever IndexedDB threw into one of our errors. */
export function mapIdbError(error: unknown): PersonalSpacesError {
  if (error instanceof PersonalSpacesError) return error
  const name = errorName(error)
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return new QuotaError(error)
  if (name === 'VersionError') {
    return new StorageUnavailableError(
      'Your saved WebTown data was made by a newer version of WebTown. Update WebTown to open it.',
      error,
    )
  }
  if (name === 'SecurityError' || name === 'NotSupportedError') {
    return new StorageUnavailableError(
      "Your browser isn't allowing WebTown to use storage (private browsing can do this).",
      error,
    )
  }
  return new StorageError(undefined, error)
}

export class IdbDatabase {
  private db: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null

  constructor(
    private readonly spec: DatabaseSpec,
    private readonly options: IdbOptions = {},
  ) {}

  /** Opens the database now. Rejects with the reason if it cannot be used. */
  async ready(): Promise<void> {
    await this.open()
  }

  /** The stored value for a key, or `undefined`. Untrusted. */
  async get(store: string, key: IDBValidKey): Promise<unknown> {
    return this.transact(store, 'readonly', s => s.get(key))
  }

  /** Stores a value under its key path. Resolves once committed. */
  async put(store: string, value: unknown): Promise<void> {
    await this.transact(store, 'readwrite', s => s.put(value))
  }

  async delete(store: string, key: IDBValidKey): Promise<void> {
    await this.transact(store, 'readwrite', s => s.delete(key))
  }

  /** Every value in a store. Untrusted. */
  async getAll(store: string): Promise<unknown[]> {
    return (await this.transact(store, 'readonly', s => s.getAll())) as unknown[]
  }

  /** Closes the connection. A later call opens a new one. */
  close(): void {
    this.db?.close()
    this.db = null
  }

  // ── Opening ──────────────────────────────────────────────────────────────

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db)
    if (!this.opening) {
      this.opening = this.openOnce().then(
        db => {
          this.db = db
          this.opening = null
          return db
        },
        (error: unknown) => {
          this.opening = null
          throw error
        },
      )
    }
    return this.opening
  }

  private openOnce(): Promise<IDBDatabase> {
    const factory = this.options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
    if (!factory) {
      return Promise.reject(new StorageUnavailableError("This browser doesn't support WebTown storage."))
    }

    return new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(this.spec.name, this.spec.version)
      } catch (error) {
        reject(mapIdbError(error))
        return
      }

      let settled = false
      let blockedTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (action: () => void): void => {
        if (blockedTimer !== undefined) clearTimeout(blockedTimer)
        if (settled) return
        settled = true
        action()
      }

      request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
        try {
          this.spec.upgrade(request.result, event.oldVersion)
        } catch (error) {
          // Abort the upgrade so a half-built database is never left behind.
          try { request.transaction?.abort() } catch { /* already finished */ }
          finish(() => reject(mapIdbError(error)))
        }
      }

      request.onsuccess = (): void => {
        const db = request.result
        if (settled) {
          // We already gave up (blocked for too long). Do not leak the connection.
          db.close()
          return
        }
        // Another tab wants to upgrade, or the browser is closing us: let go,
        // and reopen on the next call.
        db.onversionchange = (): void => {
          db.close()
          if (this.db === db) this.db = null
        }
        db.onclose = (): void => {
          if (this.db === db) this.db = null
        }
        finish(() => resolve(db))
      }

      request.onerror = (): void => {
        finish(() => reject(mapIdbError(request.error)))
      }

      request.onblocked = (): void => {
        // Blocked is not failure yet: the other tab may close in a moment.
        if (blockedTimer !== undefined || settled) return
        blockedTimer = setTimeout(() => {
          finish(() => reject(new StorageBlockedError()))
        }, this.options.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS)
      }
    })
  }

  // ── Transactions ─────────────────────────────────────────────────────────

  /** Runs one request in its own transaction, retrying once if the connection had been closed. */
  private async transact(
    store: string,
    mode: IDBTransactionMode,
    operation: (objectStore: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const db = await this.open()
      try {
        return await this.runOnce(db, store, mode, operation)
      } catch (error) {
        if (error instanceof ConnectionClosed && attempt === 0) {
          if (this.db === db) this.db = null
          try { db.close() } catch { /* already closed */ }
          continue
        }
        throw error instanceof ConnectionClosed
          ? new StorageError(undefined, error)
          : error
      }
    }
  }

  private runOnce(
    db: IDBDatabase,
    storeName: string,
    mode: IDBTransactionMode,
    operation: (objectStore: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      let transaction: IDBTransaction
      let request: IDBRequest
      try {
        transaction = db.transaction(storeName, mode)
        request = operation(transaction.objectStore(storeName))
      } catch (error) {
        reject(errorName(error) === 'InvalidStateError' ? new ConnectionClosed() : mapIdbError(error))
        return
      }

      let result: unknown
      let failure: PersonalSpacesError | null = null

      request.onsuccess = (): void => {
        result = request.result
      }
      request.onerror = (): void => {
        failure = mapIdbError(request.error)
      }
      transaction.oncomplete = (): void => resolve(result)
      transaction.onerror = (): void => reject(failure ?? mapIdbError(transaction.error ?? request.error))
      transaction.onabort = (): void => reject(failure ?? mapIdbError(transaction.error ?? request.error))
    })
  }
}
