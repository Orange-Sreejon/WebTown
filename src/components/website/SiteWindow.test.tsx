import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuotaError, StorageError } from '../../personal-spaces/errors'
import {
  LOCAL_ONLY_LABEL,
  NOT_SAVED_NOTICE,
  VISITOR_LOCAL_NOTICE,
  VISITOR_NOT_SAVED_NOTICE,
} from '../../personal-spaces/labels'
import type { SiteReader } from '../../personal-spaces/website/site-repository'
import type { ReadonlySiteContent } from '../../personal-spaces/website/site-types'
import { toReadonlySite } from '../../personal-spaces/website/site-readonly'
import { SiteWindow, storageStatus, type RecoveryNotice } from './SiteWindow'
import { PAYLOADS, hostileSite, readonlySite } from './site-fixtures.test-support'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  delete (window as unknown as { __xss?: number }).__xss
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

interface Options {
  reader?: SiteReader
  houseId?: string
  isOwner?: boolean
  persistent?: boolean
  recovery?: RecoveryNotice | null
  onClose?: () => void
}

async function open(options: Options = {}): Promise<{ onClose: () => void; reader: SiteReader }> {
  const reader = options.reader ?? { load: async () => readonlySite(options.houseId ?? 'house-a') }
  const onClose = options.onClose ?? vi.fn()
  act(() => {
    root.render(
      <SiteWindow
        houseId={options.houseId ?? 'house-a'}
        reader={reader}
        isOwner={options.isOwner ?? true}
        persistent={options.persistent ?? true}
        recovery={options.recovery ?? null}
        onClose={onClose}
      />,
    )
  })
  await settle()
  return { onClose, reader }
}

const q = <T extends Element>(selector: string): T => {
  const found = container.querySelector<T>(selector)
  if (!found) throw new Error(`nothing matches ${selector}`)
  return found
}
const button = (name: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  )
  if (!found) throw new Error(`no button "${name}"`)
  return found
}
const click = (el: HTMLElement): void => act(() => el.click())
const address = (): string => q<HTMLInputElement>('.wt-address input').value
const heading = (): string => q('main h2').textContent ?? ''
const press = (target: Element, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(event))
  return event
}

describe('opening', () => {
  it('shows a loading message, then the home page', async () => {
    let finish!: (site: ReadonlySiteContent) => void
    const reader: SiteReader = { load: () => new Promise(resolve => { finish = resolve }) }
    await open({ reader })
    expect(q('[role="status"]').textContent).toContain('Loading website')
    expect(container.querySelector('main')).toBeNull()

    await act(async () => finish(readonlySite()))
    expect(heading()).toBe('Welcome!')
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(address()).toBe('webtown://house-a/')
  })

  it('asks the reader for this house, and only that house', async () => {
    const load = vi.fn(async (id: string) => readonlySite(id))
    await open({ reader: { load }, houseId: 'house-c' })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('house-c')
    expect(q('h1').textContent).toBe('Welcome to House C!')
    expect(address()).toBe('webtown://house-c/')
  })

  it('shows a complete default website when nothing was saved', async () => {
    await open()
    expect(q('h1').textContent).toBe('Welcome to House A!')
    for (const label of ['Home', 'About', 'Projects', 'Links']) {
      click(q<HTMLElement>('nav').querySelectorAll('button')[['Home', 'About', 'Projects', 'Links'].indexOf(label)] as HTMLElement)
      expect(q('main').textContent!.length, label).toBeGreaterThan(40)
    }
  })

  it('does not update after the window was closed while loading', async () => {
    let finish!: (site: ReadonlySiteContent) => void
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await open({ reader: { load: () => new Promise(resolve => { finish = resolve }) } })
    act(() => root.render(<div />))
    await act(async () => finish(readonlySite()))
    expect(error).not.toHaveBeenCalled()
  })
})

