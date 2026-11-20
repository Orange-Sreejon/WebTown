import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentType } from 'react'
import { ConflictError, PersonalSpacesError, ValidationError } from '../../personal-spaces/errors'
import { LOCAL_ONLY_LABEL, NOT_SAVED_NOTICE } from '../../personal-spaces/labels'
import { assetDataUrl, buildSitePage, findPage, type RenderableSite } from '../../personal-spaces/site-project/builder'
import { checkCss, checkHtml, type CodeNote } from '../../personal-spaces/site-project/html-check'
import {
  assetNameProblem,
  checkUpload,
  cleanAssetName,
  formatBytes,
  pageNameProblem,
  projectUsage,
  uniqueName,
  validateProject,
} from '../../personal-spaces/site-project/rules'
import {
  assetUsedIn,
  isDirty,
  saveRequest,
  startStudio,
  studioReducer,
  unsavedPages,
  type StudioAction,
  type StudioState,
} from '../../personal-spaces/site-project/studio-state'
import { blankProject, classicProject } from '../../personal-spaces/site-project/templates'
import {
  ASSET_FOLDER,
  SITE_PROJECT_LIMITS,
  STYLESHEET_NAME,
  type SiteAsset,
  type SiteAssetMeta,
  type SiteProject,
} from '../../personal-spaces/site-project/types'
import type { SiteProjectWriter } from '../../personal-spaces/site-project-storage/project-repository'
import type { WebsiteState } from '../../personal-spaces/site-project-storage/resolve-website'
import { WindowFrame } from '../apps/WindowFrame'
import { SiteFrame } from '../website/SiteFrame'
import { siteAppBase } from '../website/site-urls'
import { AssetsPanel } from './AssetsPanel'
import { CodeEditor } from './CodeEditor'
import type { CodeEditorHandle, CodeEditorProps } from './editor-types'
import { PagesPanel } from './PagesPanel'
import { ConfirmDialog, NameDialog } from './StudioDialog'
import './website-studio.css'

/** How long after typing stops the preview refreshes on its own (decision SD-11). */
export const PREVIEW_DELAY_MS = 600
export const PHONE_WIDTH = 375

export interface SiteStudioProps {
  houseId: string
  initial: StudioState
  writer: SiteProjectWriter
  /** Reads what storage holds now; used after a conflict. */
  reload: () => Promise<WebsiteState>
  /** False when storage is unusable and saves last only for this tab. */
  persistent: boolean
  /** Back to the website (after any unsaved-changes question). */
  onExit: () => void
  /** Close the whole window (after any unsaved-changes question). */
  onClose: () => void
  /** The code editor; CodeMirror by default. Tests pass a plain one. */
  Editor?: ComponentType<CodeEditorProps>
  now?: () => string
}

type Layout = 'split' | 'code' | 'preview'
type Viewport = 'desktop' | 'phone'

type Dialog =
  | { kind: 'new-page' }
  | { kind: 'rename-page'; name: string }
  | { kind: 'delete-page'; name: string }
  | { kind: 'delete-asset'; asset: SiteAssetMeta }
  | { kind: 'start-over' }
  | { kind: 'leave'; then: 'exit' | 'close' }
  | { kind: 'conflict' }

type Notice = { tone: 'good' | 'problem' | 'info'; text: string; items?: string[] }

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** A file's bytes. `FileReader` where `Blob.arrayBuffer` is missing (older browsers, jsdom). */
function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/** `about` -> `about.html`; anything with an extension is left for the rules to judge. */
const pageFileName = (text: string): string => (text !== '' && !text.includes('.') ? `${text}.html` : text)

const describe = (error: unknown): string =>
  error instanceof PersonalSpacesError ? error.message : 'Something went wrong while saving. Your changes are still here.'

/**
 * The owner's HTML/CSS Studio: pages and images on the left, the HTML of the
 * current page or `style.css` in a code editor, and a live preview built by the
 * very same `buildSitePage` visitors get, inside the same sandbox.
 */
