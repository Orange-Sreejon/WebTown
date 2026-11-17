import { describe, expect, it } from 'vitest'

/**
 * The website domain must run anywhere: no Phaser, no React, no browser
 * storage, no backend, no game code. It also must not grow a second
 * ownership system; who may edit is decided by the access policy alone.
 *
 * Reads the module sources as text through Vite, so no Node typings are needed.
 */
const files = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const sources = Object.entries(files).map(([path, text]) => ({
  name: path.replace('./', ''),
  text,
}))
/** Source with comments removed, so prose cannot trip the checks. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const imports = (text: string): string[] =>
  [...code(text).matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1]!)

describe('website domain independence', () => {
  it('finds the domain files', () => {
    expect(sources.map(s => s.name)).toEqual(
      expect.arrayContaining([
        'site-types.ts', 'site-validation.ts', 'url-policy.ts', 'contrast.ts',
        'default-site.ts', 'site-repository.ts', 'site-readonly.ts', 'site-text.ts', 'theme-presets.ts',
      ]),
    )
  })

  it('imports only from its own folder', () => {
    for (const { name, text } of sources) {
      for (const path of imports(text)) {
        expect(path.startsWith('./'), `${name} imports ${path}`).toBe(true)
        expect(path, `${name} imports ${path}`).not.toMatch(/\.\.|phaser|react|idb|supabase|game|components/i)
      }
    }
  })

  it('does not touch the DOM, browser storage, the network or a framework', () => {
    const forbidden = [
      'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest',
      'navigator', 'Phaser', 'React', 'createRoot', 'supabase', 'innerHTML', 'dangerouslySetInnerHTML',
      'eval(', 'new Function',
    ]
    for (const { name, text } of sources) {
      const body = code(text)
      for (const word of forbidden) {
        expect(body.includes(word), `${name} mentions ${word}`).toBe(false)
      }
    }
  })

  it('has no ownership logic of its own', () => {
    for (const { name, text } of sources) {
      const body = code(text)
      expect(body, name).not.toMatch(/canEdit|ownership|isOwner|ownedHouse|LOCAL_PLAYER/)
    }
  })

  it('has no writable path in the reader interface', () => {
    const repo = code(sources.find(s => s.name === 'site-repository.ts')!.text)
    const reader = repo.slice(repo.indexOf('interface SiteReader'), repo.indexOf('interface SiteWriter'))
    expect(reader).toContain('load(')
    expect(reader).not.toMatch(/save|delete|remove|update|write|put/i)
  })
})
