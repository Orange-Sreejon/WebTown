import { useState } from 'react'
import { AuthError, emailProblem, passwordProblem, type AuthUser } from '../../cloud/auth'
import type { Profile } from '../../cloud/player'
import { WindowFrame } from '../apps/WindowFrame'
import { Field, FormError, LoginForm, useAction } from './AuthForms'
import { KeyboardShield } from './KeyboardShield'
import { AVATARS, AVATAR_LABELS, avatarFor, type AvatarId } from '../../game/systems/avatars'
import './account.css'

/** What the panel may do. Supplied by the session gate; nothing here talks to a backend directly. */
export interface AccountActions {
  linkEmail(email: string): Promise<AuthUser>
  refresh(): Promise<AuthUser | null>
  setPassword(password: string): Promise<AuthUser>
  signIn(email: string, password: string): Promise<unknown>
  signOut(): Promise<unknown>
  updateProfile(change: { displayName?: string; avatar?: string; settings?: Record<string, unknown> }): Promise<Profile>
}

export interface AccountPanelProps {
  user: AuthUser
  profile: Profile
  actions: AccountActions
  onClose: () => void
}

export const GUEST_RISK =
  "You're playing as a guest. Your town is saved to a guest account that only this browser can open: if you clear " +
  "your browser data, use another device or log out, it can't be recovered."

/**
 * The account window: name, and either making a guest permanent (email, confirm, password) or, for an account,
 * its email, password and logging out. Key presses stay in the window (`KeyboardShield`).
 */
export function AccountPanel({ user, profile, actions, onClose }: AccountPanelProps): React.ReactElement {
  const [view, setView] = useState<'main' | 'login'>('main')
  const [prefill, setPrefill] = useState('')
  // Only a guest who linked an email has no password yet; accounts made with Sign up always have one.
  const needsPassword = !user.isAnonymous && profile.settings['passwordNeeded'] === true

  return (
    <KeyboardShield>
      <WindowFrame title={user.isAnonymous ? 'Your guest account' : 'Your account'} onClose={onClose}>
        <div className="ac-panel">
          {view === 'login' ? (
            <section className="ac-section">
              <h2 className="ac-heading">Log in to another account</h2>
              <LoginForm
                initialEmail={prefill}
                onSubmit={actions.signIn}
                confirm={user.isAnonymous ? 'I understand my guest progress stays with this guest and will not move to that account. I will not be able to come back to it.' : undefined}
              >
                <button type="button" className="ac-button" onClick={() => setView('main')}>Back</button>
              </LoginForm>
            </section>
          ) : (
            <>
              <DisplayName profile={profile} actions={actions} />
              <Look userId={user.id} profile={profile} actions={actions} />
              {user.pendingEmail !== null ? (
                <PendingEmail email={user.pendingEmail} actions={actions} />
              ) : user.isAnonymous ? (
                <Upgrade actions={actions} profile={profile} onExisting={email => { setPrefill(email); setView('login') }} />
              ) : needsPassword ? (
                <ChoosePassword actions={actions} profile={profile} />
              ) : (
                <Permanent user={user} actions={actions} />
              )}
              {user.isAnonymous && user.pendingEmail === null && (
                <section className="ac-section">
                  <button type="button" className="ac-link" onClick={() => { setPrefill(''); setView('login') }}>
                    I already have an account
                  </button>
                </section>
              )}
            </>
          )}
        </div>
      </WindowFrame>
    </KeyboardShield>
  )
}

function DisplayName({ profile, actions }: { profile: Profile; actions: AccountActions }): React.ReactElement {
  const [name, setName] = useState(profile.displayName)
  const [saved, setSaved] = useState(false)
  const { busy, error, run, setError } = useAction()
  return (
    <section className="ac-section">
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault()
          const n = name.trim()
          if (n.length < 1 || n.length > 40) { setError('A name is 1 to 40 characters.'); return }
          setSaved(false)
          void run(async () => { await actions.updateProfile({ displayName: n }); setSaved(true) })
        }}
      >
        <Field label="Your name in WebTown" value={name} onChange={v => { setName(v); setSaved(false) }} autoComplete="nickname" />
        <FormError message={error} />
        {saved && <p className="ac-good" role="status">Saved.</p>}
        <button type="submit" className="ac-button" disabled={busy || name.trim() === profile.displayName}>Save name</button>
      </form>
    </section>
  )
}

/** The colour of the player's character; others see it too. Applies the next time the town opens. */
function Look({ userId, profile, actions }: { userId: string; profile: Profile; actions: AccountActions }): React.ReactElement {
  const current = avatarFor(profile.avatar, userId)
  const [saved, setSaved] = useState<AvatarId | null>(null)
  const { busy, error, run } = useAction()
  return (
    <section className="ac-section" aria-labelledby="ac-look">
      <h2 className="ac-heading" id="ac-look">Your look</h2>
      <div className="ac-buttons" role="group" aria-label="Character colour">
        {AVATARS.map(look => (
          <button key={look} type="button" className="ac-button" aria-pressed={look === current} disabled={busy}
            onClick={() => void run(async () => { await actions.updateProfile({ avatar: look }); setSaved(look) })}>
            {AVATAR_LABELS[look]}
          </button>
        ))}
      </div>
      <FormError message={error} />
      {saved && <p className="ac-good" role="status">Saved. Your new look shows the next time the town opens.</p>}
    </section>
  )
}

