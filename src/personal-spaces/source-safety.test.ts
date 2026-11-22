import { describe, expect, it } from 'vitest'

/**
 * Guards the rules in `.kiro/steering/security.md` that cannot be seen from a
 * single unit test: nothing in the shipped source may interpret user text as
 * markup or code, and test-only packages must stay out of the shipped bundle.
 *
 * Reads every non-test source file as text through Vite, so no Node typings are needed.
 */
const files = import.meta.glob<string>(
  [
    '/src/**/*.{ts,tsx}',
    '!/src/**/*.test.{ts,tsx}',
    '!/src/**/*.test-support.ts',
    '!/src/**/*.contract.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
)

const sources = Object.entries(files).map(([path, text]) => ({ path, text }))

/** Source with comments removed, so prose cannot trip the checks. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const importsOf = (text: string): string[] =>
  [...code(text).matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)].map(
    m => m[1] ?? m[2]!,
  )

describe('shipped source', () => {
  it('finds the source files', () => {
    expect(sources.length).toBeGreaterThan(40)
    expect(sources.some(s => s.path.endsWith('/personal-spaces/composition.ts'))).toBe(true)
  })

  it('never turns text into markup or code', () => {
    const forbidden = [
      /dangerouslySetInnerHTML/,
      /\.innerHTML\b/,
      /\.outerHTML\b/,
      /insertAdjacentHTML/,
      /document\.write/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /createContextualFragment/,
    ]
    // The single allowed serialiser: the website builder turns an inert, sanitised
    // DOMParser document back into text, which only ever goes into the sandboxed frame.
    const serialiser = /\.outerHTML\b/
    const serialiserHome = '/src/personal-spaces/site-project/builder.ts'
    for (const { path, text } of sources) {
      const body = code(text)
      for (const pattern of forbidden) {
        if (pattern === forbidden[2] && path === serialiserHome) {
          expect(body.match(new RegExp(serialiser.source, 'g'))?.length, `${path} serialises once`).toBe(1)
          continue
        }
        expect(pattern.test(body), `${path} uses ${String(pattern)}`).toBe(false)
      }
    }
  })

  it('does not ship test-only packages', () => {
    for (const { path, text } of sources) {
      for (const module of importsOf(text)) {
        expect(module, `${path} imports ${module}`).not.toMatch(/fake-indexeddb|vitest|jsdom|pglite/)
      }
    }
  })

  it('keeps Personal Spaces free of Phaser and game code', () => {
    for (const { path, text } of sources.filter(s => s.path.includes('/personal-spaces/'))) {
      for (const module of importsOf(text)) {
        expect(module, `${path} imports ${module}`).not.toMatch(/phaser|\/game\//)
      }
    }
  })

  it('keeps the game free of storage code', () => {
    for (const { path, text } of sources.filter(s => s.path.includes('/src/game/'))) {
      for (const module of importsOf(text)) {
        expect(module, `${path} imports ${module}`).not.toMatch(/personal-spaces\/(storage|site-storage|composition)/)
      }
    }
  })

  it('opens external links only with noopener and noreferrer', () => {
    for (const { path, text } of sources) {
      const body = code(text)
      if (!/target\s*=\s*["']_blank["']|target:\s*["']_blank["']/.test(body)) continue
      expect(body, `${path} opens a new tab`).toMatch(/noopener/)
      expect(body, `${path} opens a new tab`).toMatch(/noreferrer/)
    }
  })

  it('does not use browser storage other than through the storage layer', () => {
    for (const { path, text } of sources) {
      if (path.includes('/personal-spaces/storage/')) continue
      const body = code(text)
      expect(/\blocalStorage\b|\bsessionStorage\b/.test(body), `${path} uses web storage`).toBe(false)
      if (!path.includes('/personal-spaces/composition.ts')) {
        expect(/\bindexedDB\b/.test(body), `${path} touches indexedDB`).toBe(false)
      }
    }
  })
  it('talks to Supabase from one module only, and holds no secret key', () => {
    const users = sources.filter(s => importsOf(s.text).some(m => /^@supabase\//.test(m))).map(s => s.path)
    expect(users).toEqual(['/src/cloud/supabase-backend.ts'])
    for (const { path, text } of sources) {
      const body = code(text)
      expect(body, path).not.toMatch(/sb_secret_[A-Za-z0-9]|SUPABASE_SERVICE_ROLE|service_role_key|serviceRoleKey/i)
      expect(body, path).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./) // no JWT-shaped keys in code
    }
  })

  it('imports the code editor in one file only, inside the owner-only Studio', () => {
    const users = sources.filter(s => importsOf(s.text).some(m => /^(codemirror|@codemirror\/)/.test(m))).map(s => s.path)
    expect(users).toEqual(['/src/components/website-studio/CodeEditor.tsx'])
  })

  it('sandboxes every frame with exactly allow-scripts, and never allow-same-origin', () => {
    for (const { path, text } of sources) {
      const body = code(text)
      expect(body, path).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/)
      for (const m of body.matchAll(/sandbox(?:=|\s*:\s*|',\s*)["']([^"']*)["']/g)) expect(m[1], path).toBe('allow-scripts')
    }
  })
})

const hostPages = import.meta.glob<string>(['/public/site-host.html', '/public/site-nav.html'], { query: '?raw', import: 'default', eager: true })

describe('the static sandbox pages', () => {
  const host = hostPages['/public/site-host.html']!
  const nav = hostPages['/public/site-nav.html']!

  it('exist', () => {
    expect(host).toContain('<script nonce="wtHost1">')
    expect(nav).toContain('<script nonce="wtNav1">')
  })

  it('allow no network, no plugins, no forms and no base, and scripts only by nonce', () => {
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/
    const hostPolicy = host.match(policy)![1]!
    for (const rule of ["default-src 'none'", "script-src 'nonce-wtHost1'", "connect-src 'none'", "object-src 'none'",
      "worker-src 'none'", "form-action 'none'", "base-uri 'none'", 'img-src data:', "child-src 'none'"]) {
      expect(hostPolicy).toContain(rule)
    }
    expect(hostPolicy).not.toMatch(/unsafe-eval|'unsafe-inline' *;? *script|https?:|\*/)
    const navPolicy = nav.match(policy)![1]!
    expect(navPolicy).toContain("default-src 'none'")
    expect(navPolicy).toContain("script-src 'nonce-wtNav1'")
  })

  it('creates the resident frame with exactly allow-scripts and narrows framing to the navigation page', () => {
    expect(host).toContain("frame.setAttribute('sandbox', 'allow-scripts')")
    expect(host).not.toMatch(/allow-same-origin/)
    expect(host).toContain("narrow.content = 'frame-src ' + navPage.href")
    expect(host).toMatch(/event\.source === window\.parent/)
    expect(host).toMatch(/event\.source === frame\.contentWindow/)
  })
})
