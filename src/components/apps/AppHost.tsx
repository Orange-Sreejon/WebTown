import { useEffect, useState } from 'react'
import {
  HIDDEN_APP_VIEW,
  emitAppCommand,
  onAppState,
  type AppCommand,
  type AppView,
} from '../../lib/app-bridge'
import { AppErrorBoundary } from './AppErrorBoundary'
import { PlaceholderApp } from './PlaceholderApp'

interface AppHostProps {
  /** Where commands go; the event bus by default. Injectable for tests. */
  sendCommand?: (command: AppCommand) => void
}

/**
 * Shows whichever app the interior scene says is open. It renders nothing
 * otherwise and sends only `close` back; it never reaches into Phaser.
 */
export function AppHost({ sendCommand = emitAppCommand }: AppHostProps): React.ReactElement | null {
  const [view, setView] = useState<AppView>(HIDDEN_APP_VIEW)

  useEffect(() => onAppState(setView), [])

  if (view.open === null) return null

  const close = (): void => sendCommand({ type: 'close' })

  // Keyed by app and house so a different app never inherits another's state.
  return (
    <AppErrorBoundary key={`${view.open}:${view.houseId}`} onError={close}>
      <PlaceholderApp view={view} onClose={close} />
    </AppErrorBoundary>
  )
}
