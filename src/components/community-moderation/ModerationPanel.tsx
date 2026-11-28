import { useCallback, useEffect, useState } from 'react'
import type { CloudBackend } from '../../cloud/backend'
import { restoreCanvasStroke, setHallLock } from '../../cloud/canvas'
import {
  displayNameOr, grantModerator, hallContext, listHallModerators, listModerationLog, revokeModerator,
  type HallContext, type HallModerator, type ModerationEntry,
} from '../../cloud/community'
import { listMembers, type WorldMember } from '../../cloud/worlds'
import { describeEntry, restorableStroke } from '../../community-moderation/log-text'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import './moderation.css'

/**
 * The Community Hall's moderation panel (CH-07), shown inside the canvas and kiosk windows to moderators: the log
 * of what moderators did (with "Bring back" for removed drawings), the canvas and draft locks, and the moderators
 * (the town's owner appoints and removes them). Every action is a database function that checks the caller; this
 * panel only offers what the role allows and shows what the database answered.
 */

export type ModerationTab = 'log' | 'locks' | 'moderators'

export interface ModerationPanelProps {
  backend: CloudBackend
  worldId: string
  userId: string
  /** A lock changed here: the window reads the Hall again. */
  onLocksChanged?: () => void
  onClose: () => void
  initialTab?: ModerationTab
}

