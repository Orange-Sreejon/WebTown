import { CloudError, type Bucket, type CloudBackend } from '../backend'
import { DatabaseError, TestDatabase, type Caller } from './test-database.test-support'

/**
 * Test support: WebTown's backend port on a real PostgreSQL (`TestDatabase`). Function calls run as the given
 * user under RLS, like `supabase.rpc`. Storage keeps the bytes in memory but records each file as a row in
 * `storage.objects` under the same RLS, so who may upload, read and remove is decided by the real policies.
 */
export class FileStore {
  readonly bytes = new Map<string, ArrayBuffer>()
}

export interface TestBackend extends CloudBackend {
  /** Make every following call fail as if the network were down, until set back. */
  offline: boolean
  calls: string[]
}

export function testBackend(db: TestDatabase, caller: Caller, files = new FileStore()): TestBackend {
  const wrap = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    backend.calls.push(name)
    if (backend.offline) throw new CloudError('network', 'Failed to fetch')
    try {
      return await run()
    } catch (error) {
      if (error instanceof DatabaseError) throw new CloudError(error.code, error.message, error)
      throw error
    }
  }
  const key = (bucket: Bucket, path: string): string => `${bucket}:${path}`
  const backend: TestBackend = {
    offline: false,
    calls: [],
    rpc: <T>(fn: string, args: Record<string, unknown> = {}) => wrap(`rpc:${fn}`, () => db.rpc<T>(caller, fn, args)),
    upload: (bucket, path, bytes) => wrap(`upload:${bucket}`, async () => {
      await db.upload(caller, bucket, path)
      files.bytes.set(key(bucket, path), bytes.slice(0))
    }),
    download: (bucket, path) => wrap(`download:${bucket}`, async () => {
      const rows = await db.query(caller, 'select name from storage.objects where bucket_id = $1 and name = $2', [bucket, path])
      const bytes = files.bytes.get(key(bucket, path))
      if (rows.length === 0 || !bytes) throw new CloudError('storage', 'Object not found')
      return bytes.slice(0)
    }),
    remove: (bucket, paths) => wrap(`remove:${bucket}`, async () => {
      const rows = await db.query<{ name: string }>(caller, 'delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, paths])
      for (const row of rows) files.bytes.delete(key(bucket, row.name))
    }),
  }
  return backend
}
