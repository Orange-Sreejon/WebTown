import { describe, expect, it } from 'vitest'
import { describeChanges, diffSites, unchanged } from './diff'

const site = (over: Record<string, unknown> = {}) => ({
  title: 'Our town', homePage: 'index.html', css: 'a{}',
  pages: [{ name: 'index.html', html: 'home' }, { name: 'about.html', html: 'about' }],
  assets: [{ id: 'i1', name: 'logo.png', mimeType: 'image/png' as const, size: 1 }],
  ...over,
})

describe('diffSites', () => {
  it('finds nothing between equal versions', () => {
    const c = diffSites(site(), site())
    expect(unchanged(c)).toBe(true)
    expect(describeChanges(c)).toEqual(['Nothing changes: this is the same as the published version.'])
  })

  it('lists added, changed and removed pages and images, and other changes', () => {
    const next = site({
      title: 'Our lovely town', homePage: 'news.html', css: 'b{}',
      pages: [{ name: 'index.html', html: 'home!' }, { name: 'news.html', html: 'news' }],
      assets: [{ id: 'i2', name: 'banner.gif', mimeType: 'image/gif', size: 2 }],
    })
    const c = diffSites(site(), next)
    expect(c).toEqual({
      pagesAdded: ['news.html'], pagesChanged: ['index.html'], pagesRemoved: ['about.html'], cssChanged: true,
      titleChanged: true, homeChanged: true, imagesAdded: ['banner.gif'], imagesRemoved: ['logo.png'],
    })
    expect(describeChanges(c)).toEqual([
      'The website name changes.', 'The homepage changes.', 'New pages: news.html', 'Changed pages: index.html',
      'Removed pages: about.html', 'style.css changes.', 'New images: banner.gif', 'Removed images: logo.png',
    ])
  })

  it('treats everything as new when nothing is published yet, and shortens long lists', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}.html`, html: '' }))
    const c = diffSites(null, site({ pages: many, homePage: 'p0.html', css: '' }))
    expect(c.titleChanged).toBe(false)
    expect(c.cssChanged).toBe(false)
    expect(describeChanges(c)[0]).toBe('New pages: p0.html, p1.html, p2.html, p3.html, p4.html and 3 more')
  })

  it('follows images by id, so a renamed image is neither new nor removed', () => {
    const c = diffSites(site(), site({ assets: [{ id: 'i1', name: 'renamed.png', mimeType: 'image/png', size: 1 }] }))
    expect([c.imagesAdded, c.imagesRemoved]).toEqual([[], []])
  })
})
