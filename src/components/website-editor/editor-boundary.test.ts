import { describe, expect, it } from 'vitest'
import editorCss from './website-editor.css?raw'

/**
 * Where the power to change a website may live.
 *
 * The editor folder is the only part of the interface that holds a
 * `SiteWriter`. Nothing a visitor is given may import it, and the editor itself
 * may not reach around the writer to storage, ownership or the game. A second
 * renderer is not allowed either: the preview must use the visitor's own.
 *
 * Guards against mistakes in this codebase only. Browser developer tools can
 * still change stored data; real enforcement is server-side (Phase 3b).
 */

const raw = (glob: Record<string, string>): Array<{ path: string; text: string }> =>
  Object.entries(glob).map(([path, text]) => ({ path, text }))

const editorFiles = raw(
  import.meta.glob<string>(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }),
)
const visitorFiles = raw(
  import.meta.glob<string>(['../website/*.{ts,tsx}', '!../website/*.test.{ts,tsx}', '!../website/*.test-support.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)
const everythingElse = raw(
  import.meta.glob<string>(
    ['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/**/*.test-support.ts', '!/src/**/*.contract.ts',
      '!/src/components/website-editor/**', '!/src/components/apps/WebsiteApp.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ),
)

const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const importsOf = (text: string): string[] =>
  [...code(text).matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    m => m[1] ?? m[2]!,
  )

describe('the editor folder', () => {
  it('has the expected files', () => {
    expect(editorFiles.map(f => f.path.replace('./', '')).sort()).toEqual(
      ['ConfirmDialog.tsx', 'OwnerWebsiteWindow.tsx', 'SiteEditor.tsx', 'editor-fields.tsx'].sort(),
    )
  })

  it('is imported by nothing but the website host, and only on demand', () => {
    for (const { path, text } of [...everythingElse, ...visitorFiles]) {
      for (const from of importsOf(text)) {
        expect(from, `${path} imports ${from}`).not.toMatch(/website-editor/)
      }
    }
  })

  it('reaches storage only through the writer it is handed', () => {
    const forbidden = [
      /site-storage/, /\/storage\//, /composition/, /guarded-site-writer/, /access-policy/, /app-bridge/,
      /\/game\//, /phaser/i, /indexeddb/i, /supabase/i, /fake-indexeddb/, /ownership/,
    ]
    for (const { path, text } of editorFiles) {
      for (const from of importsOf(text)) {
        for (const pattern of forbidden) expect(from, `${path} imports ${from}`).not.toMatch(pattern)
      }
      const body = code(text)
      expect(body, path).not.toMatch(/\bindexedDB\b|\blocalStorage\b|\bsessionStorage\b|canEditHouse|siteAccessFor|guardSiteWriter/)
    }
  })

  it('writes in one place: Save, through the writer it was given', () => {
    const saves = editorFiles.flatMap(f => [...code(f.text).matchAll(/\.save\s*\(/g)].map(() => f.path))
    expect(saves).toEqual(['./OwnerWebsiteWindow.tsx'])
    const owner = code(editorFiles.find(f => f.path.endsWith('OwnerWebsiteWindow.tsx'))!.text)
    expect(owner).toMatch(/await writer\.save\(checked\.value\)/)
    // The form and fields have no writer at all.
    for (const { path, text } of editorFiles.filter(f => !f.path.endsWith('OwnerWebsiteWindow.tsx'))) {
      expect(code(text), path).not.toMatch(/\bSiteWriter\b|\bwriter\b/)
    }
  })

  it('uses the visitor’s renderer for the preview and has no renderer of its own', () => {
    const editor = code(editorFiles.find(f => f.path.endsWith('SiteEditor.tsx'))!.text)
    expect(editor).toMatch(/import \{ SiteRenderer \} from '\.\.\/website\/SiteRenderer'/)
    expect(editor).toMatch(/<SiteRenderer site=\{preview\}/)
    for (const { path, text } of editorFiles) {
      const body = code(text)
      // Page content is drawn by SiteRenderer only: no banner, page sections or paragraph splitting here.
      expect(body, path).not.toMatch(/splitParagraphs|className="wt-(banner|title|page|layout|main|footer|paragraph)"/)
    }
  })

  it('takes its rules from the website domain instead of making its own', () => {
    const editor = code(editorFiles.map(f => f.text).join('\n'))
    expect(editor).toMatch(/validateSite/)
    expect(editor).toMatch(/contrastRows/)
    expect(editor).toMatch(/SITE_LIMITS/)
    // No ad-hoc checks of addresses, colours or contrast.
    expect(editor).not.toMatch(/startsWith\(['"]https|new URL\(|relativeLuminance|4\.5\b|maxLength=\{SITE/)
  })

  it('never parses markup or runs code, and opens no tabs', () => {
    for (const { path, text } of editorFiles) {
      const body = code(text)
      for (const pattern of [/dangerouslySetInnerHTML/, /\binnerHTML\b/, /DOMParser/, /\beval\s*\(/, /new\s+Function/, /window\.open/, /_blank/]) {
        expect(pattern.test(body), `${path} matches ${String(pattern)}`).toBe(false)
      }
    }
  })

  it('does not use the browser’s blocking confirm or alert dialogs', () => {
    for (const { path, text } of editorFiles) {
      expect(code(text), path).not.toMatch(/\bwindow\.confirm\b|\bconfirm\(|\balert\(|\bprompt\(/)
    }
  })

  it('says only that changes are saved on this device', () => {
    for (const { path, text } of editorFiles) {
      expect(code(text), path).not.toMatch(/\bpublish|\bshared with\b|\bvisible to (everyone|others|anyone)|\bonline\b|\bsync/i)
    }
  })
})

describe('the editor’s layout', () => {
  it('puts the form and the preview side by side on a wide window', () => {
    expect(editorCss).toMatch(/\.we-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  })

  it('shows one at a time, with a switch, on a narrow window', () => {
    expect(editorCss).toMatch(/@media \(max-width: 1000px\)[\s\S]*\.we-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(editorCss).toMatch(/@media \(max-width: 1000px\)[\s\S]*\.we-panes\s*\{[^}]*display:\s*flex/)
    expect(editorCss).toMatch(/\.we-editor\[data-pane="form"\] \.we-preview/)
  })

  it('scrolls the form and the preview inside the window', () => {
    expect(editorCss).toMatch(/\.we-form\s*\{[^}]*overflow:\s*auto/)
    expect(editorCss).toMatch(/\.we-preview-frame\s*\{[^}]*overflow:\s*auto/)
  })

  it('keeps focus visible and does not show a problem by colour alone', () => {
    expect(editorCss).toMatch(/:focus-visible/)
    expect(editorCss).toMatch(/\.we-error\s*\{/)
    expect(editorCss).not.toMatch(/@keyframes|animation:|transition:/)
  })
})
