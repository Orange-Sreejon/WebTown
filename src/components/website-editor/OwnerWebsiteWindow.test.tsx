import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionError, QuotaError, StorageError, ValidationError } from '../../personal-spaces/errors'
import { EDITOR_LOCAL_NOTICE, NOT_SAVED_NOTICE, SAVED_LOCAL_NOTICE, SAVED_MEMORY_NOTICE } from '../../personal-spaces/labels'
import { MemorySiteRepository } from '../../personal-spaces/site-storage/memory-site-repository'
import { createDefaultSite } from '../../personal-spaces/website/default-site'
import type { SiteReader, SiteWriter } from '../../personal-spaces/website/site-repository'
import { SITE_LIMITS, type SiteContent } from '../../personal-spaces/website/site-types'
import { THEME_PRESETS } from '../../personal-spaces/website/theme-presets'
import { SiteRenderer } from '../website/SiteRenderer'
import { OwnerWebsiteWindow } from './OwnerWebsiteWindow'
import { fieldId } from './editor-fields'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STAMP = '2026-11-16T00:00:00.000Z'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  delete (window as unknown as { __xss?: number }).__xss
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

interface Setup {
  repository: MemorySiteRepository
  reader: SiteReader
  writer: SiteWriter
  onClose: ReturnType<typeof vi.fn>
}

