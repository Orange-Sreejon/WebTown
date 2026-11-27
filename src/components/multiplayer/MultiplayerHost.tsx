import { useEffect, useRef, useState } from 'react'
import { newUuid, type CloudBackend } from '../../cloud/backend'
import type { PlayerContext } from '../../cloud/player'
import { listMembers } from '../../cloud/worlds'
import { avatarFor } from '../../game/systems/avatars'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import { setMultiplayerLink } from '../../lib/multiplayer-link'
import { onAppState } from '../../lib/app-bridge'
import { onEditorState } from '../../lib/editor-bridge'
import type { RealtimeTransport } from '../../multiplayer/transport'
import { WorldSession, type SessionStatus } from '../../multiplayer/world-session'
import { CommunityCanvasHost } from '../community-canvas/CommunityCanvasHost'
import { CommunityWebsiteHost } from '../community-website/CommunityWebsiteHost'
import './multiplayer.css'

export interface MultiplayerHostProps {
  transport: RealtimeTransport
  backend: CloudBackend
  /** The world being played. */
  player: PlayerContext
  /** Opens the player's own town (offered when they are no longer in this one). */
  onGoHome?: () => void
}

interface Toast { id: number; text: string }

/**
 * Runs the realtime session of the world being played for as long as the game is mounted, hands it to the game
 * (`setMultiplayerLink`), and shows its state: a status line and short notices when someone arrives or leaves.
 * React only re-renders on those; positions go straight from the session to Phaser.
 */
export function MultiplayerHost({ transport, backend, player, onGoHome }: MultiplayerHostProps): React.ReactElement {
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [others, setOthers] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  // The emote bar steps aside while the furniture editor or an app (website, Sketchbook) is open.
  const [appOpen, setAppOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => onAppState(view => setAppOpen(view.open !== null)), [])
  useEffect(() => onEditorState(view => setEditing(view.mode === 'edit')), [])
  const session = useRef<WorldSession | null>(null)
  const toastId = useRef(0)
  const worldId = player.world.id
  const userId = player.userId
  // Read when the session starts only: a new look or name must not restart the session (others see it at the next
  // member reload), and leaving and rejoining the same channel at once can catch it half-closed.
  const avatar = useRef(player.profile.avatar)
  avatar.current = player.profile.avatar

  useEffect(() => {
    const s = new WorldSession({
      transport,
      worldId,
      userId,
      sessionId: newUuid(),
      selfAvatar: avatarFor(avatar.current, userId),
      loadMembers: async () => {
        try {
          return (await listMembers(backend, worldId)).map(m => ({
            userId: m.userId, displayName: m.displayName, avatar: avatarFor(m.avatar, m.userId),
          }))
        } catch (error) {
          // The database refused: this player is not in the world any more (removed, or they left elsewhere).
          if (error instanceof PersonalSpacesError && error.code === 'permission') return null
          throw error
        }
      },
    })
    session.current = s
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const toast = (text: string): void => {
      const id = ++toastId.current
      setToasts(t => [...t.slice(-2), { id, text }])
      const timer = setTimeout(() => {
        timers.delete(timer)
        setToasts(t => t.filter(x => x.id !== id))
      }, 4000)
      timers.add(timer)
    }
    const stop = s.subscribe(event => {
      if (event.kind === 'status') setStatus(event.status)
      else if (event.kind === 'roster') setOthers(s.roster().length)
      else if (event.kind === 'joined') toast(`${event.name} joined`)
      else if (event.kind === 'left') toast(`${event.name} left`)
    })
    const stopGame = s.onEvent(event => {
      if (event.kind === 'notice') toast(event.text)
    })
    setMultiplayerLink(s)
    void s.start()
    return () => {
      stop()
      stopGame()
      for (const t of timers) clearTimeout(t)
      setMultiplayerLink(null)
      s.stop()
      session.current = null
    }
  }, [transport, backend, worldId, userId])

  const line =
    status === 'connecting' ? 'Connecting...'
    : status === 'joined' ? (others === 0 ? 'Online · only you here' : `Online · ${others + 1} players`)
    : status === 'reconnecting' ? 'Reconnecting...'
    : status === 'lost' ? 'Connection lost. You can keep playing; others are hidden.'
    : status === 'failed' ? "Couldn't join this town's live session."
    : status === 'removed' ? "You're no longer in this town."
    : ''
  // Over the website, the Sketchbook or the editor only what needs the player: the connection or the town is gone.
  const urgent = status === 'lost' || status === 'failed' || status === 'removed'
  const covered = appOpen || editing

  return (
    <>
      {line && (!covered || urgent) && (
        <div className={`mp-status mp-status--${status}`} role="status" data-testid="mp-status" data-status={status} data-players={others + 1}>
          <span>{line}</span>
          {(status === 'lost' || status === 'failed') && (
            <button type="button" className="mp-retry" onClick={() => session.current?.retry()}>Retry</button>
          )}
          {status === 'removed' && onGoHome && (
            <button type="button" className="mp-retry" onClick={onGoHome}>Go to my town</button>
          )}
        </div>
      )}
      {status === 'joined' && !appOpen && !editing && (
        <div className="mp-emotes" role="toolbar" aria-label="Emotes">
          <button type="button" className="mp-emote" title="Wave to the nearest player (Q)" onClick={() => session.current?.wave()}>👋 Wave (Q)</button>
          <button type="button" className="mp-emote" aria-label="Heart" onClick={() => session.current?.emote('heart')}>❤</button>
          <button type="button" className="mp-emote" aria-label="Laugh" onClick={() => session.current?.emote('laugh')}>😄</button>
          <button type="button" className="mp-emote" aria-label="Surprise" onClick={() => session.current?.emote('surprise')}>❗</button>
        </div>
      )}
      <CommunityCanvasHost transport={transport} backend={backend} worldId={worldId} userId={userId} />
      <CommunityWebsiteHost transport={transport} backend={backend} worldId={worldId} userId={userId} />
      {toasts.length > 0 && !covered && (
        <div className="mp-toasts" aria-live="polite">
          {toasts.map(t => <div key={t.id} className="mp-toast">{t.text}</div>)}
        </div>
      )}
    </>
  )
}
