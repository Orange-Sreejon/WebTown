import { describe, expect, it } from 'vitest'
import { RESIDENT_CSP, buildSitePage, findPage, resolveReference, rewriteCss, toRenderable, type RenderableSite } from './builder'
import { GIF_1PX, PNG_1PX, svg } from './test-images.test-support'

const ORIGIN = 'http://webtown.test'
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function site(pages: Record<string, string>, css = '', assets: Record<string, string> = { 'banner.gif': GIF }): RenderableSite {
  return { pages, css, assets }
}
const one = (html: string, css = ''): RenderableSite => site({ 'index.html': html }, css)
const render = (s: RenderableSite, page = 'index.html'): Document =>
  new DOMParser().parseFromString(buildSitePage(s, page, ORIGIN).html, 'text/html')

describe('resident freedom', () => {
  it('keeps the resident\'s own structure, text and inline styles', () => {
    const doc = render(one('<!DOCTYPE html><html><head><title>Hi</title><style>.x{display:grid;grid-template-columns:1fr 2fr}</style></head>' +
      '<body class="zine"><marquee>news</marquee><table border=1><tr><td id="c">cell</td></tr></table><div style="transform:rotate(3deg)">tilt</div></body></html>'))
    expect(doc.body.className).toBe('zine')
    expect(doc.querySelector('marquee')?.textContent).toBe('news')
    expect(doc.getElementById('c')?.textContent).toBe('cell')
    expect(doc.querySelector('style')?.textContent).toBe('.x{display:grid;grid-template-columns:1fr 2fr}')
    expect(doc.querySelector('div')?.getAttribute('style')).toBe('transform:rotate(3deg)')
  })

  it('keeps the author\'s doctype, or none (quirks mode)', () => {
    expect(buildSitePage(one('<!DOCTYPE html><p>x'), 'index.html', ORIGIN).html.startsWith('<!DOCTYPE html>\n')).toBe(true)
    expect(buildSitePage(one('<p>quirky</p>'), 'index.html', ORIGIN).html.startsWith('<html')).toBe(true)
  })

  it('renders broken markup the way a browser would, without throwing', () => {
    const doc = render(one('<div><p>unclosed <b>bold <i>both</div></span>'))
    expect(doc.body.textContent).toContain('unclosed bold both')
    expect(() => buildSitePage(one('<<<>>>'), 'index.html', ORIGIN)).not.toThrow()
  })

  it('reports the page title as text', () => {
    expect(buildSitePage(one('<title>  My   <b>Page</b> </title>'), 'index.html', ORIGIN).title).toBe('My <b>Page</b>')
  })

  it('finds pages ignoring case, and shows WebTown\'s page for a missing one', () => {
    expect(findPage(site({ 'About.html': 'x' }), 'about.html')).toBe('About.html')
    const missing = buildSitePage(one('x'), 'nope<b>.html', ORIGIN)
    expect(missing.missing).toBe(true)
    expect(missing.html).toContain('nope&#60;b&#62;.html')
    expect(missing.html).toContain(RESIDENT_CSP)
  })
})

