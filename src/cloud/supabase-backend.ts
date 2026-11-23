import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { AuthError, type AuthErrorCode, type AuthPort, type AuthUser } from './auth'
import { CloudError, type Bucket, type CloudBackend } from './backend'
import type { CloudConfig } from './config'
import type { RealtimeTransport } from '../multiplayer/transport'

/**
 * WebTown on Supabase: the one module that talks to it. Auth (sessions are kept by supabase-js in this
 * browser's storage, as Supabase does by default), database functions and Storage, all with the publishable key
 * and the signed-in user's session. Everything the player may or may not do is enforced by the database.
 */
export interface SupabaseConnection {
  auth: AuthPort
  backend: CloudBackend
  realtime: RealtimeTransport
}

export function connectSupabase(config: CloudConfig): SupabaseConnection {
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    // A dropped connection is noticed within about 15 s instead of 25 s.
    realtime: { heartbeatIntervalMs: 15_000 },
  })
  return { auth: supabaseAuth(client), backend: supabaseBackend(client), realtime: supabaseRealtime(client) }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    isAnonymous: user.is_anonymous === true,
    email: user.email && user.email_confirmed_at ? user.email : user.is_anonymous ? null : (user.email ?? null),
    pendingEmail: user.new_email ?? (user.is_anonymous && user.email && !user.email_confirmed_at ? user.email : null),
  }
}

const MESSAGES: Record<AuthErrorCode, string> = {
  email_exists: 'That email already has a WebTown account.',
  invalid_credentials: 'That email and password do not match an account.',
  email_not_confirmed: 'Confirm your email first: open the link we sent you, then log in.',
  weak_password: 'Choose a stronger password.',
  invalid_email: 'That does not look like an email address.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  guests_disabled: 'Guest play is turned off on this WebTown server.',
  network: "Couldn't reach WebTown. Check your connection and try again.",
  unknown: 'Something went wrong with your account. Please try again.',
}

/** Supabase Auth's error codes (https://supabase.com/docs/guides/auth/debugging/error-codes) to ours. */
export function toAuthError(error: unknown): AuthError {
  const e = error as { code?: string; name?: string; status?: number; message?: string } | null
  const code = e?.code ?? ''
  let ours: AuthErrorCode = 'unknown'
  if (code === 'email_exists' || code === 'user_already_exists' || code === 'identity_already_exists') ours = 'email_exists'
  else if (code === 'invalid_credentials') ours = 'invalid_credentials'
  else if (code === 'email_not_confirmed') ours = 'email_not_confirmed'
  else if (code === 'weak_password' || code === 'same_password') ours = 'weak_password'
  else if (code === 'email_address_invalid' || code === 'validation_failed') ours = 'invalid_email'
  else if (code.startsWith('over_') && code.endsWith('_rate_limit')) ours = 'rate_limited'
  else if (code === 'anonymous_provider_disabled') ours = 'guests_disabled'
  else if (e?.name === 'AuthRetryableFetchError' || e?.status === 0) ours = 'network'
  const message = ours === 'weak_password' && code === 'same_password' ? 'Choose a password different from the current one.' : MESSAGES[ours]
  return new AuthError(ours, message, error)
}

function supabaseAuth(client: SupabaseClient): AuthPort {
  const need = (user: User | null | undefined): AuthUser => {
    if (!user) throw new AuthError('unknown', MESSAGES.unknown)
    return toAuthUser(user)
  }
  return {
    async restore() {
      const { data, error } = await client.auth.getSession()
      if (error) throw toAuthError(error)
      return data.session?.user ? toAuthUser(data.session.user) : null
    },
    async signInAnonymously() {
      const { data, error } = await client.auth.signInAnonymously()
      if (error) throw toAuthError(error)
      return need(data.user)
    },
    async signUp(email, password, redirectTo) {
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
      if (error) throw toAuthError(error)
      // With email confirmation on, there is no session until the link is used (and an address that is
      // already registered looks the same, so nobody can probe which emails have accounts).
      return { user: data.user ? toAuthUser(data.user) : null, confirmationSent: data.session === null }
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw toAuthError(error)
      return need(data.user)
    },
    async signOut() {
      const { error } = await client.auth.signOut()
      if (error) throw toAuthError(error)
    },
    async linkEmail(email, redirectTo) {
      const { data, error } = await client.auth.updateUser({ email }, { emailRedirectTo: redirectTo })
      if (error) throw toAuthError(error)
      return need(data.user)
    },
    async setPassword(password) {
      const { data, error } = await client.auth.updateUser({ password })
      if (error) throw toAuthError(error)
      return need(data.user)
    },
    async refresh() {
      const { data, error } = await client.auth.getUser()
      if (error) throw toAuthError(error)
      return data.user ? toAuthUser(data.user) : null
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // Supabase calls back inside its own lock; hand over outside it.
        setTimeout(() => listener(session?.user ? toAuthUser(session.user) : null), 0)
      })
      return () => data.subscription.unsubscribe()
    },
  }
}

