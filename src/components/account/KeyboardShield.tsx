import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Keeps key presses inside these elements away from the game. Phaser listens on `window` and cancels W, A, S,
 * D, E, Space and the arrows, which would stop them being typed into a form and would move the player behind
 * it. A native listener here stops them on the way out. Escape and Tab pass, so the window can still be
 * closed and keyboard focus can still move.
 */
export function KeyboardShield({ children }: { children: ReactNode }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
    }
    el.addEventListener('keydown', stop)
    el.addEventListener('keyup', stop)
    return () => {
      el.removeEventListener('keydown', stop)
      el.removeEventListener('keyup', stop)
    }
  }, [])
  return <div ref={ref}>{children}</div>
}
