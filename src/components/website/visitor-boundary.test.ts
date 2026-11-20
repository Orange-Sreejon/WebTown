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
function importsOf(text: string): Array<{ from: string; names: string[]; typeOnly: boolean }> {
  return [...code(text).matchAll(/import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?(?:\s*\*\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g)].map(m => ({
    from: m[5]!,
    typeOnly: m[1] !== undefined,
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
      expect.arrayContaining(['HouseWebsite.tsx', 'SiteFrame.tsx', 'SiteViewer.tsx', 'site-urls.ts', 'useWebsiteState.ts']),
    )
  })

  it('imports only from React, the read-only website domain, and a few shared modules', () => {
    const allowed = [
      /^react$/,
      /^\.\//, // its own files
      /^\.\.\/\.\.\/personal-spaces\/site-project\/(builder|page-history|host-protocol|types)$/,
      /^\.\.\/\.\.\/personal-spaces\/website\/url-policy$/,
      /^\.\.\/\.\.\/personal-spaces\/(errors|labels)$/,
    ]
    for (const { path, text } of files) {
      for (const { from, typeOnly } of importsOf(text)) {
        // The description of what a website state is, and nothing else from storage.
        if (typeOnly && /^\.\.\/\.\.\/personal-spaces\/site-project-storage\/resolve-website$/.test(from)) continue
        expect(allowed.some(pattern => pattern.test(from)), `${path} imports ${from}`).toBe(true)
      }
      for (const from of sideEffectImports(text)) expect(from, path).toMatch(/\.css$/)
    }
  })

  it('imports nothing that stores, writes, edits, decides ownership or touches the game', () => {
    const forbidden = [
      /site-storage/, /\/storage\//, /composition/, /guarded/, /access-policy/, /project-repository/, /studio-state/,
      /website-studio/, /codemirror/, /\/game\//, /phaser/i, /paint/i, /artwork/i, /app-bridge/, /ownership/,
      /fake-indexeddb/, /indexeddb/i, /supabase/i, /templates/,
    ]
    for (const { path, text } of files) {
      for (const { from } of importsOf(text)) {
        for (const pattern of forbidden) expect(from, `${path} imports ${from}`).not.toMatch(pattern)
      }
    }
  })

  it('never names a writer, a repository, or anything that saves', () => {
    const forbidden = [
      /\bSiteProjectWriter\b/, /\bSiteProjectRepository\b/, /\bguardProjectWriter\b/, /\bwebsiteAccessFor\b/,
      /\bOwnerWebsiteAccess\b/, /\bwriter\b/i, /\.save\s*\(/, /\.put\s*\(/, /\.delete\s*\(/, /\bindexedDB\b/,
      /\blocalStorage\b/, /canEditHouse/,
    ]
    for (const { path, text } of files) {
      const body = code(text)
      for (const pattern of forbidden) expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
    }
  })

  it('does not reach into Phaser, the page address or the browser history', () => {
    const forbidden = [/\blocation\.(hash|assign|replace)\b/, /\bhistory\.(push|replace)State\b/, /\bPhaser\b/, /location\.href\s*=/]
    for (const { path, text } of files) {
      const body = code(text)
      for (const pattern of forbidden) expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
    }
  })

  it('does not parse or inject markup, or run code', () => {
    const forbidden = [/dangerouslySetInnerHTML/, /\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /DOMParser/, /\beval\s*\(/, /new\s+Function/, /document\.write/, /\bsrcDoc\b/, /srcdoc/]
    for (const { path, text } of files) {
      const body = code(text)
      for (const pattern of forbidden) expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
    }
  })

  it('opens a new tab in one place only, after asking, with noopener and noreferrer', () => {
    const opening = files.filter(f => /window\.open|_blank/.test(code(f.text)))
    expect(opening.map(f => f.path)).toEqual(['SiteFrame.tsx'])
    expect(code(opening[0]!.text)).toMatch(/window\.open\(target\.href, '_blank', 'noopener,noreferrer'\)/)
  })

  it('sandboxes the frame with scripts for WebTown’s host page only, and nothing else', () => {
    const siteFrame = code(files.find(f => f.path === 'SiteFrame.tsx')!.text)
    expect(siteFrame.match(/sandbox=/g)).toHaveLength(1)
    expect(siteFrame).toContain('sandbox="allow-scripts"')
    expect(siteFrame).toMatch(/isFromHost\(event, frameRef\.current\?\.contentWindow/)
  })
})

describe('the host that feeds the website window', () => {
  const host = Object.entries(hostFiles).map(([path, text]) => ({ path, text }))
  const website = (): string => code(host.find(f => f.path.endsWith('WebsiteApp.tsx'))!.text)

  it('hands the owner access (with its writer) only in the branch where the bridge said owner', () => {
    const body = website()
    expect(body.match(/<OwnerWebsiteWindow/g)).toHaveLength(1)
    const ownerBranch = body.slice(body.indexOf("if (access.mode === 'owner')"), body.indexOf('<VisitorWebsiteWindow houseId'))
    expect(ownerBranch).toContain('<OwnerWebsiteWindow access={access}')
    // The visitor's window gets the read function and nothing that can write.
    const visitor = body.slice(body.lastIndexOf('<VisitorWebsiteWindow'), body.indexOf('/>', body.lastIndexOf('<VisitorWebsiteWindow')))
    expect(visitor).toMatch(/open=\{access\.open\}/)
    expect(visitor).not.toMatch(/writer|save|repository|storage=|access=/i)
  })

  it('loads the Studio only on demand, so a visitor never downloads it or the code editor', () => {
    const body = website()
    expect(body).toMatch(/lazy\(\(\) =>\s*import\('\.\.\/website-studio\/OwnerWebsiteWindow'\)/)
    expect(body).not.toMatch(/^\s*import[^;]*from\s+'\.\.\/website-studio\//m)
    expect(body).not.toMatch(/codemirror/)
  })

  it('takes the player’s mode from the app bridge and nowhere else', () => {
    const body = code(host.map(f => f.text).join('\n'))
    expect(body).not.toMatch(/canEditHouse|LOCAL_PLAYER_HOUSE_ID|resolveOwnedHouseId|ownership/)
    expect(body).toMatch(/websiteAccessFor\(\{ houseId, mode \}, storage\)/)
  })
})

describe('the window’s layout', () => {
  it('fits any screen: sized from the viewport, never a fixed pixel size', () => {
    expect(frame).toContain("width: 'min(1040px, 96vw)'")
    expect(frame).toContain("height: 'min(720px, 92vh)'")
    expect(frame).toContain("maxHeight: '92vh'")
  })

  it('gives the page all the room the window has, and scrolls inside it', () => {
    expect(css).toMatch(/\.wt-viewport\s*\{[^}]*overflow:\s*auto/)
    expect(css).toMatch(/\.wt-viewport\s*\{[^}]*min-height:\s*0/)
    expect(css).toMatch(/\.wt-window\s*\{[^}]*height:\s*100%/)
    expect(css).toMatch(/\.wt-frame-host\s*\{[^}]*flex:\s*1 1 auto/)
  })

  it('keeps focus visible, and has no animation to suppress', () => {
    expect(css).toMatch(/:focus-visible/)
    expect(css).not.toMatch(/@keyframes|animation:|transition:/)
  })

  it('styles only WebTown’s chrome, never fetching anything', () => {
    expect(css).not.toMatch(/url\(/)
  })
})
