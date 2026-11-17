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
    for (const { path, text } of sources) {
      const body = code(text)
      for (const pattern of forbidden) {
        expect(pattern.test(body), `${path} uses ${String(pattern)}`).toBe(false)
      }
    }
  })

  it('does not ship test-only packages', () => {
    for (const { path, text } of sources) {
      for (const module of importsOf(text)) {
        expect(module, `${path} imports ${module}`).not.toMatch(/fake-indexeddb|vitest|jsdom/)
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
})
