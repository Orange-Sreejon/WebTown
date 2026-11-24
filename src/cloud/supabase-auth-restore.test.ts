import { describe, expect, it } from 'vitest'
import { supabaseAuth, type AuthClientLike } from './supabase-backend'

/**
 * Stabilization P1: restoring the saved session must never forget a session that still works. Forgetting a guest's
 * session loses their town (and every town they joined) for good, so it happens only when the server refuses the
 * session itself (the refresh), never for a refused access token alone (e.g. a device clock running behind), a
 * network failure or a server error.
 */

const USER = { id: '00000000-0000-4000-8000-000000000001', is_anonymous: true, email: undefined, email_confirmed_at: undefined, new_email: undefined }
type Answer = { status: number } | null

function client(answers: { getUser: Answer; refresh?: Answer; session?: boolean }) {
  const calls: string[] = []
  const fake = {
    auth: {
      async getSession() {
        calls.push('getSession')
        return { data: { session: answers.session === false ? null : { user: USER } }, error: null }
      },
      async getUser() {
        calls.push('getUser')
        return answers.getUser ? { data: { user: null }, error: answers.getUser } : { data: { user: USER }, error: null }
      },
      async refreshSession() {
        calls.push('refreshSession')
        const e = answers.refresh ?? null
        return e ? { data: { user: null, session: null }, error: e } : { data: { user: USER, session: { user: USER } }, error: null }
      },
      async signOut(options: { scope: string }) {
        calls.push(`signOut:${options.scope}`)
        return { error: null }
      },
    },
  }
  return { client: fake as unknown as AuthClientLike, calls }
}

describe('restoring the saved session', () => {
  it('keeps a session the server accepts', async () => {
    const { client: c, calls } = client({ getUser: null })
    expect((await supabaseAuth(c).restore())?.id).toBe(USER.id)
    expect(calls).toEqual(['getSession', 'getUser'])
  })

  it('keeps a session whose access token is refused but whose refresh works (a clock running behind)', async () => {
    for (const status of [401, 403]) {
      const { client: c, calls } = client({ getUser: { status }, refresh: null })
      expect((await supabaseAuth(c).restore())?.id, String(status)).toBe(USER.id)
      expect(calls, String(status)).toEqual(['getSession', 'getUser', 'refreshSession'])
    }
  })

  it('forgets, locally only, a session the server refuses to refresh (unknown, revoked or deleted)', async () => {
    for (const status of [400, 401, 403, 404]) {
      const { client: c, calls } = client({ getUser: { status: 403 }, refresh: { status } })
      expect(await supabaseAuth(c).restore(), String(status)).toBeNull()
      expect(calls, String(status)).toEqual(['getSession', 'getUser', 'refreshSession', 'signOut:local'])
    }
  })

  it('keeps the saved user when the server cannot be reached or fails, or rate-limits', async () => {
    for (const [getUser, refresh] of [[{ status: 0 }, null], [{ status: 503 }, null], [{ status: 429 }, null], [{ status: 403 }, { status: 0 }], [{ status: 403 }, { status: 500 }], [{ status: 403 }, { status: 429 }]] as const) {
      const { client: c, calls } = client({ getUser, refresh })
      expect((await supabaseAuth(c).restore())?.id, JSON.stringify([getUser, refresh])).toBe(USER.id)
      expect(calls).not.toContain('signOut:local')
    }
  })

  it('returns no user when nothing is saved, without asking the server', async () => {
    const { client: c, calls } = client({ getUser: null, session: false })
    expect(await supabaseAuth(c).restore()).toBeNull()
    expect(calls).toEqual(['getSession'])
  })
})
