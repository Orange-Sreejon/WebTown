import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ConflictError, ValidationError } from '../../personal-spaces/errors'
import { startStudio } from '../../personal-spaces/site-project/studio-state'
import { blankProject, classicProject } from '../../personal-spaces/site-project/templates'
import { COMMUNITY_SITE_KEY, hallTarget, houseTarget, type SiteTarget } from '../../personal-spaces/site-project/site-target'
import { GIF_ANIMATED, PNG_1PX } from '../../personal-spaces/site-project/test-images.test-support'
import type { SiteProject, SiteSave } from '../../personal-spaces/site-project/types'
import type { WebsiteState } from '../../personal-spaces/site-project-storage/resolve-website'
import { PlainEditor } from './plain-editor.test-support'
import { PREVIEW_DELAY_MS, SiteStudio, unsavedStudio } from './SiteStudio'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = '2026-11-16T00:00:00.000Z'
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

interface Setup {
  writer: { save: Mock<(save: SiteSave) => Promise<SiteProject>> }
  reload: Mock<() => Promise<WebsiteState>>
  onExit: Mock<() => void>
  onClose: Mock<() => void>
}

function mount(initial = unsavedStudio(blankProject('house-a', NOW)), overrides: Partial<Setup> = {}, target: SiteTarget = houseTarget('house-a')): Setup {
  const setup: Setup = {
    writer: { save: vi.fn(async (save: SiteSave): Promise<SiteProject> => ({ ...save.project, revision: save.baseRevision + 1, updatedAt: NOW })) },
    reload: vi.fn(async (): Promise<WebsiteState> => ({ kind: 'none' })),
    onExit: vi.fn<() => void>(),
    onClose: vi.fn<() => void>(),
    ...overrides,
  }
  act(() =>
    root.render(
      <SiteStudio
        target={target}
        initial={initial}
        writer={setup.writer}
        reload={setup.reload}
        persistent
        onExit={setup.onExit}
        onClose={setup.onClose}
        Editor={PlainEditor}
        now={() => NOW}
      />,
    ),
  )
  return setup
}

const text = (): string => container.textContent ?? ''
const findButton = (name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name)
const button = (name: string): HTMLButtonElement => {
  const found = findButton(name)
  if (!found) throw new Error(`no button "${name}"`)
  return found
}
const pageButton = (name: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.ws-item-name')].find(b => b.title.startsWith(name))
  if (!found) throw new Error(`no page "${name}"`)
  return found
}
const click = (el: HTMLElement): void => act(() => el.click())
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}
const editor = (): HTMLTextAreaElement => container.querySelector('textarea')!

/** Types into a React-controlled field. */
function type(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const dialogInput = (): HTMLInputElement => container.querySelector('.ws-dialog input')!
const submitDialog = (): void => act(() => container.querySelector<HTMLFormElement>('.ws-dialog form')!.requestSubmit())

const stored = (project: SiteProject = { ...blankProject('house-a', NOW), revision: 2 }) => startStudio({ project, assets: [] }, { stored: true })

describe('the Studio window', () => {
  it('has the toolbar, the files and the editor', () => {
    mount()
    expect(text()).toContain('Site Studio: My website')
    for (const name of ['Save', 'Split', 'Code', 'Preview', 'Desktop', 'Phone', 'Refresh', 'Start over', 'Exit', 'New page', 'Upload']) button(name)
    expect(container.querySelector<HTMLInputElement>('.ws-field input')!.value).toBe('My website')
    expect(text()).toContain('Not saved yet')
    expect(text()).toContain('style.css')
    expect(editor().getAttribute('aria-label')).toBe('index.html HTML code')
    expect(editor().value).toContain('<!DOCTYPE html>')
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('saves the draft, then reports it saved', async () => {
    const { writer } = mount()
    type(editor(), '<h1>My zine</h1>')
    click(button('Save'))
    await flush()
    expect(writer.save).toHaveBeenCalledTimes(1)
    const save = writer.save.mock.calls[0]![0] as SiteSave
    expect(save.baseRevision).toBe(0)
    expect(save.project.pages[0]!.html).toBe('<h1>My zine</h1>')
    expect(text()).toContain('Saved on this device only.')
    expect(container.querySelector('.ws-status')!.textContent).toBe('Saved')
    expect(button('Save').disabled).toBe(true)
  })

  it('saves with Ctrl+S', async () => {
    const { writer } = mount()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })) })
    await flush()
    expect(writer.save).toHaveBeenCalledTimes(1)
  })

  it('marks unsaved pages and says there are unsaved changes', () => {
    mount(stored())
    expect(container.querySelector('.ws-status')!.textContent).toBe('Saved')
    type(editor(), 'changed')
    expect(container.querySelector('.ws-status')!.textContent).toBe('Unsaved changes')
    expect(container.querySelector('.ws-unsaved')).not.toBeNull()
  })

  it('edits the shared stylesheet', () => {
    const { writer } = mount()
    click(button('style.css'))
    expect(editor().getAttribute('aria-label')).toBe('style.css code')
    expect(editor().dataset['language']).toBe('css')
    type(editor(), 'body { display: grid }')
    click(button('Save'))
    expect((writer.save.mock.calls[0]![0] as SiteSave).project.css).toBe('body { display: grid }')
  })

  it('names the website', () => {
    const { writer } = mount()
    type(container.querySelector<HTMLInputElement>('.ws-field input')!, 'Zine of Ada')
    click(button('Save'))
    expect((writer.save.mock.calls[0]![0] as SiteSave).project.title).toBe('Zine of Ada')
  })

  it('refuses to save an invalid website and says why, without calling storage', () => {
    const { writer } = mount()
    type(container.querySelector<HTMLInputElement>('.ws-field input')!, '   ')
    click(button('Save'))
    expect(writer.save).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Give your website a name.')
  })

  it('shows what storage refused', async () => {
    const { writer } = mount()
    writer.save.mockRejectedValueOnce(new ValidationError([{ path: 'site', message: 'Too big.' }]))
    click(button('Save'))
    await flush()
    expect(text()).toContain('Too big.')
  })
})

