import { Suspense, lazy, useEffect, useState } from 'react'
import type { CloudBackend } from '../../cloud/backend'
import { emitAppCommand, onAppState, type AppCommand } from '../../lib/app-bridge'
import type { RealtimeTransport } from '../../multiplayer/transport'
import { AppErrorBoundary } from '../apps/AppErrorBoundary'
import { WindowFrame } from '../apps/WindowFrame'

/** The canvas code (session, renderer) is downloaded only when someone opens the easel. */
const CanvasApp = lazy(() => import('./CanvasApp'))

export interface CommunityCanvasHostProps {
  transport: RealtimeTransport
  backend: CloudBackend
  worldId: string
  userId: string
  /** Where commands go; the event bus by default. Injectable for tests. */
  sendCommand?: (command: AppCommand) => void
}

/**
 * Shows the Community Canvas when the Hall's easel says so (app `canvas` on the app bridge). Lives with the
 * multiplayer session, because the canvas needs the town's backend and realtime connection; houses' apps stay in
 * AppHost. Closing sends only `close` back to Phaser.
 */
export function CommunityCanvasHost({ transport, backend, worldId, userId, sendCommand = emitAppCommand }: CommunityCanvasHostProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  useEffect(() => onAppState(view => setOpen(view.open === 'canvas')), [])
  if (!open) return null

  const close = (): void => sendCommand({ type: 'close' })
  return (
    <AppErrorBoundary onError={close}>
      <Suspense fallback={<WindowFrame title="Community Canvas" onClose={close}><p role="status" style={{ margin: 0 }}>Opening the canvas...</p></WindowFrame>}>
        <CanvasApp transport={transport} backend={backend} worldId={worldId} userId={userId} onClosed={close} />
      </Suspense>
    </AppErrorBoundary>
  )
}
