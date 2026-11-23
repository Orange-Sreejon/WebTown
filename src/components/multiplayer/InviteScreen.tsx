import { useEffect, useState } from 'react'
import type { CloudBackend } from '../../cloud/backend'
import { InviteError, joinWorld, previewInvite, type InvitePreview } from '../../cloud/worlds'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import '../account/account.css'

export interface InviteScreenProps {
  backend: CloudBackend
  code: string
  /** Open this world (after joining it, or because the player is already in it). */
  onOpen: (worldId: string) => void
  /** Don't join; open the town the player would have opened anyway. */
  onSkip: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'preview'; preview: InvitePreview }
  | { kind: 'problem'; message: string; title: string }

const sentence = (error: unknown): { title: string; message: string } => {
  if (error instanceof InviteError) {
    if (error.problem === 'expired') return { title: 'This invitation has expired', message: 'Ask the town owner for a new one.' }
    if (error.problem === 'full') return { title: 'This town is full', message: error.message }
    return { title: "This invitation doesn't work", message: 'It may have been revoked or mistyped. Ask the town owner for a new one.' }
  }
  return { title: "Couldn't open the invitation", message: error instanceof PersonalSpacesError ? error.message : 'Please try again.' }
}

/** "Join <town>?" for a `?invite=` link: who invited you and how full the town is, then Join or Not now. */
export function InviteScreen({ backend, code, onOpen, onSkip }: InviteScreenProps): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    previewInvite(backend, code).then(
      preview => { if (live) setState({ kind: 'preview', preview }) },
      error => { if (live) setState({ kind: 'problem', ...sentence(error) }) },
    )
    return () => { live = false }
  }, [backend, code])

  const join = async (): Promise<void> => {
    setBusy(true)
    setJoinError(null)
    try {
      const { worldId } = await joinWorld(backend, code)
      onOpen(worldId)
    } catch (error) {
      const s = sentence(error)
      setJoinError(`${s.title}. ${s.message}`)
      setBusy(false)
    }
  }

  return (
    <main className="ac-screen">
      <div className="ac-card" role="dialog" aria-labelledby="mp-invite-title">
        <h1 className="ac-title" id="mp-invite-title">
          {state.kind === 'preview' ? `Join ${state.preview.worldName}?` : state.kind === 'problem' ? state.title : 'An invitation to WebTown'}
        </h1>
        {state.kind === 'loading' && <p className="ac-lead" role="status">Checking the invitation...</p>}
        {state.kind === 'problem' && <p className="ac-lead" role="alert">{state.message}</p>}
        {state.kind === 'preview' && (
          <>
            <p className="ac-lead">
              {state.preview.ownerName} invited you to their town. {state.preview.members} of {state.preview.max} players.
            </p>
            {state.preview.alreadyMember ? (
              <p className="ac-text">You're already in this town.</p>
            ) : state.preview.members >= state.preview.max ? (
              <p className="ac-error" role="alert">This town is full.</p>
            ) : (
              <p className="ac-text">You'll get your own empty house there. Your own town stays as it is.</p>
            )}
            {joinError && <p className="ac-error" role="alert">{joinError}</p>}
          </>
        )}
        <div className="ac-buttons">
          {state.kind === 'preview' && state.preview.alreadyMember && (
            <button type="button" className="ac-button ac-button--primary" onClick={() => onOpen(state.preview.worldId)}>Open the town</button>
          )}
          {state.kind === 'preview' && !state.preview.alreadyMember && state.preview.members < state.preview.max && (
            <button type="button" className="ac-button ac-button--primary" disabled={busy} onClick={() => void join()}>
              {busy ? 'Joining...' : 'Join'}
            </button>
          )}
          <button type="button" className="ac-button" disabled={busy} onClick={onSkip}>
            {state.kind === 'problem' ? 'Open my town' : 'Not now'}
          </button>
        </div>
      </div>
    </main>
  )
}
