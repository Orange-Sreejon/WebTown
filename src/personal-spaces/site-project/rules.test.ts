import { describe, expect, it } from 'vitest'
import {
  assetNameProblem,
  assetProblem,
  checkUpload,
  cleanAssetName,
  formatBytes,
  pageNameProblem,
  projectUsage,
  sniffImage,
  uniqueName,
  validateProject,
} from './rules'
import { blankProject } from './templates'
import { GIF_1PX, GIF_ANIMATED, JPEG_HEAD, PNG_1PX, WEBP_HEAD, svg, text } from './test-images.test-support'
import { SITE_PROJECT_LIMITS, type SiteProject } from './types'

const NOW = '2026-11-17T12:00:00.000Z'
const project = (): SiteProject => blankProject('house-a', NOW)

describe('page names', () => {
  it.each(['index.html', 'about.html', 'blog.html', 'my-page_2.html', 'Guest.Book.html', 'a.html'])('accepts %s', name => {
    expect(pageNameProblem(name, [])).toBeNull()
  })

  it.each([
    ['about', 'must end in .html'],
    ['about.htm', 'must end in .html'],
    ['.html', 'can use letters'],
    ['-x.html', 'can use letters'],
    ['my page.html', 'can use letters'],
    ['../x.html', 'can use letters'],
    ['a/b.html', 'can use letters'],
    ['<b>.html', 'can use letters'],
    ['x'.repeat(65) + '.html', 'can use letters'],
  ])('refuses %j', (name, words) => {
    expect(pageNameProblem(name, [])).toContain(words)
  })

  it('refuses a name already used, ignoring case', () => {
    expect(pageNameProblem('ABOUT.html', ['about.html'])).toBe('There is already a page called ABOUT.html.')
  })
})

describe('asset names', () => {
  it.each(['my-banner.gif', 'cat.PNG', 'photo.jpeg', 'photo.jpg', 'a.webp', 'logo.svg'])('accepts %s', name => {
    expect(assetNameProblem(name, [])).toBeNull()
  })

  it.each(['cat', 'cat.bmp', 'run.exe', 'page.html', 'x.svgz', 'my banner.gif', '../cat.gif'])('refuses %j', name => {
    expect(assetNameProblem(name, [])).not.toBeNull()
  })

  it('cleans an uploaded name into an acceptable one', () => {
    expect(cleanAssetName('My Banner (1).GIF')).toBe('My-Banner-1-.gif')
    expect(assetNameProblem(cleanAssetName('My Banner (1).GIF'), [])).toBeNull()
    expect(cleanAssetName('  ..secret.png')).toBe('secret.png')
    expect(cleanAssetName('Ñandú.jpg')).toBe('Nandu.jpg')
    expect(cleanAssetName('???.png')).toBe('image.png')
  })

  it('finds a free name', () => {
    expect(uniqueName('cat.gif', [])).toBe('cat.gif')
    expect(uniqueName('cat.gif', ['CAT.gif'])).toBe('cat-2.gif')
    expect(uniqueName('cat.gif', ['cat.gif', 'cat-2.gif'])).toBe('cat-3.gif')
  })
})

