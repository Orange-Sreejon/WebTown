import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { newUuid, type CloudBackend } from '../../cloud/backend'
import { hallContext, displayNameOr, type HallContext } from '../../cloud/community'
import {
  listCommunityRevisions, loadCommunityWebsite, publishCommunityWebsite,
  type CommunityLoad, type CommunityRevision, type CommunityVersionInfo,
} from '../../cloud/community-website'
import { listMembers } from '../../cloud/worlds'
import { describeChanges, diffSites } from '../../community-website/diff'
import { WebsiteChannel } from '../../community-website/website-channel'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import { COMMUNITY_SITE_KEY } from '../../personal-spaces/site-project/site-target'
import { startStudio, type StudioState } from '../../personal-spaces/site-project/studio-state'
import { blankProject, classicProject } from '../../personal-spaces/site-project/templates'
import type { SiteProject } from '../../personal-spaces/site-project/types'
import type { WebsiteState } from '../../personal-spaces/site-project-storage/resolve-website'
import type { RealtimeTransport } from '../../multiplayer/transport'
import { WindowFrame } from '../apps/WindowFrame'
import { HouseWebsite } from '../website/HouseWebsite'
import type { WebsiteLoad } from '../website/useWebsiteState'
import type { CodeEditorProps } from '../website-studio/editor-types'
import { ModerationPanel } from '../community-moderation/ModerationPanel'
import './community-website.css'

/** The Studio and the code editor, downloaded only when someone edits the draft. */
const CommunityStudio = lazy(() => import('./CommunityStudio'))

export interface CommunityWebsiteAppProps {
  transport: RealtimeTransport
  backend: CloudBackend
  worldId: string
  userId: string
  onClosed: () => void
  /** The Studio's code editor; CodeMirror by default. Tests pass a plain one. */
  Editor?: ComponentType<CodeEditorProps>
  now?: () => string
}

type Showing = { which: 'published' } | { which: 'draft' } | { which: 'revision'; number: number }
type Shown = { load: WebsiteLoad; info: CommunityVersionInfo | null }
type Confirm = { number: number; lines: string[] }

/** A load as the website viewer reads it. */
export function toWebsiteState(load: CommunityLoad['load']): WebsiteState {
  if (load.kind === 'saved') return { kind: 'project', snapshot: load.snapshot, skipped: load.skipped }
  if (load.kind === 'damaged') return { kind: 'damaged', problems: load.problems, revision: load.revision }
  return { kind: 'none' }
}

const message = (error: unknown): string =>
  error instanceof PersonalSpacesError ? error.message : 'Something went wrong. Please try again.'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/**
 * The Community Website at the Hall's kiosk (CH-06): what visitors see (the published version); the shared draft
 * and every kept version for members to look at; "Edit the draft" (the Site Studio, for every member unless a
 * moderator locked it); and for moderators, publishing the version they are looking at, with what it changes.
 * Who may do what is decided by the database; the role here only decides which buttons are offered.
 */