/** Opens the owner's window over a fresh in-memory repository (same rules as IndexedDB). */
async function open(options: { seed?: SiteContent; writer?: SiteWriter; persistent?: boolean } = {}): Promise<Setup> {
  const repository = new MemorySiteRepository({ now: () => '2026-11-16T12:00:00.000Z' })
  if (options.seed) await repository.save(options.seed)
  const reader: SiteReader = { load: id => repository.load(id) }
  const writer: SiteWriter = options.writer ?? { save: site => repository.save(site) }
  const onClose = vi.fn()
  act(() => {
    root.render(
      <OwnerWebsiteWindow
        houseId="house-a"
        reader={reader}
        writer={writer}
        persistent={options.persistent ?? true}
        recovery={null}
        onClose={onClose}
      />,
    )
  })
  await settle()
  return { repository, reader, writer, onClose }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const q = <T extends Element>(selector: string, scope: ParentNode = container): T => {
  const found = scope.querySelector<T>(selector)
  if (!found) throw new Error(`nothing matches ${selector}`)
  return found
}
const has = (selector: string): boolean => container.querySelector(selector) !== null
const button = (name: string | RegExp, scope: ParentNode = container): HTMLButtonElement => {
  const found = [...scope.querySelectorAll('button')].find(b => {
    const text = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim()
    return typeof name === 'string' ? text === name : name.test(text)
  })
  if (!found) throw new Error(`no button "${String(name)}"`)
  return found
}
const click = (el: HTMLElement): void => act(() => el.click())
const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement = HTMLInputElement>(path: string): T =>
  q<T>(`#${fieldId(path)}`)

/** Types into a field the way React sees it: the native setter, then an input event. */
function type(path: string, value: string): void {
  const element = field(path)
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function choose(path: string, value: string): void {
  const element = field<HTMLSelectElement>(path)
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
function leave(path: string): void {
  act(() => field(path).dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}
function tick(path: string): void {
  click(field(path) as HTMLInputElement)
}

const startEditing = async (): Promise<void> => {
  click(button('Edit this website'))
  await settle()
}
const save = async (): Promise<void> => {
  click(button('Save'))
  await settle()
}
const preview = (): HTMLElement => q('.we-preview-frame')
const errorOf = (path: string): string | null => container.querySelector(`#${fieldId(path)}-error`)?.textContent ?? null

// ── Starting and ending an edit ────────────────────────────────────────────

describe('opening the editor', () => {
  it('starts as the normal website, with an Edit button for the owner', async () => {
    await open()
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(has('.we-editor')).toBe(false)
    expect(button('Edit this website').disabled).toBe(false)
  })

  it('opens the editor with the current website filled in', async () => {
    await open({ seed: { ...createDefaultSite('house-a', STAMP), title: 'Saved title' } })
    await startEditing()
    expect(has('.we-editor')).toBe(true)
    expect(field('title').value).toBe('Saved title')
    expect(field('profile.displayName').value).toBe('House A')
    expect(q('[role="dialog"] [id]').textContent).toBe('WebTown Browser - Editing')
  })

  it('puts focus on the editor heading', async () => {
    await open()
    await startEditing()
    expect(document.activeElement).toBe(q('.we-title'))
  })

  it('says, plainly, that changes stay on this device', async () => {
    await open()
    await startEditing()
    expect(q('.we-local').textContent).toBe(EDITOR_LOCAL_NOTICE)
    expect(EDITOR_LOCAL_NOTICE).toContain('this device only')
    expect(container.textContent).not.toMatch(/\bpublish|\bpublic(ly)?\b|\bonline\b|visible to (everyone|others|anyone)/i)
  })

  it('starts with nothing to save', async () => {
    await open()
    await startEditing()
    expect(button('Save').disabled).toBe(true)
    expect(q('.we-state').textContent).toBe('No changes yet.')
  })
})

// ── Editing each field ─────────────────────────────────────────────────────

describe('editing every field', () => {
  it('saves every text field', async () => {
    const { repository } = await open()
    await startEditing()

    type('title', 'My New Page')
    type('profile.displayName', 'Ada')
    type('profile.tagline', 'Pixels and patience')
    type('home.welcome', 'Hello there.\n\nSecond paragraph.')
    type('about.body', 'About Ada.')
    await save()

    const saved = await repository.load('house-a')
    expect(saved.title).toBe('My New Page')
    expect(saved.profile).toEqual({ displayName: 'Ada', tagline: 'Pixels and patience' })
    expect(saved.home.welcome).toBe('Hello there.\n\nSecond paragraph.')
    expect(saved.about.body).toBe('About Ada.')
  })

  it('edits, adds, moves and removes projects', async () => {
    const { repository } = await open()
    await startEditing()

    type('projects[0].title', 'First, renamed')
    type('projects[0].description', 'Now with a description')
    type('projects[1].url', 'https://example.org/sketches')

    click(button('Add a project'))
    expect(document.activeElement).toBe(field('projects[3].title'))
    type('projects[3].title', 'Brand new')

    click(button('Move project 4 up'))
    // The new project is now third; remove the one that was third before it.
    click(button('Remove project 4'))
    await save()

    const saved = await repository.load('house-a')
    expect(saved.projects.map(p => p.title)).toEqual(['First, renamed', 'Sketchbook doodles', 'Brand new'])
    expect(saved.projects[0]!.description).toBe('Now with a description')
    expect(saved.projects[1]!.url).toBe('https://example.org/sketches')
  })

  it('clears a project link by emptying it', async () => {
    const { repository } = await open()
    await startEditing()
    type('projects[2].url', '')
    await save()
    expect((await repository.load('house-a')).projects[2]!.url).toBeNull()
  })

  it('edits, adds, moves and removes links', async () => {
    const { repository } = await open()
    await startEditing()

    type('links[0].label', 'Renamed link')
    type('links[0].url', 'https://example.com:8443/path?q=1#top')
    click(button('Add a link'))
    expect(document.activeElement).toBe(field('links[2].label'))
    type('links[2].label', 'Third')
    type('links[2].url', 'https://example.net/')
    click(button('Move link 3 up'))
    click(button('Remove link 3'))
    await save()

    const saved = await repository.load('house-a')
    expect(saved.links.map(l => l.label)).toEqual(['Renamed link', 'Third'])
    expect(saved.links[0]!.url).toBe('https://example.com:8443/path?q=1#top')
  })

  it('disables Move up and Move down at the ends of a list', async () => {
    await open()
    await startEditing()
    expect(button('Move project 1 up').disabled).toBe(true)
    expect(button('Move project 3 down').disabled).toBe(true)
    expect(button('Move link 1 up').disabled).toBe(true)
    expect(button('Move link 2 down').disabled).toBe(true)
  })

  it('stops adding at the limit, says why, and never drops an entry', async () => {
    await open()
    await startEditing()
    for (let i = 3; i < SITE_LIMITS.maxProjects; i++) click(button('Add a project'))
    expect(container.querySelectorAll('.we-entry legend')).toHaveLength(SITE_LIMITS.maxProjects + 2)
    expect(button('Add a project').disabled).toBe(true)
    expect(q('#we-projects-limit').textContent).toBe('You can have at most 12 projects. Remove one to add another.')
  })

  it('chooses a theme preset', async () => {
    const { repository } = await open()
    await startEditing()
    choose('theme.preset', 'forest')
    expect(field('theme.background').value).toBe(THEME_PRESETS.forest.background)
    await save()
    const saved = await repository.load('house-a')
    expect(saved.theme).toEqual({ ...THEME_PRESETS.forest, underConstruction: true })
  })

  it('changes colours, font and pattern, and becomes a custom theme', async () => {
    const { repository } = await open()
    await startEditing()
    type('theme.background', '#ffffff')
    type('theme.text', '#000000')
    type('theme.link', '#0000ee')
    type('theme.headerBackground', '#800000')
    type('theme.headerText', '#ffffff')
    choose('theme.font', 'sans')
    choose('theme.pattern', 'grid')
    expect(field<HTMLSelectElement>('theme.preset').value).toBe('custom')
    await save()

    const saved = await repository.load('house-a')
    expect(saved.theme).toMatchObject({
      preset: 'custom',
      background: '#FFFFFF',
      text: '#000000',
      link: '#0000EE',
      headerBackground: '#800000',
      headerText: '#FFFFFF',
      font: 'sans',
      pattern: 'grid',
    })
  })

  it('switches the "under construction" banner off', async () => {
    const { repository } = await open()
    await startEditing()
    tick('theme.underConstruction')
    await save()
    expect((await repository.load('house-a')).theme.underConstruction).toBe(false)
  })

  it('cannot pick "Custom colours" directly: it follows from changing a colour', async () => {
    await open()
    await startEditing()
    const custom = [...field<HTMLSelectElement>('theme.preset').options].find(o => o.value === 'custom')!
    expect(custom.disabled).toBe(true)
  })

  it('offers only the fixed fonts, patterns and presets', async () => {
    await open()
    await startEditing()
    expect([...field<HTMLSelectElement>('theme.font').options].map(o => o.value)).toEqual(['serif', 'sans', 'mono'])
    expect([...field<HTMLSelectElement>('theme.pattern').options].map(o => o.value)).toEqual(['plain', 'dots', 'grid', 'stars'])
    expect([...field<HTMLSelectElement>('theme.preset').options].map(o => o.value)).toEqual(
      ['classic-grey', 'starfield', 'pastel', 'forest', 'custom'],
    )
  })
})

// ── Live preview ───────────────────────────────────────────────────────────

describe('the live preview', () => {
  it('changes as soon as a field changes', async () => {
    await open()
    await startEditing()
    expect(q('h1', preview()).textContent).toBe('Welcome to House A!')
    type('title', 'Live title')
    expect(q('h1', preview()).textContent).toBe('Live title')
    type('profile.tagline', 'Fresh tagline')
    expect(q('.wt-tagline', preview()).textContent).toBe('Fresh tagline')
  })

  it('follows the section being edited', async () => {
    await open()
    await startEditing()
    act(() => field('about.body').focus())
    expect(q('main h2', preview()).textContent).toBe('About House A')
    act(() => field('links[0].label').focus())
    expect(q('main h2', preview()).textContent).toBe('Links')
    act(() => field('projects[0].title').focus())
    expect(q('main h2', preview()).textContent).toBe('Projects')
  })

  it('can be switched to any page by hand', async () => {
    await open()
    await startEditing()
    click(button('About', q('.we-preview-pages')))
    expect(q('main h2', preview()).textContent).toBe('About House A')
    expect(button('About', q('.we-preview-pages')).getAttribute('aria-pressed')).toBe('true')
  })

  it('is drawn by the visitor’s own renderer, and looks exactly like the saved page', async () => {
    const { repository } = await open()
    await startEditing()
    type('title', '  Same <b>everywhere</b>  ')
    type('theme.background', '#ffffff')
    type('theme.text', '#000000')
    type('theme.link', '#0000ee')
    click(button('Projects', q('.we-preview-pages')))
    const previewHtml = q('.wt-site', preview()).outerHTML

    await save()
    const saved = await repository.load('house-a')
    const other = document.createElement('div')
    const otherRoot = createRoot(other)
    act(() => otherRoot.render(<SiteRenderer site={saved} section="projects" onNavigate={() => undefined} />))
    const normalise = (html: string): string => html.replace(/ (id|aria-labelledby)="[^"]*"/g, '')
    expect(normalise(other.querySelector('.wt-site')!.outerHTML)).toBe(normalise(previewHtml))
    act(() => otherRoot.unmount())
  })

  it('cannot be clicked or tabbed into, so a link in it cannot open a tab', async () => {
    await open()
    await startEditing()
    expect(preview().hasAttribute('inert')).toBe(true)
  })

  it('never writes the draft anywhere', async () => {
    const save = vi.fn(async (site: SiteContent) => site)
    await open({ writer: { save } })
    await startEditing()
    type('title', 'Draft only')
    type('about.body', 'Draft only')
    click(button('Links', q('.we-preview-pages')))
    expect(save).not.toHaveBeenCalled()
  })

  it('shows HTML-looking text literally and runs nothing', async () => {
    await open()
    await startEditing()
    type('title', '<script>window.__xss = 1</script>')
    type('profile.tagline', '<img src=x onerror="window.__xss = 1">')
    expect(q('h1', preview()).textContent).toBe('<script>window.__xss = 1</script>')
    expect(preview().querySelectorAll('script, img, iframe')).toHaveLength(0)
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('shows an address that is not allowed as plain text', async () => {
    await open()
    await startEditing()
    type('links[0].url', 'javascript:alert(1)')
    click(button('Links', q('.we-preview-pages')))
    expect(preview().querySelectorAll('a')).toHaveLength(1)
    expect(preview().textContent).toContain('(link unavailable)')
  })
})

// ── Draft isolation ────────────────────────────────────────────────────────

describe('the draft', () => {
  it('leaves the saved website alone until Save', async () => {
    const { repository } = await open({ seed: { ...createDefaultSite('house-a', STAMP), title: 'Saved' } })
    await startEditing()
    type('title', 'Unsaved')
    type('links[0].label', 'Unsaved')
    expect((await repository.load('house-a')).title).toBe('Saved')
    expect((await repository.load('house-a')).links[0]!.label).not.toBe('Unsaved')
  })

  it('marks itself unsaved, and clean again when the change is undone', async () => {
    await open()
    await startEditing()
    type('title', 'Changed')
    expect(q('.we-state').textContent).toBe('You have unsaved changes.')
    expect(button('Save').disabled).toBe(false)
    type('title', 'Welcome to House A!')
    expect(q('.we-state').textContent).toBe('No changes yet.')
    expect(button('Save').disabled).toBe(true)
  })

  it('starts fresh each time editing begins', async () => {
    await open()
    await startEditing()
    type('title', 'Abandoned')
    click(button('Cancel'))
    click(button('Discard changes'))
    await settle()
    await startEditing()
    expect(field('title').value).toBe('Welcome to House A!')
  })

  it('warns before the browser tab is closed with unsaved changes, and not otherwise', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    await open()
    await startEditing()
    expect(add.mock.calls.filter(c => c[0] === 'beforeunload')).toHaveLength(0)

    type('title', 'Changed')
    const handler = add.mock.calls.find(c => c[0] === 'beforeunload')?.[1] as (event: Event) => void
    expect(handler).toBeDefined()
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    handler(event)
    expect(event.defaultPrevented).toBe(true)

    type('title', 'Welcome to House A!')
    expect(remove.mock.calls.some(c => c[0] === 'beforeunload' && c[1] === handler)).toBe(true)
  })
})

// ── Save ───────────────────────────────────────────────────────────────────

describe('saving', () => {
  it('saves, returns to the website, and shows what was saved', async () => {
    const { repository } = await open()
    await startEditing()
    type('title', 'Fresh from the editor')
    await save()

    expect(has('.we-editor')).toBe(false)
    expect(q('h1').textContent).toBe('Fresh from the editor')
    expect(q('.wt-notice--good').textContent).toBe(SAVED_LOCAL_NOTICE)
    expect((await repository.load('house-a')).title).toBe('Fresh from the editor')
  })

  it('shows the page as stored, cleaned the same way as for visitors', async () => {
    await open()
    await startEditing()
    type('title', '   Lots   of   spaces   ')
    await save()
    expect(q('h1').textContent).toBe('Lots of spaces')
  })

  it('reads the website back from storage after saving, rather than trusting the draft', async () => {
    const repository = new MemorySiteRepository({ now: () => '2026-11-16T12:00:00.000Z' })
    const load = vi.fn((id: string) => repository.load(id))
    const onClose = vi.fn()
    act(() => root.render(
      <OwnerWebsiteWindow houseId="house-a" reader={{ load }} writer={{ save: s => repository.save(s) }}
        persistent recovery={null} onClose={onClose} />,
    ))
    await settle()
    await startEditing()
    type('title', 'Reloaded')
    await save()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('gives focus back to the Edit button after saving', async () => {
    await open()
    await startEditing()
    type('title', 'Saved')
    await save()
    expect(document.activeElement).toBe(button('Edit this website'))
  })

  it('says the change is only in memory when storage is unavailable', async () => {
    await open({ persistent: false })
    await startEditing()
    expect(q('.we-state').textContent).toContain(NOT_SAVED_NOTICE)
    type('title', 'Memory only')
    await save()
    expect(q('.wt-notice--good').textContent).toBe(SAVED_MEMORY_NOTICE)
  })

  it('submits with Enter in a text box', async () => {
    const { repository } = await open()
    await startEditing()
    type('title', 'Enter to save')
    act(() => { q<HTMLFormElement>('#we-form').requestSubmit() })
    await settle()
    expect((await repository.load('house-a')).title).toBe('Enter to save')
  })

  it('does not save twice when Save is pressed twice', async () => {
    let finish!: () => void
    const save = vi.fn((site: SiteContent) => new Promise<SiteContent>(resolve => { finish = () => resolve(site) }))
    await open({ writer: { save } })
    await startEditing()
    type('title', 'Once')
    click(button('Save'))
    expect(button('Saving...').disabled).toBe(true)
    expect(q('.we-state').textContent).toBe('Saving...')
    click(button('Saving...'))
    await act(async () => finish())
    await settle()
    expect(save).toHaveBeenCalledTimes(1)
  })
})

// ── Validation ─────────────────────────────────────────────────────────────

describe('problems in the draft', () => {
  it('shows a problem next to its field once the field is left', async () => {
    await open()
    await startEditing()
    type('title', '')
    expect(errorOf('title')).toBeNull()
    leave('title')
    expect(errorOf('title')).toBe('Problem: The site title is required.')
    expect(field('title').getAttribute('aria-invalid')).toBe('true')
    expect(field('title').getAttribute('aria-describedby')).toContain(`${fieldId('title')}-error`)
  })

  it('refuses to save, lists every problem, and moves focus to the list', async () => {
    const save = vi.fn(async (site: SiteContent) => site)
    await open({ writer: { save } })
    await startEditing()
    type('title', '')
    type('profile.displayName', '')
    type('links[0].url', 'http://example.com')
    await act(async () => { button('Save').click() })

    expect(save).not.toHaveBeenCalled()
    const summary = q('.we-summary')
    expect(summary.textContent).toContain('3 problems need fixing before this can be saved.')
    expect(document.activeElement).toBe(summary)
    expect(errorOf('title')).toBe('Problem: The site title is required.')
    expect(errorOf('profile.displayName')).toBe('Problem: Your name is required.')
    expect(errorOf('links[0].url')).toBe('Problem: Link 1 address: Only https:// addresses are allowed.')
    expect(has('.we-editor')).toBe(true)
  })

  it('takes you to the field when a problem in the list is chosen', async () => {
    await open()
    await startEditing()
    type('profile.displayName', '')
    await act(async () => { button('Save').click() })
    click(button('Your name is required.'))
    expect(document.activeElement).toBe(field('profile.displayName'))
  })

  it('lets the save through once the problems are fixed', async () => {
    const { repository } = await open()
    await startEditing()
    type('title', '')
    await act(async () => { button('Save').click() })
    type('title', 'Fixed')
    expect(container.querySelector('.we-summary')?.textContent ?? '').not.toContain('title')
    await save()
    expect((await repository.load('house-a')).title).toBe('Fixed')
  })

  it('does not cut text that is too long: it keeps it, counts it and refuses to save', async () => {
    const save = vi.fn(async (site: SiteContent) => site)
    await open({ writer: { save } })
    await startEditing()
    const long = 'x'.repeat(SITE_LIMITS.title.max + 5)
    type('title', long)
    expect(field('title').value).toBe(long)
    expect(field('title').hasAttribute('maxlength')).toBe(false)
    expect(q(`#${fieldId('title')}-count`).textContent).toBe('65 of 60 characters (too long)')
    await act(async () => { button('Save').click() })
    expect(save).not.toHaveBeenCalled()
    expect(errorOf('title')).toBe('Problem: The site title is too long: 65 characters, the limit is 60.')
  })

  it('counts characters as people do', async () => {
    await open()
    await startEditing()
    type('title', '😀😀😀')
    expect(q(`#${fieldId('title')}-count`).textContent).toBe('3 of 60 characters')
  })

  it.each([
    ['javascript:alert(1)', 'Only https:// addresses are allowed.'],
    ['data:text/html,x', 'Only https:// addresses are allowed.'],
    ['http://example.com', 'Only https:// addresses are allowed.'],
    ['example.com', 'Start it with https://'],
    ['https://localhost/', 'private network'],
    ['https://127.0.0.1/', 'IP addresses'],
    ['https://user:pw@example.com/', 'user name or password'],
    ['https://example.com:0/', 'between 1 and 65535'],
  ])('refuses the address %s with a reason', async (url, reason) => {
    await open()
    await startEditing()
    type('links[0].url', url)
    leave('links[0].url')
    expect(errorOf('links[0].url')).toContain(reason)
  })

  it('accepts an https address with an explicit port', async () => {
    const { repository } = await open()
    await startEditing()
    type('links[1].url', 'https://example.org:8443/')
    leave('links[1].url')
    expect(errorOf('links[1].url')).toBeNull()
    await save()
    expect((await repository.load('house-a')).links[1]!.url).toBe('https://example.org:8443/')
  })

  it('accepts HTML-looking text as plain text and saves it exactly', async () => {
    const { repository } = await open()
    await startEditing()
    type('title', '<script>alert(1)</script>')
    leave('title')
    expect(errorOf('title')).toBeNull()
    await save()
    expect((await repository.load('house-a')).title).toBe('<script>alert(1)</script>')
    expect(q('h1').textContent).toBe('<script>alert(1)</script>')
  })
})

// ── Colours ────────────────────────────────────────────────────────────────

describe('colour readability', () => {
  const rows = (): Array<{ ratio: string; needs: string; result: string; passes: string }> =>
    [...container.querySelectorAll('.we-contrast tbody tr')].map(tr => ({
      ratio: tr.children[1]!.textContent!,
      needs: tr.children[2]!.textContent!,
      result: tr.children[3]!.textContent!,
      passes: tr.getAttribute('data-passes')!,
    }))

  it('shows the ratio, what is needed and the result for each pair', async () => {
    await open()
    await startEditing()
    expect(q('.we-contrast caption').textContent).toBe('How easy the colours are to read (WCAG AA)')
    expect(rows().map(r => r.needs)).toEqual(['4.5:1', '4.5:1', '3:1 (large text)'])
    expect(rows().every(r => r.result === 'Passes AA')).toBe(true)
  })

  it('updates as colours change, and says in words when a pair fails', async () => {
    await open()
    await startEditing()
    type('theme.background', '#FFFFFF')
    type('theme.text', '#777777')
    expect(rows()[0]).toMatchObject({ ratio: '4.47:1', result: 'Fails AA: change a colour', passes: 'false' })
    type('theme.text', '#767676')
    expect(rows()[0]).toMatchObject({ ratio: '4.54:1', result: 'Passes AA', passes: 'true' })
  })

  it('holds the banner title to 3:1', async () => {
    await open()
    await startEditing()
    type('theme.headerBackground', '#FFFFFF')
    type('theme.headerText', '#949494')
    expect(rows()[2]).toMatchObject({ ratio: '3.03:1', result: 'Passes AA' })
    type('theme.headerText', '#959595')
    expect(rows()[2]).toMatchObject({ ratio: '2.99:1', result: 'Fails AA: change a colour' })
  })

  it('refuses to save colours that fail, with the numbers', async () => {
    const save = vi.fn(async (site: SiteContent) => site)
    await open({ writer: { save } })
    await startEditing()
    type('theme.background', '#FFFFFF')
    type('theme.text', '#EEEEEE')
    await act(async () => { button('Save').click() })
    expect(save).not.toHaveBeenCalled()
    expect(errorOf('theme.text')).toContain('too hard to read')
    expect(errorOf('theme.text')).toContain('needs at least 4.5:1')
  })

  it('asks for #RRGGBB while a colour is unfinished, and refuses to save it', async () => {
    const save = vi.fn(async (site: SiteContent) => site)
    await open({ writer: { save } })
    await startEditing()
    type('theme.text', '#12')
    expect(rows()[0]).toMatchObject({ ratio: 'unknown', result: 'Enter both colours as #RRGGBB' })
    leave('theme.text')
    expect(errorOf('theme.text')).toContain('#RRGGBB')
    await act(async () => { button('Save').click() })
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the colour picker and the text box in step', async () => {
    await open()
    await startEditing()
    const picker = q<HTMLInputElement>(`#${fieldId('theme.link')}`).parentElement!.querySelector<HTMLInputElement>('input[type="color"]')!
    expect(picker.getAttribute('aria-label')).toBe('Link colour: choose with the colour picker')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker, '#123abc')
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(field('theme.link').value).toBe('#123ABC')
    type('theme.link', '#00ff00')
    expect(picker.value).toBe('#00ff00')
  })
})

// ── Failures ───────────────────────────────────────────────────────────────

describe('when saving fails', () => {
  it.each([
    ['a full disk', new QuotaError(), "There isn't enough storage space"],
    ['a storage error', new StorageError(), "couldn't save or read"],
    ['a refusal', new PermissionError(), 'Only the owner'],
    ['a rejected draft', new ValidationError([{ path: 'title', message: 'The site title is required.' }]), 'The site title is required.'],
  ])('keeps the whole draft after %s, and says why', async (_name, error, words) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await open({ writer: { save: async () => { throw error } } })
    await startEditing()
    type('title', 'Keep me')
    type('about.body', 'And me')
    type('links[0].url', 'https://example.net/')
    await save()

    expect(has('.we-editor')).toBe(true)
    expect(field('title').value).toBe('Keep me')
    expect(field<HTMLTextAreaElement>('about.body').value).toBe('And me')
    expect(field('links[0].url').value).toBe('https://example.net/')
    const banner = q('.we-banner--problem[role="alert"]')
    expect(banner.textContent).toContain('Your changes were not saved.')
    expect(banner.textContent).toContain(words)
    expect(banner.textContent).toContain('Your draft is still here')
    expect(q('.we-state').textContent).toBe('You have unsaved changes.')
  })

  it('shows a plain sentence for an unexpected error, and logs the detail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await open({ writer: { save: async () => { throw new Error('internal: /tmp/x stack') } } })
    await startEditing()
    type('title', 'x')
    await save()
    expect(q('.we-banner--problem').textContent).toContain('Something went wrong while saving.')
    expect(q('.we-banner--problem').textContent).not.toContain('internal')
    expect(log).toHaveBeenCalled()
  })

  it('saves on the next try once the problem is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const repository = new MemorySiteRepository()
    let fail = true
    const writer: SiteWriter = { save: async site => { if (fail) throw new QuotaError(); return repository.save(site) } }
    await open({ writer })
    await startEditing()
    type('title', 'Second time lucky')
    await save()
    expect(has('.we-banner--problem')).toBe(true)

    fail = false
    await save()
    expect(has('.we-editor')).toBe(false)
    expect((await repository.load('house-a')).title).toBe('Second time lucky')
  })
})

// ── Cancel and close ───────────────────────────────────────────────────────

describe('cancelling and closing', () => {
  it('cancels a clean draft straight away', async () => {
    await open()
    await startEditing()
    click(button('Cancel'))
    await settle()
    expect(has('.we-editor')).toBe(false)
    expect(has('[role="alertdialog"]')).toBe(false)
  })

  it('asks before throwing away changes, and keeps them if asked to', async () => {
    const { repository } = await open()
    await startEditing()
    type('title', 'Precious')
    click(button('Cancel'))

    const dialog = q('[role="alertdialog"]')
    expect(dialog.textContent).toContain('Discard your changes?')
    expect(dialog.textContent).toContain('If you cancel now they will be lost.')
    expect(document.activeElement).toBe(button('Keep editing'))

    click(button('Keep editing'))
    expect(has('[role="alertdialog"]')).toBe(false)
    expect(field('title').value).toBe('Precious')
    expect((await repository.load('house-a')).title).toBe('Welcome to House A!')
  })

  it('throws the changes away when asked to, and saves nothing', async () => {
    const save = vi.fn(async (site: SiteContent) => site)
    await open({ writer: { save } })
    await startEditing()
    type('title', 'Gone')
    click(button('Cancel'))
    click(button('Discard changes'))
    await settle()
    expect(has('.we-editor')).toBe(false)
    expect(q('h1').textContent).toBe('Welcome to House A!')
    expect(save).not.toHaveBeenCalled()
  })

  it('asks before closing the window with unsaved changes', async () => {
    const { onClose } = await open()
    await startEditing()
    type('title', 'Unsaved')
    click(button('Close'))
    expect(onClose).not.toHaveBeenCalled()
    expect(q('[role="alertdialog"]').textContent).toContain('If you close now they will be lost.')

    click(button('Discard changes'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('treats Escape as Close: it asks, and a second Escape keeps editing', async () => {
    const { onClose } = await open()
    await startEditing()
    type('title', 'Unsaved')
    const escape = (): void =>
      act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))

    escape()
    expect(has('[role="alertdialog"]')).toBe(true)
    escape()
    expect(has('[role="alertdialog"]')).toBe(false)
    expect(field('title').value).toBe('Unsaved')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes at once when nothing would be lost', async () => {
    const { onClose } = await open()
    await startEditing()
    click(button('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab between the two buttons of the question, and makes the rest unreachable', async () => {
    await open()
    await startEditing()
    type('title', 'Unsaved')
    click(button('Cancel'))
    const keep = button('Keep editing')
    const discard = button('Discard changes')
    act(() => void keep.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(discard)
    act(() => void discard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(keep)
    expect(q('.we-window').hasAttribute('inert')).toBe(true)
  })

  it('gives focus back to the Edit button after cancelling', async () => {
    await open()
    await startEditing()
    click(button('Cancel'))
    await settle()
    expect(document.activeElement).toBe(button('Edit this website'))
  })
})

// ── Accessibility ──────────────────────────────────────────────────────────

describe('keyboard and screen readers', () => {
  it('labels every field, and every button has a name', async () => {
    await open()
    await startEditing()
    for (const control of container.querySelectorAll<HTMLElement>('.we-editor input, .we-editor textarea, .we-editor select')) {
      const named =
        control.getAttribute('aria-label') !== null ||
        (control.id !== '' && container.querySelector(`label[for="${control.id}"]`) !== null)
      expect(named, control.outerHTML.slice(0, 80)).toBe(true)
    }
    for (const b of container.querySelectorAll<HTMLButtonElement>('.we-editor button')) {
      expect((b.getAttribute('aria-label') ?? b.textContent ?? '').trim().length, b.outerHTML).toBeGreaterThan(0)
    }
  })

  it('groups fields under headings a screen reader announces', async () => {
    await open()
    await startEditing()
    const legends = [...container.querySelectorAll('.we-group > legend')].map(l => l.textContent)
    expect(legends).toEqual(['Your page', 'Home page', 'About page', 'Projects', 'Links', 'Look'])
  })

  it('describes each field with its help, its count and its problem', async () => {
    await open()
    await startEditing()
    const welcome = field<HTMLTextAreaElement>('home.welcome')
    const described = welcome.getAttribute('aria-describedby')!.split(' ')
    expect(described).toEqual([`${fieldId('home.welcome')}-hint`, `${fieldId('home.welcome')}-count`])
    expect(document.getElementById(described[0]!)!.textContent).toBe('Leave a blank line between paragraphs.')
  })

  it('writes every problem out in words, not just in colour', async () => {
    await open()
    await startEditing()
    type('title', '')
    leave('title')
    expect(q(`#${fieldId('title')}-error`).textContent!.startsWith('Problem: ')).toBe(true)
  })

  it('announces save progress and results', async () => {
    await open()
    await startEditing()
    expect(q('.we-state').getAttribute('role')).toBe('status')
    type('title', 'Saved')
    await save()
    expect(q('.wt-notice--good').getAttribute('role')).toBe('status')
  })

  it('has an Edit / Preview switch for narrow screens that says which is showing', async () => {
    await open()
    await startEditing()
    const editor = q('.we-editor')
    expect(editor.getAttribute('data-pane')).toBe('form')
    expect(button('Edit').getAttribute('aria-pressed')).toBe('true')
    click(button('Preview'))
    expect(editor.getAttribute('data-pane')).toBe('preview')
    expect(button('Preview').getAttribute('aria-pressed')).toBe('true')
    expect(button('Edit').getAttribute('aria-pressed')).toBe('false')
  })

  it('does not stop W, A, S, D, E or the arrows from being typed', async () => {
    await open()
    await startEditing()
    for (const key of ['w', 'a', 's', 'd', 'e', 'ArrowLeft', 'ArrowRight', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      field('title').dispatchEvent(event)
      expect(event.defaultPrevented, key).toBe(false)
    }
  })

  it('lets Alt+Left move the text cursor in the editor instead of going back a page', async () => {
    await open()
    await startEditing()
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })
    field('title').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
