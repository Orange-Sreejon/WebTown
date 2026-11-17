import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toReadonlySite } from '../../personal-spaces/website/site-readonly'
import { SECTION_IDS, type SectionId, type SiteContent } from '../../personal-spaces/website/site-types'
import { SiteRenderer } from './SiteRenderer'
import { PAYLOADS, defaultSite, hostileSite, validLinkCount } from './site-fixtures.test-support'
import { FONT_STACKS } from './site-theme'

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
})

function show(site: SiteContent, section: SectionId = 'home', onNavigate: (s: SectionId) => void = () => undefined): void {
  act(() => root.render(<SiteRenderer site={toReadonlySite(site)} section={section} onNavigate={onNavigate} />))
}

const text = (selector: string): string | null => container.querySelector(selector)?.textContent ?? null
const all = (selector: string): Element[] => [...container.querySelectorAll(selector)]
const button = (name: string): HTMLButtonElement => {
  const found = all('button').find(b => b.textContent?.trim() === name)
  if (!found) throw new Error(`no button "${name}"`)
  return found as HTMLButtonElement
}

describe('the banner and footer', () => {
  it('shows the title, tagline and who made the page', () => {
    show(defaultSite())
    expect(text('h1')).toBe('Welcome to House A!')
    expect(text('.wt-tagline')).toBe('Best viewed in WebTown. Thanks for stopping by!')
    expect(text('.wt-byline')).toBe('A home page by House A')
  })

  it('leaves out an empty tagline instead of drawing an empty line', () => {
    const site = defaultSite()
    site.profile.tagline = ''
    show(site)
    expect(container.querySelector('.wt-tagline')).toBeNull()
  })

  it('has exactly one top-level heading', () => {
    for (const section of SECTION_IDS) {
      show(defaultSite(), section)
      expect(all('h1')).toHaveLength(1)
    }
  })

  it('says when the page was last updated, in plain words', () => {
    show(defaultSite())
    expect(text('footer')).toBe('Last updated 16 Nov 2026. Made in WebTown.')
  })

  it('shows the under-construction banner only when it is on', () => {
    show(defaultSite())
    expect(text('[role="note"]')).toBe('Under construction')

    const site = defaultSite()
    site.theme.underConstruction = false
    show(site)
    expect(container.querySelector('[role="note"]')).toBeNull()
  })

  it('has no visitor counter or other made-up statistics', () => {
    show(defaultSite())
    expect(container.textContent).not.toMatch(/visitor|you are visitor|hits|counter/i)
  })
})

