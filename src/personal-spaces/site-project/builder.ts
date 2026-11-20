import { validateExternalUrl } from '../website/url-policy'
import { ASSET_FOLDER, STYLESHEET_NAME, type SiteAsset, type SiteProject } from './types'

/**
 * Turns a resident's files into the one document shown in the sandboxed frame.
 *
 * The same function serves the Studio preview and the visitor view, so what
 * the owner sees is what visitors see. It parses with `DOMParser`, which makes
 * an inert document: nothing in it runs or loads. It then removes everything
 * that could run code, reach the network or leave the frame, swaps the site's
 * own files in as `data:` URLs, and adds the resident policy (S-01).
 *
 * The resident's source is never changed; only this rendered copy is.
 */

/** Everything the builder needs, ready to inline. */
export interface RenderableSite {
  pages: Readonly<Record<string, string>>
  css: string
  /** `my-banner.gif` -> `data:image/gif;base64,...` */
  assets: Readonly<Record<string, string>>
}

export interface BuiltPage {
  html: string
  /** The page's `<title>`, as plain text (shown by WebTown as React text). */
  title: string
  /** True for WebTown's "page not found" document. */
  missing: boolean
}

/** The resident policy, verified by S-01. `base-uri 'none'`: no `<base>` (W-3). */
export const RESIDENT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data:; font-src data:; " +
  "media-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; " +
  "manifest-src 'none'; form-action 'none'; base-uri 'none'"

const REMOVE = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe', 'base']
const BLOCKED_RELS = ['preload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch', 'modulepreload', 'manifest',
  'import', 'serviceworker', 'pingback']
const DROP_ATTRS = new Set(['nonce', 'ping', 'target', 'formtarget', 'formaction', 'action', 'srcdoc'])
const RESOURCE_ATTRS = ['src', 'srcset', 'poster', 'background', 'data', 'lowsrc', 'dynsrc', 'xlink:href', 'href']
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// ── Bytes to data URLs ─────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export const assetDataUrl = (asset: Pick<SiteAsset, 'mimeType' | 'bytes'>): string =>
  `data:${asset.mimeType};base64,${toBase64(new Uint8Array(asset.bytes))}`

/** A project and its assets, ready for `buildSitePage`. */
export function toRenderable(project: Pick<SiteProject, 'pages' | 'css'>, assets: readonly Pick<SiteAsset, 'name' | 'mimeType' | 'bytes'>[]): RenderableSite {
  return {
    pages: Object.fromEntries(project.pages.map(p => [p.name, p.html])),
    css: project.css,
    assets: Object.fromEntries(assets.map(a => [a.name, assetDataUrl(a)])),
  }
}

// ── References ─────────────────────────────────────────────────────────────

/** What a reference inside the site points at, if it is one of the site's own files. */
type Target = { kind: 'page'; name: string; fragment: string } | { kind: 'css' } | { kind: 'asset'; name: string }

/** Site paths are flat: pages at the top, images in `assets/`. `./`, `/` and `?query` are ignored. */
export function resolveReference(site: RenderableSite, ref: string): Target | null {
  const trimmed = ref.trim()
  if (trimmed === '' || URL_SCHEME.test(trimmed) || trimmed.startsWith('//')) return null
  const hashAt = trimmed.indexOf('#')
  const fragment = hashAt >= 0 ? trimmed.slice(hashAt) : ''
  let path = (hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed).split('?')[0]!
  try { path = decodeURIComponent(path) } catch { return null }
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const flat = parts.join('/')
  if (flat === '' && path.endsWith('/')) return null
  if (parts.length === 1 && parts[0]!.toLowerCase() === STYLESHEET_NAME) return { kind: 'css' }
  if (parts.length === 2 && parts[0] === ASSET_FOLDER) {
    const name = findKey(site.assets, parts[1]!)
    return name ? { kind: 'asset', name } : null
  }
  if (parts.length === 1 && /\.html?$/i.test(parts[0]!)) return { kind: 'page', name: parts[0]!, fragment }
  return null
}

const findKey = (record: Readonly<Record<string, string>>, name: string): string | null =>
  Object.keys(record).find(key => key.toLowerCase() === name.toLowerCase()) ?? null