const PAGE = 30
const message = (error: unknown): string => (error instanceof PersonalSpacesError ? error.message : 'Something went wrong. Please try again.')
const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function ModerationPanel({ backend, worldId, userId, onLocksChanged, onClose, initialTab = 'log' }: ModerationPanelProps): React.ReactElement {
  const [tab, setTab] = useState<ModerationTab>(initialTab)
  const [ctx, setCtx] = useState<HallContext | null>(null)
  const [members, setMembers] = useState<WorldMember[]>([])
  const [mods, setMods] = useState<HallModerator[] | null>(null)
  const [log, setLog] = useState<ModerationEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'problem'; text: string } | null>(null)

  const names = new Map(members.map(m => [m.userId, m.displayName]))
  const isOwner = ctx?.role === 'owner'

  const loadHall = useCallback(async (): Promise<void> => {
    try {
      setCtx(await hallContext(backend, worldId))
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
    }
  }, [backend, worldId])
  const loadLog = useCallback(async (): Promise<void> => {
    try {
      const page = await listModerationLog(backend, worldId, { limit: PAGE })
      setLog(page)
      setMore(page.length === PAGE)
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
    }
  }, [backend, worldId])
  const loadMods = useCallback(async (): Promise<void> => {
    try {
      setMods(await listHallModerators(backend, worldId))
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
    }
  }, [backend, worldId])

  useEffect(() => {
    void loadHall()
    listMembers(backend, worldId).then(setMembers, () => undefined)
  }, [backend, worldId, loadHall])
  useEffect(() => {
    if (tab === 'log') void loadLog()
    if (tab === 'moderators') void loadMods()
  }, [tab, loadLog, loadMods])

  /** Runs one moderation action: busy while it runs, its result or refusal shown, then `after` (reloads). */
  const act = async (run: () => Promise<string>, after: () => Promise<void> | void): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      setNotice({ tone: 'good', text: await run() })
      setNote('')
      await after()
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
    } finally {
      setBusy(false)
    }
  }
  const reason = (): string | undefined => note.trim() || undefined

  const older = async (): Promise<void> => {
    if (!log || log.length === 0) return
    try {
      const page = await listModerationLog(backend, worldId, { before: log[log.length - 1]!.id, limit: PAGE })
      setLog([...log, ...page])
      setMore(page.length === PAGE)
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
    }
  }

  const lockRow = (what: 'canvas' | 'draft', label: string, locked: boolean | undefined) => (
    <div className="mod-lock">
      <span><strong>{label}</strong>: {locked === undefined ? '...' : locked ? 'locked (only moderators can change it)' : 'open to everyone in town'}</span>
      <button type="button" className="wt-tool" disabled={busy || locked === undefined}
        onClick={() => void act(async () => {
          await setHallLock(backend, worldId, what, !locked, reason())
          return `${label} ${locked ? 'unlocked' : 'locked'}.`
        }, async () => { await loadHall(); onLocksChanged?.() })}>
        {locked ? `Unlock the ${what === 'canvas' ? 'canvas' : 'draft'}` : `Lock the ${what === 'canvas' ? 'canvas' : 'draft'}`}
      </button>
    </div>
  )

  const modIds = new Set((mods ?? []).map(m => m.userId))
  const candidates = members.filter(m => !modIds.has(m.userId) && m.role !== 'owner')

  return (
    <div className="mod-panel" role="dialog" aria-label="Moderation">
      <div className="mod-head">
        <h3>Moderation</h3>
        <div className="mod-tabs" role="tablist" aria-label="Moderation">
          {([['log', 'Log'], ['locks', 'Locks'], ['moderators', 'Moderators']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="wt-tool ws-small" onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <button type="button" className="wt-tool ws-small" onClick={onClose}>Done</button>
      </div>

      {notice && <p className={`wt-notice ${notice.tone === 'problem' ? 'wt-notice--problem' : 'wt-notice--good'}`} role={notice.tone === 'problem' ? 'alert' : 'status'}>{notice.text}</p>}

      {tab !== 'moderators' || isOwner ? (
        <label className="mod-note">
          <span>Note for the log (optional)</span>
          <input className="ws-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
        </label>
      ) : null}

      {tab === 'log' && (
        <div className="mod-body">
          {log === null ? <p role="status">Loading...</p> : log.length === 0 ? <p>Nothing here yet: no moderator has done anything in this Hall.</p> : (
            <ol className="mod-log">
              {log.map(e => {
                const stroke = restorableStroke(e)
                return (
                  <li key={e.id}>
                    <span>{describeEntry(e, names)}</span>
                    <span className="mod-meta">{when(e.createdAt)}{e.reason ? ` · Note: ${e.reason}` : ''}</span>
                    {stroke && (
                      <button type="button" className="wt-tool ws-small" disabled={busy}
                        onClick={() => void act(async () => {
                          const op = await restoreCanvasStroke(backend, worldId, stroke, reason())
                          return op ? 'The drawing is back on the canvas.' : 'That drawing is already on the canvas.'
                        }, loadLog)}>
                        Bring back
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
          {more && <button type="button" className="wt-tool ws-small" onClick={() => void older()}>Older</button>}
        </div>
      )}

      {tab === 'locks' && (
        <div className="mod-body">
          {lockRow('canvas', 'The canvas', ctx?.canvasLocked)}
          {lockRow('draft', "The Community Website's draft", ctx?.draftLocked)}
          <p className="mod-meta">A lock stops members from drawing or saving the draft. Moderators still can. Viewing is never locked.</p>
        </div>
      )}

      {tab === 'moderators' && (
        <div className="mod-body">
          {mods === null ? <p role="status">Loading...</p> : (
            <ul className="mod-list">
              {mods.map(m => (
                <li key={m.userId}>
                  <span>{displayNameOr(m.displayName)}{m.isOwner ? ' (owner of the town)' : ''}{m.userId === userId ? ' (you)' : ''}</span>
                  {isOwner && !m.isOwner && (
                    <button type="button" className="wt-tool ws-small" disabled={busy}
                      onClick={() => void act(async () => {
                        await revokeModerator(backend, worldId, m.userId, reason())
                        return `${displayNameOr(m.displayName)} is no longer a moderator.`
                      }, loadMods)}>
                      Remove as moderator
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isOwner ? (
            candidates.length > 0 && (
              <>
                <h4>Members</h4>
                <ul className="mod-list">
                  {candidates.map(m => (
                    <li key={m.userId}>
                      <span>{m.displayName}</span>
                      <button type="button" className="wt-tool ws-small" disabled={busy}
                        onClick={() => void act(async () => {
                          await grantModerator(backend, worldId, m.userId, reason())
                          return `${m.displayName} is now a moderator.`
                        }, loadMods)}>
                        Make moderator
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <p className="mod-meta">Only the town's owner appoints and removes moderators.</p>
          )}
        </div>
      )}
    </div>
  )
}
