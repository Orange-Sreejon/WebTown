import { useState } from 'react'
import { LoginForm, SignUpForm, useAction, FormError } from './AuthForms'
import './account.css'

export interface StartScreenProps {
  notice: string | null
  onGuest: () => Promise<unknown>
  onLogin: (email: string, password: string) => Promise<unknown>
  onSignUp: (email: string, password: string) => Promise<{ confirmationSent: boolean }>
}

/**
 * Shown only when there is no session after the player logged out (a first visit goes straight in as a guest).
 * Play as a guest, log in, or create an account.
 */
export function StartScreen({ notice, onGuest, onLogin, onSignUp }: StartScreenProps): React.ReactElement {
  const [view, setView] = useState<'choose' | 'login' | 'signup'>('choose')
  const guest = useAction()
  return (
    <main className="ac-screen">
      <div className="ac-card">
        <h1 className="ac-title">WebTown</h1>
        <p className="ac-lead">Your house, your website, your sketchbook.</p>
        {notice && <p className="ac-text" role="status">{notice}</p>}
        {view === 'choose' && (
          <>
            <div className="ac-section">
              <button type="button" className="ac-button ac-button--primary" disabled={guest.busy} onClick={() => void guest.run(onGuest)}>
                {guest.busy ? 'Starting...' : 'Play as guest'}
              </button>
              <p className="ac-text" style={{ marginTop: 8 }}>No sign-up. You can add an email later to keep your progress.</p>
              <FormError message={guest.error} />
            </div>
            <div className="ac-section">
              <div className="ac-buttons">
                <button type="button" className="ac-button" onClick={() => setView('login')}>Log in</button>
                <button type="button" className="ac-button" onClick={() => setView('signup')}>Create an account</button>
              </div>
            </div>
          </>
        )}
        {view === 'login' && (
          <div className="ac-section">
            <h2 className="ac-heading">Log in</h2>
            <LoginForm onSubmit={onLogin}>
              <button type="button" className="ac-button" onClick={() => setView('choose')}>Back</button>
            </LoginForm>
          </div>
        )}
        {view === 'signup' && (
          <div className="ac-section">
            <h2 className="ac-heading">Create an account</h2>
            <SignUpForm onSubmit={onSignUp}>
              <button type="button" className="ac-button" onClick={() => setView('choose')}>Back</button>
            </SignUpForm>
          </div>
        )}
      </div>
    </main>
  )
}
