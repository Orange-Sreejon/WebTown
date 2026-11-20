import { describe, expect, it } from 'vitest'
import { createDefaultSite } from '../website/default-site'
import type { SiteContent } from '../website/site-types'
import { validateProject } from './rules'
import { BLANK_INDEX, blankProject, classicProject, escapeHtml, newPageHtml, siteContentToProject } from './templates'

const NOW = '2026-11-17T12:00:00.000Z'
const page = (p: { pages: { name: string; html: string }[] }, name: string): string => p.pages.find(x => x.name === name)!.html

describe('Blank', () => {
  it('is one minimal, valid page and an empty stylesheet, with no design', () => {
    const p = blankProject('house-a', NOW)
    expect(p.pages).toEqual([{ name: 'index.html', html: BLANK_INDEX }])
    expect(p.homePage).toBe('index.html')
    expect(p.css).toBe('')
    expect(p.assets).toEqual([])
    expect(p.revision).toBe(0)
    expect(p.origin).toEqual({ kind: 'blank' })
    expect(validateProject(p)).toEqual([])
    expect(BLANK_INDEX).toMatch(/^<!DOCTYPE html>/)
    expect(BLANK_INDEX).toContain('<body>\n\n</body>')
    expect(BLANK_INDEX).not.toMatch(/<(div|nav|header|main|section|h1|p)\b/)
  })

  it('gives each house its own copy', () => {
    const a = blankProject('house-a', NOW)
    const b = blankProject('house-b', NOW)
    expect(a.houseId).toBe('house-a')
    expect(b.houseId).toBe('house-b')
    a.pages[0]!.html = 'changed'
    expect(blankProject('house-a', NOW).pages[0]!.html).toBe(BLANK_INDEX)
  })

  it('starts new pages with a minimal document titled after the page', () => {
    expect(newPageHtml('guestbook.html')).toContain('<title>guestbook</title>')
    expect(newPageHtml('guestbook.html')).toContain('<link rel="stylesheet" href="style.css">')
  })
})

describe('Classic', () => {
  it('is a valid, editable multi-page starter', () => {
    const p = classicProject('house-a', NOW)
    expect(p.origin).toEqual({ kind: 'classic' })
    expect(p.pages.map(x => x.name)).toEqual(['index.html', 'about.html', 'projects.html', 'links.html'])
    expect(validateProject(p)).toEqual([])
    expect(p.css).toContain('repeating-linear-gradient')
    expect(page(p, 'index.html')).toContain('Under construction')
  })
})

describe('converting an old structured website', () => {
  const old = (): SiteContent => {
    const s = createDefaultSite('house-c', '2026-01-02T03:04:05.000Z')
    s.title = 'Ada\'s <Corner> & more'
    s.profile.displayName = 'Ada "Pixels"'
    s.profile.tagline = 'Making <things>'
    s.home.welcome = 'Hello!\n\nSecond paragraph\nwith a line break.'
    s.about.body = 'About me.'
    s.projects = [
      { id: 'p1', title: 'Robot', description: 'A robot.', url: 'https://example.com/robot' },
      { id: 'p2', title: 'No link', description: '', url: null },
    ]
    s.links = [
      { id: 'l1', label: 'Example', url: 'https://example.org/' },
      { id: 'l2', label: 'Bad', url: 'javascript:alert(1)' },
    ]
    s.theme = { preset: 'custom', background: '#112233', text: '#FFEEDD', link: '#AABBCC', headerBackground: '#440000',
      headerText: '#FFFFFF', font: 'mono', pattern: 'grid', underConstruction: true }
    return s
  }

  it('produces a valid website, owned by the same house, marked as migrated', () => {
    const p = siteContentToProject(old(), NOW, { kind: 'migrated', sourceUpdatedAt: '2026-01-02T03:04:05.000Z' })
    expect(validateProject(p)).toEqual([])
    expect(p.houseId).toBe('house-c')
    expect(p.origin).toEqual({ kind: 'migrated', sourceUpdatedAt: '2026-01-02T03:04:05.000Z' })
    expect(p.homePage).toBe('index.html')
    expect(p.title).toBe('Ada\'s <Corner> & more')
  })

  it('carries over every field, escaped', () => {
    const p = siteContentToProject(old(), NOW, { kind: 'classic' })
    const index = page(p, 'index.html')
    expect(index).toContain('<h1>Ada&#39;s &lt;Corner&gt; &amp; more</h1>')
    expect(index).toContain('<p class="tagline">Making &lt;things&gt;</p>')
    expect(index).toContain('A home page by Ada &quot;Pixels&quot;')
    expect(index).toContain('<p>Hello!</p>')
    expect(index).toContain('<p>Second paragraph<br>')
    expect(index).toContain('Under construction')
    expect(page(p, 'about.html')).toContain('<p>About me.</p>')
    const projects = page(p, 'projects.html')
    expect(projects).toContain('<h3>Robot</h3>')
    expect(projects).toContain('<a href="https://example.com/robot">Visit this project</a>')
    expect(projects).toContain('<h3>No link</h3>')
    const links = page(p, 'links.html')
    expect(links).toContain('<a href="https://example.org/">Example</a>')
    expect(links).toContain('Bad <small>(link unavailable)</small>')
    expect(links).not.toContain('javascript:')
  })

  it('carries over the theme as CSS: colours, font, pattern', () => {
    const css = siteContentToProject(old(), NOW, { kind: 'classic' }).css
    expect(css).toContain('background-color: #112233;')
    expect(css).toContain('color: #FFEEDD;')
    expect(css).toContain('a { color: #AABBCC; }')
    expect(css).toContain('background: #440000;')
    expect(css).toContain('"Courier New", Courier, monospace')
    expect(css).toContain('background-size: 24px 24px;')
  })

  it('leaves out the banner when it was off, and handles empty sections', () => {
    const s = old()
    s.theme.underConstruction = false
    s.projects = []
    s.links = []
    s.about.body = ''
    const p = siteContentToProject(s, NOW, { kind: 'classic' })
    expect(page(p, 'index.html')).not.toContain('Under construction')
    expect(page(p, 'projects.html')).toContain('No projects yet.')
    expect(page(p, 'links.html')).toContain('No links yet.')
    expect(page(p, 'about.html')).toContain('Nothing here yet.')
  })

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    '</title><script>x</script>',
  ])('keeps hostile old text as text: %s', payload => {
    const s = old()
    s.title = payload
    s.profile.tagline = payload
    s.home.welcome = payload
    s.projects[0]!.title = payload
    s.links[0]!.label = payload
    const p = siteContentToProject(s, NOW, { kind: 'classic' })
    for (const pg of p.pages) {
      // Parsed as a browser would, the text creates no element and no handler.
      const doc = new DOMParser().parseFromString(pg.html, 'text/html')
      expect(doc.querySelectorAll('script, img, svg, [onerror], [onload]'), pg.name).toHaveLength(0)
      expect(pg.html).toContain(escapeHtml(payload))
    }
  })

  it('never puts an unsafe colour into the CSS', () => {
    const s = old()
    ;(s.theme as unknown as Record<string, string>)['background'] = 'red;} body{background:url(//evil)'
    const css = siteContentToProject(s, NOW, { kind: 'classic' }).css
    expect(css).not.toContain('evil')
    expect(css).toContain('background-color: #C0C0C0;')
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml('<a href="x">\'&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
