import { useCallback, useEffect, useState } from 'react'
import type { CloudBackend } from '../../cloud/backend'
import type { PlayerContext } from '../../cloud/player'
import {
  InviteError, MAX_WORLD_MEMBERS, createInvite, inviteLink, joinWorld, leaveWorld, listInvites, listMembers, listMyWorlds,
  normaliseInviteCode, removeMember, revokeInvite,
  type CreatedInvite, type InviteSummary, type WorldMember, type WorldSummary,
} from '../../cloud/worlds'
import { WindowFrame } from '../apps/WindowFrame'
import { multiplayerLink } from '../../lib/multiplayer-link'
import { KeyboardShield } from '../account/KeyboardShield'
import { useAction } from '../account/AuthForms'
import '../account/account.css'

export interface WorldPanelProps {
  backend: CloudBackend
  /** The world being played. */
  player: PlayerContext
  personalWorldId: string
  /** The address invitation links point to. */
  inviteBase: string
  /** Start the game in another world (also after leaving this one, or joining one). */
  onOpenWorld: (worldId: string) => void
  onClose: () => void
}

const day = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * The town window: who is in this town, invitations (owner), the player's towns, joining with a code, and
 * leaving. Everything is checked by the database; this only shows what it answers.
 */
export function WorldPanel({ backend, player, personalWorldId, inviteBase, onOpenWorld, onClose }: WorldPanelProps): React.ReactElement {
  const worldId = player.world.id
  const isOwner = player.world.role === 'owner'
  const [members, setMembers] = useState<WorldMember[] | null>(null)
  const [invites, setInvites] = useState<InviteSummary[] | null>(null)
  const [worlds, setWorlds] = useState<WorldSummary[] | null>(null)
  const [created, setCreated] = useState<CreatedInvite | null>(null)
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  const [code, setCode] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  /** The resident the owner asked to remove, waiting for confirmation (it deletes their house). */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const load = useAction()
  const act = useAction()

  const reload = useCallback(() => load.run(async () => {
    const [m, w, i] = await Promise.all([
      listMembers(backend, worldId),
      listMyWorlds(backend),
      isOwner ? listInvites(backend, worldId) : Promise.resolve(null),
    ])
    setMembers(m)
    setWorlds(w)
    setInvites(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [backend, worldId, isOwner])
  useEffect(() => { void reload() }, [reload])

  const link = created ? inviteLink(created.code, inviteBase) : ''
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('yes')
    } catch {
      // No clipboard here (a plain-http address, or permission refused): the link is selectable instead.
      setCopied('failed')
    }
  }

  const joinCode = normaliseInviteCode(code)

  return (
    <KeyboardShield>
      <WindowFrame title={`Town: ${player.world.name}`} onClose={onClose}>
        <div className="ac-panel">
          <section className="ac-section" aria-labelledby="mp-members">
            <h2 className="ac-heading" id="mp-members">Players in this town</h2>
            {members === null && !load.error && <p className="ac-text" role="status">Loading...</p>}
            {load.error && <p className="ac-error" role="alert">{load.error}</p>}
            {members && (
              <ul className="mp-list">
                {members.map(m => (
                  <li key={m.userId}>
                    <span>
                      {m.displayName}
                      {m.userId === player.userId ? ' (you)' : ''}
                      {m.role === 'owner' ? ' · owner' : ''}
                      {m.slot ? ` · ${m.slot.replace('house-', 'house ').toUpperCase()}` : ''}
                    </span>
                    {isOwner && m.role !== 'owner' && confirmRemove !== m.userId && (
                      <button type="button" className="ac-link" disabled={act.busy} onClick={() => setConfirmRemove(m.userId)}>
                        Remove {m.displayName}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {members?.filter(m => m.userId === confirmRemove).map(m => (
              <div key={m.userId} className="mp-confirm" role="group" aria-label={`Remove ${m.displayName}`}>
                <p className="ac-text">Remove {m.displayName} from {player.world.name}? Their house here and everything in it (furniture, website, drawings) will be deleted.</p>
                <div className="ac-buttons">
                  <button type="button" className="ac-button" disabled={act.busy}
                    onClick={() => void act.run(async () => {
                      await removeMember(backend, worldId, m.userId)
                      setConfirmRemove(null)
                      multiplayerLink()?.membersChanged()
                      await reload()
                    })}>
                    Remove and delete their house
                  </button>
                  <button type="button" className="ac-button" onClick={() => setConfirmRemove(null)}>Keep {m.displayName}</button>
                </div>
              </div>
            ))}
            {members && <p className="ac-text">{members.length} of {MAX_WORLD_MEMBERS} players.</p>}
          </section>

          {isOwner && (
            <section className="ac-section" aria-labelledby="mp-invites">
              <h2 className="ac-heading" id="mp-invites">Invite people</h2>
              <p className="ac-text">Anyone with the link can join until it expires (7 days) or you revoke it.</p>
              <div className="ac-buttons">
                <button type="button" className="ac-button ac-button--primary" disabled={act.busy}
                  onClick={() => void act.run(async () => { setCopied('no'); setCreated(await createInvite(backend, worldId)); await reload() })}>
                  Create invitation
                </button>
              </div>
              {created && (
                <div className="mp-invite" role="status">
                  <p className="ac-text">Code <strong data-testid="invite-code">{created.code}</strong>. Shown only now.</p>
                  <input className="ac-input" readOnly value={link} aria-label="Invitation link" onFocus={e => e.currentTarget.select()} />
                  <div className="ac-buttons">
                    <button type="button" className="ac-button" onClick={() => void copy()}>{copied === 'yes' ? 'Copied' : 'Copy link'}</button>
                  </div>
                  {copied === 'failed' && <p className="ac-error" role="alert">Couldn't copy here. Select the link above and copy it.</p>}
                </div>
              )}
              {invites && invites.length > 0 && (
                <ul className="mp-list">
                  {invites.map(i => (
                    <li key={i.id}>
                      <span>
                        ...{i.hint} · {i.revoked ? 'revoked' : i.expired ? 'expired' : `until ${day(i.expiresAt)}`} · used {i.uses}
                      </span>
                      {!i.revoked && !i.expired && (
                        <button type="button" className="ac-link" disabled={act.busy}
                          onClick={() => void act.run(async () => { await revokeInvite(backend, i.id); await reload() })}>
                          Revoke ...{i.hint}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="ac-section" aria-labelledby="mp-towns">
            <h2 className="ac-heading" id="mp-towns">Your towns</h2>
            {worlds && (
              <ul className="mp-list">
                {worlds.map(w => (
                  <li key={w.id}>
                    <span>{w.id === personalWorldId ? `${w.name} (yours)` : `${w.name} · ${w.ownerName}'s`} · {w.members} of {MAX_WORLD_MEMBERS}</span>
                    {w.id === worldId ? <span className="ac-good">Here now</span> : (
                      <button type="button" className="ac-link" onClick={() => onOpenWorld(w.id)}>Go to {w.name}</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form className="mp-join" onSubmit={e => {
              e.preventDefault()
              if (!joinCode) return
              void act.run(async () => {
                try {
                  const { worldId: joined } = await joinWorld(backend, joinCode)
                  onOpenWorld(joined)
                } catch (error) {
                  if (error instanceof InviteError && error.problem === 'invalid') throw new Error("That code doesn't work. Check it, or ask for a new one.")
                  throw error
                }
              })
            }}>
              <label className="ac-field">
                <span>Join with an invitation code or link</span>
                <input className="ac-input" value={code} onChange={e => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" autoComplete="off" />
              </label>
              <div className="ac-buttons">
                <button type="submit" className="ac-button" disabled={!joinCode || act.busy}>Join</button>
              </div>
            </form>
          </section>

          {!isOwner && (
            <section className="ac-section">
              {!confirmLeave ? (
                <button type="button" className="ac-link" onClick={() => setConfirmLeave(true)}>Leave this town</button>
              ) : (
                <>
                  <p className="ac-text">Leave {player.world.name}? Your house there and everything in it (furniture, website, drawings) will be deleted.</p>
                  <div className="ac-buttons">
                    <button type="button" className="ac-button" disabled={act.busy}
                      onClick={() => void act.run(async () => { await leaveWorld(backend, worldId); onOpenWorld(personalWorldId) })}>
                      Leave and delete my house there
                    </button>
                    <button type="button" className="ac-button" onClick={() => setConfirmLeave(false)}>Stay</button>
                  </div>
                </>
              )}
            </section>
          )}
          {act.error && <p className="ac-error" role="alert">{act.error}</p>}
        </div>
      </WindowFrame>
    </KeyboardShield>
  )
}
