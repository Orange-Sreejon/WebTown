import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLOW_PAGE_MS, SiteFrame } from './SiteFrame'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const frame = (): HTMLIFrameElement => container.querySelector('iframe')!

/** A message as the browser would deliver it from `source`. */
function deliver(data: unknown, source: Window | null = frame().contentWindow, origin = 'null'): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
  })
}

function mount(props: Partial<Parameters<typeof SiteFrame>[0]> = {}) {
  const onPageLink = vi.fn()
  act(() => root.render(<SiteFrame html="<p>page</p>" title="Website" onPageLink={onPageLink} hostUrl="/site-host.html" {...props} />))
  const posted = vi.spyOn(frame().contentWindow!, 'postMessage')
  return { onPageLink, posted }
}

const button = (name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === name)

describe('SiteFrame', () => {
  it('is a sandboxed frame with scripts only for WebTown’s host page, and no other permission', () => {
    mount()
    const f = frame()
    expect(f.getAttribute('sandbox')).toBe('allow-scripts')
    expect(f.getAttribute('src')).toBe('/site-host.html')
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(f.getAttribute('allow')).toContain("camera 'none'")
    expect(f.getAttribute('allow')).toContain("clipboard-read 'none'")
    expect(f.hasAttribute('srcdoc')).toBe(false)
  })

  it('sends the page only once the host says it is ready', () => {
    const { posted } = mount()
    expect(posted).not.toHaveBeenCalled()
    deliver({ t: 'ready' })
    expect(posted).toHaveBeenCalledWith({ t: 'render', html: '<p>page</p>' }, '*')
  })

  it('sends again on Refresh and when the page changes', () => {
    const { posted } = mount()
    deliver({ t: 'ready' })
    act(() => root.render(<SiteFrame html="<p>page</p>" renderKey={1} title="Website" onPageLink={vi.fn()} hostUrl="/site-host.html" />))
    act(() => root.render(<SiteFrame html="<p>two</p>" renderKey={1} title="Website" onPageLink={vi.fn()} hostUrl="/site-host.html" />))
    expect(posted.mock.calls.map(c => (c[0] as { html: string }).html)).toEqual(['<p>page</p>', '<p>page</p>', '<p>two</p>'])
  })

  it('follows a page link the host reports', () => {
    const { onPageLink } = mount()
    deliver({ t: 'nav', kind: 'page', value: 'about.html#me' })
    expect(onPageLink).toHaveBeenCalledWith('about.html', 'me')
  })

  it('ignores messages from any other window, or with a real origin', () => {
    const { onPageLink, posted } = mount()
    deliver({ t: 'nav', kind: 'page', value: 'about.html' }, window)
    deliver({ t: 'ready' }, window)
    deliver({ t: 'nav', kind: 'page', value: 'about.html' }, frame().contentWindow, 'http://localhost:3000')
    deliver({ t: 'nav', kind: 'page', value: 'about.html' }, null)
    expect(onPageLink).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  it('ignores messages outside the schema', () => {
    const { onPageLink } = mount()
    for (const data of [{ t: 'close' }, { type: 'close' }, 'nav', { t: 'nav', kind: 'script', value: 'x' }, { t: 'nav', kind: 'page', value: '' }]) deliver(data)
    expect(onPageLink).not.toHaveBeenCalled()
  })

  it('rate-limits a flood of messages', () => {
    const { onPageLink } = mount()
    for (let i = 0; i < 100; i++) deliver({ t: 'nav', kind: 'page', value: `p${i}.html` })
    expect(onPageLink.mock.calls.length).toBeLessThanOrEqual(30)
  })

  it('asks before opening an external link, and opens it only with noopener and noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    mount()
    deliver({ t: 'nav', kind: 'external', value: 'https://example.com/zine' })
    expect(container.textContent).toContain('example.com')
    expect(open).not.toHaveBeenCalled()
    act(() => button('Open')!.click())
    expect(open).toHaveBeenCalledWith('https://example.com/zine', '_blank', 'noopener,noreferrer')
    expect(container.textContent).not.toContain('outside WebTown')
  })

  it('can cancel an external link', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    mount()
    deliver({ t: 'nav', kind: 'external', value: 'https://example.com/' })
    act(() => button('Cancel')!.click())
    expect(open).not.toHaveBeenCalled()
  })

  it('never offers links the URL policy refuses', () => {
    mount()
    for (const value of ['javascript:alert(1)', 'http://example.com/', 'data:text/html,x', 'https://user:pw@example.com/']) {
      deliver({ t: 'nav', kind: 'external', value })
    }
    expect(button('Open')).toBeUndefined()
  })

  it('says when a page tried to leave', () => {
    mount()
    deliver({ t: 'unexpected-nav' })
    expect(container.textContent).toContain('put it back')
    deliver({ t: 'loop-detected' })
    expect(container.textContent).toContain('stopped putting it back')
  })

  it('offers to stop a page that takes too long, and to show it again', () => {
    vi.useFakeTimers()
    mount()
    deliver({ t: 'ready' })
    act(() => { vi.advanceTimersByTime(SLOW_PAGE_MS + 10) })
    act(() => button('Stop')!.click())
    expect(frame()).toBeNull()
    expect(container.textContent).toContain('stopped')
    act(() => button('Show it again')!.click())
    expect(frame()).not.toBeNull()
  })

  it('does not offer to stop a page that appeared', () => {
    vi.useFakeTimers()
    mount()
    deliver({ t: 'ready' })
    deliver({ t: 'rendered' })
    act(() => { vi.advanceTimersByTime(SLOW_PAGE_MS + 10) })
    expect(button('Stop')).toBeUndefined()
  })
})
