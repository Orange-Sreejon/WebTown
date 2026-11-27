import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStudioThemeMemory } from '../../personal-spaces/studio-preferences'
import { startStudio } from '../../personal-spaces/site-project/studio-state'
import { blankProject } from '../../personal-spaces/site-project/templates'
import type { SiteProject, SiteSave } from '../../personal-spaces/site-project/types'
import { PlainEditor } from './plain-editor.test-support'
import { SiteStudio } from './SiteStudio'
import { houseTarget } from '../../personal-spaces/site-project/site-target'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = '2026-11-16T00:00:00.000Z'
const SITE_CSS = 'body { background: #ffeecc; color: #331100 }'
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory() as unknown as IDBFactory
  resetStudioThemeMemory()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  resetStudioThemeMemory()
  delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
  vi.restoreAllMocks()
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const button = (name: string): HTMLButtonElement => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent?.trim() === name || x.getAttribute('aria-label') === name)
  if (!b) throw new Error(`no button ${name}`)
  return b
}
const studio = (): HTMLElement => container.querySelector('.ws-studio')!
const editor = (): HTMLTextAreaElement => container.querySelector('textarea')!

function mount(save = vi.fn(async (s: SiteSave): Promise<SiteProject> => ({ ...s.project, revision: s.baseRevision + 1 }))) {
  const project = { ...blankProject('house-a', NOW), css: SITE_CSS, revision: 1 }
  act(() =>
    root.render(
      <SiteStudio
        target={houseTarget('house-a')}
        initial={startStudio({ project, assets: [] }, { stored: true })}
        writer={{ save }}
        reload={async () => ({ kind: 'none' })}
        persistent
        onExit={vi.fn()}
        onClose={vi.fn()}
        Editor={PlainEditor}
        now={() => NOW}
      />,
    ),
  )
  return save
}

/** The page the preview frame was told to show (what the sandbox receives). */
async function shownHtml(): Promise<string> {
  const frame = container.querySelector('iframe')!
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: { t: 'ready' }, origin: 'null', source: frame.contentWindow })) })
  act(() => button('Refresh').click())
  const html = (posted.mock.calls[posted.mock.calls.length - 1][0] as { html: string }).html
  posted.mockRestore()
  return html
}

describe('dark mode in the Studio', () => {
  it('switches the Studio and its editor between light and dark', async () => {
    mount()
    await settle()
    expect(studio().dataset['theme']).toBe('light')
    expect(button('Dark mode').getAttribute('aria-pressed')).toBe('false')
    act(() => button('Dark mode').click())
    expect(studio().classList.contains('ws-studio--dark')).toBe(true)
    expect(studio().dataset['theme']).toBe('dark')
    expect(editor().dataset['theme']).toBe('dark')
    expect(button('Dark mode').getAttribute('aria-pressed')).toBe('true')
    // The window around it too.
    expect((container.querySelector('[role="dialog"]') as HTMLElement).style.background).toBe('rgb(30, 31, 36)')
    act(() => button('Dark mode').click())
    expect(studio().dataset['theme']).toBe('light')
    expect(editor().dataset['theme']).toBe('light')
  })

  it('remembers the choice on this device for the next time the Studio opens', async () => {
    mount()
    await settle()
    act(() => button('Dark mode').click())
    await settle()
    act(() => root.unmount())
    resetStudioThemeMemory() // as after a reload: only what was saved is left
    root = createRoot(container)
    mount()
    await settle()
    expect(studio().dataset['theme']).toBe('dark')
  })

  it("never changes the website: the page sent to the preview and what is saved are identical in both themes", async () => {
    const save = mount()
    await settle()
    const light = await shownHtml()
    act(() => button('Dark mode').click())
    const dark = await shownHtml()
    expect(dark).toBe(light)
    expect(dark).toContain(`data:text/css;base64,${btoa(SITE_CSS)}`) // the site's own style.css, exactly
    expect(dark).not.toMatch(/color-scheme|ws-studio|#1e1f24|oneDark/)

    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor(), '<p>x</p>'); editor().dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => button('Save').click())
    await settle()
    const saved = (save.mock.calls[0]![0] as SiteSave).project
    expect(saved.css).toBe(SITE_CSS)
    expect(saved.pages[0]!.html).toBe('<p>x</p>')
  })

  it('starts from the device setting when nothing was chosen', async () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      mount()
      await settle()
      expect(studio().dataset['theme']).toBe('dark')
    } finally {
      window.matchMedia = original
    }
  })
})

describe('Format button', () => {
  it('formats the file in the editor', async () => {
    mount()
    await settle()
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor(), '<p>x</p>   '); editor().dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => button('Format').click())
    expect(editor().value).toBe('<p>x</p>')
  })

  it('is unavailable when no editor is showing', async () => {
    mount()
    await settle()
    act(() => button('Preview').click())
    expect(button('Format').disabled).toBe(true)
  })
})