describe('pages', () => {
  it('creates a page from a name, adding .html', () => {
    mount()
    click(button('New page'))
    type(dialogInput(), 'zine')
    expect(text()).toContain('It will be called zine.html.')
    submitDialog()
    expect(text()).toContain('zine.html')
    expect(editor().getAttribute('aria-label')).toBe('zine.html HTML code')
  })

  it('explains a name it cannot use', () => {
    mount()
    click(button('New page'))
    type(dialogInput(), 'index')
    submitDialog()
    expect(container.querySelector('.ws-dialog [role="alert"]')!.textContent).toContain('already a page called index.html')
    type(dialogInput(), 'my page')
    expect(container.querySelector('.ws-dialog-error')!.textContent).toMatch(/letters, digits/)
  })

  it('renames, sets the homepage, and deletes after asking', () => {
    const { writer } = mount(unsavedStudio(classicProject('house-a', NOW)))
    click(pageButton('about.html'))
    click(button('Set as homepage'))
    click(button('Rename'))
    type(dialogInput(), 'me.html')
    submitDialog()
    expect(text()).toContain('Links to about.html in your pages are not changed automatically.')
    click(button('Delete'))
    expect(text()).toContain('Delete me.html?')
    click(button('Cancel'))
    expect(text()).toContain('me.html')
    click(button('Delete'))
    click(button('Delete page'))
    click(button('Save'))
    const save = writer.save.mock.calls[0]![0] as SiteSave
    expect(save.project.pages.map(p => p.name)).toEqual(['index.html', 'projects.html', 'links.html'])
    expect(save.project.homePage).toBe('index.html')
  })

  it('cannot delete the only page', () => {
    mount()
    expect(button('Delete').disabled).toBe(true)
  })
})

const file = (name: string, bytes: ArrayBuffer, mime = 'image/gif'): File => new File([bytes], name, { type: mime })

async function upload(...files: File[]): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
}

