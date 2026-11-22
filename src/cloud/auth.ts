/**
 * Accounts: what WebTown needs from Supabase Auth (`AuthPort`, implemented in `supabase-backend.ts`) and the
 * rules for starting, playing as a guest, logging in, upgrading a guest and logging out
 * (`SessionController`). Pure TypeScript; tests drive it with a fake port.
 */

export interface AuthUser {
  id: string
  /** A guest: signed in anonymously, no email or password yet. */
  isAnonymous: boolean
  /** The confirmed email, if any. */
  email: string | null
  /** An email waiting for confirmation (a guest upgrading, or an email change). */
  pendingEmail: string | null
}

export type AuthErrorCode =
  | 'email_exists'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'weak_password'
  | 'invalid_email'
  | 'rate_limited'
  | 'guests_disabled'
  | 'network'
  | 'unknown'

/** An auth failure with a message for the player. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthPort {
  /** The user of the session saved in this browser, or null. Never creates one. */
  restore(): Promise<AuthUser | null>
  signInAnonymously(): Promise<AuthUser>
  /** A new permanent account. `confirmationSent` when the email must be confirmed before logging in. */
  signUp(email: string, password: string, redirectTo: string): Promise<{ user: AuthUser | null; confirmationSent: boolean }>
  signIn(email: string, password: string): Promise<AuthUser>
  signOut(): Promise<void>
  /** Links an email to the signed-in user (keeps the user id); a confirmation link is sent. */
  linkEmail(email: string, redirectTo: string): Promise<AuthUser>
  setPassword(password: string): Promise<AuthUser>
  /** The signed-in user as the server knows it now (after a confirmation link was used). */
  refresh(): Promise<AuthUser | null>
  /** Session changes made elsewhere (another tab, a confirmation link, token expiry). */
  onChange(listener: (user: AuthUser | null) => void): () => void
}

// ── Validation ───────────────────────────────────────────────────────────────

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72

/** Why an email cannot be used, or null. Deliberately simple: the server has the final word. */
export function emailProblem(email: string): string | null {
  const e = email.trim()
  if (e === '') return 'Type your email address.'
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'That does not look like an email address.'
  return null
}

export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  if (confirm !== undefined && confirm !== password) return 'The two passwords are different.'
  return null
}

// ── The session ──────────────────────────────────────────────────────────────

export type SessionState =
  | { status: 'starting' }
  /** No session, after the player logged out (or guests are turned off): show the start screen. */
  | { status: 'signed-out'; notice: string | null }
  | { status: 'signed-in'; user: AuthUser }
  /** A session could not be made or restored for a reason other than "logged out" (usually the network). */
  | { status: 'failed'; message: string }

/**
 * The player's session. On the first visit (no saved session) it signs in a guest straight away, so play
 * starts without a form; a reload restores the saved session, so the same guest comes back. After an
 * explicit log out it waits on the start screen instead of quietly making a new guest.
 */
export class SessionController {
  private state: SessionState = { status: 'starting' }
  private listeners = new Set<(state: SessionState) => void>()
  private stopWatching: (() => void) | null = null

  constructor(private readonly auth: AuthPort, private readonly redirectTo: string) {}

  get current(): SessionState {
    return this.state
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  async start(): Promise<SessionState> {
    this.set({ status: 'starting' })
    this.watch()
    try {
      const saved = await this.auth.restore()
      if (saved) return this.set({ status: 'signed-in', user: saved })
      return this.set({ status: 'signed-in', user: await this.auth.signInAnonymously() })
    } catch (error) {
      return this.fail(error)
    }
  }

  /** From the start screen: a new guest. */
  async playAsGuest(): Promise<SessionState> {
    try {
      return this.set({ status: 'signed-in', user: await this.auth.signInAnonymously() })
    } catch (error) {
      return this.fail(error)
    }
  }

  /** Logs in to a permanent account. Rejects with `AuthError` and leaves the state alone on failure. */
  async signIn(email: string, password: string): Promise<SessionState> {
    const user = await this.auth.signIn(email.trim(), password)
    return this.set({ status: 'signed-in', user })
  }

  /** Creates a permanent account (from the start screen, not a guest upgrade). */
  async signUp(email: string, password: string): Promise<{ state: SessionState; confirmationSent: boolean }> {
    const result = await this.auth.signUp(email.trim(), password, this.redirectTo)
    if (result.user && !result.confirmationSent) return { state: this.set({ status: 'signed-in', user: result.user }), confirmationSent: false }
    return { state: this.state, confirmationSent: true }
  }

  async signOut(): Promise<SessionState> {
    try {
      await this.auth.signOut()
    } catch (error) {
      // Signing out locally always works; a network failure only means the server forgets it later.
      console.warn('[WebTown] Sign-out did not reach the server.', error)
    }
    return this.set({ status: 'signed-out', notice: null })
  }

  /** Guest upgrade, step 1: link an email. The user id stays the same, so all progress stays with it. */
  async linkEmail(email: string): Promise<AuthUser> {
    const user = await this.auth.linkEmail(email.trim(), this.redirectTo)
    if (this.state.status === 'signed-in') this.set({ status: 'signed-in', user })
    return user
  }

  /** Guest upgrade, step 2 (after the email is confirmed), and changing a password. */
  async setPassword(password: string): Promise<AuthUser> {
    const user = await this.auth.setPassword(password)
    if (this.state.status === 'signed-in') this.set({ status: 'signed-in', user })
    return user
  }

  /** Re-reads the user from the server (for "I've confirmed my email"). */
  async refresh(): Promise<AuthUser | null> {
    const user = await this.auth.refresh()
    if (user && this.state.status === 'signed-in' && user.id === this.state.user.id) this.set({ status: 'signed-in', user })
    return user
  }

  dispose(): void {
    this.stopWatching?.()
    this.stopWatching = null
    this.listeners.clear()
  }

  private watch(): void {
    if (this.stopWatching) return
    this.stopWatching = this.auth.onChange(user => {
      const s = this.state
      if (user && s.status === 'signed-in') {
        // Same person, newer details (confirmed email), or a different account signed in in another tab.
        this.set({ status: 'signed-in', user })
      } else if (!user && s.status === 'signed-in') {
        this.set({ status: 'signed-out', notice: 'You were signed out (perhaps in another tab).' })
      }
    })
  }

  private fail(error: unknown): SessionState {
    if (error instanceof AuthError && error.code === 'guests_disabled') {
      return this.set({ status: 'signed-out', notice: 'Guest play is turned off on this WebTown server. Log in or create an account.' })
    }
    const message = error instanceof AuthError ? error.message : "Couldn't reach WebTown. Check your connection and try again."
    console.error('[WebTown] Could not start a session.', error)
    return this.set({ status: 'failed', message })
  }

  private set(state: SessionState): SessionState {
    this.state = state
    for (const listener of [...this.listeners]) listener(state)
    return state
  }
}
