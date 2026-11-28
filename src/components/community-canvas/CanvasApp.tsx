import { useEffect, useState } from 'react'
import { newUuid, type CloudBackend } from '../../cloud/backend'
import type { RealtimeTransport } from '../../multiplayer/transport'
import { CanvasSession } from '../../community-canvas/session'
import { CanvasWindow } from './CanvasWindow'
import { ModerationPanel } from '../community-moderation/ModerationPanel'

export interface CanvasAppProps {
  transport: RealtimeTransport
  backend: CloudBackend
  worldId: string
  userId: string
  /** The window is gone (the player closed it). */
  onClosed: () => void
}

/**
 * The Community Canvas while the easel is open: one session for as long as the window is, and a question before
 * closing would lose changes the database has not confirmed yet. Loaded on demand (CommunityCanvasHost).
 */
export function CanvasApp({ transport, backend, worldId, userId, onClosed }: CanvasAppProps): React.ReactElement {
  const [session] = useState(() => new CanvasSession({ backend, transport, worldId, userId, sessionId: newUuid() }))
  const [confirming, setConfirming] = useState<number | null>(null)

  useEffect(() => {
    void session.start()
    return () => session.stop()
  }, [session])

  const requestClose = (): void => {
    if (session.unsaved > 0 && session.status !== 'removed') setConfirming(session.unsaved)
    else onClosed()
  }

  return (
    <CanvasWindow
      session={session}
      onClose={requestClose}
      confirming={confirming === null ? null : { count: confirming, keep: () => setConfirming(null), discard: onClosed }}
      moderation={close => (
        <ModerationPanel backend={backend} worldId={worldId} userId={userId} onClose={close} onLocksChanged={() => void session.refreshHall()} />
      )}
    />
  )
}

export default CanvasApp