describe('what an upload really is', () => {
  it('recognises each supported image by its content', () => {
    expect(sniffImage(PNG_1PX())).toBe('image/png')
    expect(sniffImage(GIF_1PX())).toBe('image/gif')
    expect(sniffImage(GIF_ANIMATED())).toBe('image/gif')
    expect(sniffImage(JPEG_HEAD())).toBe('image/jpeg')
    expect(sniffImage(WEBP_HEAD())).toBe('image/webp')
    expect(sniffImage(svg())).toBe('image/svg+xml')
    expect(sniffImage(text('<?xml version="1.0"?>\n<!-- hi -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
  })

  it('does not take text or other files for images', () => {
    expect(sniffImage(text('<html><svg></svg></html>'))).toBeNull()
    expect(sniffImage(text('hello'))).toBeNull()
    expect(sniffImage(text('MZ\u0090\u0000'))).toBeNull()
    expect(sniffImage(new Uint8Array([0xff, 0xfe, 0, 0x3c]).buffer)).toBeNull()
  })

  it('accepts an upload whose content matches its name', () => {
    expect(checkUpload('banner.gif', GIF_ANIMATED())).toEqual({ ok: true, mimeType: 'image/gif' })
    expect(checkUpload('logo.svg', svg())).toEqual({ ok: true, mimeType: 'image/svg+xml' })
  })

  it('refuses a file pretending to be an image', () => {
    const r = checkUpload('cat.png', text('<script>alert(1)</script>'))
    expect(r).toEqual({ ok: false, reason: 'cat.png does not contain a valid PNG, JPEG, GIF, WebP or SVG image.' })
  })

  it('refuses a name that disagrees with the content', () => {
    expect(checkUpload('cat.png', GIF_1PX())).toEqual({ ok: false, reason: 'cat.png is named like a PNG but contains a GIF. Rename it to match.' })
    expect(checkUpload('trick.gif', svg()).ok).toBe(false)
  })

  it('refuses unsupported, empty and oversized files, with the reason', () => {
    expect(checkUpload('a.bmp', PNG_1PX())).toMatchObject({ ok: false, reason: expect.stringContaining('not a supported image type') })
    expect(checkUpload('a.png', new ArrayBuffer(0))).toEqual({ ok: false, reason: 'a.png is empty.' })
    const big = new Uint8Array(SITE_PROJECT_LIMITS.assetBytes + 1)
    big.set(new Uint8Array(PNG_1PX()))
    expect(checkUpload('big.png', big.buffer)).toMatchObject({ ok: false, reason: expect.stringContaining('the limit for one image is 5.0 MB') })
  })

  it('formats sizes for people', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(150_000)).toBe('150 KB')
    expect(formatBytes(5_000_000)).toBe('5.0 MB')
  })
})

describe('validateProject', () => {
  it('accepts a blank website', () => {
    expect(validateProject(project())).toEqual([])
  })

  it('accepts any HTML and CSS at all, including broken markup', () => {
    const p = project()
    p.pages = [{ name: 'index.html', html: '<div><p>unclosed <b>everything' }, { name: 'x.html', html: '' }]
    p.css = 'body { color: red  /* no closing brace'
    expect(validateProject(p)).toEqual([])
  })

  it.each([null, 'site', 42, []])('refuses %j', input => {
    expect(validateProject(input)).toEqual([{ where: 'site', message: 'The website data is missing or damaged.' }])
  })

  it('needs a name, at least one page, and a homepage that exists', () => {
    const p = project()
    p.title = '   '
    p.homePage = 'gone.html'
    expect(validateProject(p).map(x => x.message)).toEqual(expect.arrayContaining([
      'Give your website a name.', 'The homepage must be one of the pages.',
    ]))
    expect(validateProject({ ...project(), pages: [] }).map(x => x.message)).toContain('A website needs at least one page.')
  })

  it('refuses duplicate and bad page names', () => {
    const p = project()
    p.pages.push({ name: 'INDEX.html', html: '' }, { name: 'bad name.html', html: '' })
    const where = validateProject(p).map(x => x.where)
    expect(where).toEqual(expect.arrayContaining(['page:INDEX.html', 'page:bad name.html']))
  })

  it('enforces the size limits, with the numbers', () => {
    const p = project()
    p.pages[0]!.html = 'x'.repeat(SITE_PROJECT_LIMITS.pageBytes + 1)
    p.css = 'y'.repeat(SITE_PROJECT_LIMITS.cssBytes + 1)
    const messages = validateProject(p).map(x => x.message)
    expect(messages).toContain('index.html is 1.0 MB; a page can be at most 1.0 MB.')
    expect(messages.some(m => m.startsWith('style.css is'))).toBe(true)
  })

  it('counts UTF-8 bytes, not characters', () => {
    const p = project()
    p.pages[0]!.html = '😀'.repeat(SITE_PROJECT_LIMITS.pageBytes / 4 + 1)
    expect(validateProject(p).length).toBe(1)
  })

  it('enforces the total size and file count', () => {
    const p = project()
    p.assets = Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, name: `a${i}.png`, mimeType: 'image/png' as const, size: SITE_PROJECT_LIMITS.assetBytes }))
    expect(validateProject(p).map(x => x.message)).toContain('The website is 55.0 MB; the limit is 50.0 MB.')
    const many = project()
    many.assets = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, name: `a${i}.png`, mimeType: 'image/png' as const, size: 10 }))
    expect(validateProject(many).map(x => x.message)).toContain('The website has 502 files; the limit is 500.')
  })

  it('refuses damaged asset records', () => {
    const p = project()
    p.assets = [{ id: 'x', name: 'cat.png', mimeType: 'image/gif', size: 10 }]
    expect(validateProject(p).map(x => x.message)).toContain('cat.png does not match its type.')
  })

  it('counts usage of text and assets', () => {
    const p = project()
    p.assets = [{ id: 'x', name: 'cat.png', mimeType: 'image/png', size: 1000 }]
    const usage = projectUsage(p)
    expect(usage.files).toBe(3)
    expect(usage.bytes).toBe(1000 + new TextEncoder().encode(p.pages[0]!.html).length)
  })
})

describe('stored asset records', () => {
  const base = { id: 'a1', houseId: 'house-a', name: 'cat.png', mimeType: 'image/png' as const }

  it('accepts a real image that matches its record', () => {
    const bytes = PNG_1PX()
    expect(assetProblem({ ...base, size: bytes.byteLength, bytes }, 'house-a')).toBeNull()
  })

  it('refuses a record from another house, with wrong bytes, or a wrong size', () => {
    const bytes = PNG_1PX()
    expect(assetProblem({ ...base, size: bytes.byteLength, bytes }, 'house-b')).toContain('another house')
    expect(assetProblem({ ...base, size: 5, bytes: text('hello') }, 'house-a')).toContain('not the image it claims')
    expect(assetProblem({ ...base, size: 999, bytes }, 'house-a')).toContain('wrong size')
    expect(assetProblem({ ...base, size: 10 }, 'house-a')).toContain('no image data')
  })
})
