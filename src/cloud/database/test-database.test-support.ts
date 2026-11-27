import { PGlite, type Transaction } from '@electric-sql/pglite'

/**
 * Test support: a real PostgreSQL (PGlite, in WebAssembly) with the parts of Supabase that WebTown relies on
 * (`supabase/tests/supabase-shim.sql`) and every migration in `supabase/migrations/`, in order.
 *
 * Statements run the way PostgREST runs them: inside a transaction, as the `authenticated` role (or `anon`),
 * with the caller's JWT claims in `request.jwt.claims`. RLS, grants and security definer functions behave as in
 * a Supabase project. Used only by tests; PGlite is a development dependency.
 */

const shim = import.meta.glob<string>('/supabase/tests/supabase-shim.sql', { query: '?raw', import: 'default', eager: true })
const migrations = import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })

/** The migration files, in the order the Supabase CLI applies them (by file name). */
export const MIGRATION_FILES = Object.keys(migrations).sort()

export type Caller = { kind: 'user'; id: string; anonymous: boolean } | { kind: 'anon' } | { kind: 'service' }

export class DatabaseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const toDatabaseError = (error: unknown): DatabaseError => {
  const e = error as { code?: string; message?: string }
  return new DatabaseError(e?.code ?? 'unknown', e?.message ?? String(error))
}

/** Sets the role and JWT claims of `caller` for the rest of the transaction, as PostgREST does. */
async function actAs(tx: Transaction, caller: Caller): Promise<void> {
  if (caller.kind === 'user') {
    const claims = { sub: caller.id, role: 'authenticated', is_anonymous: caller.anonymous, aud: 'authenticated' }
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    await tx.exec('set local role authenticated')
  } else if (caller.kind === 'anon') {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })])
    await tx.exec('set local role anon')
  } else {
    await tx.exec('set local role service_role')
  }
}

export class TestDatabase {
  private constructor(readonly pg: PGlite) {}

  static async create(): Promise<TestDatabase> {
    const pg = await PGlite.create()
    await pg.exec(Object.values(shim)[0]!)
    for (const file of MIGRATION_FILES) {
      try {
        await pg.exec(migrations[file]!)
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
      }
    }
    return new TestDatabase(pg)
  }

  /** A new Supabase user, as Auth would create it. Returns the caller to act as them. */
  async createUser(options: { anonymous?: boolean; email?: string } = {}): Promise<Caller & { kind: 'user' }> {
    const id = crypto.randomUUID()
    const anonymous = options.anonymous ?? false
    await this.pg.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [
      id, anonymous ? null : (options.email ?? `${id.slice(0, 8)}@example.test`), anonymous,
    ])
    return { kind: 'user', id, anonymous }
  }

  /** Runs `body` in one transaction as `caller`. Rolls back if it throws. */
  async as<T>(caller: Caller, body: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.pg.transaction(async tx => {
        await actAs(tx, caller)
        return await body(tx)
      })
    } catch (error) {
      throw toDatabaseError(error)
    }
  }

  /**
   * Whether `caller` may receive and send on a private Realtime channel, decided the way Supabase Realtime
   * decides it: a probe row for the topic is written, then, as the caller with `realtime.topic` set, the row
   * must be visible (receive) and a row must be insertable (send). Everything is rolled back.
   */
  async realtimeAccess(caller: Caller, topic: string, extension: 'broadcast' | 'presence' = 'broadcast'): Promise<{ read: boolean; write: boolean }> {
    const ROLLBACK = Symbol('rollback')
    const probe = async (body: (tx: Transaction) => Promise<boolean>): Promise<boolean> => {
      let result = false
      try {
        await this.pg.transaction(async tx => {
          result = await body(tx)
          throw ROLLBACK
        })
      } catch (error) {
        if (error !== ROLLBACK) throw error
      }
      return result
    }
    const read = await probe(async tx => {
      const { rows } = await tx.query<{ id: number }>('insert into realtime.messages (topic, extension) values ($1, $2) returning id', [topic, extension])
      await actAs(tx, caller)
      await tx.query("select set_config('realtime.topic', $1, true)", [topic])
      return (await tx.query('select 1 from realtime.messages where id = $1', [rows[0]!.id])).rows.length === 1
    })
    const write = await probe(async tx => {
      await actAs(tx, caller)
      await tx.query("select set_config('realtime.topic', $1, true)", [topic])
      try {
        await tx.query('insert into realtime.messages (topic, extension) values ($1, $2)', [topic, extension])
        return true
      } catch {
        return false
      }
    })
    return { read, write }
  }

  /** A query as `caller`; the rows. */
  async query<R = Record<string, unknown>>(caller: Caller, sql: string, params: unknown[] = []): Promise<R[]> {
    return this.as(caller, async tx => (await tx.query<R>(sql, params)).rows)
  }

  /** Calls `public.<fn>(name => value, ...)` as `caller`, as `supabase.rpc(fn, args)` does. */
  async rpc<T = unknown>(caller: Caller, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^[a-z_]+$/.test(fn)) throw new Error(`bad function name ${fn}`)
    const names = Object.keys(args)
    for (const name of names) if (!/^p_[a-z0-9_]+$/.test(name)) throw new Error(`bad argument name ${name}`)
    const call = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as result`
    const values = names.map(n => {
      const v = args[n]
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
    })
    const rows = await this.query<{ result: T }>(caller, call, values)
    return rows[0]!.result
  }

  /** Uploads a file as `caller` (the row Storage writes, under the same RLS). */
  async upload(caller: Caller, bucket: string, path: string): Promise<void> {
    await this.query(caller, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path])
  }

  /** As the database owner, bypassing RLS: for looking at what is really stored. */
  async superuser<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
    return (await this.pg.query<R>(sql, params)).rows
  }

  async close(): Promise<void> {
    await this.pg.close()
  }
}

export async function rejection(promise: Promise<unknown>): Promise<DatabaseError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof DatabaseError) return error
    throw error
  }
  throw new Error('expected the database to refuse')
}