export function CommunityWebsiteApp({ transport, backend, worldId, userId, onClosed, Editor, now }: CommunityWebsiteAppProps): React.ReactElement {
  const [ctx, setCtx] = useState<HallContext | null>(null)
  const [showing, setShowing] = useState<Showing>({ which: 'published' })
  const [shown, setShown] = useState<Shown>({ load: { status: 'loading' }, info: null })
  const [attempt, setAttempt] = useState(0)
  const [studio, setStudio] = useState<StudioState | null>(null)
  const [starting, setStarting] = useState<null | { base: number; problems?: string[] }>(null)
  const [versions, setVersions] = useState<CommunityRevision[] | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'problem'; text: string } | null>(null)
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [editors, setEditors] = useState<string[]>([])
  const [newerDraft, setNewerDraft] = useState<number | null>(null)
  const [moderating, setModerating] = useState(false)
  // The newest draft's number when nothing is shown that says it (for "there is a draft" on an empty Published tab).
  const [latestDraft, setLatestDraft] = useState<number | null>(null)
  // The draft version this player saved in the Studio just now, for the line shown after leaving it.
  const [justSaved, setJustSaved] = useState<number | null>(null)
  const mine = useRef<number>(0) // the newest draft number this player saved or opened
  const saving = useRef(0) // saves of this player under way
  const heldHints = useRef<number[]>([]) // draft hints that arrived during one of them

  const channel = useMemo(() => new WebsiteChannel({ transport, worldId, userId, sessionId: newUuid() }), [transport, worldId, userId])
  const moderator = ctx !== null && ctx.role !== 'member'
  const canEdit = ctx !== null && (!ctx.draftLocked || moderator)

  // Who I am here, and the names of the town's members (for "Ada is editing").
  useEffect(() => {
    let live = true
    hallContext(backend, worldId).then(c => { if (live) setCtx(c) }, (error: unknown) => { if (live) setNotice({ tone: 'problem', text: message(error) }) })
    listMembers(backend, worldId).then(ms => { if (live) setNames(new Map(ms.map(m => [m.userId, m.displayName]))) }, () => undefined)
    return () => { live = false }
  }, [backend, worldId])

  // What is shown: loaded again when it changes, on retry, and when a hint says it changed.
  useEffect(() => {
    let live = true
    setShown({ load: { status: 'loading' }, info: null })
    const which = showing.which === 'revision' ? { number: showing.number } : showing.which
    loadCommunityWebsite(backend, worldId, which).then(
      r => { if (live) setShown({ load: { status: 'ready', website: toWebsiteState(r.load) }, info: r.info }) },
      (error: unknown) => { if (live) setShown({ load: { status: 'error', message: message(error) }, info: null }) },
    )
    return () => { live = false }
  }, [backend, worldId, showing, attempt])

  const refreshLatest = useCallback((): void => {
    listCommunityRevisions(backend, worldId, { limit: 1 }).then(r => setLatestDraft(r[0]?.number ?? null), () => undefined)
  }, [backend, worldId])
  useEffect(() => { refreshLatest() }, [refreshLatest])

  /** A draft hint is about someone else's save only if it is newer than anything this player saved or opened. */
  const judgeHints = useCallback((numbers: number[]): void => {
    const newer = numbers.filter(n => n > mine.current)
    if (newer.length > 0) setNewerDraft(d => Math.max(d ?? 0, ...newer))
  }, [])

  const refreshVersions = useCallback((): void => {
    listCommunityRevisions(backend, worldId, { limit: 50 }).then(setVersions, (error: unknown) => setNotice({ tone: 'problem', text: message(error) }))
  }, [backend, worldId])

  // The Hall channel: hints and who is editing.
  useEffect(() => {
    channel.start()
    const stopEditors = channel.onEditors(setEditors)
    return () => { stopEditors(); channel.stop() }
  }, [channel])
  const showingRef = useRef(showing)
  showingRef.current = showing
  const versionsOpen = versions !== null
  useEffect(() => channel.onHint(hint => {
    if (hint.kind === 'lock') {
      hallContext(backend, worldId).then(setCtx, () => undefined)
      return
    }
    const s = showingRef.current
    if (hint.kind === 'draft') {
      // During this player's own save, the hint may be about that save: decide once its number is known.
      if (saving.current > 0) heldHints.current.push(hint.number)
      else judgeHints([hint.number])
      refreshLatest()
    }
    if ((hint.kind === 'draft' && s.which === 'draft') || (hint.kind === 'published' && s.which === 'published')) setAttempt(n => n + 1)
    if (versionsOpen) refreshVersions()
    if (hint.kind === 'published') hallContext(backend, worldId).then(setCtx, () => undefined)
  }), [channel, versionsOpen, refreshVersions, refreshLatest, judgeHints, backend, worldId])
  useEffect(() => { channel.setEditing(studio !== null) }, [channel, studio])

  // ── Editing ──────────────────────────────────────────────────────────────────────────────────────────────────

  const loadDraftState = useCallback(async (): Promise<WebsiteState> => {
    const r = await loadCommunityWebsite(backend, worldId, 'draft')
    return toWebsiteState(r.load)
  }, [backend, worldId])

  const editDraft = async (): Promise<void> => {
    setNotice(null)
    let r: CommunityLoad
    try {
      r = await loadCommunityWebsite(backend, worldId, 'draft')
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
      return
    }
    mine.current = r.info?.number ?? 0
    setNewerDraft(null)
    if (r.load.kind === 'saved') setStudio(startStudio(r.load.snapshot, { stored: true }))
    else if (r.load.kind === 'damaged') setStarting({ base: r.load.revision, problems: r.load.problems })
    else setStarting({ base: 0 })
  }

  const startFrom = (kind: 'blank' | 'classic'): void => {
    const time = (now ?? (() => new Date().toISOString()))()
    const project: SiteProject = kind === 'blank' ? blankProject(COMMUNITY_SITE_KEY, time) : classicProject(COMMUNITY_SITE_KEY, time)
    project.title = 'Community Website'
    const base = starting?.base ?? 0
    setStarting(null)
    setStudio(startStudio({ project, assets: [] }, { stored: false, baseRevision: base }))
  }

  const leaveStudio = (): void => {
    setStudio(null)
    setNewerDraft(null)
    refreshLatest()
    setShowing({ which: 'draft' })
    setAttempt(n => n + 1)
  }

  // ── Publishing ───────────────────────────────────────────────────────────────────────────────────────────────

  const askPublish = async (): Promise<void> => {
    const info = shown.info
    if (!info || shown.load.status !== 'ready' || shown.load.website.kind !== 'project') return
    const next = shown.load.website.snapshot.project
    let published: SiteProject | null = null
    try {
      const p = await loadCommunityWebsite(backend, worldId, 'published')
      if (p.load.kind === 'saved') published = p.load.snapshot.project
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
      return
    }
    const older = info.publishedNumber !== null && info.number < info.publishedNumber
    setNote('')
    setConfirm({ number: info.number, lines: [...(older ? [`This goes back to version ${info.number} (a rollback).`] : []), ...describeChanges(diffSites(published, next))] })
  }

  const publish = async (): Promise<void> => {
    if (!confirm) return
    setBusy(true)
    try {
      const r = await publishCommunityWebsite(backend, worldId, confirm.number, note.trim() || undefined)
      setConfirm(null)
      setNotice({ tone: 'good', text: r.changed ? `Version ${r.number} is now what visitors see.` : `Version ${r.number} was already published.` })
      setShowing({ which: 'published' })
      setAttempt(n => n + 1)
      if (versionsOpen) refreshVersions()
    } catch (error) {
      setNotice({ tone: 'problem', text: message(error) })
    } finally {
      setBusy(false)
    }
  }

  // ── The Studio ───────────────────────────────────────────────────────────────────────────────────────────────

  const editorNames = editors.map(id => names.get(id)).filter((n): n is string => !!n)
  const banner = (
    <>
      {editorNames.length > 0 && <span>{editorNames.join(', ')} {editorNames.length === 1 ? 'is' : 'are'} editing the draft too.</span>}
      {newerDraft !== null && <span> Someone saved a newer draft (version {newerDraft}). When you save, WebTown asks what to do.</span>}
    </>
  )
  if (studio) {
    return (
      <Suspense fallback={<WindowFrame title="Site Studio" onClose={onClosed}><p role="status" style={{ margin: 0 }}>Opening the Studio...</p></WindowFrame>}>
        <CommunityStudio
          backend={backend}
          worldId={worldId}
          initial={studio}
          reload={loadDraftState}
          onSaveStart={() => { saving.current++ }}
          onSaveEnd={n => {
            saving.current = Math.max(0, saving.current - 1)
            if (n !== null) {
              mine.current = Math.max(mine.current, n)
              setJustSaved(n)
              setNewerDraft(d => (d !== null && d <= n ? null : d))
            }
            if (saving.current === 0) {
              const held = heldHints.current
              heldHints.current = []
              judgeHints(held)
            }
          }}
          banner={editorNames.length > 0 || newerDraft !== null ? banner : undefined}
          onExit={leaveStudio}
          onClose={onClosed}
          {...(Editor ? { Editor } : {})}
          {...(now ? { now } : {})}
        />
      </Suspense>
    )
  }

  // ── The viewer ───────────────────────────────────────────────────────────────────────────────────────────────

  const info = shown.info
  const isPublished = info !== null && info.number === info.publishedNumber
  // The newest of what the shown version said and what the last check of the versions said (a hint may be newer).
  const draftNo = Math.max(info?.draftNumber ?? 0, latestDraft ?? 0) || null
  const publishedNo = info !== null ? info.publishedNumber : showing.which === 'published' ? null : undefined
  const draftIsNewer = draftNo !== null && publishedNo !== undefined && (publishedNo === null || draftNo > publishedNo)
  const visitorsSee = (p: number | null | undefined): string => (p ? `version ${p}` : 'nothing yet')
  const showDraft = <button type="button" className="wt-tool ws-small" onClick={() => setShowing({ which: 'draft' })}>Show the draft</button>
  const status = info === null ? ''
    : `${showing.which === 'published' ? 'Published' : isPublished ? 'Published' : 'Not published'}: version ${info.number}, saved by ${displayNameOr(info.authorName)} on ${when(info.savedAt)}.`
  const editButton = (
    <button type="button" className="wt-tool" onClick={() => void editDraft()} disabled={!canEdit}
      title={canEdit ? 'Open the shared draft in the Site Studio' : 'A moderator has locked the draft for now.'}>
      Edit the draft
    </button>
  )
  const actions = (
    <span className="cw-actions">
      <span className="cw-group" role="group" aria-label="Version">
        <button type="button" className="wt-tool ws-small" aria-pressed={showing.which === 'published'} onClick={() => setShowing({ which: 'published' })}>Published</button>
        <button type="button" className="wt-tool ws-small" aria-pressed={showing.which === 'draft'} onClick={() => setShowing({ which: 'draft' })}
          aria-label="Draft" title={draftIsNewer ? 'The draft has changes visitors do not see yet' : undefined}>
          Draft{draftIsNewer && <span className="cw-pill cw-pill--new">not published</span>}
        </button>
        {showing.which === 'revision' && <span className="cw-pill">Version {showing.number}</span>}
      </span>
      {editButton}
      <button type="button" className="wt-tool" aria-pressed={versionsOpen} onClick={() => (versionsOpen ? setVersions(null) : refreshVersions())}>Versions</button>
      {moderator && info !== null && !isPublished && shown.load.status === 'ready' && shown.load.website.kind === 'project' && (
        <button type="button" className="wt-tool cw-publish" onClick={() => void askPublish()}>Publish this version</button>
      )}
      {moderator && (
        <button type="button" className="wt-tool" aria-pressed={moderating} onClick={() => setModerating(m => !m)}>Moderation</button>
      )}
    </span>
  )

  const empty = showing.which === 'published' ? (
    <div className="cw-empty">
      <p>Nothing has been published yet.</p>
      {latestDraft !== null
        ? <p>There is a draft (version {latestDraft}) that visitors don't see yet. {showDraft}</p>
        : <p>Everyone in town can work on the draft; a moderator publishes it when it is ready.</p>}
      <p>{actions}</p>
    </div>
  ) : showing.which === 'draft' ? (
    <div className="cw-empty"><p>Nobody has started the draft yet.</p><p>{actions}</p></div>
  ) : (
    <div className="cw-empty"><p>That version is no longer kept.</p><p>{actions}</p></div>
  )

  return (
    <WindowFrame title="Community Website" onClose={onClosed} size="wide">
      <div className="cw">
        {ctx?.draftLocked && <p className="wt-notice" role="status">A moderator has locked the draft{moderator ? ': only moderators can save it.' : ' for now.'}</p>}
        {notice && <p className={`wt-notice ${notice.tone === 'problem' ? 'wt-notice--problem' : 'wt-notice--good'}`} role={notice.tone === 'problem' ? 'alert' : 'status'}>{notice.text}</p>}
        {editorNames.length > 0 && <p className="wt-notice" role="status">{editorNames.join(', ')} {editorNames.length === 1 ? 'is' : 'are'} editing the draft.</p>}
        {justSaved !== null && showing.which === 'draft' && info !== null && info.number === justSaved && !isPublished && (
          <p className="wt-notice wt-notice--good" role="status">
            Saved as draft version {justSaved}. Visitors still see {visitorsSee(info.publishedNumber)} until a moderator publishes it
            {moderator ? ': use "Publish this version".' : '.'}
          </p>
        )}
        {showing.which === 'published' && info !== null && draftIsNewer && (
          <p className="wt-notice" role="status">
            There is a newer draft (version {draftNo}) that visitors don't see yet.{moderator ? ' You can publish it from the draft.' : ''} {showDraft}
          </p>
        )}
        {showing.which === 'draft' && info !== null && !isPublished && justSaved !== info.number && (
          <p className="wt-notice" role="status">Visitors don't see this draft yet: they see {visitorsSee(info.publishedNumber)} until a moderator publishes it.</p>
        )}

        {starting ? (
          <div className="wt-start">
            {starting.problems && (
              <div className="wt-notice wt-notice--problem" role="alert">
                The saved draft could not be read. Nothing was deleted: it is only replaced when the new draft is saved.
                <ul>{starting.problems.slice(0, 3).map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            <h2 className="wt-start-title">Start the Community Website</h2>
            <p>Everyone in town edits this draft. Pick a starting point; you can change everything.</p>
            <div className="wt-start-choices">
              <button type="button" className="wt-tool wt-start-choice" onClick={() => startFrom('blank')}>
                <strong>Blank website</strong><span>One empty page and an empty stylesheet.</span>
              </button>
              <button type="button" className="wt-tool wt-start-choice" onClick={() => startFrom('classic')}>
                <strong>Classic homepage</strong><span>A few linked pages in a nostalgic style, to make the town's own.</span>
              </button>
            </div>
            <button type="button" className="wt-tool" onClick={() => setStarting(null)}>Back</button>
          </div>
        ) : (
          <div className="cw-body">
            <div className="cw-site">
              <HouseWebsite
                houseId="community"
                load={shown.load}
                onRetry={() => setAttempt(n => n + 1)}
                status={status}
                actions={actions}
                empty={empty}
                damaged={d => (
                  <div className="cw-empty" role="alert">
                    <p>This version could not be read.</p>
                    <ul>{d.problems.slice(0, 3).map((p, i) => <li key={i}>{p}</li>)}</ul>
                    <p>{actions}</p>
                  </div>
                )}
              />
            </div>
            {versions && (
              <aside className="cw-versions" aria-label="Versions">
                <h3>Versions</h3>
                {versions.length === 0 ? <p>None yet.</p> : (
                  <ol>
                    {versions.map(v => (
                      <li key={v.number}>
                        <button type="button" className="cw-version" aria-current={showing.which === 'revision' && showing.number === v.number ? 'true' : undefined}
                          onClick={() => setShowing(v.isDraft ? { which: 'draft' } : v.isPublished ? { which: 'published' } : { which: 'revision', number: v.number })}>
                          <strong>Version {v.number}</strong>
                          {v.isDraft && <span className="cw-pill">Draft</span>}
                          {v.isPublished && <span className="cw-pill cw-pill--live">Published</span>}
                          <span>{displayNameOr(v.authorName)}, {when(v.savedAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="cw-small">The newest 30 versions are kept, and the last 10 that were published.</p>
              </aside>
            )}
          </div>
        )}

        {moderating && (
          <ModerationPanel backend={backend} worldId={worldId} userId={userId} onClose={() => setModerating(false)} initialTab="locks"
            onLocksChanged={() => hallContext(backend, worldId).then(setCtx, () => undefined)} />
        )}
        {confirm && (
          <div className="cw-confirm" role="alertdialog" aria-label={`Publish version ${confirm.number}?`}>
            <h3>Publish version {confirm.number}?</h3>
            <p>Everyone who opens the Community Website will see this version. For them, it changes:</p>
            <ul>{confirm.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <label className="ws-field">
              <span>Note for the moderation log (optional)</span>
              <input className="ws-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
            </label>
            <div className="cw-confirm-buttons">
              <button type="button" className="wt-tool" onClick={() => setConfirm(null)} disabled={busy} autoFocus>Cancel</button>
              <button type="button" className="wt-tool cw-publish" onClick={() => void publish()} disabled={busy}>Publish</button>
            </div>
          </div>
        )}
      </div>
    </WindowFrame>
  )
}

export default CommunityWebsiteApp