function Upgrade({ actions, profile, onExisting }: { actions: AccountActions; profile: Profile; onExisting: (email: string) => void }): React.ReactElement {
  const [email, setEmail] = useState('')
  const [exists, setExists] = useState(false)
  const { busy, error, run, setError } = useAction()
  return (
    <section className="ac-section">
      <h2 className="ac-heading">Keep your progress</h2>
      <p className="ac-text">{GUEST_RISK}</p>
      <p className="ac-text">Add your email to make this a permanent account. Everything you have made stays exactly as it is, and you can then log in on any device.</p>
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault()
          const problem = emailProblem(email)
          if (problem) { setError(problem); return }
          setExists(false)
          void run(async () => {
            try {
              await actions.linkEmail(email)
              // Remembered in the profile, so the password step is offered on any device once the email is confirmed.
              await actions.updateProfile({ settings: { ...profile.settings, passwordNeeded: true } })
            } catch (err) {
              if (err instanceof AuthError && err.code === 'email_exists') setExists(true)
              throw err
            }
          })
        }}
      >
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <FormError message={error} />
        {exists && (
          <div className="ac-text" role="status">
            <p className="ac-text">
              Nothing was changed: that account and this guest stay separate, and neither is merged into the other. You can keep
              playing as this guest, or log in to that account (this guest's progress stays here and will not move with you).
            </p>
            <button type="button" className="ac-link" onClick={() => onExisting(email.trim())}>Log in to that account instead</button>
          </div>
        )}
        <div className="ac-buttons">
          <button type="submit" className="ac-button ac-button--primary" disabled={busy}>{busy ? 'Sending...' : 'Send confirmation link'}</button>
        </div>
      </form>
      {profile.settings['upgradeHintDismissed'] !== true && (
        <p className="ac-text" style={{ marginTop: 10 }}>
          <button type="button" className="ac-link" onClick={() => void actions.updateProfile({ settings: { ...profile.settings, upgradeHintDismissed: true } })}>
            Hide the reminder on the Guest button
          </button>
        </p>
      )}
    </section>
  )
}

function PendingEmail({ email, actions }: { email: string; actions: AccountActions }): React.ReactElement {
  const { busy, error, run } = useAction()
  const [note, setNote] = useState<string | null>(null)
  return (
    <section className="ac-section">
      <h2 className="ac-heading">Confirm your email</h2>
      <p className="ac-text">We sent a link to <strong>{email}</strong>. Open it to confirm the address; then you can choose a password here.</p>
      <p className="ac-text">Until then you are still a guest, and your progress is safe in this browser.</p>
      <FormError message={error} />
      {note && <p className="ac-text" role="status">{note}</p>}
      <div className="ac-buttons">
        <button type="button" className="ac-button ac-button--primary" disabled={busy} onClick={() => void run(async () => {
          const user = await actions.refresh()
          if (user?.pendingEmail) setNote('Not confirmed yet. Open the link in the email, then try again.')
        })}>
          I've confirmed it
        </button>
        <button type="button" className="ac-button" disabled={busy} onClick={() => void run(async () => {
          await actions.linkEmail(email)
          setNote('Sent again.')
        })}>
          Send again
        </button>
      </div>
    </section>
  )
}

function ChoosePassword({ actions, profile }: { actions: AccountActions; profile: Profile }): React.ReactElement {
  return (
    <section className="ac-section">
      <h2 className="ac-heading">Choose a password</h2>
      <p className="ac-text">Your email is confirmed and your account is permanent. Choose a password so you can log in on other devices.</p>
      <PasswordForm actions={actions} profile={profile} submitLabel="Set password" />
    </section>
  )
}

function Permanent({ user, actions }: { user: AuthUser; actions: AccountActions }): React.ReactElement {
  const out = useAction()
  const [changing, setChanging] = useState(false)
  return (
    <>
      <section className="ac-section">
        <h2 className="ac-heading">Account</h2>
        <p className="ac-text">Logged in as <strong>{user.email}</strong>. Your town is saved to your account and you can log in on any device.</p>
        {changing ? <PasswordForm actions={actions} submitLabel="Change password" /> : (
          <button type="button" className="ac-link" onClick={() => setChanging(true)}>Change password</button>
        )}
      </section>
      <section className="ac-section">
        <FormError message={out.error} />
        <button type="button" className="ac-button" disabled={out.busy} onClick={() => void out.run(actions.signOut)}>Log out</button>
      </section>
    </>
  )
}

function PasswordForm({ actions, profile, submitLabel, onDone }: { actions: AccountActions; profile?: Profile; submitLabel: string; onDone?: () => void }): React.ReactElement {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, run, setError } = useAction()
  if (done) return <p className="ac-good" role="status">Password saved.</p>
  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault()
        const problem = passwordProblem(password, again)
        if (problem) { setError(problem); return }
        void run(async () => {
          await actions.setPassword(password)
          if (profile) await actions.updateProfile({ settings: { ...profile.settings, passwordNeeded: false } })
          setDone(true)
          onDone?.()
        })
      }}
    >
      <Field label="New password (at least 8 characters)" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      <Field label="New password again" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
      <FormError message={error} />
      <button type="submit" className="ac-button ac-button--primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>
    </form>
  )
}
