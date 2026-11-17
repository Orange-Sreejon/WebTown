import { describe, expect, it } from 'vitest'
import css from './website.css?raw'
import frame from '../apps/WindowFrame.tsx?raw'

/**
 * The website window is what a visitor is given, so it must be provably unable
 * to change a website: it may only import what is needed to read and show one.
 * These tests read the source of every file in `components/website/` (and the
 * host that feeds it) and fail if that stops being true.
 *
 * This guards against mistakes in this codebase. It is not authorisation:
 * anyone with browser developer tools can still change stored data, which is
 * why real enforcement will be server-side in Phase 3b.
 */

const windowFiles = import.meta.glob<string>(
  ['./*.{ts,tsx}', '!./*.test.{ts,tsx}', '!./*.test-support.ts'],
  { query: '?raw', import: 'default', eager: true },
)
const hostFiles = import.meta.glob<string>(['../apps/WebsiteApp.tsx', '../apps/AppHost.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const files = Object.entries(windowFiles).map(([path, text]) => ({ path: path.replace('./', ''), text }))

const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Every `import ... from 'x'`, with the names it brings in. */
function importsOf(text: string): Array<{ from: string; names: string[] }> {
  return [...code(text).matchAll(/import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?(?:\s*\*\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g)].map(m => ({
    from: m[5]!,
    names: [m[2], m[4], ...(m[3] ?? '').split(',').map(n => n.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0]!.trim())].filter(
      (n): n is string => !!n,
    ),
  }))
}
const sideEffectImports = (text: string): string[] =>
  [...code(text).matchAll(/import\s+['"]([^'"]+)['"]/g)].map(m => m[1]!)

describe('the website window', () => {
  it('finds its files', () => {
    expect(files.map(f => f.path).sort()).toEqual(
      expect.arrayContaining(['ExternalLink.tsx', 'SiteRenderer.tsx', 'SiteWindow.tsx', 'site-theme.ts']),
    )
  })

  it('imports only from React, the website domain, and a few shared read-only modules', () => {
    const allowed = [
      /^react$/,
      /^\.\//, // its own files
      /^\.\.\/apps\/WindowFrame$/,
      /^\.\.\/\.\.\/personal-spaces\/website\/(contrast|site-format|site-navigation|site-repository|site-text|site-types|theme-presets|url-policy)$/,
      /^\.\.\/\.\.\/personal-spaces\/(errors|labels)$/,
    ]
    for (const { path, text } of files) {
      for (const { from } of importsOf(text)) {
        expect(allowed.some(pattern => pattern.test(from)), `${path} imports ${from}`).toBe(true)
      }
      for (const from of sideEffectImports(text)) expect(from, path).toMatch(/\.css$/)
    }
  })

  it('imports nothing that stores, writes, decides ownership or touches the game', () => {
    const forbidden = [
      /site-storage/, /\/storage\//, /composition/, /guarded-site-writer/, /access-policy/,
      /\/game\//, /phaser/i, /paint/i, /artwork/i, /gallery/i, /app-bridge/, /ownership/,
      /fake-indexeddb/, /indexeddb/i, /supabase/i,
    ]
    for (const { path, text } of files) {
      for (const { from } of importsOf(text)) {
        for (const pattern of forbidden) expect(from, `${path} imports ${from}`).not.toMatch(pattern)
      }
    }
  })

  it('takes from the repository contract only the reader', () => {
    for (const { path, text } of files) {
      for (const { from, names } of importsOf(text)) {
        if (!/site-repository$/.test(from)) continue
        expect(names, `${path} imports from ${from}`).toEqual(['SiteReader'])
      }
    }
  })

  it('never names a writer, a repository, or anything that saves', () => {
    const forbidden = [
      /\bSiteWriter\b/, /\bSiteRepository\b/, /\bguardSiteWriter\b/, /\bsiteAccessFor\b/, /\bOwnerSiteAccess\b/,
      /\bwriter\b/i, /\.save\s*\(/, /\.put\s*\(/, /\.delete\s*\(/, /\bindexedDB\b/, /\blocalStorage\b/,
      /canEditHouse/, /\bisOwner\b.*\bsave/,
    ]
    for (const { path, text } of files) {
      const body = code(text)
      for (const pattern of forbidden) expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
    }
  })

  it('does not reach into Phaser, the page address or the browser history', () => {
    const forbidden = [/\bwindow\.location\b/, /\blocation\.(href|hash|assign|replace)\b/, /\bhistory\.(push|replace)State\b/, /\bwindow\.open\b/, /\bPhaser\b/]
    for (const { path, text } of files) {
      const body = code(text)
      for (const pattern of forbidden) expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
    }
  })

  it('does not parse or inject markup, or run code', () => {
    const forbidden = [/dangerouslySetInnerHTML/, /\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /DOMParser/, /\beval\s*\(/, /new\s+Function/, /document\.write/]
    for (const { path, text } of files) {
      const body = code(text)
      for (const pattern of forbidden) expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
    }
  })

  it('opens a new tab only with noopener and noreferrer', () => {
    const withBlank = files.filter(f => /_blank/.test(code(f.text)))
    expect(withBlank.map(f => f.path)).toEqual(['ExternalLink.tsx'])
    expect(code(withBlank[0]!.text)).toMatch(/rel="noopener noreferrer"/)
  })

  it('is independent of the drawing application and the artworks', () => {
    for (const { path, text } of files) {
      expect(code(text), path).not.toMatch(/paint|artwork|gallery|sketchbook/i)
    }
  })
})

describe('the host that feeds the website window', () => {
  const host = Object.entries(hostFiles).map(([path, text]) => ({ path, text }))

  it('hands the window the reader and nothing else, in either mode', () => {
    const website = host.find(f => f.path.endsWith('WebsiteApp.tsx'))!
    const body = code(website.text)
    expect(body).toMatch(/reader=\{reader\}/)
    expect(body).not.toMatch(/\.writer\b/) // the editor (a separate task) will be the first to use it
    expect(body).not.toMatch(/writer=/)
    const props = body.slice(body.indexOf('<SiteWindow'), body.indexOf('/>', body.indexOf('<SiteWindow')))
    expect(props).not.toMatch(/save|writer|repository|storage=/i)
  })

  it('takes the player’s mode from the app bridge and nowhere else', () => {
    const body = code(host.map(f => f.text).join('\n'))
    expect(body).not.toMatch(/canEditHouse|LOCAL_PLAYER_HOUSE_ID|resolveOwnedHouseId|ownership/)
    expect(body).toMatch(/siteAccessFor\(\{ houseId, mode \}/)
  })
})

describe('the window’s layout', () => {
  it('fits any screen: sized from the viewport, never a fixed pixel size', () => {
    expect(frame).toContain("width: 'min(1040px, 96vw)'")
    expect(frame).toContain("height: 'min(720px, 92vh)'")
    expect(frame).toContain("maxHeight: '92vh'")
  })

  it('scrolls the page inside the window instead of growing it', () => {
    expect(css).toMatch(/\.wt-viewport\s*\{[^}]*overflow:\s*auto/)
    expect(css).toMatch(/\.wt-viewport\s*\{[^}]*min-height:\s*0/)
    expect(css).toMatch(/\.wt-window\s*\{[^}]*height:\s*100%/)
  })

  it('stacks the navigation above the page on a narrow window', () => {
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*\.wt-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('lets long words and addresses wrap instead of pushing the page wider', () => {
    expect(css).toMatch(/\.wt-title\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.wt-paragraph\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.wt-layout\s*\{[^}]*minmax\(0, 1fr\)/)
  })

  it('keeps focus visible, and has no animation to suppress', () => {
    expect(css).toMatch(/:focus-visible/)
    expect(css).not.toMatch(/@keyframes|animation:|transition:/)
  })

  it('sets no page style from content: colours and font arrive only as custom properties', () => {
    for (const name of ['--site-bg', '--site-text', '--site-link', '--site-header-bg', '--site-header-text', '--site-font']) {
      expect(css).toContain(`var(${name})`)
    }
    expect(css).not.toMatch(/url\(\s*['"]?https?:/)
  })
})
