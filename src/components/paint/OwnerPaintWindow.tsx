import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { OwnerPaintAccess } from '../../personal-spaces/composition'
import type { Artwork } from '../../personal-spaces/artwork-storage/artwork'
import type { ArtworkList } from '../../personal-spaces/artwork-storage/artwork-repository'
import { savedLabel } from '../../personal-spaces/labels'
import { BLACK, PALETTE, WHITE, describeColor, type CanvasBase, type Rgba, type Swatch } from '../../personal-spaces/paint/color'
import { PaintSession, type StrokeInput } from '../../personal-spaces/paint/paint-session'
import type { Point } from '../../personal-spaces/paint/raster'
import { DEFAULT_SETTINGS, sizeFor, toolInfo, type ToolId, type ToolSettings } from '../../personal-spaces/paint/tools'
import { WindowFrame } from '../apps/WindowFrame'
import { CanvasView, type TextBox, type Zoom } from './CanvasView'
import { ColorBox } from './ColorBox'
import { downloadPng, pngFileName } from './export'
import { AppIcon } from './icons'
import { MenuBar, type Menu } from './MenuBar'
import { AboutDialog, AttributesDialog, ConfirmDialog, EditColorDialog, NameDialog, OpenDialog } from './PaintDialogs'
import { browserPngCodec, type PngCodec } from './png-codec'
import { StatusBar, createValueStore } from './StatusBar'
import { browserTextRasterizer, type TextRasterizer } from './text-raster'
import { Toolbox } from './Toolbox'
import { NEW_HEIGHT, NEW_WIDTH, useSketchbook, type SaveState } from './useSketchbook'
import './paint.css'

export interface OwnerPaintWindowProps {
  /** Given only when the app bridge said `owner`. Its writer changes only this house. */
  access: Pick<OwnerPaintAccess, 'houseId' | 'reader' | 'writer'>
  persistent: boolean
  onClose: () => void
  /** Browser helpers, injectable for tests. */
  codec?: PngCodec
  rasterizeText?: TextRasterizer
  download?: (bytes: ArrayBuffer, fileName: string) => void
  autosaveMs?: number
  random?: () => number
}

type Dialog =
  | { kind: 'attributes' }
  | { kind: 'open'; list: ArtworkList | null; error: string | null }
  | { kind: 'rename' }
  | { kind: 'clear' }
  | { kind: 'delete' }
  | { kind: 'edit-color'; swatch: number | null }
  | { kind: 'about' }
  | { kind: 'save-failed' }

const DEFAULT_HINT = 'For Help, click About WebTown Paint on the Help menu.'

const saveLabel = (state: SaveState, persistent: boolean, error: string | null): string => {
  if (state === 'saving') return 'Saving...'
  if (state === 'failed') return `Save failed${error ? `: ${error}` : ''}`
  if (state === 'unsaved') return 'Unsaved changes'
  if (state === 'new') return 'New drawing'
  return persistent ? savedLabel(true) : 'Not saved: kept until you close this tab'
}

/** Re-renders only when what the window shows about the picture changes, not on every pixel. */
function useSessionMeta(session: PaintSession): { width: number; height: number; base: CanvasBase; canUndo: boolean; canRedo: boolean } {
  const key = useSyncExternalStore(
    useCallback(listener => session.onChange(listener), [session]),
    () => `${session.width}|${session.height}|${session.base}|${session.canUndo}|${session.canRedo}`,
  )
  return useMemo(() => {
    const [w, h, base, undo, redo] = key.split('|')
    return { width: Number(w), height: Number(h), base: base as CanvasBase, canUndo: undo === 'true', canRedo: redo === 'true' }
  }, [key])
}

/**
 * WebTown Paint, the owner's Sketchbook: a late-1990s desktop paint program.
 * Loaded on demand and only for the owner; a visitor never gets this module.
 */
