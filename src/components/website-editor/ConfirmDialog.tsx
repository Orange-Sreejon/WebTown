import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  /** The safe choice: it is focused first, and Escape chooses it. */
  keepLabel: string
  /** The choice that loses something. */
  discardLabel: string
  onKeep: () => void
  onDiscard: () => void
}

/**
 * A small question inside the window, in front of everything else. It keeps
 * Tab between its two buttons, starts on the safe one, and gives focus back to
 * where it was when it goes away. It is not the browser's `confirm()`, which
 * would stop the whole game and cannot be styled or read reliably.
 */
export function ConfirmDialog({
  title,
  message,
  keepLabel,
  discardLabel,
  onKeep,
  onDiscard,
}: ConfirmDialogProps): React.ReactElement {
  const titleId = useId()
  const messageId = useId()
  const keepRef = useRef<HTMLButtonElement>(null)
  const discardRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    keepRef.current?.focus()
    return () => {
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') {
      // Two buttons: Tab and Shift+Tab simply swap between them. Stop here, so the
      // window behind does not move focus out of the question.
      event.preventDefault()
      event.stopPropagation()
      const next = document.activeElement === keepRef.current ? discardRef.current : keepRef.current
      next?.focus()
    }
  }

  return (
    <div className="we-confirm-backdrop">
      <div
        className="we-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId} className="we-confirm-title">{title}</h3>
        <p id={messageId}>{message}</p>
        <div className="we-confirm-buttons">
          <button type="button" className="we-button we-button--primary" ref={keepRef} onClick={onKeep}>
            {keepLabel}
          </button>
          <button type="button" className="we-button" ref={discardRef} onClick={onDiscard}>
            {discardLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