describe('moving between pages', () => {
  it('goes to each page from the navigation, and the address follows', async () => {
    await open()
    click(button('About'))
    expect(heading()).toBe('About House A')
    expect(address()).toBe('webtown://house-a/about')
    click(button('Projects'))
    expect(heading()).toBe('Projects')
    expect(address()).toBe('webtown://house-a/projects')
    click(button('Links'))
    expect(heading()).toBe('Links')
    expect(address()).toBe('webtown://house-a/links')
    click(button('Home'))
    expect(heading()).toBe('Welcome!')
  })

  it('has Back and Forward that follow the history', async () => {
    await open()
    expect(button('Back').disabled).toBe(true)
    expect(button('Forward').disabled).toBe(true)

    click(q<HTMLElement>('nav').querySelectorAll('button')[1] as HTMLElement) // About
    click(q<HTMLElement>('nav').querySelectorAll('button')[2] as HTMLElement) // Projects
    expect(button('Back').disabled).toBe(false)
    expect(button('Forward').disabled).toBe(true)

    click(button('Back'))
    expect(heading()).toBe('About House A')
    expect(button('Forward').disabled).toBe(false)
    click(button('Back'))
    expect(heading()).toBe('Welcome!')
    expect(button('Back').disabled).toBe(true)

    click(button('Forward'))
    click(button('Forward'))
    expect(heading()).toBe('Projects')
    expect(button('Forward').disabled).toBe(true)
  })

  it('drops the forward trail when a new page is chosen after going back', async () => {
    await open()
    const nav = (): HTMLElement[] => [...q<HTMLElement>('nav').querySelectorAll('button')] as HTMLElement[]
    click(nav()[1]!) // About
    click(nav()[2]!) // Projects
    click(button('Back'))
    click(nav()[3]!) // Links
    expect(button('Forward').disabled).toBe(true)
    click(button('Back'))
    expect(heading()).toBe('About House A')
  })

  it('Home button returns to the home page from anywhere', async () => {
    await open()
    click([...q<HTMLElement>('nav').querySelectorAll('button')][3] as HTMLElement)
    expect(heading()).toBe('Links')
    click(button('Home page'))
    expect(heading()).toBe('Welcome!')
    expect(address()).toBe('webtown://house-a/')
  })

  it('moves with the links on the home page, too', async () => {
    await open()
    click(button('Projects (3)'))
    expect(heading()).toBe('Projects')
  })

  it('supports Alt+Left and Alt+Right like a browser', async () => {
    await open()
    click(button('About'))
    const dialog = q('[role="dialog"]')

    const back = press(dialog, { key: 'ArrowLeft', altKey: true })
    expect(back.defaultPrevented).toBe(true)
    expect(heading()).toBe('Welcome!')

    const forward = press(dialog, { key: 'ArrowRight', altKey: true })
    expect(forward.defaultPrevented).toBe(true)
    expect(heading()).toBe('About House A')
  })

  it('leaves the arrow keys alone without Alt, and with other modifiers', async () => {
    await open()
    click(button('About'))
    const dialog = q('[role="dialog"]')
    expect(press(dialog, { key: 'ArrowLeft' }).defaultPrevented).toBe(false)
    expect(press(dialog, { key: 'ArrowLeft', altKey: true, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(dialog, { key: 'ArrowLeft', altKey: true, metaKey: true }).defaultPrevented).toBe(false)
    expect(heading()).toBe('About House A')
  })

  it('never changes the page address or the browser history', async () => {
    const before = { href: window.location.href, length: window.history.length, hash: window.location.hash }
    await open()
    for (const name of ['About', 'Projects', 'Links', 'Back', 'Forward', 'Home page']) click(button(name))
    press(q('[role="dialog"]'), { key: 'ArrowLeft', altKey: true })
    expect(window.location.href).toBe(before.href)
    expect(window.location.hash).toBe(before.hash)
    expect(window.history.length).toBe(before.length)
  })
})

describe('the address bar', () => {
  it('shows the address and cannot be typed into', async () => {
    await open()
    const field = q<HTMLInputElement>('.wt-address input')
    expect(field.readOnly).toBe(true)
    expect(field.getAttribute('aria-label')).toBe('Website address (display only)')
    expect(address()).toBe('webtown://house-a/')
  })

  it('does not take anything from the address field', async () => {
    await open()
    const field = q<HTMLInputElement>('.wt-address input')
    for (const key of ['w', 'a', 's', 'd', 'e', 'Enter', 'x']) press(field, { key })
    expect(address()).toBe('webtown://house-a/')
    expect(heading()).toBe('Welcome!')
  })

  it('shows a safe address even for an odd house id', async () => {
    await open({ houseId: 'House A/../x', reader: { load: async () => readonlySite() } })
    expect(address()).toBe('webtown://unknown/')
  })
})

describe('keyboard and screen readers', () => {
  it('is a labelled dialog with labelled controls', async () => {
    await open()
    const dialog = q('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('WebTown Browser')
    expect(q('[role="toolbar"]').getAttribute('aria-label')).toBe('Browser controls')
    expect(q('nav').getAttribute('aria-label')).toBe('Website pages')
    for (const control of container.querySelectorAll('button, input')) {
      const name = control.getAttribute('aria-label') ?? control.textContent
      expect(name?.trim().length, control.outerHTML).toBeGreaterThan(0)
    }
  })

  it('uses real buttons for every action', async () => {
    await open()
    for (const name of ['Back', 'Forward', 'Home page', 'Home', 'About', 'Projects', 'Links']) {
      const control = button(name)
      expect(control.tagName).toBe('BUTTON')
      expect(control.type).toBe('button')
    }
    expect(container.querySelectorAll('[role="button"], div[onclick]')).toHaveLength(0)
  })

  it('moves focus to the page after navigating, but not when it first opens', async () => {
    await open()
    expect(document.activeElement).toBe(q('[role="dialog"]'))

    click(button('About'))
    expect(document.activeElement).toBe(q('main'))

    q<HTMLElement>('nav').querySelector('button')!.focus()
    click(button('Back'))
    expect(document.activeElement).toBe(q('main'))
  })

  it('announces the page that is showing', async () => {
    await open()
    expect(q('p[aria-live="polite"]').textContent).toBe('')
    click(button('Projects'))
    expect(q('p[aria-live="polite"]').textContent).toBe('Projects page')
    click(button('Links'))
    expect(q('p[aria-live="polite"]').textContent).toBe('Links page')
  })

  it('tells assistive technology which page is current', async () => {
    await open()
    click(button('Links'))
    expect(container.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1)
    expect(q('nav [aria-current="page"]').textContent).toBe('Links')
  })

  it('does not trap the typing keys: W A S D E and the arrows are left to the page', async () => {
    await open()
    for (const key of ['w', 'a', 's', 'd', 'e', 'ArrowUp', 'ArrowDown', ' ']) {
      expect(press(q('main'), { key }).defaultPrevented, key).toBe(false)
    }
  })

  it('keeps Tab inside the window', async () => {
    await open()
    const last = [...container.querySelectorAll<HTMLElement>('button, input, a[href]')].filter(e => !(e as HTMLButtonElement).disabled).pop()!
    last.focus()
    const tab = press(last, { key: 'Tab' })
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(last)
  })

  it('disables Back, Forward and Home until there is a page to move around', async () => {
    let finish!: (site: ReadonlySiteContent) => void
    await open({ reader: { load: () => new Promise(resolve => { finish = resolve }) } })
    for (const name of ['Back', 'Forward', 'Home page']) expect(button(name).disabled, name).toBe(true)
    await act(async () => finish(readonlySite()))
    expect(button('Home page').disabled).toBe(false)
  })
})

describe('closing', () => {
  it('closes from the window’s Close button', async () => {
    const { onClose } = await open()
    click(button('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape', async () => {
    const { onClose } = await open()
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes even while loading, and even if loading failed', async () => {
    const closeWhileLoading = vi.fn()
    await open({ reader: { load: () => new Promise(() => undefined) }, onClose: closeWhileLoading })
    click(button('Close'))
    expect(closeWhileLoading).toHaveBeenCalledTimes(1)

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const closeAfterFailure = vi.fn()
    await open({ reader: { load: async () => { throw new StorageError() } }, onClose: closeAfterFailure })
    click(button('Close'))
    expect(closeAfterFailure).toHaveBeenCalledTimes(1)
  })
})

describe('when the website cannot be loaded', () => {
  it('says so with the reason, and lets the user try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let attempts = 0
    const reader: SiteReader = {
      load: async () => {
        attempts++
        if (attempts === 1) throw new QuotaError()
        return readonlySite()
      },
    }
    await open({ reader })

    const alert = q('[role="alert"]')
    expect(alert.textContent).toContain('could not be opened')
    expect(alert.textContent).toContain("There isn't enough storage space")
    expect(container.querySelector('main')).toBeNull()

    click(button('Try again'))
    await settle()
    expect(attempts).toBe(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(heading()).toBe('Welcome!')
  })

  it('shows a plain message for an error it does not know, and logs the real one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await open({ reader: { load: async () => { throw new Error('secret internal detail: /path/to/x') } } })
    expect(q('[role="alert"]').textContent).toContain('Something went wrong while opening this website.')
    expect(q('[role="alert"]').textContent).not.toContain('secret internal detail')
    expect(error).toHaveBeenCalled()
  })

  it('keeps the toolbar from doing anything while there is no page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await open({ reader: { load: async () => { throw new StorageError() } } })
    for (const name of ['Back', 'Forward', 'Home page']) expect(button(name).disabled, name).toBe(true)
  })
})

describe('what is said about where the website is kept', () => {
  it('tells the owner it is saved on this device only', async () => {
    await open({ isOwner: true, persistent: true })
    expect(q('.wt-status').textContent).toBe(`${LOCAL_ONLY_LABEL}.`)
  })

  it('tells a visitor the website is stored on this device only, and that others cannot see it', async () => {
    await open({ isOwner: false, persistent: true })
    expect(q('.wt-status').textContent).toBe(VISITOR_LOCAL_NOTICE)
    expect(VISITOR_LOCAL_NOTICE).toContain("Visitors on other devices can't see it")
  })

  it('says plainly when nothing is being saved', async () => {
    await open({ isOwner: true, persistent: false })
    expect(q('.wt-status').textContent).toBe(NOT_SAVED_NOTICE)

    act(() => root.unmount())
    root = createRoot(container)
    await open({ isOwner: false, persistent: false })
    expect(q('.wt-status').textContent).toBe(VISITOR_NOT_SAVED_NOTICE)
  })

  it('never claims the website is shared, public or visible elsewhere', () => {
    const everything = [true, false].flatMap(owner => [true, false].map(persistent => storageStatus(owner, persistent)))
    for (const sentence of everything) {
      expect(sentence).not.toMatch(/\bshared\b|\bpublic(ly)?\b|\bpublish|\bonline\b|visible to (everyone|others|anyone)|\bsync/i)
    }
  })
})

describe('a recovered website', () => {
  const recovery: RecoveryNotice = { problems: ['The site title is required.', 'Link 1 address: Only https:// addresses are allowed.'] }

  it('tells the owner that the saved website could not be read, and that nothing was deleted', async () => {
    await open({ isOwner: true, recovery })
    const alert = q('[role="alert"]')
    expect(alert.textContent).toContain('could not be read')
    expect(alert.textContent).toContain('default website is shown')
    expect(alert.textContent).toContain('Nothing was deleted')
    expect([...alert.querySelectorAll('li')].map(li => li.textContent)).toEqual(recovery.problems)
    expect(q('h1').textContent).toBe('Welcome to House A!') // the default site is what is shown
  })

  it('shows at most three reasons', async () => {
    await open({ isOwner: true, recovery: { problems: ['1', '2', '3', '4', '5'] } })
    expect(q('[role="alert"]').querySelectorAll('li')).toHaveLength(3)
  })

  it('does not tell a visitor, even if it is handed the notice', async () => {
    await open({ isOwner: false, recovery })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).not.toContain('could not be read')
    expect(container.textContent).not.toContain('The site title is required.')
  })

  it('has no button for the owner to press, because recovery changes nothing here', async () => {
    await open({ isOwner: true, recovery })
    expect([...container.querySelectorAll('button')].map(b => b.getAttribute('aria-label') ?? b.textContent)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/repair|fix|restore|reset|delete|overwrite|save/i)]),
    )
  })

  it('shows nothing about recovery when there is nothing to recover', async () => {
    await open({ isOwner: true, recovery: null })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('a read-only window', () => {
  it('has nothing in it that can edit, save, rename or delete', async () => {
    for (const isOwner of [false, true]) {
      act(() => root.unmount())
      root = createRoot(container)
      await open({ isOwner })
      const names = [...container.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase())
      for (const name of names) expect(name, name).not.toMatch(/edit|save|rename|delete|publish|upload|remove|add/)
      expect(container.querySelectorAll('textarea, form, [contenteditable], input:not([readonly])')).toHaveLength(0)
    }
  })

  it('only ever reads: it calls load, and there is nothing else on the reader to call', async () => {
    const load = vi.fn(async (id: string) => readonlySite(id))
    const reader: SiteReader = { load }
    await open({ reader, isOwner: false })
    for (const name of ['About', 'Projects', 'Links', 'Back', 'Forward', 'Home page']) click(button(name))
    expect(Object.keys(reader)).toEqual(['load'])
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('hostile text in the window', () => {
  it.each(PAYLOADS)('shows %s as text and runs nothing', async payload => {
    const site = toReadonlySite(hostileSite(payload))
    await open({ reader: { load: async () => site } })
    for (const label of ['About', 'Projects', 'Links', 'Home page']) {
      click(button(label))
      expect(container.querySelectorAll('script, img, iframe, style, svg, object, embed, form, textarea')).toHaveLength(0)
      expect(container.querySelectorAll('[onerror], [onload], [onclick], [onmouseover]')).toHaveLength(0)
    }
    expect(q('h1').textContent).toBe(payload)
    expect(document.querySelectorAll('script')).toHaveLength(0)
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })
})
