import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SessionController, type AuthPort, type AuthUser, type SessionState } from '../../cloud/auth'
import type { CloudBackend } from '../../cloud/backend'
import { CloudArtworkRepository } from '../../cloud/cloud-artworks'
import { CloudLayoutStore } from '../../cloud/cloud-layouts'
import { setActiveCloud } from '../../cloud/cloud-session'
import { CloudWebsiteRepository } from '../../cloud/cloud-websites'
import { importLocalData, type ImportReport, type LocalSources } from '../../cloud/local-import'
import { bootstrapPlayer, updateProfile, type PlayerContext, type Profile } from '../../cloud/player'
import { houseLayouts } from '../../game/maps/house/house-layout-store'
import { onAppState } from '../../lib/app-bridge'
import { setPlayerHouse } from '../../lib/player-identity'
import { resetSiteStorage } from '../../personal-spaces/composition'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import { setStorageWhere } from '../../personal-spaces/labels'
import { AccountPanel, type AccountActions } from './AccountPanel'
import { StartScreen } from './StartScreen'
import './account.css'

export interface Connection {
  auth: AuthPort
  backend: CloudBackend
}

export interface SessionGateProps {
  /** The game, for the identity that is signed in (it is mounted afresh for every identity). */
  children: ReactNode
  /** The backend, or null when none is configured (Phase 3a: this device only). */
  connect: () => Promise<Connection | null>
  /** This device's Phase 3a data, for the one-time copy into the account. */
  deviceSources?: () => Promise<(LocalSources & { close(): void }) | null>
  /** Where email confirmation links bring the player back to. */
  redirectTo: string
}

type Phase =
  | { kind: 'connecting'; step: string }
  | { kind: 'signed-out'; notice: string | null }
  | { kind: 'failed'; message: string }
  | { kind: 'local'; chosen: boolean }
  | { kind: 'ready'; user: AuthUser; player: PlayerContext }

/** Back to "no account": every module the game reads goes back to its Phase 3a default. */
async function clearAccount(): Promise<void> {
  setActiveCloud(null)
  setPlayerHouse(null)
  houseLayouts.use(null)
  setStorageWhere('device')
  await resetSiteStorage()
}

/**
 * Starts WebTown for whoever is playing. With a backend: restore the session or sign in a guest, create or
 * restore their profile, world and house in the database, copy this device's earlier work in once, then start
 * the game with the player's house and account-backed storage. The game is mounted afresh for every identity,
 * so nothing of one account can leak into the next. Without a backend: the game as in Phase 3a.
 */
