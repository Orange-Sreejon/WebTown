import { describe, expect, it } from 'vitest'

/**
 * The Sketchbook a visitor gets must be unable to change drawings. These tests
 * read the source of the visitor's files and of the host that picks between
 * owner and visitor. Client-side only: developer tools can still bypass it.
 */
const sources = import.meta.glob<string>(
  ['./SketchbookViewer.tsx', './PaintDialogs.tsx', './export.ts', '../apps/PaintApp.tsx', '../../personal-spaces/paint/*.ts', '!../../personal-spaces/paint/*.test.ts'],
  { query: '?raw', import: 'default', eager: true },
)
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const file = (name: string): string => code(Object.entries(sources).find(([path]) => path.endsWith(name))![1])
const importsOf = (text: string): string[] => [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]!)

describe('the Sketchbook boundary', () => {
  it("gives the visitor's viewer a reader only", () => {
    for (const name of ['SketchbookViewer.tsx', 'PaintDialogs.tsx', 'export.ts']) {
      const body = file(name)
      expect(body, name).not.toMatch(/\bArtworkWriter\b|\bwriter\b|\.save\s*\(|\.delete\s*\(|guardArtworkWriter|paintAccessFor/)
      for (const from of importsOf(body)) {
        expect(from, `${name} imports ${from}`).not.toMatch(/OwnerPaintWindow|useSketchbook|personal-spaces\/storage\/|composition|indexeddb|memory-artwork|guarded/i)
      }
    }
  })

  it('loads the owner window only on demand, and only in the owner branch', () => {
    const body = file('PaintApp.tsx')
    expect(body).toMatch(/lazy\(\(\) => import\('\.\.\/paint\/OwnerPaintWindow'\)/)
    expect(body).not.toMatch(/^import [^\n]*from '[^']*OwnerPaintWindow'/m)
    const ownerBranch = body.slice(body.indexOf("if (access.mode === 'owner')"), body.indexOf('<SketchbookViewer'))
    expect(ownerBranch).toContain('<OwnerPaintWindow access={access}')
    const visitor = body.slice(body.indexOf('<SketchbookViewer'), body.indexOf('/>', body.indexOf('<SketchbookViewer')))
    expect(visitor).toContain('reader={access.reader}')
    expect(visitor).not.toMatch(/writer|access=\{access\}/)
    expect(body).toMatch(/paintAccessFor\(\{ houseId, mode \}, storage\)/)
  })

  it('keeps the drawing engine free of the DOM, React, storage and the game', () => {
    for (const [path, text] of Object.entries(sources).filter(([p]) => p.includes('/paint/') && p.endsWith('.ts') && p.includes('personal-spaces'))) {
      const body = code(text)
      for (const from of importsOf(body)) expect(from.startsWith('./'), `${path} imports ${from}`).toBe(true)
      expect(body, path).not.toMatch(/\bdocument\.|\bwindow\.|getContext|indexedDB|phaser/i)
    }
  })
})