export function OwnerPaintWindow({
  access, persistent, onClose,
  codec = browserPngCodec, rasterizeText = browserTextRasterizer, download = downloadPng, autosaveMs, random,
}: OwnerPaintWindowProps): React.ReactElement {
  const [session] = useState(() => PaintSession.blank(NEW_WIDTH, NEW_HEIGHT, 'white', { random }))
  const meta = useSessionMeta(session)
  const sb = useSketchbook({ houseId: access.houseId, reader: access.reader, writer: access.writer, codec, session, autosaveMs })

  const [tool, setTool] = useState<ToolId>('pencil')
  const [previousTool, setPreviousTool] = useState<ToolId>('pencil')
  const [primary, setPrimary] = useState<Rgba>(BLACK)
  const [secondary, setSecondary] = useState<Rgba>(WHITE)
  const [settings, setSettings] = useState<ToolSettings>(DEFAULT_SETTINGS)
  const [palette, setPalette] = useState<Swatch[]>(() => [...PALETTE])
  const [zoom, setZoom] = useState<Zoom>('auto')
  const [showTools, setShowTools] = useState(true)
  const [showColors, setShowColors] = useState(true)
  const [showStatus, setShowStatus] = useState(true)
  const [maximised, setMaximised] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [textBox, setTextBox] = useState<TextBox | null>(null)
  const [pointer] = useState(() => createValueStore(''))
  const closing = useRef(false)

  // The latest choices, read at the moment of a press.
  const live = useRef({ tool, primary, secondary, settings })
  live.current = { tool, primary, secondary, settings }
  const inputFor = useCallback((button: StrokeInput['button'], shift: boolean): StrokeInput => ({
    tool: live.current.tool, primary: live.current.primary, secondary: live.current.secondary,
    settings: live.current.settings, button, shift,
  }), [])

  // ── Text ───────────────────────────────────────────────────────────────
  const textRef = useRef(textBox)
  textRef.current = textBox
  const commitText = useCallback((): void => {
    const box = textRef.current
    if (!box) return
    setTextBox(null)
    textRef.current = null
    const mask = rasterizeText(box.value, box.size)
    if (mask) session.applyMask(mask, box.at.x, box.at.y, box.color)
  }, [rasterizeText, session])
  const cancelText = useCallback(() => { setTextBox(null); textRef.current = null }, [])

  const chooseTool = (next: ToolId): void => {
    commitText()
    if (next === 'picker' && tool !== 'picker') setPreviousTool(tool)
    setTool(next)
  }

  const onPicked = (color: Rgba | null): void => {
    if (!color) return
    if (color.a === 0) setMessage('That pixel is transparent, so the colour was not changed.')
    else setPrimary(color)
    setTool(previousTool)
  }

  // ── Document actions ───────────────────────────────────────────────────
  const busyGuard = (): boolean => {
    commitText()
    session.cancel()
    return true
  }

  const doSave = async (): Promise<void> => {
    busyGuard()
    await sb.save()
  }

  const doNew = async (): Promise<void> => {
    busyGuard()
    if (!(await sb.newDrawing())) setMessage('The drawing could not be saved, so a new one was not started.')
  }

  const showOpen = async (): Promise<void> => {
    busyGuard()
    setDialog({ kind: 'open', list: null, error: null })
    try {
      const list = await sb.list()
      setDialog(d => (d?.kind === 'open' ? { kind: 'open', list, error: null } : d))
    } catch {
      setDialog(d => (d?.kind === 'open' ? { kind: 'open', list: { items: [], skipped: [] }, error: 'The drawings could not be read.' } : d))
    }
  }

  const doExport = async (): Promise<void> => {
    busyGuard()
    try {
      download(await codec.encode(session.image), pngFileName(sb.title))
      setMessage(`Exported ${pngFileName(sb.title)}.`)
    } catch (error) {
      console.error('[WebTown] Export failed.', error)
      setMessage('The picture could not be exported.')
    }
  }

  const requestClose = useCallback(async (): Promise<void> => {
    if (closing.current) return
    closing.current = true
    commitText()
    session.cancel()
    const ok = await sb.save()
    closing.current = false
    if (ok) onClose()
    else setDialog({ kind: 'save-failed' })
  }, [commitText, onClose, sb, session])

  const undo = (): void => { cancelText(); session.undo() }
  const redo = (): void => { cancelText(); session.redo() }

  // ── Keyboard ───────────────────────────────────────────────────────────
  const keys = useRef({ requestClose, undo, redo, doSave, doNew, showOpen, dialog, textBox })
  keys.current = { requestClose, undo, redo, doSave, doNew, showOpen, dialog, textBox }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const k = keys.current
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (k.dialog) return
        if (session.cancel()) return
        void k.requestClose()
        return
      }
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      if (k.dialog) return
      const mod = event.ctrlKey || event.metaKey
      if (!mod || event.altKey) return
      const key = event.key.toLowerCase()
      const run = (fn: () => void): void => { event.preventDefault(); fn() }
      if (key === 'z' && !event.shiftKey) run(k.undo)
      else if (key === 'y' || (key === 'z' && event.shiftKey)) run(k.redo)
      else if (key === 's') run(() => void k.doSave())
      else if (key === 'n' && event.shiftKey) run(() => setDialog({ kind: 'clear' }))
      else if (key === 'n') run(() => void k.doNew())
      else if (key === 'o') run(() => void k.showOpen())
      else if (key === 'e') run(() => setDialog({ kind: 'attributes' }))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [session])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(t)
  }, [message])

  // ── Menus ──────────────────────────────────────────────────────────────
  const item = (label: string, onSelect: () => void, extra: { shortcut?: string; hint?: string; disabled?: boolean; checked?: boolean } = {}) =>
    ({ kind: 'item' as const, label, onSelect, ...extra })
  const sep = { kind: 'separator' as const }
  const zoomItem = (label: string, value: Zoom) => item(label, () => setZoom(value), { checked: zoom === value, hint: 'Changes how big the picture is shown. The picture itself does not change.' })
  const menus: Menu[] = [
    { label: 'File', access: 'F', items: [
      item('New', () => void doNew(), { shortcut: 'Ctrl+N', hint: 'Starts a new drawing. The current one is saved first.' }),
      item('Open...', () => void showOpen(), { shortcut: 'Ctrl+O', hint: "Opens one of this house's drawings." }),
      item('Save', () => void doSave(), { shortcut: 'Ctrl+S', hint: 'Saves the drawing now. It is also saved automatically.' }),
      item('Rename...', () => setDialog({ kind: 'rename' }), { hint: 'Gives the drawing a new name.' }),
      sep,
      item('Export PNG...', () => void doExport(), { hint: 'Downloads the picture as a PNG file.' }),
      item('Delete Drawing...', () => setDialog({ kind: 'delete' }), { hint: 'Deletes this drawing for good.' }),
      sep,
      item('Exit', () => void requestClose(), { hint: 'Saves and closes the Sketchbook.' }),
    ] },
    { label: 'Edit', access: 'E', items: [
      item('Undo', undo, { shortcut: 'Ctrl+Z', disabled: !meta.canUndo, hint: 'Undoes the last action.' }),
      item('Redo', redo, { shortcut: 'Ctrl+Y', disabled: !meta.canRedo, hint: 'Redoes the action you undid.' }),
    ] },
    { label: 'View', access: 'V', items: [
      item('Tool Box', () => setShowTools(v => !v), { checked: showTools, hint: 'Shows or hides the tool box.' }),
      item('Color Box', () => setShowColors(v => !v), { checked: showColors, hint: 'Shows or hides the colour box.' }),
      item('Status Bar', () => setShowStatus(v => !v), { checked: showStatus, hint: 'Shows or hides the status bar.' }),
      sep,
      zoomItem('Zoom to Fit', 'auto'),
      zoomItem('Normal Size (100%)', 1),
      zoomItem('Large Size (200%)', 2),
      zoomItem('Extra Large (400%)', 4),
    ] },
    { label: 'Image', access: 'I', items: [
      item('Attributes...', () => setDialog({ kind: 'attributes' }), { shortcut: 'Ctrl+E', hint: 'Changes the canvas size and colour.' }),
      item('Clear Image', () => setDialog({ kind: 'clear' }), { shortcut: 'Ctrl+Shift+N', hint: 'Clears the whole picture. You can undo this.' }),
    ] },
    { label: 'Colors', access: 'C', items: [
      item('Edit Colors...', () => setDialog({ kind: 'edit-color', swatch: null }), { hint: 'Picks any colour as the foreground colour.' }),
    ] },
    { label: 'Help', access: 'H', items: [
      item('About WebTown Paint', () => setDialog({ kind: 'about' }), { hint: 'Shows how WebTown Paint works.' }),
    ] },
  ]

  const size = sizeFor(tool, settings)
  const statusHint = message ?? hint ?? (textBox ? 'Type your text. Click outside the box or press Ctrl+Enter to place it; Escape cancels.' : null) ?? DEFAULT_HINT
  const title = `${sb.title} - WebTown Paint`
  const finish = (): void => setDialog(null)

  return (
    <WindowFrame title={title} onClose={() => void requestClose()} size="full" maximised={maximised} bare closeOnEscape={false}>
      <div className="pt-window" data-testid="paint-window">
        <div className="pt-titlebar">
          <AppIcon />
          <span className="pt-title">{title}</span>
          <span className="pt-winbtns">
            <button type="button" className="pt-winbtn" aria-label="Minimise" aria-disabled="true" title="Not available">
              <span aria-hidden="true">_</span>
            </button>
            <button type="button" className="pt-winbtn" aria-label={maximised ? 'Restore' : 'Maximise'} title={maximised ? 'Restore' : 'Maximise'} onClick={() => setMaximised(m => !m)}>
              <span aria-hidden="true">{maximised ? '❐' : '□'}</span>
            </button>
            <button type="button" className="pt-winbtn pt-winbtn--close" aria-label="Close" title="Close (saves first)" onClick={() => void requestClose()}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        </div>
        <MenuBar menus={menus} onHint={setHint} />
        {sb.problems.length > 0 && (
          <p className="pt-notice" role="status">Some drawings could not be opened and are left as they were: {sb.problems.slice(0, 2).join(' ')}</p>
        )}
        <div className="pt-main">
          {showTools && (
            <Toolbox
              tool={tool}
              settings={settings}
              onTool={chooseTool}
              onSettings={change => setSettings(s => ({ ...s, ...change }))}
              onHint={setHint}
              canUndo={meta.canUndo}
              canRedo={meta.canRedo}
              onUndo={undo}
              onRedo={redo}
            />
          )}
          {sb.status === 'loading' ? (
            <div className="pt-canvas-area"><p className="pt-loading" role="status">Opening the Sketchbook...</p></div>
          ) : (
            <CanvasView
              session={session}
              width={meta.width}
              height={meta.height}
              transparent={meta.base === 'transparent'}
              tool={tool}
              zoom={zoom}
              inputFor={inputFor}
              onPicked={onPicked}
              onTextRequest={(at: Point) => setTextBox({ at, value: '', size: settings.fontSize, color: primary })}
              pointer={pointer}
              textBox={textBox}
              onTextChange={value => setTextBox(box => (box ? { ...box, value } : box))}
              onTextCommit={commitText}
              onTextCancel={cancelText}
            />
          )}
        </div>
        {showColors && (
          <ColorBox
            palette={palette}
            primary={primary}
            secondary={secondary}
            onPrimary={setPrimary}
            onSecondary={setSecondary}
            onEditSwatch={index => setDialog({ kind: 'edit-color', swatch: index })}
            onSwap={() => { setPrimary(secondary); setSecondary(primary) }}
          />
        )}
        {showStatus && (
          <StatusBar
            hint={statusHint}
            pointer={pointer}
            size={`${meta.width} x ${meta.height}`}
            toolSize={size ? `${size.label}: ${size.value}` : toolInfo(tool).label}
            saveState={saveLabel(sb.saveState, persistent, sb.saveError)}
          />
        )}
        <span className="wt-sr-only" aria-live="polite">{`Tool: ${toolInfo(tool).label}. Foreground ${describeColor(primary)}.`}</span>

        {dialog?.kind === 'attributes' && (
          <AttributesDialog
            width={meta.width}
            height={meta.height}
            base={meta.base}
            onApply={(w, h, base) => { commitText(); session.setAttributes(w, h, base); finish() }}
            onCancel={finish}
          />
        )}
        {dialog?.kind === 'open' && (
          <OpenDialog
            items={dialog.list?.items ?? null}
            skipped={dialog.list?.skipped ?? []}
            error={dialog.error}
            currentId={sb.id}
            onOpen={(artwork: Artwork) => { finish(); void sb.open(artwork).then(ok => { if (!ok) setMessage('That drawing could not be opened.') }) }}
            onCancel={finish}
          />
        )}
        {dialog?.kind === 'rename' && (
          <NameDialog title="Rename" initial={sb.title} confirmLabel="Rename" onConfirm={name => { finish(); void sb.rename(name) }} onCancel={finish} />
        )}
        {dialog?.kind === 'clear' && (
          <ConfirmDialog
            title="Clear Image"
            message={<p>Clear the whole picture? You can undo this with Ctrl+Z.</p>}
            confirmLabel="Clear"
            onConfirm={() => { commitText(); session.clear(); finish() }}
            onCancel={finish}
          />
        )}
        {dialog?.kind === 'delete' && (
          <ConfirmDialog
            title="Delete Drawing"
            message={<p>Delete <strong>{sb.title}</strong> for good? This cannot be undone.</p>}
            confirmLabel="Delete"
            onConfirm={() => { finish(); cancelText(); void sb.remove() }}
            onCancel={finish}
          />
        )}
        {dialog?.kind === 'edit-color' && (
          <EditColorDialog
            initial={dialog.swatch === null ? primary : palette[dialog.swatch]!.color}
            onConfirm={color => {
              if (dialog.swatch !== null) {
                const index = dialog.swatch
                setPalette(p => p.map((s, i) => (i === index ? { name: 'Custom', color } : s)))
              }
              setPrimary(color)
              finish()
            }}
            onCancel={finish}
          />
        )}
        {dialog?.kind === 'about' && <AboutDialog persistent={persistent} onClose={finish} />}
        {dialog?.kind === 'save-failed' && (
          <ConfirmDialog
            title="WebTown Paint"
            message={<p>Your drawing could not be saved. {sb.saveError} If you close now, your latest changes are lost.</p>}
            confirmLabel="Try again"
            extra={{ label: 'Close without saving', onChoose: () => { finish(); onClose() } }}
            cancelLabel="Keep drawing"
            onConfirm={() => { finish(); void requestClose() }}
            onCancel={finish}
          />
        )}
      </div>
    </WindowFrame>
  )
}
