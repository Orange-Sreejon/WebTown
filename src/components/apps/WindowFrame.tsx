import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

interface WindowFrameProps {
  title: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The modal window every in-house app sits in. Presentation only: it holds no
 * data access, so it is safe to share between the website and Paint.
 *
 * It covers the game, so clicks never reach the canvas; moves focus in on open
 * and back out on close; keeps Tab inside; and closes on Escape. Nothing here
 * touches Phaser: closing is just `onClose`.
 */
export function WindowFrame({ title, onClose, children }: WindowFrameProps): React.ReactElement {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()

    // On the document, not the dialog, so Escape works wherever focus is.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [])

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div style={styles.backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={styles.window}
        onKeyDown={trapTab}
      >
        <div style={styles.titleBar}>
          <span id={titleId} style={styles.title}>{title}</span>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <span aria-hidden="true">x</span>
          </button>
        </div>
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  )
}

const styles = {
  backdrop: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.45)',
    pointerEvents: 'auto' as const,
  },
  window: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: 'min(640px, 94vw)',
    maxHeight: '90vh',
    background: '#c0c0c0',
    color: '#000',
    border: '2px solid',
    borderColor: '#fff #404040 #404040 #fff',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 4px',
    background: '#000080',
    color: '#fff',
  },
  title: { fontWeight: 'bold' as const },
  closeButton: {
    width: 20,
    height: 18,
    padding: 0,
    background: '#c0c0c0',
    color: '#000',
    border: '2px solid',
    borderColor: '#fff #404040 #404040 #fff',
    fontFamily: 'monospace',
    cursor: 'pointer',
  },
  body: { padding: 12, overflow: 'auto' as const },
} as const