describe('images', () => {

  it('uploads a GIF under a predictable name and saves it with the website', async () => {
    const { writer } = mount()
    await upload(file('My Banner.gif', GIF_ANIMATED()))
    expect(text()).toContain('assets/My-Banner.gif')
    click(button('Save'))
    await flush()
    const save = writer.save.mock.calls[0]![0] as SiteSave
    expect(save.putAssets.map(a => [a.name, a.mimeType, a.houseId])).toEqual([['My-Banner.gif', 'image/gif', 'house-a']])
    expect(save.project.assets.map(a => a.name)).toEqual(['My-Banner.gif'])
  })

  it('gives a second image with the same name a new name', async () => {
    mount()
    await upload(file('cat.png', PNG_1PX(), 'image/png'), file('cat.png', PNG_1PX(), 'image/png'))
    expect(text()).toContain('assets/cat.png')
    expect(text()).toContain('assets/cat-2.png')
  })

  it('refuses files that are not the image they claim to be', async () => {
    mount()
    await upload(file('evil.png', new TextEncoder().encode('<script>alert(1)</script>').buffer as ArrayBuffer, 'image/png'), file('notes.txt', PNG_1PX(), 'text/plain'))
    const alert = container.querySelector('[role="alert"]')!.textContent!
    expect(alert).toContain('These files were not added')
    expect(alert).toContain('evil.png')
    expect(alert).toContain('notes')
    expect(container.querySelectorAll('.ws-asset')).toHaveLength(0)
  })

  it('inserts an image tag at the cursor, and a url() in CSS', async () => {
    mount()
    await upload(file('cat.png', PNG_1PX(), 'image/png'))
    type(editor(), '<body></body>')
    act(() => editor().setSelectionRange(6, 6))
    click(button('Insert cat.png'))
    expect(editor().value).toBe('<body><img src="assets/cat.png" alt="cat"></body>')
    click(button('style.css'))
    type(editor(), '')
    click(button('Insert cat.png'))
    expect(editor().value).toBe('url("assets/cat.png")')
  })

  it('copies the path', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    await upload(file('cat.png', PNG_1PX(), 'image/png'))
    click(button('Copy path assets/cat.png'))
    await flush()
    expect(writeText).toHaveBeenCalledWith('assets/cat.png')
    expect(text()).toContain('Copied assets/cat.png')
  })

  it('warns where an image is still used before deleting it', async () => {
    const { writer } = mount()
    await upload(file('cat.png', PNG_1PX(), 'image/png'))
    type(editor(), '<img src="assets/cat.png">')
    click(button('Delete cat.png'))
    expect(text()).toContain('It is still used in: index.html')
    click(button('Delete image'))
    expect(container.querySelectorAll('.ws-asset')).toHaveLength(0)
    click(button('Save'))
    expect((writer.save.mock.calls[0]![0] as SiteSave).putAssets).toEqual([])
  })
})

describe('preview', () => {
  it('follows typing after a short pause, and only on Refresh when Auto is off', () => {
    vi.useFakeTimers()
    mount()
    const title = (): string => container.querySelector('.ws-preview-title')!.textContent!
    type(editor(), '<title>Zine</title><p>x</p>')
    expect(title()).not.toContain('Zine')
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS + 5) })
    expect(title()).toContain('(Zine)')

    click(container.querySelector<HTMLInputElement>('.ws-check input')!)
    type(editor(), '<title>Second</title>')
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS * 3) })
    expect(title()).toContain('(Zine)')
    click(button('Refresh'))
    expect(title()).toContain('(Second)')
  })

  it('switches layout and preview size', () => {
    mount()
    click(button('Code'))
    expect(container.querySelector<HTMLElement>('.ws-preview-pane')!.hidden).toBe(true)
    click(button('Preview'))
    expect(container.querySelector<HTMLElement>('.ws-code-pane')!.hidden).toBe(true)
    expect(findButton('Insert cat.png')).toBeUndefined() // no images, nothing to insert
    click(button('Split'))
    click(button('Phone'))
    expect(container.querySelector<HTMLElement>('.ws-preview')!.style.width).toBe('375px')
    expect(button('Phone').getAttribute('aria-pressed')).toBe('true')
  })

  it('reports likely markup mistakes as warnings', () => {
    vi.useFakeTimers()
    mount()
    type(editor(), '<div>\n<p>open')
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS + 5) })
    expect(container.querySelector('.ws-notes')!.textContent).toContain('Line 1: <div> is never closed.')
  })
})