export function SiteStudio({ houseId, initial, writer, reload, persistent, onExit, onClose, Editor = CodeEditor, now = () => new Date().toISOString() }: SiteStudioProps): React.ReactElement {
  const [state, dispatch] = useReducer(studioReducer, initial)
  const stateRef = useRef(state)
  stateRef.current = state
  const editorRef = useRef<CodeEditorHandle>(null)

  const [layout, setLayout] = useState<Layout>('split')
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [auto, setAuto] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  // ── Preview: rebuilt shortly after typing stops, or on Refresh ──────────
  const [shown, setShown] = useState(() => ({ draft: state.draft, page: state.page }))
  const [previewPage, setPreviewPage] = useState(state.page)
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => {
    setShown({ draft: stateRef.current.draft, page: stateRef.current.page })
    setRefreshKey(n => n + 1)
  }, [])

  useEffect(() => setPreviewPage(state.page), [state.page])
  useEffect(() => {
    if (!auto) return
    const timer = setTimeout(() => setShown({ draft: state.draft, page: state.page }), PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state.draft, state.page, auto])

  // Data URLs are made once per image, not on every keystroke.
  const dataUrls = useRef(new Map<string, string>())
  const urlFor = useCallback((id: string): string | undefined => {
    const asset = stateRef.current.assetData[id]
    if (!asset) return undefined
    let url = dataUrls.current.get(id)
    if (url === undefined) {
      url = assetDataUrl(asset)
      dataUrls.current.set(id, url)
    }
    return url
  }, [])

  const renderable = useMemo<RenderableSite>(() => ({
    pages: Object.fromEntries(shown.draft.pages.map(p => [p.name, p.html])),
    css: shown.draft.css,
    assets: Object.fromEntries(shown.draft.assets.flatMap(a => {
      const url = urlFor(a.id)
      return url ? [[a.name, url]] : []
    })),
  }), [shown, urlFor])

  const built = useMemo(() => buildSitePage(renderable, previewPage, siteAppBase()), [renderable, previewPage])

  const notes: CodeNote[] = useMemo(() => {
    if (state.tab === 'css') return checkCss(shown.draft.css)
    const page = shown.draft.pages.find(p => p.name === state.page)
    return page ? checkHtml(page.html) : []
  }, [shown, state.tab, state.page])

  // ── Saving ─────────────────────────────────────────────────────────────
  const dirty = isDirty(state)
  const unsaved = useMemo(() => unsavedPages(state), [state])

  const saveFrom = useCallback(async (from: StudioState): Promise<void> => {
    const request = saveRequest(from)
    const problems = validateProject(request.project)
    if (problems.length > 0) {
      setNotice({ tone: 'problem', text: 'The website was not saved:', items: problems.map(p => p.message) })
      return
    }
    setSaving(true)
    try {
      const project = await writer.save(request)
      dispatch({ type: 'saved', project })
      setNotice({ tone: 'good', text: persistent ? 'Saved on this device only.' : 'Saved for this tab only: browser storage is unavailable.' })
    } catch (error) {
      if (error instanceof ConflictError) setDialog({ kind: 'conflict' })
      else if (error instanceof ValidationError) {
        setNotice({ tone: 'problem', text: 'The website was not saved:', items: error.issues.map(i => i.message) })
      } else {
        console.error('[WebTown] The website could not be saved.', error)
        setNotice({ tone: 'problem', text: describe(error) })
      }
    } finally {
      setSaving(false)
    }
  }, [writer, persistent])

  const save = useCallback(() => {
    if (!saving) void saveFrom(stateRef.current)
  }, [saving, saveFrom])

  // Ctrl+S / Cmd+S saves.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [save])

  // The browser asks before the tab closes with unsaved work.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const resolveConflict = async (choice: 'reload' | 'overwrite'): Promise<void> => {
    setDialog(null)
    let latest: WebsiteState
    try {
      latest = await reload()
    } catch (error) {
      setNotice({ tone: 'problem', text: describe(error) })
      return
    }
    if (choice === 'reload') {
      if (latest.kind !== 'project') {
        setNotice({ tone: 'problem', text: 'There is no saved website to reload. Your changes are still here.' })
        return
      }
      dispatch({ type: 'reload', snapshot: latest.snapshot })
      refreshNow(latest.snapshot.project)
      setNotice({ tone: 'info', text: 'Showing the version saved in the other tab.' })
      return
    }
    // Save anyway: keep this draft and write it over whatever is stored now.
    const action: StudioAction = latest.kind === 'project'
      ? { type: 'rebase', snapshot: latest.snapshot }
      : { type: 'rebase', snapshot: { project: { ...stateRef.current.draft, revision: latest.kind === 'damaged' ? latest.revision : 0, assets: [] }, assets: [] } }
    let next = studioReducer(stateRef.current, action)
    if (latest.kind !== 'project') next = { ...next, stored: false }
    stateRef.current = next
    dispatch({ type: 'restore', state: next })
    await saveFrom(next)
  }

  const refreshNow = (project: SiteProject): void => {
    setShown({ draft: project, page: project.homePage })
    setRefreshKey(n => n + 1)
  }

  // ── Leaving ────────────────────────────────────────────────────────────
  const leave = (then: 'exit' | 'close'): void => {
    if (isDirty(stateRef.current)) setDialog({ kind: 'leave', then })
    else if (then === 'exit') onExit()
    else onClose()
  }

  // ── Images ─────────────────────────────────────────────────────────────
  const upload = async (files: File[]): Promise<void> => {
    const refused: string[] = []
    const added: string[] = []
    let current = stateRef.current
    for (const file of files) {
      const taken = current.draft.assets.map(a => a.name)
      const name = uniqueName(cleanAssetName(file.name), taken)
      const nameIssue = assetNameProblem(name, taken)
      if (nameIssue) { refused.push(`${file.name}: ${nameIssue}`); continue }
      let bytes: ArrayBuffer
      try {
        bytes = await readBytes(file)
      } catch {
        refused.push(`${file.name} could not be read.`)
        continue
      }
      const check = checkUpload(name, bytes)
      if (!check.ok) { refused.push(check.reason); continue }
      const usage = projectUsage(current.draft)
      if (usage.bytes + bytes.byteLength > SITE_PROJECT_LIMITS.totalBytes) {
        refused.push(`${file.name} would take the website over ${formatBytes(SITE_PROJECT_LIMITS.totalBytes)}.`)
        continue
      }
      if (usage.files + 1 > SITE_PROJECT_LIMITS.totalFiles) {
        refused.push(`A website can have at most ${SITE_PROJECT_LIMITS.totalFiles} files.`)
        continue
      }
      const asset: SiteAsset = { id: newId(), name, mimeType: check.mimeType, size: bytes.byteLength, houseId, bytes }
      const action: StudioAction = { type: 'add-asset', asset }
      current = studioReducer(current, action)
      stateRef.current = current
      dispatch(action)
      added.push(`${ASSET_FOLDER}/${name}`)
    }
    if (refused.length > 0) setNotice({ tone: 'problem', text: added.length > 0 ? `Added ${added.join(', ')}. Some files were not added:` : 'These files were not added:', items: refused })
    else if (added.length > 0) setNotice({ tone: 'good', text: `Added ${added.join(', ')}. Use it in a page as ${added[0]}.` })
  }

  const copyPath = async (asset: SiteAssetMeta): Promise<void> => {
    const path = `${ASSET_FOLDER}/${asset.name}`
    try {
      await navigator.clipboard.writeText(path)
      setNotice({ tone: 'good', text: `Copied ${path}` })
    } catch {
      setNotice({ tone: 'info', text: `Your browser did not allow copying. The path is: ${path}` })
    }
  }

  const insertAsset = (asset: SiteAssetMeta): void => {
    const path = `${ASSET_FOLDER}/${asset.name}`
    const stem = asset.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
    editorRef.current?.insert(state.tab === 'css' ? `url("${path}")` : `<img src="${path}" alt="${stem}">`)
  }

  // ── Layout pieces ──────────────────────────────────────────────────────
  const currentHtml = state.draft.pages.find(p => p.name === state.page)?.html ?? ''
  const usage = projectUsage(state.draft)
  const status = saving ? 'Saving...' : dirty ? (state.stored ? 'Unsaved changes' : 'Not saved yet') : 'Saved'
  const editorLabel = state.tab === 'css' ? `${STYLESHEET_NAME} code` : `${state.page} HTML code`

  const finishDialog = (): void => setDialog(null)

  return (
    <WindowFrame title={`Site Studio: ${state.draft.title || 'My website'}`} onClose={() => leave('close')} size="full">
      <div className="ws-studio wt-window">
        <div className="wt-toolbar ws-toolbar" role="toolbar" aria-label="Studio">
          <label className="ws-field">
            <span>Website name</span>
            <input
              className="ws-input"
              value={state.draft.title}
              maxLength={SITE_PROJECT_LIMITS.title}
              onChange={event => dispatch({ type: 'set-title', title: event.target.value })}
            />
          </label>
          <span className="ws-status" role="status" aria-live="polite">{status}</span>
          <button type="button" className="wt-tool" onClick={save} disabled={saving || !dirty}>Save</button>
          <span className="ws-sep" aria-hidden="true" />
          <span className="ws-group" role="group" aria-label="Layout">
            {(['split', 'code', 'preview'] as const).map(value => (
              <button key={value} type="button" className="wt-tool ws-small" aria-pressed={layout === value} onClick={() => setLayout(value)}>
                {value === 'split' ? 'Split' : value === 'code' ? 'Code' : 'Preview'}
              </button>
            ))}
          </span>
          <span className="ws-group" role="group" aria-label="Preview size">
            <button type="button" className="wt-tool ws-small" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}>Desktop</button>
            <button type="button" className="wt-tool ws-small" aria-pressed={viewport === 'phone'} onClick={() => setViewport('phone')}>Phone</button>
          </span>
          <button type="button" className="wt-tool ws-small" onClick={refresh}>Refresh</button>
          <label className="ws-check">
            <input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />
            Auto
          </label>
          <span className="ws-sep" aria-hidden="true" />
          <button type="button" className="wt-tool ws-small" onClick={() => setDialog({ kind: 'start-over' })}>Start over</button>
          <button type="button" className="wt-tool" onClick={() => leave('exit')}>Exit</button>
        </div>

        {notice && (
          <div className={`wt-notice ${notice.tone === 'problem' ? 'wt-notice--problem' : notice.tone === 'good' ? 'wt-notice--good' : ''}`} role={notice.tone === 'problem' ? 'alert' : 'status'}>
            {notice.text}
            {notice.items && <ul>{notice.items.slice(0, 8).map((item, i) => <li key={i}>{item}</li>)}</ul>}
            <button type="button" className="wt-retry" onClick={() => setNotice(null)} aria-label="Dismiss message">OK</button>
          </div>
        )}

        <div className="ws-body">
          <aside className="ws-side" aria-label="Files">
            <PagesPanel
              pages={state.draft.pages}
              current={state.page}
              homePage={state.draft.homePage}
              unsaved={unsaved}
              onSelect={name => dispatch({ type: 'select-page', page: name })}
              onNew={() => setDialog({ kind: 'new-page' })}
              onRename={name => setDialog({ kind: 'rename-page', name })}
              onDelete={name => setDialog({ kind: 'delete-page', name })}
              onSetHome={name => dispatch({ type: 'set-home', name })}
            />
            <section className="ws-panel" aria-label="Stylesheet">
              <button
                type="button"
                className={state.tab === 'css' ? 'ws-item-name ws-item--current' : 'ws-item-name'}
                aria-current={state.tab === 'css' ? 'true' : undefined}
                onClick={() => dispatch({ type: 'select-tab', tab: 'css' })}
              >
                {STYLESHEET_NAME} <span className="ws-hint">(every page)</span>
              </button>
            </section>
            <AssetsPanel
              assets={state.draft.assets}
              thumbnail={urlFor}
              onUpload={files => void upload(files)}
              onCopyPath={asset => void copyPath(asset)}
              onInsert={insertAsset}
              onDelete={asset => setDialog({ kind: 'delete-asset', asset })}
              canInsert={layout !== 'preview'}
            />
            <p className="ws-hint ws-usage">
              {formatBytes(usage.bytes)} of {formatBytes(SITE_PROJECT_LIMITS.totalBytes)} used, {usage.files} of {SITE_PROJECT_LIMITS.totalFiles} files.
            </p>
          </aside>

          <main className={`ws-main ws-main--${layout}`}>
            <section className="ws-code-pane" hidden={layout === 'preview'} aria-label="Code">
              <div className="ws-tabs" role="tablist" aria-label="File">
                <button type="button" role="tab" className="ws-tab" aria-selected={state.tab === 'html'} onClick={() => dispatch({ type: 'select-tab', tab: 'html' })}>
                  {state.page}
                </button>
                <button type="button" role="tab" className="ws-tab" aria-selected={state.tab === 'css'} onClick={() => dispatch({ type: 'select-tab', tab: 'css' })}>
                  {STYLESHEET_NAME}
                </button>
              </div>
              <div className="ws-editor">
                <Editor
                  ref={editorRef}
                  docKey={state.tab === 'css' ? 'css' : `page:${state.page}`}
                  value={state.tab === 'css' ? state.draft.css : currentHtml}
                  language={state.tab}
                  label={editorLabel}
                  onChange={value =>
                    state.tab === 'css'
                      ? dispatch({ type: 'edit-css', css: value })
                      : dispatch({ type: 'edit-html', page: state.page, html: value })
                  }
                />
              </div>
              <div className="ws-notes" aria-label="Markup check">
                <p className="ws-notes-title">Markup check{notes.length === 0 ? ': nothing to report.' : ':'}</p>
                {notes.length > 0 && (
                  <ul>
                    {notes.slice(0, 20).map((note, i) => <li key={i}>Line {note.line}: {note.message}</li>)}
                  </ul>
                )}
              </div>
            </section>

            <section className="ws-preview-pane" hidden={layout === 'code'} aria-label="Preview">
              <p className="ws-preview-title">
                Preview: {previewPage}{built.title.trim() ? ` (${built.title.trim()})` : ''}{!auto && <span className="ws-hint"> press Refresh to update</span>}
              </p>
              <div className={viewport === 'phone' ? 'ws-preview ws-preview--phone' : 'ws-preview'} style={viewport === 'phone' ? { width: PHONE_WIDTH } : undefined}>
                <SiteFrame
                  html={built.html}
                  renderKey={refreshKey}
                  title={`Preview of ${previewPage}`}
                  onPageLink={target => {
                    const name = findPage(renderable, target)
                    if (name !== null && stateRef.current.draft.pages.some(p => p.name === name)) dispatch({ type: 'select-page', page: name })
                    else setPreviewPage(target)
                  }}
                />
              </div>
            </section>
          </main>
        </div>

        <p className="wt-status">{persistent ? `${LOCAL_ONLY_LABEL}. Visitors on this device see the saved version.` : NOT_SAVED_NOTICE}</p>

        {dialog?.kind === 'new-page' && (
          <NameDialog
            title="New page"
            label="Page name"
            initial=""
            confirmLabel="Create"
            normalise={pageFileName}
            problem={name => (name === '' ? 'Type a name, for example about.html.' : pageNameProblem(name, state.draft.pages.map(p => p.name)))}
            onConfirm={name => { dispatch({ type: 'add-page', name }); finishDialog() }}
            onCancel={finishDialog}
          />
        )}
        {dialog?.kind === 'rename-page' && (
          <NameDialog
            title={`Rename ${dialog.name}`}
            label="New name"
            initial={dialog.name}
            confirmLabel="Rename"
            normalise={pageFileName}
            problem={name => (name === dialog.name ? 'Type a different name.' : pageNameProblem(name, state.draft.pages.map(p => p.name).filter(n => n !== dialog.name)))}
            onConfirm={name => {
              dispatch({ type: 'rename-page', from: dialog.name, to: name })
              setNotice({ tone: 'info', text: `Renamed to ${name}. Links to ${dialog.name} in your pages are not changed automatically.` })
              finishDialog()
            }}
            onCancel={finishDialog}
          />
        )}
        {dialog?.kind === 'delete-page' && (
          <ConfirmDialog
            title={`Delete ${dialog.name}?`}
            message={<p>This removes the page and its HTML from the editor{dialog.name === state.draft.homePage ? ', and another page becomes the homepage' : ''}. It is gone for good once you save.</p>}
            confirmLabel="Delete page"
            onConfirm={() => { dispatch({ type: 'delete-page', name: dialog.name }); finishDialog() }}
            onCancel={finishDialog}
          />
        )}
        {dialog?.kind === 'delete-asset' && (() => {
          const usedIn = assetUsedIn(state.draft, dialog.asset.name)
          return (
            <ConfirmDialog
              title={`Delete ${dialog.asset.name}?`}
              message={
                <>
                  <p>The image is removed from your website when you save.</p>
                  {usedIn.length > 0 && <p><strong>It is still used in:</strong> {usedIn.join(', ')}. Those places will show a missing image.</p>}
                </>
              }
              confirmLabel="Delete image"
              onConfirm={() => { dispatch({ type: 'delete-asset', id: dialog.asset.id }); finishDialog() }}
              onCancel={finishDialog}
            />
          )
        })()}
        {dialog?.kind === 'start-over' && (
          <ConfirmDialog
            title="Start over"
            message={<p>Replace every page and {STYLESHEET_NAME} with a starting point? Your images are kept. Nothing is saved until you press Save.</p>}
            confirmLabel="Blank website"
            extra={{
              label: 'Classic personal homepage',
              onChoose: () => {
                const project = classicProject(houseId, now())
                dispatch({ type: 'replace-draft', project: { ...project, assets: state.draft.assets }, assets: [] })
                refreshNow(project)
                finishDialog()
              },
            }}
            onConfirm={() => {
              const project = blankProject(houseId, now())
              dispatch({ type: 'replace-draft', project: { ...project, assets: state.draft.assets }, assets: [] })
              refreshNow(project)
              finishDialog()
            }}
            onCancel={finishDialog}
          />
        )}
        {dialog?.kind === 'leave' && (
          <ConfirmDialog
            title="Leave without saving?"
            message={<p>Your changes have not been saved. If you leave now, they are lost.</p>}
            confirmLabel="Leave without saving"
            cancelLabel="Keep editing"
            onConfirm={() => {
              const then = dialog.then
              finishDialog()
              if (then === 'exit') onExit()
              else onClose()
            }}
            onCancel={finishDialog}
          />
        )}
        {dialog?.kind === 'conflict' && (
          <ConfirmDialog
            title="Saved somewhere else"
            message={<p>This website was saved in another tab after you opened it. Saving now would replace that version.</p>}
            confirmLabel="Save mine anyway"
            cancelLabel="Keep editing"
            extra={{ label: 'Load the other version', onChoose: () => void resolveConflict('reload') }}
            onConfirm={() => void resolveConflict('overwrite')}
            onCancel={finishDialog}
          />
        )}
      </div>
    </WindowFrame>
  )
}

/** A Studio state for a website that is not in storage yet (new, converted or over a damaged one). */
export function unsavedStudio(project: SiteProject, assets: SiteAsset[] = [], baseRevision = 0): StudioState {
  return startStudio({ project, assets }, { stored: false, baseRevision })
}
