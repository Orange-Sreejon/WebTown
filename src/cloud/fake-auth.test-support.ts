import { AuthError, type AuthPort, type AuthUser } from './auth'

/**
 * Test support: Supabase Auth's behaviour that WebTown relies on, in memory. The "browser" (saved session)
 * survives creating a new port with the same `FakeAuthServer`, as a reload would. Anonymous users keep their id
 * when an email is linked; an email already registered is refused with `email_exists`; linking sends a
 * confirmation that `confirm(email)` stands in for; signing up requires confirmation when `confirmations` is on.
 */
interface StoredUser {
  id: string
  email: string | null
  pendingEmail: string | null
  password: string | null
  anonymous: boolean
}

export class FakeAuthServer {
  readonly users = new Map<string, StoredUser>()
  /** The session saved in "this browser". */
  savedSession: string | null = null
  confirmations = true
  guestsEnabled = true
  offline = false
  private seq = 0
  private listeners = new Set<(user: AuthUser | null) => void>()
  readonly calls: string[] = []

  newId(): string {
    this.seq++
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`
  }

  view(id: string | null): AuthUser | null {
    const u = id ? this.users.get(id) : undefined
    return u ? { id: u.id, isAnonymous: u.anonymous, email: u.email, pendingEmail: u.pendingEmail } : null
  }

  /** Someone opened the confirmation link. */
  confirm(email: string): void {
    for (const u of this.users.values()) {
      if (u.pendingEmail === email) {
        u.email = email
        u.pendingEmail = null
        u.anonymous = false
      }
    }
  }

  /** A permanent account that already exists. */
  addAccount(email: string, password: string): string {
    const id = this.newId()
    this.users.set(id, { id, email, pendingEmail: null, password, anonymous: false })
    return id
  }

  emit(): void {
    const user = this.view(this.savedSession)
    for (const l of [...this.listeners]) l(user)
  }

  port(): AuthPort {
    const s = this
    const guard = (name: string): void => {
      s.calls.push(name)
      if (s.offline) throw new AuthError('network', "Couldn't reach WebTown. Check your connection and try again.")
    }
    const signedIn = (): StoredUser => {
      const u = s.savedSession ? s.users.get(s.savedSession) : undefined
      if (!u) throw new AuthError('unknown', 'Not signed in')
      return u
    }
    const taken = (email: string, except?: string): boolean =>
      [...s.users.values()].some(u => u.id !== except && (u.email === email || u.pendingEmail === email))
    return {
      async restore() {
        s.calls.push('restore')
        return s.view(s.savedSession)
      },
      async signInAnonymously() {
        guard('signInAnonymously')
        if (!s.guestsEnabled) throw new AuthError('guests_disabled', 'Guest play is turned off on this WebTown server.')
        const id = s.newId()
        s.users.set(id, { id, email: null, pendingEmail: null, password: null, anonymous: true })
        s.savedSession = id
        return s.view(id)!
      },
      async signUp(email, password) {
        guard('signUp')
        if (taken(email)) return { user: null, confirmationSent: true }
        const id = s.newId()
        s.users.set(id, { id, email: s.confirmations ? null : email, pendingEmail: s.confirmations ? email : null, password, anonymous: false })
        if (s.confirmations) return { user: s.view(id), confirmationSent: true }
        s.savedSession = id
        return { user: s.view(id), confirmationSent: false }
      },
      async signIn(email, password) {
        guard('signIn')
        const u = [...s.users.values()].find(x => x.email === email || x.pendingEmail === email)
        if (!u || u.password !== password) throw new AuthError('invalid_credentials', 'That email and password do not match an account.')
        if (u.email !== email) throw new AuthError('email_not_confirmed', 'Confirm your email first.')
        s.savedSession = u.id
        return s.view(u.id)!
      },
      async signOut() {
        s.calls.push('signOut')
        s.savedSession = null
      },
      async linkEmail(email) {
        guard('linkEmail')
        const u = signedIn()
        if (taken(email, u.id)) throw new AuthError('email_exists', 'That email already has a WebTown account.')
        u.pendingEmail = email
        if (!s.confirmations) s.confirm(email)
        return s.view(u.id)!
      },
      async setPassword(password) {
        guard('setPassword')
        const u = signedIn()
        if (u.anonymous) throw new AuthError('unknown', 'Confirm your email first.')
        u.password = password
        return s.view(u.id)!
      },
      async refresh() {
        guard('refresh')
        return s.view(s.savedSession)
      },
      onChange(listener) {
        s.listeners.add(listener)
        return () => void s.listeners.delete(listener)
      },
    }
  }
}