describe('leaving and starting over', () => {
  it('leaves at once when everything is saved', () => {
    const { onExit } = mount(stored())
    click(button('Exit'))
    expect(onExit).toHaveBeenCalled()
  })

  it('asks before leaving with unsaved work', () => {
    const { onExit, onClose } = mount()
    click(button('Exit'))
    expect(text()).toContain('Leave without saving?')
    click(button('Keep editing'))
    expect(onExit).not.toHaveBeenCalled()
    click(button('Close'))
    click(button('Leave without saving'))
    expect(onClose).toHaveBeenCalled()
  })

  it('asks the browser to confirm closing the tab while there is unsaved work', () => {
    mount()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not hold up closing the tab when everything is saved', () => {
    mount(stored())
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('starts over from the classic template, keeping images', async () => {
    const { writer } = mount()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File([PNG_1PX()], 'cat.png', { type: 'image/png' })], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await flush()
    click(button('Start over'))
    click(button('Classic personal homepage'))
    for (const page of ['about.html', 'projects.html', 'links.html']) expect(text()).toContain(page)
    click(button('Save'))
    await flush()
    const save = writer.save.mock.calls[0]![0] as SiteSave
    expect(save.project.pages).toHaveLength(4)
    expect(save.putAssets.map(a => a.name)).toEqual(['cat.png'])
  })
})

describe('a save that conflicts with another tab', () => {
  const theirs = (): WebsiteState => ({ kind: 'project', snapshot: { project: { ...blankProject('house-a', NOW), revision: 5, css: 'theirs' }, assets: [] }, skipped: [] })

  it('can load the other version', async () => {
    const setup = mount(stored())
    setup.writer.save.mockRejectedValueOnce(new ConflictError())
    setup.reload.mockResolvedValue(theirs())
    type(editor(), 'mine')
    click(button('Save'))
    await flush()
    expect(text()).toContain('Saved somewhere else')
    click(button('Load the other version'))
    await flush()
    expect(editor().value).not.toBe('mine')
    click(button('style.css'))
    expect(editor().value).toBe('theirs')
    expect(container.querySelector('.ws-status')!.textContent).toBe('Saved')
  })

  it('can save over it on purpose', async () => {
    const setup = mount(stored())
    setup.writer.save.mockRejectedValueOnce(new ConflictError())
    setup.reload.mockResolvedValue(theirs())
    type(editor(), 'mine')
    click(button('Save'))
    await flush()
    click(button('Save mine anyway'))
    await flush()
    expect(setup.writer.save).toHaveBeenCalledTimes(2)
    const second = setup.writer.save.mock.calls[1]![0] as SiteSave
    expect(second.baseRevision).toBe(5)
    expect(second.project.pages[0]!.html).toBe('mine')
    expect(container.querySelector('.ws-status')!.textContent).toBe('Saved')
  })
})

describe('for the Community Website (a Hall target, CH-05a)', () => {
  const WORLD = '0b6c1c4e-8f0e-4c7e-9d7a-000000000001'
  const hall = (): SiteTarget => hallTarget(WORLD)
  const draft = () => unsavedStudio(blankProject(COMMUNITY_SITE_KEY, NOW))

  it("stamps the town's key, never a house's, on images and new starting points", async () => {
    const { writer } = mount(draft(), {}, hall())
    await upload(file('Poster.png', PNG_1PX(), 'image/png'))
    click(button('Save'))
    await flush()
    const save = writer.save.mock.calls[0]![0] as SiteSave
    expect(save.project.houseId).toBe(COMMUNITY_SITE_KEY)
    expect(save.putAssets.map(a => a.houseId)).toEqual([COMMUNITY_SITE_KEY])
    click(button('Start over'))
    click(button('Classic personal homepage'))
    click(button('Save'))
    await flush()
    expect((writer.save.mock.calls[1]![0] as SiteSave).project.houseId).toBe(COMMUNITY_SITE_KEY)
  })

  it('says the draft is shared and published by moderators, and that someone else saved it', async () => {
    const setup = mount(draft(), {}, hall())
    expect(text()).toContain('Everyone in town can edit this draft. Visitors see the Community Website only once a moderator publishes it.')
    expect(text()).not.toContain('Visitors to your town see the saved version')
    setup.writer.save.mockRejectedValueOnce(new ConflictError())
    setup.reload.mockResolvedValue({ kind: 'project', snapshot: { project: { ...blankProject(COMMUNITY_SITE_KEY, NOW), revision: 3 }, assets: [] }, skipped: [] })
    click(button('Save'))
    await flush()
    expect(text()).toContain('Someone else in town saved the draft after you opened it.')
    expect(text()).not.toContain('another tab')
    click(button('Load the other version'))
    await flush()
    expect(text()).toContain('Showing the draft as it was last saved.')
  })

  it('keeps the house wording for a house', () => {
    mount()
    expect(text()).toMatch(/Visitors (on this device|to your town) see the saved version\./)
  })
})
