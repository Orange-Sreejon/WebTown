import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface DialogShellProps {
  title: string
  onCancel: () => void
  children: ReactNode
}

/**
 * A small modal inside the Studio window. Escape cancels it (and only it: the
 * window underneath does not close). Focus moves in on open and back on close.
 */
function DialogShell({ title, onCancel, children }: DialogShellProps): React.ReactElement {
  const titleId = useId()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = boxRef.current?.querySelector<HTMLElement>('input, button')
    ;(first ?? boxRef.current)?.focus()
    return () => {
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [])

  return (
    <div className="ws-dialog-backdrop">
      <div
        ref={boxRef}
        className="ws-dialog"
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
        <p id={titleId} className="ws-dialog-title">{title}</p>
        {children}
      </div>
    </div>
  )
}

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** A third choice, for example "Save anyway". */
  extra?: { label: string; onChoose: () => void }
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, extra }: ConfirmDialogProps): React.ReactElement {
  return (
    <DialogShell title={title} onCancel={onCancel}>
      <div className="ws-dialog-body">{message}</div>
      <div className="ws-dialog-buttons">
        <button type="button" className="wt-tool" onClick={onCancel}>{cancelLabel}</button>
        {extra && <button type="button" className="wt-tool" onClick={extra.onChoose}>{extra.label}</button>}
        <button type="button" className="wt-tool" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </DialogShell>
  )
}

export interface NameDialogProps {
  title: string
  label: string
  initial: string
  confirmLabel: string
  /** Turns what was typed into the name to use (for example adds `.html`). */
  normalise?: (text: string) => string
  /** Why the name cannot be used, or null. */
  problem: (name: string) => string | null
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function NameDialog({ title, label, initial, confirmLabel, normalise = s => s, problem, onConfirm, onCancel }: NameDialogProps): React.ReactElement {
  const [text, setText] = useState(initial)
  const [touched, setTouched] = useState(false)
  const inputId = useId()
  const errorId = useId()
  const name = normalise(text.trim())
  const issue = problem(name)

  return (
    <DialogShell title={title} onCancel={onCancel}>
      <form
        onSubmit={event => {
          event.preventDefault()
          setTouched(true)
          if (issue === null) onConfirm(name)
        }}
      >
        <label htmlFor={inputId} className="ws-dialog-label">{label}</label>
        <input
          id={inputId}
          className="ws-input"
          value={text}
          onChange={event => { setText(event.target.value); setTouched(true) }}
          aria-invalid={touched && issue !== null}
          aria-describedby={errorId}
          spellCheck={false}
          autoComplete="off"
        />
        <p id={errorId} className="ws-dialog-error" role={touched && issue ? 'alert' : undefined}>
          {touched && issue ? issue : name ? `It will be called ${name}.` : ''}
        </p>
        <div className="ws-dialog-buttons">
          <button type="button" className="wt-tool" onClick={onCancel}>Cancel</button>
          <button type="submit" className="wt-tool">{confirmLabel}</button>
        </div>
      </form>
    </DialogShell>
  )
}
