import { Suspense, lazy, useEffect, useState } from 'react'
import type { CloudBackend } from '../../cloud/backend'
import { emitAppCommand, onAppState, type AppCommand } from '../../lib/app-bridge'
import type { RealtimeTransport } from '../../multiplayer/transport'
import { AppErrorBoundary } from '../apps/AppErrorBoundary'
import { WindowFrame } from '../apps/WindowFrame'

/** Downloaded only when someone uses the Hall's kiosk. */
const CommunityWebsiteApp = lazy(() => import('./CommunityWebsiteApp'))

export interface CommunityWebsiteHostProps {
  transport: RealtimeTransport
  backend: CloudBackend
  worldId: string
  userId: string
  /** Where commands go; the event bus by default. Injectable for tests. */
  sendCommand?: (command: AppCommand) => void
}

/**
 * Shows the Community Website when the Hall's kiosk says so (app `community-website` on the app bridge). Lives with
 * the multiplayer session, as the canvas does, because it needs the town's backend and realtime connection.
 */
export function CommunityWebsiteHost({ transport, backend, worldId, userId, sendCommand = emitAppCommand }: CommunityWebsiteHostProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  useEffect(() => onAppState(view => setOpen(view.open === 'community-website')), [])
  if (!open) return null

  const close = (): void => sendCommand({ type: 'close' })
  return (
    <AppErrorBoundary onError={close}>
      <Suspense fallback={<WindowFrame title="Community Website" onClose={close}><p role="status" style={{ margin: 0 }}>Opening the Community Website...</p></WindowFrame>}>
        <CommunityWebsiteApp transport={transport} backend={backend} worldId={worldId} userId={userId} onClosed={close} />
      </Suspense>
    </AppErrorBoundary>
  )
}