describe('policy', () => {
  it('puts WebTown\'s charset and policy first in <head>, before anything of the resident\'s', () => {
    const doc = render(one('<head><meta charset="windows-1252"><meta name="x"></head><body>x</body>'))
    const head = doc.head.children
    expect(head[0]!.getAttribute('charset')).toBe('utf-8')
    expect(head[1]!.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(head[1]!.getAttribute('content')).toBe(RESIDENT_CSP)
    expect(doc.querySelectorAll('meta[charset]')).toHaveLength(1)
  })

  it('has no network source and no script source', () => {
    expect(RESIDENT_CSP).toContain("script-src 'none'")
    expect(RESIDENT_CSP).toContain("default-src 'none'")
    expect(RESIDENT_CSP).toContain("connect-src 'none'")
    expect(RESIDENT_CSP).not.toMatch(/https?:|\*|'self'/)
  })

  it('removes a resident CSP, refresh and set-cookie meta tags', () => {
    const doc = render(one('<head><meta http-equiv="refresh" content="0;url=https://evil.example"><meta http-equiv="Content-Security-Policy" content="default-src *"><meta http-equiv="set-cookie" content="a=b"></head>'))
    expect(doc.querySelectorAll('meta[http-equiv]')).toHaveLength(1)
  })
})

describe('no JavaScript', () => {
  it.each([
    ['inline script', '<script>alert(1)</script>'],
    ['module script', '<script type="module">x</script>'],
    ['script file', '<script src="app.js"></script>'],
    ['svg script', '<svg><script>alert(1)</script></svg>'],
    ['nonce copy', '<script nonce="wtHost1">alert(1)</script>'],
  ])('removes %s', (_name, html) => {
    const out = buildSitePage(one(html), 'index.html', ORIGIN).html
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/nonce=/i)
  })

  it('removes every event-handler attribute', () => {
    const out = buildSitePage(one('<body onload="x()"><img src="assets/banner.gif" onerror="x()" ONCLICK="x()"><svg onload="x()"><a onmouseover="x()">a</a></svg></body>'), 'index.html', ORIGIN).html
    expect(out).not.toMatch(/\son[a-z]+=/i)
  })

  it('never leaves a javascript: URL', () => {
    const out = buildSitePage(one('<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><img src="javascript:x"><iframe src="javascript:x"></iframe><form action="javascript:x"><button formaction="javascript:x">b</button></form>'), 'index.html', ORIGIN).html
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('unwraps <noscript>, since no script runs', () => {
    const doc = render(one('<noscript><p id="n">shown</p></noscript>'))
    expect(doc.querySelector('noscript')).toBeNull()
    expect(doc.getElementById('n')?.textContent).toBe('shown')
  })

  it('keeps declarative shadow DOM inert and cleans what is inside it', () => {
    const out = buildSitePage(one('<div><template shadowrootmode="open"><img src="https://evil.example/x.png"><a href="https://evil.example">x</a><script>x</script></template></div>'), 'index.html', ORIGIN).html
    expect(out).not.toContain('shadowrootmode')
    expect(out).not.toContain('src="https://evil')
    expect(out).not.toContain('href="https://evil')
    // The link inside is treated like any other external link: it goes through WebTown's confirmation.
    expect(out).toContain(`${ORIGIN}/site-nav.html#k=external&amp;u=https%3A%2F%2Fevil.example`)
    expect(out).not.toMatch(/<script/i)
  })
})

describe('no network, no escape', () => {
  it.each(['iframe', 'frame', 'object', 'embed', 'applet', 'portal', 'base'])('removes <%s>', tag => {
    const out = buildSitePage(one(`<${tag} src="https://evil.example" data="https://evil.example" href="https://evil.example"></${tag}>`), 'index.html', ORIGIN).html
    expect(out).not.toContain('evil.example')
  })

  it('removes preload, prefetch, preconnect and similar links', () => {
    const out = buildSitePage(one(['preload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch', 'modulepreload', 'manifest']
      .map(rel => `<link rel="${rel}" href="https://evil.example/${rel}">`).join('')), 'index.html', ORIGIN).html
    expect(out).not.toContain('evil.example')
  })

  it('removes external resource references of every kind', () => {
    const html = '<img src="https://e.example/a.png" srcset="https://e.example/b.png 2x"><video poster="https://e.example/p.png" src="https://e.example/v.mp4"></video>' +
      '<table background="https://e.example/t.png"></table><input type="image" src="https://e.example/i.png"><link rel="stylesheet" href="https://e.example/s.css">' +
      '<svg><image href="https://e.example/si.png"/><use href="https://e.example/u.svg#a"/></svg>'
    const out = buildSitePage(one(html), 'index.html', ORIGIN).html
    expect(out).not.toContain('e.example')
  })

  it('neutralises external URLs in CSS, inline styles and @import', () => {
    const out = buildSitePage(one('<style>@import url(https://e.example/i.css); .a{background:url(https://e.example/b.png)} .b{background-image:image-set("https://e.example/c.png" 1x)}</style><div style="background:url(//e.example/d.png)">x</div>',
      '.c{cursor:url(https://e.example/cur.cur),auto}'), 'index.html', ORIGIN).html
    expect(out).not.toContain('e.example')
    // The shared stylesheet is a data URL; decode it and check too.
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const shared = doc.querySelector('link[rel="stylesheet"]')!.getAttribute('href')!
    expect(atob(shared.split(',')[1]!)).not.toContain('e.example')
  })

  it('drops target, ping, formaction and similar attributes', () => {
    const out = buildSitePage(one('<a href="about.html" target="_top" ping="https://e.example/p">a</a><form action="https://e.example"><button formaction="https://e.example" formtarget="_blank">b</button></form>'), 'index.html', ORIGIN).html
    expect(out).not.toMatch(/target=|ping=|formaction=|action=|e\.example/)
  })
})

describe('links', () => {
  const pages = { 'index.html': '<a id="a" href="about.html">About</a><a id="b" href="./About.html#bio">Bio</a><a id="c" href="#top">Top</a><a id="d" href="/blog.html?x=1">Blog</a><a id="e" href="nope.html">Nope</a>',
    'about.html': 'x', 'blog.html': 'y' }

  it('sends links to the site\'s own pages through WebTown\'s navigation page', () => {
    const doc = render(site(pages))
    expect(doc.getElementById('a')!.getAttribute('href')).toBe(`${ORIGIN}/site-nav.html#k=page&p=about.html`)
    expect(doc.getElementById('b')!.getAttribute('href')).toBe(`${ORIGIN}/site-nav.html#k=page&p=About.html%23bio`)
    expect(doc.getElementById('d')!.getAttribute('href')).toBe(`${ORIGIN}/site-nav.html#k=page&p=blog.html`)
    // A missing page still goes to WebTown, which shows "page not found".
    expect(doc.getElementById('e')!.getAttribute('href')).toBe(`${ORIGIN}/site-nav.html#k=page&p=nope.html`)
  })

  it('points links within the page at the frame document itself, so they stay in the page', () => {
    expect(render(site(pages)).getElementById('c')!.getAttribute('href')).toBe('about:srcdoc#top')
  })

  it('sends policy-approved external links through WebTown for confirmation, and disables the rest', () => {
    const doc = render(one('<a id="ok" href="https://example.com/x?y=1">ok</a><a id="http" href="http://example.com/">http</a><a id="mail" href="mailto:a@example.com">mail</a><a id="ip" href="https://127.0.0.1/">ip</a>'))
    expect(doc.getElementById('ok')!.getAttribute('href')).toBe(`${ORIGIN}/site-nav.html#k=external&u=https%3A%2F%2Fexample.com%2Fx%3Fy%3D1`)
    for (const id of ['http', 'mail', 'ip']) {
      expect(doc.getElementById(id)!.hasAttribute('href'), id).toBe(false)
      expect(doc.getElementById(id)!.getAttribute('aria-disabled')).toBe('true')
    }
  })
})

describe('the site\'s own files', () => {
  it('inlines assets wherever they are used', () => {
    const doc = render(one('<img id="i" src="assets/banner.gif"><img id="s" srcset="assets/banner.gif 1x, https://e.example/x.png 2x"><div id="d" style="background:url(\'assets/BANNER.gif\')"></div><style>body{background:url(assets/banner.gif)}</style>'))
    expect(doc.getElementById('i')!.getAttribute('src')).toBe(GIF)
    expect(doc.getElementById('s')!.getAttribute('srcset')).toBe(`${GIF} 1x`)
    expect(doc.getElementById('d')!.getAttribute('style')).toBe(`background:url("${GIF}")`)
    expect(doc.querySelector('style')!.textContent).toBe(`body{background:url("${GIF}")}`)
  })

  it('removes references to files the site does not have', () => {
    const doc = render(one('<img id="i" src="assets/missing.png"><img id="j" src="cat.png">'))
    expect(doc.getElementById('i')!.hasAttribute('src')).toBe(false)
    expect(doc.getElementById('j')!.hasAttribute('src')).toBe(false)
  })

  it('applies style.css to every page exactly once, linked or not', () => {
    const s = site({ 'index.html': '<head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="./style.css"></head><p>a', 'b.html': '<p>b' }, 'p{color:red}')
    for (const page of ['index.html', 'b.html']) {
      const doc = render(s, page)
      const links = doc.querySelectorAll('link[rel="stylesheet"]')
      expect(links, page).toHaveLength(1)
      expect(atob(links[0]!.getAttribute('href')!.split(',')[1]!)).toBe('p{color:red}')
    }
  })

  it('keeps the stylesheet where the author linked it, so cascade order is theirs', () => {
    const doc = render(one('<head><style id="before">p{color:blue}</style><link rel="stylesheet" href="style.css"><style id="after">p{color:green}</style></head>', 'p{color:red}'))
    const order = Array.from(doc.head.querySelectorAll('style, link')).map(el => el.id || el.localName)
    expect(order).toEqual(['before', 'link', 'after'])
  })

  it('resolves assets referenced from style.css and @import of style.css', () => {
    expect(rewriteCss(one('x'), '.b{background:url(assets/banner.gif)}')).toBe(`.b{background:url("${GIF}")}`)
    const css = rewriteCss(site({}, '.x{color:red}'), '@import "style.css";')
    expect(css).toMatch(/^@import url\("data:text\/css;base64,/)
  })

  it('resolves only flat site paths', () => {
    const s = one('x')
    expect(resolveReference(s, 'about.html')).toEqual({ kind: 'page', name: 'about.html', fragment: '' })
    expect(resolveReference(s, 'style.css')).toEqual({ kind: 'css' })
    expect(resolveReference(s, 'assets/banner.gif')).toEqual({ kind: 'asset', name: 'banner.gif' })
    expect(resolveReference(s, 'https://example.com/a.html')).toBeNull()
    expect(resolveReference(s, '//example.com/a.html')).toBeNull()
    expect(resolveReference(s, 'deep/folder/a.html')).toBeNull()
    expect(resolveReference(s, '%zz')).toBeNull()
  })

  it('turns uploaded bytes into data URLs', () => {
    const r = toRenderable({ pages: [{ name: 'index.html', html: 'x' }], css: '' }, [
      { name: 'a.png', mimeType: 'image/png', bytes: PNG_1PX() },
      { name: 'b.gif', mimeType: 'image/gif', bytes: GIF_1PX() },
      { name: 'c.svg', mimeType: 'image/svg+xml', bytes: svg('<script>alert(1)</script>') },
    ])
    expect(r.assets['a.png']).toMatch(/^data:image\/png;base64,iVBOR/)
    expect(r.assets['b.gif']).toBe(GIF)
    // SVG is only ever an image: as an <img>, its script cannot run.
    expect(r.assets['c.svg']).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})

describe('isolation of the rendered document', () => {
  it('never mentions WebTown internals', () => {
    const out = buildSitePage(one('<p>x</p>'), 'index.html', ORIGIN).html
    expect(out).not.toMatch(/__app|event-bus|phaser|localStorage/i)
  })

  it('does not change the source it was given', () => {
    const pages = { 'index.html': '<script>x</script><a href="about.html">a</a>' }
    const copy = JSON.stringify(pages)
    buildSitePage(site(pages), 'index.html', ORIGIN)
    expect(JSON.stringify(pages)).toBe(copy)
  })
})