/** Which page a request names, ignoring case; null if none. */
export function findPage(site: RenderableSite, name: string): string | null {
  return findKey(site.pages, name)
}

// ── CSS ────────────────────────────────────────────────────────────────────

const cssDataUrl = (css: string): string => `data:text/css;base64,${toBase64(new TextEncoder().encode(css))}`

/** Points `url()` and `@import` at the site's own files; anything else becomes an empty URL. */
export function rewriteCss(site: RenderableSite, css: string, depth = 0): string {
  return css
    .replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/gi, (_m, _q, ref: string, rest: string) => {
      const target = resolveReference(site, ref)
      if (target?.kind === 'css' && depth === 0) return `@import url("${cssDataUrl(rewriteCss(site, site.css, depth + 1))}")${rest};`
      return ''
    })
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _q, ref: string) => {
      if (/^data:(image\/|font\/|text\/css)/i.test(ref.trim())) return match
      const target = resolveReference(site, ref)
      if (target?.kind === 'asset') return `url("${site.assets[target.name]}")`
      return 'url("data:,")'
    })
    .replace(/image-set\(([^)]*)\)/gi, (match, inner: string) =>
      /["']?(https?:|\/\/)/i.test(inner) ? 'none' : match)
}

// ── Pages ──────────────────────────────────────────────────────────────────

const navUrl = (appOrigin: string, params: Record<string, string>): string =>
  `${appOrigin}/site-nav.html#${new URLSearchParams(params).toString()}`

function sanitise(doc: Document, site: RenderableSite, appOrigin: string): void {
  for (const tag of REMOVE) for (const el of Array.from(doc.getElementsByTagName(tag))) el.remove()
  // Without scripts, <noscript> holds what the page means to show. DOMParser runs with scripting off, so its
  // content is already parsed as ordinary elements: unwrap them.
  for (const el of Array.from(doc.getElementsByTagName('noscript'))) el.replaceWith(...Array.from(el.childNodes))
  // A <template shadowrootmode> is left as a template by DOMParser but would be expanded by the frame's own parser,
  // past this sanitiser. Drop the attribute so it stays an inert template, and clean its content anyway.
  for (const tpl of Array.from(doc.getElementsByTagName('template'))) {
    for (const attr of Array.from(tpl.attributes)) if (attr.name.toLowerCase().startsWith('shadowroot')) tpl.removeAttribute(attr.name)
    sanitiseTree((tpl as HTMLTemplateElement).content, doc, site, appOrigin)
  }
  for (const el of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
    const kind = (el.getAttribute('http-equiv') ?? '').toLowerCase()
    if (kind === 'refresh' || kind === 'set-cookie' || kind === 'content-security-policy') el.remove()
  }
  sanitiseTree(doc, doc, site, appOrigin)
}

