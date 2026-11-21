import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export type MenuItem =
  | { kind: 'item'; label: string; shortcut?: string; hint?: string; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { kind: 'separator' }

export interface Menu {
  label: string
  /** The underlined access letter, shown as in classic menus. */
  access: string
  items: MenuItem[]
}

export interface MenuBarProps {
  menus: Menu[]
  /** Hover hints for the status bar. */
  onHint: (hint: string | null) => void
}

const underline = (label: string, access: string): React.ReactNode => {
  const i = label.toLowerCase().indexOf(access.toLowerCase())
  if (i < 0) return label
  return <>{label.slice(0, i)}<span className="pt-access">{label[i]}</span>{label.slice(i + 1)}</>
}

/**
 * A classic menu bar. Click (or Enter, Space, Arrow Down) opens a menu; while
 * one is open, hovering another switches to it; arrows move; Enter chooses;
 * Escape closes it without closing the window.
 */
export function MenuBar({ menus, onHint }: MenuBarProps): React.ReactElement {
  const [open, setOpen] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const topRefs = useRef<Array<HTMLButtonElement | null>>([])

  const enabled = (menu: number): number[] =>
    menus[menu]!.items.flatMap((item, i) => (item.kind === 'item' && !item.disabled ? [i] : []))

  const openMenu = (menu: number, focusFirst: boolean): void => {
    setOpen(menu)
    setActive(focusFirst ? (enabled(menu)[0] ?? -1) : -1)
  }
  const close = (focusTop = false): void => {
    const was = open
    setOpen(null)
    onHint(null)
    if (focusTop && was !== null) topRefs.current[was]?.focus()
  }

  useEffect(() => {
    if (open === null) return
    const onDown = (event: PointerEvent): void => {
      if (!barRef.current?.contains(event.target as Node)) {
        setOpen(null)
        onHint(null)
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, onHint])

  useEffect(() => {
    if (open === null) return
    // A menu with nothing enabled keeps focus on its title, so the keyboard can still move on or close it.
    if (active >= 0) itemRefs.current[active]?.focus()
    else topRefs.current[open]?.focus()
  }, [open, active])

  const choose = (item: MenuItem): void => {
    if (item.kind !== 'item' || item.disabled) return
    close(true)
    item.onSelect()
  }

  const onMenuKey = (event: ReactKeyboardEvent): void => {
    if (open === null) return
    const list = enabled(open)
    const at = list.indexOf(active)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(list[(at + 1) % list.length] ?? -1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(list[(at - 1 + list.length) % list.length] ?? -1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = (open + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length
      openMenu(next, true)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  return (
    <div className="pt-menubar" role="menubar" aria-label="Menu" ref={barRef} onKeyDown={onMenuKey}>
      {menus.map((menu, m) => (
        <div key={menu.label} className="pt-menu">
          <button
            ref={el => { topRefs.current[m] = el }}
            type="button"
            role="menuitem"
            className={open === m ? 'pt-menu-title pt-menu-title--open' : 'pt-menu-title'}
            aria-haspopup="menu"
            aria-expanded={open === m}
            onClick={() => (open === m ? close() : openMenu(m, false))}
            onPointerEnter={() => { if (open !== null && open !== m) openMenu(m, false) }}
            onKeyDown={event => {
              if (open === null && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                openMenu(m, true)
              }
            }}
          >
            {underline(menu.label, menu.access)}
          </button>
          {open === m && (
            <div className="pt-menu-list" role="menu" aria-label={menu.label}>
              {menu.items.map((item, i) =>
                item.kind === 'separator' ? (
                  <div key={`sep-${i}`} className="pt-menu-sep" role="separator" />
                ) : (
                  <button
                    key={item.label}
                    ref={el => { itemRefs.current[i] = el }}
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={item.checked}
                    aria-disabled={item.disabled || undefined}
                    className={item.disabled ? 'pt-menu-item pt-menu-item--disabled' : 'pt-menu-item'}
                    tabIndex={-1}
                    onPointerEnter={() => { setActive(i); onHint(item.hint ?? null) }}
                    onFocus={() => onHint(item.hint ?? null)}
                    onClick={() => choose(item)}
                  >
                    <span className="pt-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
                    <span className="pt-menu-label">{item.label}</span>
                    <span className="pt-menu-key">{item.shortcut ?? ''}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
