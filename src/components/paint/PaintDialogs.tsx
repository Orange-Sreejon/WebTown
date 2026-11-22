import { storageWhere } from '../../personal-spaces/labels'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ARTWORK_LIMITS, cleanArtworkTitle, type Artwork } from '../../personal-spaces/artwork-storage/artwork'
import { parseHex, toHex, type CanvasBase, type Rgba } from '../../personal-spaces/paint/color'
import { MAX_HEIGHT, MAX_WIDTH } from '../../personal-spaces/paint/pixel-buffer'

/** A classic dialog inside the Paint window. Escape cancels it and nothing else. */
function Dialog({ title, onCancel, children, wide = false }: { title: string; onCancel: () => void; children: ReactNode; wide?: boolean }): React.ReactElement {
  const titleId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = boxRef.current?.querySelector<HTMLElement>('[data-autofocus], input, button')
    ;(first ?? boxRef.current)?.focus()
    return () => {
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [])
  return (
    <div className="pt-dialog-backdrop">
      <div
        ref={boxRef}
        className={wide ? 'pt-dialog pt-dialog--wide' : 'pt-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div className="pt-titlebar pt-titlebar--dialog">
          <span id={titleId} className="pt-title">{title}</span>
          <button type="button" className="pt-winbtn" onClick={onCancel} aria-label="Close dialog">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="pt-dialog-body">{children}</div>
      </div>
    </div>
  )
}

const Buttons = ({ children }: { children: ReactNode }): React.ReactElement => <div className="pt-dialog-buttons">{children}</div>

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  extra?: { label: string; onChoose: () => void }
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, extra }: ConfirmDialogProps): React.ReactElement {
  return (
    <Dialog title={title} onCancel={onCancel}>
      <div className="pt-dialog-message">{message}</div>
      <Buttons>
        <button type="button" className="pt-button" onClick={onConfirm} data-autofocus>{confirmLabel}</button>
        {extra && <button type="button" className="pt-button" onClick={extra.onChoose}>{extra.label}</button>}
        <button type="button" className="pt-button" onClick={onCancel}>{cancelLabel}</button>
      </Buttons>
    </Dialog>
  )
}

export interface AttributesDialogProps {
  width: number
  height: number
  base: CanvasBase
  onApply: (width: number, height: number, base: CanvasBase) => void
  onCancel: () => void
}

/** Image > Attributes: canvas width, height and White / Transparent. */
export function AttributesDialog({ width, height, base, onApply, onCancel }: AttributesDialogProps): React.ReactElement {
  const [w, setW] = useState(String(width))
  const [h, setH] = useState(String(height))
  const [b, setB] = useState<CanvasBase>(base)
  const wid = useId()
  const hid = useId()
  const parsed = (text: string, max: number): number | null => {
    const n = Number(text)
    return Number.isInteger(n) && n >= 1 && n <= max ? n : null
  }
  const pw = parsed(w, MAX_WIDTH)
  const ph = parsed(h, MAX_HEIGHT)
  const problem = pw === null ? `Width must be a whole number from 1 to ${MAX_WIDTH}.` : ph === null ? `Height must be a whole number from 1 to ${MAX_HEIGHT}.` : null
  return (
    <Dialog title="Attributes" onCancel={onCancel}>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (pw !== null && ph !== null) onApply(pw, ph, b)
        }}
      >
        <p className="pt-dialog-message">Current size: {width} x {height} pixels.</p>
        <div className="pt-field-row">
          <label htmlFor={wid}>Width:</label>
          <input id={wid} className="pt-input pt-input--number" inputMode="numeric" value={w} onChange={e => setW(e.target.value)} aria-invalid={pw === null} />
          <label htmlFor={hid}>Height:</label>
          <input id={hid} className="pt-input pt-input--number" inputMode="numeric" value={h} onChange={e => setH(e.target.value)} aria-invalid={ph === null} />
          <span>pixels</span>
        </div>
        <fieldset className="pt-fieldset">
          <legend>Canvas</legend>
          <label><input type="radio" name="pt-base" checked={b === 'white'} onChange={() => setB('white')} /> White</label>
          <label><input type="radio" name="pt-base" checked={b === 'transparent'} onChange={() => setB('transparent')} /> Transparent</label>
        </fieldset>
        <p className="pt-dialog-hint">Making the canvas smaller crops the right and bottom edges. New area is filled with the canvas colour. You can undo this.</p>
        <p className="pt-dialog-error" role={problem ? 'alert' : undefined}>{problem ?? ''}</p>
        <Buttons>
          <button type="submit" className="pt-button" disabled={problem !== null}>OK</button>
          <button type="button" className="pt-button" onClick={() => { setW('640'); setH('480'); setB('white') }}>Default</button>
          <button type="button" className="pt-button" onClick={onCancel}>Cancel</button>
        </Buttons>
      </form>
    </Dialog>
  )
}

