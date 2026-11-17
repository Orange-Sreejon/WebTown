import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultSite } from './default-site'
import { splitParagraphs } from './site-text'
import type { SiteContent } from './site-types'
import { validateSite } from './site-validation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * User text is shown as React text nodes, never as HTML. This renders
 * hostile content through the domain's own paragraph splitter, the way the
 * website renderer will (P3-06), and checks that it appears as characters and
 * that nothing in it is interpreted or run.
 *
 * The full `SiteRenderer` repeats these checks when it exists.
 */

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror="window.__xss = 1">',
  '<a href="javascript:window.__xss = 1">click</a>',
  '<iframe src="https://example.com"></iframe>',
  '<style>body { display: none }</style>',
  '<b onmouseover="window.__xss = 1">hover</b>',
  '&lt;b&gt;already escaped&lt;/b&gt; &amp; &#60;i&#62;',
]

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
})

function PageText({ site }: { site: SiteContent }): React.ReactElement {
  return (
    <main>
      <h1>{site.title}</h1>
      <p data-field="tagline">{site.profile.tagline}</p>
      {splitParagraphs(site.home.welcome).map((p, i) => <p key={i} data-field="welcome">{p}</p>)}
      {splitParagraphs(site.about.body).map((p, i) => <p key={i} data-field="about">{p}</p>)}
      <ul>
        {site.projects.map(p => (
          <li key={p.id}><strong>{p.title}</strong> <span>{p.description}</span></li>
        ))}
      </ul>
      <ul>{site.links.map(l => <li key={l.id}>{l.label}</li>)}</ul>
    </main>
  )
}

function siteWith(payload: string): SiteContent {
  const site = createDefaultSite('house-a', '2026-11-16T00:00:00.000Z')
  site.title = payload
  site.profile.tagline = payload
  site.home.welcome = `${payload}\n\n${payload}`
  site.about.body = payload
  site.projects[0]!.title = payload
  site.projects[0]!.description = payload
  site.links[0]!.label = payload
  return site
}

describe('hostile text in a website', () => {
  it.each(PAYLOADS)('is accepted by the domain and shown as plain characters: %s', payload => {
    const checked = validateSite(siteWith(payload))
    expect(checked.ok).toBe(true)
    if (!checked.ok) return

    act(() => root.render(<PageText site={checked.value} />))

    // The characters are all there, as text.
    expect(container.querySelector('h1')?.textContent).toBe(payload)
    expect(container.querySelector('[data-field="tagline"]')?.textContent).toBe(payload)
    const welcome = [...container.querySelectorAll('[data-field="welcome"]')].map(p => p.textContent)
    expect(welcome).toEqual([payload, payload])

    // And none of it became an element, an attribute or a listener.
    expect(container.querySelectorAll('script, img, iframe, style, a, b, i').length).toBe(0)
    expect(container.querySelectorAll('[onerror], [onmouseover], [onclick], [href], [src]').length).toBe(0)
  })

  it('escapes the markup characters in the page source', () => {
    act(() => root.render(<PageText site={siteWith('<script>alert(1)</script>')} />))
    expect(container.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('never runs anything, even where scripts would normally be revived', () => {
    for (const payload of PAYLOADS) act(() => root.render(<PageText site={siteWith(payload)} />))
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('shows an entity as typed instead of decoding it', () => {
    act(() => root.render(<PageText site={siteWith('&lt;b&gt; &amp;')} />))
    expect(container.querySelector('h1')?.textContent).toBe('&lt;b&gt; &amp;')
  })
})