/** Every element below `root`: attributes, links, resources, styles. */
function sanitiseTree(root: ParentNode, doc: Document, site: RenderableSite, appOrigin: string): void {
  for (const tag of REMOVE) for (const el of Array.from(root.querySelectorAll(tag))) el.remove()
  let stylesheetPlaced = false

  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.localName
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || DROP_ATTRS.has(name)) el.removeAttribute(attr.name)
    }

    if (tag === 'link') {
      const rels = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
      if (rels.some(r => BLOCKED_RELS.includes(r))) { el.remove(); continue }
      const target = resolveReference(site, el.getAttribute('href') ?? '')
      if (rels.includes('stylesheet') && target?.kind === 'css' && !stylesheetPlaced && !doc.querySelector('[data-wt-shared]')) {
        el.setAttribute('href', cssDataUrl(rewriteCss(site, site.css)))
        el.setAttribute('data-wt-shared', '')
        stylesheetPlaced = true
      } else if (rels.includes('icon') && target?.kind === 'asset') {
        el.setAttribute('href', site.assets[target.name]!)
      } else {
        el.remove()
      }
      continue
    }

    if ((tag === 'a' || tag === 'area') && (el.hasAttribute('href') || el.hasAttribute('xlink:href'))) {
      const ref = (el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '').trim()
      el.removeAttribute('xlink:href')
      // A place on this page. The frame's document is about:srcdoc, but a bare #name would resolve against the host
      // page's address (a srcdoc document inherits its parent's base URL) and become a blocked navigation. Written
      // as about:srcdoc#name it is a same-document jump in Chromium and Firefox; WebKit still treats it as a
      // navigation, which is blocked and the page is put back (see docs/site-sandbox-findings.md).
      if (ref.startsWith('#')) { el.setAttribute('href', `about:srcdoc${ref}`); continue }
      const target = resolveReference(site, ref)
      if (target?.kind === 'page') {
        el.setAttribute('href', navUrl(appOrigin, { k: 'page', p: target.name + target.fragment }))
      } else if (target?.kind === 'asset') {
        // A link to an image shows the image in its own page: not supported; keep the text only.
        el.removeAttribute('href')
      } else if (validateExternalUrl(ref).ok) {
        el.setAttribute('href', navUrl(appOrigin, { k: 'external', u: ref }))
      } else {
        el.removeAttribute('href')
        el.setAttribute('aria-disabled', 'true')
      }
      continue
    }

    for (const name of RESOURCE_ATTRS) {
      if (!el.hasAttribute(name) || (name === 'href' && tag !== 'image' && tag !== 'use')) continue
      const value = (el.getAttribute(name) ?? '').trim()
      if (name === 'srcset') {
        const kept = value.split(',').map(part => {
          const bits = part.trim().split(/\s+/)
          const target = resolveReference(site, bits[0] ?? '')
          return target?.kind === 'asset' ? [site.assets[target.name], ...bits.slice(1)].join(' ') : null
        }).filter((x): x is string => x !== null)
        if (kept.length > 0) el.setAttribute(name, kept.join(', '))
        else el.removeAttribute(name)
        continue
      }
      if (/^data:(image|audio|video|font)\//i.test(value)) continue
      const target = resolveReference(site, value)
      if (target?.kind === 'asset') el.setAttribute(name, site.assets[target.name]!)
      else el.removeAttribute(name)
    }

    if (el.hasAttribute('style')) el.setAttribute('style', rewriteCss(site, el.getAttribute('style') ?? ''))
    if (tag === 'style') el.textContent = rewriteCss(site, el.textContent ?? '')
  }
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

function notFound(name: string): BuiltPage {
  return {
    title: 'Page not found',
    missing: true,
    html: '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      RESIDENT_CSP + '"><title>Page not found</title><style>body{font:16px Georgia,serif;margin:40px;color:#222;background:#fffbe8}' +
      'h1{font-size:28px}</style></head><body><h1 id="wt-not-found">Page not found</h1><p>This website has no page called <b>' +
      escapeText(name) + '</b>.</p><p>Use Back or Home in the WebTown Browser to return.</p></body></html>',
  }
}

/** The document for `pageName`, ready for the resident frame. Never throws for any input. */
export function buildSitePage(site: RenderableSite, pageName: string, appOrigin: string): BuiltPage {
  const name = findPage(site, pageName)
  if (name === null) return notFound(pageName)
  const source = site.pages[name]!
  const doc = new DOMParser().parseFromString(source, 'text/html')

  sanitise(doc, site, appOrigin)

  // style.css applies to every page, exactly once: if the page did not link it, add it at the end of <head>.
  if (!doc.querySelector('[data-wt-shared]')) {
    const link = doc.createElement('link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('href', cssDataUrl(rewriteCss(site, site.css)))
    link.setAttribute('data-wt-shared', '')
    doc.head.appendChild(link)
  }
  for (const el of Array.from(doc.querySelectorAll('[data-wt-shared]'))) el.removeAttribute('data-wt-shared')

  // WebTown's policy goes first in <head>, before anything of the resident's.
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', RESIDENT_CSP)
  for (const old of Array.from(doc.head.querySelectorAll('meta[charset]'))) old.remove()
  doc.head.insertBefore(csp, doc.head.firstChild)
  doc.head.insertBefore(charset, csp)

  const title = (doc.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  // Keep the author's doctype, or none (quirks mode), as they wrote it.
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : ''
  // The one place WebTown serialises HTML: an inert, sanitised document, sent only into the sandbox.
  return { html: doctype + doc.documentElement.outerHTML, title, missing: false }
}