export interface NameDialogProps {
  title: string
  initial: string
  confirmLabel: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function NameDialog({ title, initial, confirmLabel, onConfirm, onCancel }: NameDialogProps): React.ReactElement {
  const [text, setText] = useState(initial)
  const id = useId()
  const name = cleanArtworkTitle(text)
  const problem = name.length === 0 ? 'Type a name.' : Array.from(name).length > ARTWORK_LIMITS.title ? `At most ${ARTWORK_LIMITS.title} characters.` : null
  return (
    <Dialog title={title} onCancel={onCancel}>
      <form onSubmit={event => { event.preventDefault(); if (!problem) onConfirm(name) }}>
        <label htmlFor={id} className="pt-dialog-label">Name:</label>
        <input id={id} className="pt-input pt-input--wide" value={text} onChange={e => setText(e.target.value)} maxLength={120} autoComplete="off" aria-invalid={problem !== null} />
        <p className="pt-dialog-error" role={problem ? 'alert' : undefined}>{problem ?? ''}</p>
        <Buttons>
          <button type="submit" className="pt-button" disabled={problem !== null}>{confirmLabel}</button>
          <button type="button" className="pt-button" onClick={onCancel}>Cancel</button>
        </Buttons>
      </form>
    </Dialog>
  )
}

export interface EditColorDialogProps {
  initial: Rgba
  onConfirm: (color: Rgba) => void
  onCancel: () => void
  title?: string
}

/** Colors > Edit Colors: any colour, by picker or by hex. */
export function EditColorDialog({ initial, onConfirm, onCancel, title = 'Edit Colors' }: EditColorDialogProps): React.ReactElement {
  const [hex, setHex] = useState(toHex(initial))
  const pickerId = useId()
  const hexId = useId()
  const color = parseHex(hex)
  return (
    <Dialog title={title} onCancel={onCancel}>
      <form onSubmit={event => { event.preventDefault(); if (color) onConfirm(color) }}>
        <div className="pt-field-row">
          <label htmlFor={pickerId}>Colour:</label>
          <input id={pickerId} type="color" className="pt-color-input" value={color ? toHex(color) : '#000000'} onChange={e => setHex(e.target.value)} />
          <label htmlFor={hexId}>Hex:</label>
          <input id={hexId} className="pt-input" value={hex} onChange={e => setHex(e.target.value)} spellCheck={false} aria-invalid={color === null} />
          <span className="pt-color-preview" style={{ background: color ? toHex(color) : 'transparent' }} aria-hidden="true" />
        </div>
        <p className="pt-dialog-error" role={color ? undefined : 'alert'}>{color ? '' : 'Type a colour like #ff8800.'}</p>
        <Buttons>
          <button type="submit" className="pt-button" disabled={!color}>OK</button>
          <button type="button" className="pt-button" onClick={onCancel}>Cancel</button>
        </Buttons>
      </form>
    </Dialog>
  )
}

/** A thumbnail of a stored drawing, through an object URL that is released when it goes. */
export function ArtworkThumb({ artwork, className }: { artwork: Artwork; className?: string }): React.ReactElement {
  const url = useMemo(() => URL.createObjectURL(new Blob([artwork.png], { type: 'image/png' })), [artwork])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img className={className} src={url} alt="" width={artwork.width} height={artwork.height} />
}

export interface OpenDialogProps {
  items: Artwork[] | null
  error: string | null
  skipped: string[]
  currentId: string | null
  onOpen: (artwork: Artwork) => void
  onCancel: () => void
}

/** File > Open: this house's drawings, newest first. */
export function OpenDialog({ items, error, skipped, currentId, onOpen, onCancel }: OpenDialogProps): React.ReactElement {
  const [chosen, setChosen] = useState<string | null>(currentId)
  const pick = items?.find(i => i.id === chosen) ?? null
  return (
    <Dialog title="Open" onCancel={onCancel} wide>
      {error && <p className="pt-dialog-error" role="alert">{error}</p>}
      {items === null && !error && <p className="pt-dialog-message" role="status">Loading drawings...</p>}
      {items !== null && items.length === 0 && <p className="pt-dialog-message">No saved drawings yet.</p>}
      {items !== null && items.length > 0 && (
        <ul className="pt-gallery" role="listbox" aria-label="Drawings">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.id === chosen}
                className={item.id === chosen ? 'pt-gallery-item pt-gallery-item--on' : 'pt-gallery-item'}
                onClick={() => setChosen(item.id)}
                onDoubleClick={() => onOpen(item)}
              >
                <ArtworkThumb artwork={item} className="pt-thumb" />
                <span className="pt-gallery-title">{item.title}{item.id === currentId ? ' (open)' : ''}</span>
                <span className="pt-gallery-date">{new Date(item.updatedAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && <p className="pt-dialog-hint">{skipped.length} drawing(s) could not be read and are not shown. They were not deleted.</p>}
      <Buttons>
        <button type="button" className="pt-button" disabled={!pick} onClick={() => pick && onOpen(pick)}>Open</button>
        <button type="button" className="pt-button" onClick={onCancel}>Cancel</button>
      </Buttons>
    </Dialog>
  )
}

export function AboutDialog({ onClose, persistent }: { onClose: () => void; persistent: boolean }): React.ReactElement {
  return (
    <Dialog title="About WebTown Paint" onCancel={onClose}>
      <div className="pt-dialog-message">
        <p><strong>WebTown Paint</strong>: the Sketchbook of your WebTown house.</p>
        <p>Draw with the left mouse button in the foreground colour and the right button in the background colour.
          Shift keeps lines straight and shapes square. Ctrl+Z undoes, Ctrl+Y redoes, Ctrl+S saves.</p>
        <p>{persistent
          ? storageWhere() === 'device'
            ? 'Drawings are saved automatically, in this browser on this device only. Visitors on other devices cannot see them.'
            : storageWhere() === 'guest'
              ? 'Drawings are saved automatically to your guest account. Add an email (Account, top right) so you can keep them if this browser forgets you.'
              : 'Drawings are saved automatically to your WebTown account.'
          : 'Browser storage is unavailable: drawings are kept only until you close this tab.'}</p>
      </div>
      <Buttons><button type="button" className="pt-button" onClick={onClose}>OK</button></Buttons>
    </Dialog>
  )
}
