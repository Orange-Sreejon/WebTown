/**
 * Test support: wraps a real (fake-indexeddb) factory so a test can make the
 * browser misbehave in the ways real browsers do. Used only by tests; never
 * imported by app code, and `fake-indexeddb` is a development dependency.
 */

/** What goes wrong with the next transaction (one-shot). */
export type TransactionFault =
  | { kind: 'throw'; error: Error }
  /** The request fails and the transaction aborts, as when the disk is full. */
  | { kind: 'fail'; error: Error }

export interface Faults {
  /** `factory.open` throws at once, as in some private-browsing modes. */
  openThrows?: Error | undefined
  /** The open request reports this error. */
  openError?: Error | undefined
  /** The open request reports "blocked" and, if set, succeeds this many ms later. */
  blocked?: { thenOpenAfterMs: number | null } | undefined
  /** Applies to the next call of `db.transaction`. */
  nextTransaction?: TransactionFault | undefined
  /** Every call of `db.transaction` throws this, until cleared. */
  transactionThrows?: Error | undefined
}

export interface FaultyFactory {
  factory: IDBFactory
  faults: Faults
  /** Every real connection opened through this factory, newest last. */
  opened: IDBDatabase[]
  /** How many times `open` was called. */
  openCalls(): number
}

export function domError(name: string, message = name): Error {
  const error = new Error(message)
  error.name = name
  return error
}

const later = (ms: number, action: () => void): void => void setTimeout(action, ms)

/** A request-shaped object the code under test can attach handlers to. */
function stubRequest<T>(): IDBRequest<T> & { fire(kind: 'success' | 'error' | 'blocked'): void } {
  const request = {
    result: undefined as unknown,
    error: null as unknown,
    onsuccess: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    onblocked: null as ((ev: Event) => void) | null,
    onupgradeneeded: null as ((ev: Event) => void) | null,
    transaction: null,
    fire(kind: 'success' | 'error' | 'blocked'): void {
      const handler = kind === 'success' ? request.onsuccess : kind === 'error' ? request.onerror : request.onblocked
      handler?.(new Event(kind))
    },
  }
  return request as unknown as IDBRequest<T> & { fire(kind: 'success' | 'error' | 'blocked'): void }
}

function failingTransaction(error: Error): IDBTransaction {
  const transaction = {
    error: null as unknown,
    oncomplete: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    onabort: null as ((ev: Event) => void) | null,
    objectStore(): unknown {
      const operation = (): IDBRequest => {
        const request = stubRequest<unknown>()
        later(0, () => {
          ;(request as unknown as { error: unknown }).error = error
          request.fire('error')
          transaction.error = error
          transaction.onabort?.(new Event('abort'))
        })
        return request
      }
      return { get: operation, put: operation, delete: operation, getAll: operation }
    },
  }
  return transaction as unknown as IDBTransaction
}

export function faultyFactory(real: IDBFactory): FaultyFactory {
  const faults: Faults = {}
  const opened: IDBDatabase[] = []
  let calls = 0

  const patch = (db: IDBDatabase): void => {
    opened.push(db)
    const original = db.transaction.bind(db)
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>): IDBTransaction => {
      const fault = faults.nextTransaction
      faults.nextTransaction = undefined
      if (faults.transactionThrows) throw faults.transactionThrows
      if (fault?.kind === 'throw') throw fault.error
      if (fault?.kind === 'fail') return failingTransaction(fault.error)
      return original(...args)
    }) as IDBDatabase['transaction']
  }

  const open = (name: string, version?: number): IDBOpenDBRequest => {
    calls++
    if (faults.openThrows) throw faults.openThrows

    if (faults.openError) {
      const request = stubRequest<IDBDatabase>()
      const error = faults.openError
      later(0, () => {
        ;(request as unknown as { error: unknown }).error = error
        request.fire('error')
      })
      return request as unknown as IDBOpenDBRequest
    }

    if (faults.blocked) {
      const { thenOpenAfterMs } = faults.blocked
      const request = stubRequest<IDBDatabase>()
      later(0, () => request.fire('blocked'))
      if (thenOpenAfterMs !== null) {
        later(thenOpenAfterMs, () => {
          const inner = real.open(name, version)
          const stub = request as unknown as {
            result: unknown
            onupgradeneeded: ((ev: Event) => void) | null
          }
          inner.onupgradeneeded = (event): void => {
            stub.result = inner.result
            stub.onupgradeneeded?.(event)
          }
          inner.onsuccess = (): void => {
            patch(inner.result)
            stub.result = inner.result
            request.fire('success')
          }
        })
      }
      return request as unknown as IDBOpenDBRequest
    }

    const request = real.open(name, version)
    // Patch each new connection before the code under test sees it.
    let handler: ((ev: Event) => void) | null = null
    request.onsuccess = (event): void => {
      patch(request.result)
      handler?.(event)
    }
    return new Proxy(request, {
      set(target, property, value: unknown): boolean {
        if (property === 'onsuccess') {
          handler = value as (ev: Event) => void
          return true
        }
        return Reflect.set(target, property, value) as boolean
      },
      get(target, property): unknown {
        if (property === 'onsuccess') return handler
        const value = Reflect.get(target, property) as unknown
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })
  }

  const factory = new Proxy(real, {
    get(target, property): unknown {
      if (property === 'open') return open
      const value = Reflect.get(target, property) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })

  return { factory, faults, opened, openCalls: () => calls }
}
