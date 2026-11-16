import { useId } from 'react'
import type { AppView } from '../../lib/app-bridge'
import { WindowFrame } from './WindowFrame'

interface PlaceholderAppProps {
  view: AppView
  onClose: () => void
}

const TITLES = { website: 'Computer', paint: 'Sketchbook' } as const

/**
 * Stand-in window for P3-02, so the open / freeze / close round trip can be
 * verified before the real apps exist. The text field is there to prove that
 * W, A, S, D, E and the arrow keys reach React while an app is open. Replaced
 * by the website (P3-06) and WebTown Paint (P3-12).
 */
export function PlaceholderApp({ view, onClose }: PlaceholderAppProps): React.ReactElement | null {
  const inputId = useId()
  if (view.open === null) return null

  return (
    <WindowFrame title={`${TITLES[view.open]} (placeholder)`} onClose={onClose}>
      <p>
        House: <strong data-testid="app-house">{view.houseId}</strong>
        {' | '}
        Mode: <strong data-testid="app-mode">{view.mode}</strong>
      </p>
      <p>The real app arrives in a later task. The player is frozen while this is open.</p>
      <label htmlFor={inputId}>Typing test: </label>
      <input id={inputId} type="text" autoComplete="off" />
    </WindowFrame>
  )
}