export function SessionGate({ children, connect, deviceSources, redirectTo }: SessionGateProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting', step: 'Connecting to WebTown...' })
  const [panel, setPanel] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [appOpen, setAppOpen] = useState(false)
  const connection = useRef<Connection | null | undefined>(undefined)
  const controller = useRef<SessionController | null>(null)
  const run = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const enter = useCallback(async (user: AuthUser): Promise<void> => {
    const conn = connection.current!
    const current = phaseRef.current
    if (current.kind === 'ready' && current.user.id === user.id) {
      // The same person with newer details (a confirmed email): no restart.
      setStorageWhere(user.isAnonymous ? 'guest' : 'account')
      setPhase(p => (p.kind === 'ready' && p.user.id === user.id ? { ...p, user } : p))
      return
    }
    const mine = ++run.current
    setPanel(false)
    setPhase({ kind: 'connecting', step: 'Opening your town...' })
    await clearAccount()
    let player: PlayerContext
    try {
      player = await bootstrapPlayer(conn.backend, user.id)
    } catch (error) {
      if (mine !== run.current) return
      setPhase({ kind: 'failed', message: error instanceof PersonalSpacesError ? error.message : "Couldn't open your town. Please try again." })
      return
    }
    if (mine !== run.current) return
    setActiveCloud({ backend: conn.backend, player })
    setPlayerHouse({ ownedSlot: player.ownedSlot })
    houseLayouts.use(new CloudLayoutStore(conn.backend, player))
    setStorageWhere(user.isAnonymous ? 'guest' : 'account')

    if (deviceSources) {
      setPhase({ kind: 'connecting', step: 'Bringing in your work from this device...' })
      const sources = await deviceSources().catch(() => null)
      if (sources) {
        const report = await importLocalData({
          local: sources,
          backend: conn.backend,
          player,
          websites: new CloudWebsiteRepository(conn.backend, player),
          artworks: new CloudArtworkRepository(conn.backend, player),
        }).finally(() => sources.close())
        if (mine !== run.current) return
        setToast(describeImport(report))
      }
    }
    if (mine !== run.current) return
    setPhase({ kind: 'ready', user, player })
  }, [deviceSources])

  const onState = useCallback((state: SessionState): void => {
    if (state.status === 'starting') {
      setPhase({ kind: 'connecting', step: 'Connecting to WebTown...' })
    } else if (state.status === 'signed-out') {
      run.current++
      void clearAccount()
      setPanel(false)
      setPhase({ kind: 'signed-out', notice: state.notice })
    } else if (state.status === 'failed') {
      setPhase({ kind: 'failed', message: state.message })
    } else {
      void enter(state.user)
    }
  }, [enter])

  useEffect(() => {
    let live = true
    let cleanup = (): void => undefined
    void connect().catch(error => {
      console.error('[WebTown] Could not load the account client.', error)
      return null
    }).then(conn => {
      if (!live) return
      connection.current = conn
      if (!conn) {
        void clearAccount().then(() => setPhase({ kind: 'local', chosen: false }))
        return
      }
      const c = new SessionController(conn.auth, redirectTo)
      controller.current = c
      const stop = c.subscribe(onState)
      void c.start()
      cleanup = () => {
        stop()
        c.dispose()
      }
    })
    return () => {
      live = false
      run.current++
      cleanup()
    }
    // Connect once per page: the gate lives for the whole app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The account control steps aside while the website or the Sketchbook is open.
  useEffect(() => onAppState(view => setAppOpen(view.open !== null)), [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 12_000)
    return () => clearTimeout(t)
  }, [toast])

  const retry = (): void => {
    const c = controller.current
    if (!c) return
    if (c.current.status === 'signed-in') void enter(c.current.user)
    else void c.start()
  }

  const playLocally = (): void => {
    run.current++
    void clearAccount().then(() => setPhase({ kind: 'local', chosen: true }))
  }

  if (phase.kind === 'connecting') return <Splash text={phase.step} />
  if (phase.kind === 'failed') {
    return (
      <Splash text={phase.message} alert>
        <button type="button" className="ac-button ac-button--primary" onClick={retry}>Try again</button>
        <button type="button" className="ac-button" onClick={playLocally}>Play on this device only</button>
        <p className="ac-text" style={{ marginTop: 10 }}>On this device only, nothing is saved to your account, and your account's town is not shown.</p>
      </Splash>
    )
  }
  if (phase.kind === 'signed-out') {
    const c = controller.current!
    return (
      <StartScreen
        notice={phase.notice}
        onGuest={() => c.playAsGuest()}
        onLogin={async (email, password) => { await c.signIn(email, password) }}
        onSignUp={async (email, password) => (await c.signUp(email, password))}
      />
    )
  }
  if (phase.kind === 'local') {
    return (
      <div key="local" style={{ position: 'fixed', inset: 0 }}>
        {children}
        {phase.chosen && (
          <button type="button" className="ac-corner" onClick={retry} title="Connect to your WebTown account">
            On this device only. Connect
          </button>
        )}
      </div>
    )
  }

  const c = controller.current!
  const conn = connection.current!
  const { user, player } = phase
  const actions: AccountActions = {
    linkEmail: email => c.linkEmail(email),
    refresh: () => c.refresh(),
    setPassword: password => c.setPassword(password),
    signIn: async (email, password) => { await c.signIn(email, password) },
    signOut: () => c.signOut(),
    updateProfile: async change => {
      const profile: Profile = await updateProfile(conn.backend, user.id, change)
      setPhase(p => {
        if (p.kind !== 'ready' || p.user.id !== user.id) return p
        const next = { ...p.player, profile }
        setActiveCloud({ backend: conn.backend, player: next })
        return { ...p, player: next }
      })
      return profile
    },
  }
  const reminder = user.isAnonymous && player.profile.settings['upgradeHintDismissed'] !== true
  return (
    <div key={user.id} style={{ position: 'fixed', inset: 0 }}>
      {children}
      {toast && (
        <div className="ac-toast" role="status">
          {toast}{' '}
          <button type="button" className="ac-link" onClick={() => setToast(null)}>OK</button>
        </div>
      )}
      {!appOpen && <button type="button" className="ac-corner" onClick={() => setPanel(true)} aria-haspopup="dialog">
        {user.isAnonymous ? <>Guest{reminder && <span className="ac-corner-hint"> · Save your progress</span>}</> : player.profile.displayName}
      </button>}
      {panel && <AccountPanel user={user} profile={player.profile} actions={actions} onClose={() => setPanel(false)} />}
    </div>
  )
}

function describeImport(report: ImportReport): string | null {
  if (report.idle) return null
  const parts: string[] = []
  if (report.website === 'copied') parts.push('your website')
  if (report.drawings > 0) parts.push(`${report.drawings} drawing${report.drawings === 1 ? '' : 's'}`)
  const sentences: string[] = []
  if (parts.length > 0) sentences.push(`Copied from this device into your account: ${parts.join(' and ')}.`)
  if (report.website === 'kept-account') sentences.push('Your account already had a website, so it was kept; the one on this device is unchanged.')
  if (report.skipped.length > 0) sentences.push(`Not copied: ${report.skipped.slice(0, 2).join(' ')}`)
  if (report.failed) sentences.push(`Copying stopped (${report.failed}) and will be tried again next time.`)
  return sentences.length > 0 ? sentences.join(' ') : null
}
function Splash({ text, alert = false, children }: { text: string; alert?: boolean; children?: ReactNode }): React.ReactElement {
  return (
    <main className="ac-screen">
      <div className="ac-card" style={{ textAlign: 'center' }}>
        <h1 className="ac-title">WebTown</h1>
        <p className="ac-lead" role={alert ? 'alert' : 'status'}>{text}</p>
        {children && <div className="ac-buttons" style={{ justifyContent: 'center' }}>{children}</div>}
      </div>
    </main>
  )
}
