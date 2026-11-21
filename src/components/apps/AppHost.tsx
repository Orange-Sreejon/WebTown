import { useEffect, useState } from 'react'
import {
  HIDDEN_APP_VIEW,
  emitAppCommand,
  onAppState,
  type AppCommand,
  type AppView,
} from '../../lib/app-bridge'
import type { SiteStorage } from '../../personal-spaces/composition'
import { AppErrorBoundary } from './AppErrorBoundary'
import { PaintApp } from './PaintApp'
import { WebsiteApp } from './WebsiteApp'

interface AppHostProps {
  /** Where commands go; the event bus by default. Injectable for tests. */
  sendCommand?: (command: AppCommand) => void
  /** Where website and Sketchbook storage comes from; the shared storage by default. Injectable for tests. */
  getSiteStorage?: () => Promise<SiteStorage>
}

/**
 * Shows whichever app the interior scene says is open. It renders nothing
 * otherwise and sends only `close` back; it never reaches into Phaser.
 */
export function AppHost({
  sendCommand = emitAppCommand,
  getSiteStorage,
}: AppHostProps): React.ReactElement | null {
  const [view, setView] = useState<AppView>(HIDDEN_APP_VIEW)

  useEffect(() => onAppState(setView), [])

  if (view.open === null) return null

  const close = (): void => sendCommand({ type: 'close' })

  // Keyed by app and house so a different app never inherits another's state.
  return (
    <AppErrorBoundary key={`${view.open}:${view.houseId}`} onError={close}>
      {view.open === 'website' ? (
        <WebsiteApp view={view} onClose={close} {...(getSiteStorage ? { getStorage: getSiteStorage } : {})} />
      ) : (
        <PaintApp view={view} onClose={close} {...(getSiteStorage ? { getStorage: getSiteStorage } : {})} />
      )}
    </AppErrorBoundary>
  )
}