// ── Database and Storage ─────────────────────────────────────────────────────

const storageError = (error: unknown): CloudError => {
  const e = error as { status?: number; statusCode?: string | number; message?: string; name?: string } | null
  const status = Number(e?.status ?? e?.statusCode ?? 0)
  if (status === 401 || status === 403) return new CloudError('42501', 'Not allowed.', error)
  if (status === 409) return new CloudError('23505', 'That file already exists.', error)
  if (status === 0 || e?.name === 'StorageUnknownError') return new CloudError('network', e?.message ?? 'network', error)
  return new CloudError('storage', e?.message ?? 'Storage failed', error)
}

function supabaseBackend(client: SupabaseClient): CloudBackend {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const { data, error } = await client.rpc(fn, args)
      if (error) throw new CloudError(error.code || 'network', error.message, error)
      return data as T
    },
    async upload(bucket: Bucket, path: string, bytes: ArrayBuffer, contentType: string) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false })
      if (error) throw storageError(error)
    },
    async download(bucket: Bucket, path: string) {
      const { data, error } = await client.storage.from(bucket).download(path)
      if (error) throw storageError(error)
      return data.arrayBuffer()
    },
    async remove(bucket: Bucket, paths: string[]) {
      if (paths.length === 0) return
      const { error } = await client.storage.from(bucket).remove(paths)
      if (error) throw storageError(error)
    },
  }
}

// ── Realtime (Phase 5) ────────────────────────────────────────────────────────────────────────────────────

/**
 * A world's channel on Supabase Realtime: private (authorised by RLS on `realtime.messages` with the user's
 * JWT, which supabase-js keeps up to date), presence keyed by the game session, broadcast to the others only.
 * supabase-js reconnects and rejoins by itself; the session re-tracks presence on every join. Nothing is sent
 * while the channel is not joined, so movement never falls back to Realtime's REST endpoint.
 */
function supabaseRealtime(client: SupabaseClient): RealtimeTransport {
  return {
    open(topic, presenceKey, events, handlers) {
      let left = false
      let joined = false
      const channel = client.channel(topic, {
        config: { private: true, broadcast: { self: false, ack: false }, presence: { key: presenceKey } },
      })
      channel.on('presence', { event: 'sync' }, () => {
        if (left) return
        const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>
        handlers.onPresence(new Map(Object.entries(state).map(([key, metas]) => [
          key, metas.map(({ presence_ref: _ref, ...meta }) => meta),
        ])))
      })
      for (const event of events) {
        channel.on('broadcast', { event }, message => { if (!left) handlers.onBroadcast(event, (message as { payload?: unknown }).payload) })
      }
      channel.subscribe((status, error) => {
        if (left) return
        joined = status === 'SUBSCRIBED'
        if (joined) {
          handlers.onStatus('joined')
          return
        }
        const message = error?.message ?? ''
        // Refused by the channel policy: retrying won't help.
        const fatal = status === 'CHANNEL_ERROR' && /unauthori[sz]ed|permission|not allowed|forbidden/i.test(message)
        handlers.onStatus(status === 'TIMED_OUT' ? 'timed_out' : status === 'CLOSED' ? 'closed' : 'error', { fatal, message })
      })
      return {
        track(meta) {
          if (!left && joined) void channel.track(meta).catch(() => undefined)
        },
        send(event, payload) {
          if (!left && joined) void channel.send({ type: 'broadcast', event, payload }).catch(() => undefined)
        },
        leave() {
          if (left) return
          left = true
          void client.removeChannel(channel).catch(() => undefined)
        },
      }
    },
  }
}