describe('navigation inside the site', () => {
  it('offers the four pages as buttons in a labelled navigation region', () => {
    show(defaultSite())
    const nav = container.querySelector('nav')!
    expect(nav.getAttribute('aria-label')).toBe('Website pages')
    expect([...nav.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Home', 'About', 'Projects', 'Links'])
  })

  it('marks the current page, and only that page', () => {
    for (const [section, label] of [['home', 'Home'], ['about', 'About'], ['projects', 'Projects'], ['links', 'Links']] as const) {
      show(defaultSite(), section)
      const current = all('nav [aria-current="page"]')
      expect(current.map(c => c.textContent)).toEqual([label])
    }
  })

  it('reports each page that is chosen', () => {
    const onNavigate = vi.fn()
    show(defaultSite(), 'home', onNavigate)
    for (const label of ['Home', 'About', 'Projects', 'Links']) act(() => button(label).click())
    expect(onNavigate.mock.calls.map(c => c[0])).toEqual(['home', 'about', 'projects', 'links'])
  })

  it('uses buttons, never anchors, so moving between pages cannot change the address of the page', () => {
    show(defaultSite())
    expect(all('nav a, .wt-contents a')).toHaveLength(0)
    expect(all('a').every(a => a.getAttribute('target') === '_blank')).toBe(true)
  })

  it('links from the home page to the others, with counts', () => {
    const onNavigate = vi.fn()
    show(defaultSite(), 'home', onNavigate)
    act(() => button('About me').click())
    act(() => button('Projects (3)').click())
    act(() => button('Links (2)').click())
    expect(onNavigate.mock.calls.map(c => c[0])).toEqual(['about', 'projects', 'links'])
  })
})

describe('each page', () => {
  it('home shows the welcome message as paragraphs', () => {
    show(defaultSite())
    expect(text('main h2')).toBe('Welcome!')
    const paragraphs = all('main .wt-paragraph').map(p => p.textContent)
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]).toBe('Hello, and welcome to my corner of WebTown!')
  })

  it('about shows the text under a heading with the name', () => {
    show(defaultSite(), 'about')
    expect(text('main h2')).toBe('About House A')
    expect(all('main .wt-paragraph').length).toBe(3)
    expect(container.textContent).toContain('My name is House A')
  })

  it('projects lists every project with its description', () => {
    show(defaultSite(), 'projects')
    expect(text('main h2')).toBe('Projects')
    const articles = all('main article')
    expect(articles.map(a => a.querySelector('h3')?.textContent)).toEqual([
      'My first web page',
      'Sketchbook doodles',
      'A project with a link',
    ])
    expect(articles[0]!.textContent).toContain('You are looking at it!')
  })

  it('projects shows a link only for the project that has one', () => {
    show(defaultSite(), 'projects')
    const articles = all('main article')
    expect(articles.map(a => a.querySelectorAll('a').length)).toEqual([0, 0, 1])
    expect(articles[2]!.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
  })

  it('links lists every link by its label', () => {
    show(defaultSite(), 'links')
    expect(text('main h2')).toBe('Links')
    expect(all('main li').map(li => li.querySelector('a')?.firstChild?.textContent)).toEqual([
      'An example link (replace me)',
      'Another favourite place',
    ])
  })

  it('says so, kindly, when there is nothing to show', () => {
    const site = defaultSite()
    site.projects = []
    site.links = []
    site.about.body = ''
    show(site, 'projects')
    expect(text('main')).toContain('No projects yet.')
    show(site, 'links')
    expect(text('main')).toContain('No links yet.')
    show(site, 'about')
    expect(text('main')).toContain('Nothing here yet.')
  })

  it('keeps line breaks inside a paragraph and splits paragraphs on blank lines', () => {
    const site = defaultSite()
    site.home.welcome = 'Line one\nLine two\n\nSecond paragraph'
    show(site)
    const paragraphs = all('main .wt-paragraph')
    expect(paragraphs.map(p => p.textContent)).toEqual(['Line one\nLine two', 'Second paragraph'])
  })

  it('labels the main region with its heading', () => {
    for (const section of SECTION_IDS) {
      show(defaultSite(), section)
      const main = container.querySelector('main')!
      const heading = document.getElementById(main.getAttribute('aria-labelledby')!)
      expect(heading?.tagName).toBe('H2')
      expect(main.tabIndex).toBe(-1)
    }
  })
})

describe('the look of the page', () => {
  it('passes the theme to the stylesheet as colours and a font', () => {
    show(defaultSite())
    const style = container.querySelector<HTMLElement>('.wt-site')!.style
    expect(style.getPropertyValue('--site-bg')).toBe('#000022')
    expect(style.getPropertyValue('--site-text')).toBe('#FFFFFF')
    expect(style.getPropertyValue('--site-link')).toBe('#66CCFF')
    expect(style.getPropertyValue('--site-header-bg')).toBe('#000080')
    expect(style.getPropertyValue('--site-header-text')).toBe('#FFFF66')
    expect(style.getPropertyValue('--site-font')).toBe(FONT_STACKS.mono)
    expect(container.querySelector('.wt-site')!.getAttribute('data-pattern')).toBe('stars')
  })

  it('puts only a #RRGGBB colour into a style, whatever was stored', () => {
    const site = defaultSite()
    ;(site.theme as unknown as Record<string, string>)['background'] = 'url(https://evil.example/x.png)'
    ;(site.theme as unknown as Record<string, string>)['text'] = 'red; position: fixed'
    ;(site.theme as unknown as Record<string, string>)['font'] = 'x; background: url(//evil)'
    ;(site.theme as unknown as Record<string, string>)['pattern'] = '" onmouseover="alert(1)'
    show(site)
    const element = container.querySelector<HTMLElement>('.wt-site')!
    for (const name of ['--site-bg', '--site-text', '--site-link', '--site-header-bg', '--site-header-text']) {
      expect(element.style.getPropertyValue(name), name).toMatch(/^#[0-9A-F]{6}$/)
    }
    expect(element.style.getPropertyValue('--site-font')).toBe(FONT_STACKS.serif)
    expect(element.getAttribute('data-pattern')).toBe('plain')
    expect(element.getAttribute('onmouseover')).toBeNull()
    expect(element.getAttribute('style')).not.toMatch(/evil|url\(|fixed/)
  })

  it('has a font stack for each font choice and nothing else', () => {
    expect(Object.keys(FONT_STACKS).sort()).toEqual(['mono', 'sans', 'serif'])
  })
})

describe('links to other websites', () => {
  const withLinks = (...urls: string[]): SiteContent => {
    const site = defaultSite()
    site.links = urls.map((url, i) => ({ id: `l-${i}`, label: `Link ${i}`, url }))
    return site
  }

  it('opens a valid link in a new tab, with noopener and noreferrer', () => {
    show(withLinks('https://example.com/page?x=1#top'), 'links')
    const anchor = container.querySelector('a')!
    expect(anchor.getAttribute('href')).toBe('https://example.com/page?x=1#top')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect((anchor.getAttribute('rel') ?? '').split(/\s+/).sort()).toEqual(['noopener', 'noreferrer'])
  })

  it('shows where a link goes, and says it opens a new tab', () => {
    show(withLinks('https://sub.example.org:8443/x'), 'links')
    const anchor = container.querySelector('a')!
    expect(anchor.textContent).toContain('(sub.example.org:8443)')
    expect(anchor.textContent).toContain('opens in a new tab')
  })

  it('accepts an explicit https port', () => {
    show(withLinks('https://example.com:8443/'), 'links')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com:8443/')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'blob:https://example.com/x',
    'mailto:a@example.com',
    '//example.com/',
    'example.com',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://user:pw@example.com/',
    'https://example.com:0/',
    'https://exa mple.com/',
    '',
  ])('shows %j as plain text, never as a link', url => {
    show(withLinks(url), 'links')
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelector('[href]')).toBeNull()
    expect(text('main')).toContain('Link 0')
    expect(text('main')).toContain('(link unavailable)')
  })

  it('applies the same rule to a project link', () => {
    const site = defaultSite()
    site.projects[2]!.url = 'javascript:alert(1)'
    show(site, 'projects')
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(text('main')).toContain('(link unavailable)')
  })

  it('every anchor on every page is a validated https link that opens a new tab safely', () => {
    const site = defaultSite()
    site.links.push({ id: 'bad', label: 'Bad', url: 'javascript:alert(1)' })
    for (const section of SECTION_IDS) {
      show(site, section)
      for (const anchor of all('a')) {
        expect(anchor.getAttribute('href')).toMatch(/^https:\/\//)
        expect(anchor.getAttribute('target')).toBe('_blank')
        expect(anchor.getAttribute('rel')).toContain('noopener')
        expect(anchor.getAttribute('rel')).toContain('noreferrer')
      }
    }
  })

  it('does not follow or run anything when a link label looks like markup', () => {
    const site = withLinks('https://example.com/')
    site.links[0]!.label = '<a href="javascript:alert(1)">x</a>'
    show(site, 'links')
    expect(all('a')).toHaveLength(1)
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://example.com/')
  })
})

describe('text from the site is shown literally', () => {
  const FORBIDDEN = 'script, img, iframe, style, svg, object, embed, link, meta, base, form, input, textarea, video, audio'

  it.each(PAYLOADS)('shows %s as characters on every page, and creates and runs nothing', payload => {
    const site = hostileSite(payload)
    for (const section of SECTION_IDS) {
      show(site, section)

      // No element, attribute or listener came out of the text.
      expect(container.querySelectorAll(FORBIDDEN), `${section}: injected element`).toHaveLength(0)
      expect(container.querySelectorAll('[onerror], [onload], [onclick], [onmouseover], [onfocus]')).toHaveLength(0)
      expect(container.querySelectorAll('b, i, u, em, strong'), `${section}: injected formatting`).toHaveLength(0)
      expect(all('a').length, `${section}: anchors`).toBe(section === 'links' ? site.links.length : section === 'projects' ? 1 : 0)
      expect(all('a').every(a => a.getAttribute('href')!.startsWith('https://example.'))).toBe(true)
      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    }
  })

  it.each(PAYLOADS)('shows every field of the site as the exact characters typed: %s', payload => {
    const site = hostileSite(payload)

    show(site, 'home')
    expect(text('h1')).toBe(payload)
    expect(text('.wt-tagline')).toBe(payload)
    expect(text('.wt-byline')).toBe(`A home page by ${payload}`)
    expect(all('main .wt-paragraph').map(p => p.textContent)).toEqual([payload, payload])

    show(site, 'about')
    expect(text('main h2')).toBe(`About ${payload}`)
    expect(all('main .wt-paragraph').map(p => p.textContent)).toEqual([payload, payload])

    show(site, 'projects')
    expect(all('main article h3').map(h => h.textContent)).toEqual([payload, payload, payload])
    expect(all('main article .wt-paragraph').slice(0, 3).map(p => p.textContent)).toEqual([payload, payload, payload])

    show(site, 'links')
    expect(all('main li a').map(a => a.firstChild?.textContent)).toEqual([payload, payload])
  })

  it('escapes the markup characters in the page source', () => {
    show(hostileSite('<script>alert(1)</script>'))
    expect(container.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(container.innerHTML).not.toContain('<script')
  })

  it('shows an entity as typed, without decoding it', () => {
    const site = defaultSite()
    site.title = '&lt;b&gt; &amp; &#60;'
    show(site)
    expect(text('h1')).toBe('&lt;b&gt; &amp; &#60;')
  })

  it('runs nothing even when scripts, handlers and javascript: links are all present at once', () => {
    for (const payload of PAYLOADS) show(hostileSite(payload), 'links')
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    expect(document.querySelectorAll('script')).toHaveLength(0)
  })

  it('does not leave the rendered page with more anchors than valid links', () => {
    const site = hostileSite('<a href="javascript:alert(1)">x</a>')
    show(site, 'links')
    expect(all('a')).toHaveLength(site.links.length)
    show(site, 'projects')
    expect(all('a')).toHaveLength(validLinkCount(site) - site.links.length)
  })
})
