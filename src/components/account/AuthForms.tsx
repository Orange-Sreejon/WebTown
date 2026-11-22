import { useId, useState, type ReactNode } from 'react'
import { AuthError, emailProblem, passwordProblem } from '../../cloud/auth'

/** Runs an account action with busy and error states. Errors come back as a sentence for the player. */
export function useAction(): { busy: boolean; error: string | null; run: (action: () => Promise<unknown>) => Promise<boolean>; setError: (e: string | null) => void } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(e instanceof AuthError || e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

export function Field({ label, type = 'text', value, onChange, autoComplete, invalid }: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  invalid?: boolean
}): React.ReactElement {
  const id = useId()
  return (
    <label className="ac-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        className="ac-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

export function FormError({ message }: { message: string | null }): React.ReactElement | null {
  return message ? <p className="ac-error" role="alert">{message}</p> : null
}

export interface LoginFormProps {
  initialEmail?: string
  submitLabel?: string
  onSubmit: (email: string, password: string) => Promise<unknown>
  /** Something that must be acknowledged first (a guest leaving their progress behind). */
  confirm?: ReactNode
  children?: ReactNode
}

export function LoginForm({ initialEmail = '', submitLabel = 'Log in', onSubmit, confirm, children }: LoginFormProps): React.ReactElement {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(confirm === undefined)
  const { busy, error, run, setError } = useAction()
  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault()
        const problem = emailProblem(email) ?? (password === '' ? 'Type your password.' : null)
        if (problem) { setError(problem); return }
        void run(() => onSubmit(email, password))
      }}
    >
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      {confirm !== undefined && (
        <label className="ac-check">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span>{confirm}</span>
        </label>
      )}
      <FormError message={error} />
      <div className="ac-buttons">
        <button type="submit" className="ac-button ac-button--primary" disabled={busy || !agreed}>{busy ? 'Logging in...' : submitLabel}</button>
        {children}
      </div>
    </form>
  )
}

export function SignUpForm({ onSubmit, children }: { onSubmit: (email: string, password: string) => Promise<{ confirmationSent: boolean }>; children?: ReactNode }): React.ReactElement {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { busy, error, run, setError } = useAction()
  if (sentTo) {
    return (
      <div role="status">
        <p className="ac-good">Check {sentTo} for a confirmation link.</p>
        <p className="ac-text">Open it, then log in here with your email and password.</p>
        <div className="ac-buttons">{children}</div>
      </div>
    )
  }
  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault()
        const problem = emailProblem(email) ?? passwordProblem(password, again)
        if (problem) { setError(problem); return }
        void run(async () => {
          const result = await onSubmit(email, password)
          if (result.confirmationSent) setSentTo(email.trim())
        })
      }}
    >
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field label="Password (at least 8 characters)" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      <Field label="Password again" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
      <FormError message={error} />
      <div className="ac-buttons">
        <button type="submit" className="ac-button ac-button--primary" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
        {children}
      </div>
    </form>
  )
}
