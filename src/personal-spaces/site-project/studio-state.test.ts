import { describe, expect, it } from 'vitest'
import {
  assetUsedIn,
  draftAssets,
  isDirty,
  saveRequest,
  startStudio,
  studioReducer,
  unsavedPages,
  type StudioAction,
  type StudioState,
} from './studio-state'
import { blankProject, classicProject } from './templates'
import { GIF_ANIMATED, PNG_1PX } from './test-images.test-support'
import type { SiteAsset, SiteProject } from './types'

const NOW = '2026-11-16T00:00:00.000Z'
const asset = (id: string, name: string, bytes = PNG_1PX()): SiteAsset =>
  ({ id, name, mimeType: name.endsWith('.gif') ? 'image/gif' : 'image/png', size: bytes.byteLength, houseId: 'house-a', bytes })
const meta = (a: SiteAsset) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size })

function storedStudio(change: Partial<SiteProject> = {}, assets: SiteAsset[] = []): StudioState {
  const project = { ...blankProject('house-a', NOW), revision: 3, assets: assets.map(meta), ...change }
  return startStudio({ project, assets }, { stored: true })
}
const run = (state: StudioState, ...actions: StudioAction[]): StudioState => actions.reduce(studioReducer, state)

describe('studio state', () => {
  it('starts on the homepage, clean when it is stored', () => {
    const state = storedStudio()
    expect(state.page).toBe('index.html')
    expect(state.tab).toBe('html')
    expect(isDirty(state)).toBe(false)
    expect(state.baseRevision).toBe(3)
  })

  it('is unsaved from the start when it is not in storage yet', () => {
    const state = startStudio({ project: classicProject('house-a', NOW), assets: [] }, { stored: false })
    expect(isDirty(state)).toBe(true)
    expect(unsavedPages(state).size).toBe(4)
    expect(saveRequest(state).baseRevision).toBe(0)
  })

  it('edits page HTML, CSS and the name, and knows what is unsaved', () => {
    const state = run(storedStudio(), { type: 'edit-html', page: 'index.html', html: '<p>hi</p>' })
    expect(isDirty(state)).toBe(true)
    expect([...unsavedPages(state)]).toEqual(['index.html'])
    expect(isDirty(run(storedStudio(), { type: 'edit-css', css: 'p{}' }))).toBe(true)
    expect(isDirty(run(storedStudio(), { type: 'set-title', title: 'Zine' }))).toBe(true)
    // Undoing the change by hand makes it clean again.
    const back = run(state, { type: 'edit-html', page: 'index.html', html: storedStudio().draft.pages[0]!.html })
    expect(isDirty(back)).toBe(false)
  })

  it('ignores edits to pages that do not exist', () => {
    const state = storedStudio()
    expect(run(state, { type: 'edit-html', page: 'nope.html', html: 'x' })).toBe(state)
  })

  it('adds, renames and deletes pages, keeping the homepage and selection sensible', () => {
    let state = run(storedStudio(), { type: 'add-page', name: 'zine.html' })
    expect(state.page).toBe('zine.html')
    expect(state.draft.pages.map(p => p.name)).toEqual(['index.html', 'zine.html'])
    expect(state.draft.pages[1]!.html).toContain('<title>zine</title>')

    expect(run(state, { type: 'add-page', name: 'ZINE.html' })).toBe(state) // clash, ignoring case
    expect(run(state, { type: 'add-page', name: 'bad name.html' })).toBe(state)

    state = run(state, { type: 'set-home', name: 'zine.html' }, { type: 'rename-page', from: 'zine.html', to: 'home.html' })
    expect(state.draft.homePage).toBe('home.html')
    expect(state.page).toBe('home.html')

    state = run(state, { type: 'delete-page', name: 'home.html' })
    expect(state.draft.pages.map(p => p.name)).toEqual(['index.html'])
    expect(state.draft.homePage).toBe('index.html')
    expect(state.page).toBe('index.html')
    expect(run(state, { type: 'delete-page', name: 'index.html' })).toBe(state) // never the last page
  })

  it('switches between a page and style.css', () => {
    const state = run(storedStudio(), { type: 'select-tab', tab: 'css' })
    expect(state.tab).toBe('css')
    expect(run(state, { type: 'select-page', page: 'index.html' }).tab).toBe('html')
  })

  it('adds and deletes images, and the save carries exactly the difference', () => {
    const kept = asset('a1', 'kept.png')
    let state = storedStudio({}, [kept])
    const gif = asset('a2', 'my-banner.gif', GIF_ANIMATED())
    state = run(state, { type: 'add-asset', asset: gif })
    expect(run(state, { type: 'add-asset', asset: { ...gif, id: 'a3', name: 'MY-BANNER.gif' } })).toBe(state)
    expect(draftAssets(state).map(a => a.name)).toEqual(['kept.png', 'my-banner.gif'])

    state = run(state, { type: 'delete-asset', id: 'a1' })
    const request = saveRequest(state)
    expect(request.baseRevision).toBe(3)
    expect(request.putAssets.map(a => a.id)).toEqual(['a2'])
    expect(request.deleteAssetIds).toEqual(['a1'])
    expect(request.project.assets.map(a => a.name)).toEqual(['my-banner.gif'])
  })

  it('after saving, keeps edits made while the save was running', () => {
    let state = run(storedStudio(), { type: 'edit-css', css: 'a{}' })
    const sent = saveRequest(state)
    state = run(state, { type: 'edit-css', css: 'b{}' })
    state = run(state, { type: 'saved', project: { ...sent.project, revision: 4, updatedAt: '2026-11-17T00:00:00.000Z' } })
    expect(state.baseRevision).toBe(4)
    expect(state.draft.css).toBe('b{}')
    expect(isDirty(state)).toBe(true)
    state = run(state, { type: 'saved', project: { ...state.draft, revision: 5 } })
    expect(isDirty(state)).toBe(false)
  })

  it('starts over from a template, keeping the save history', () => {
    const state = run(storedStudio(), { type: 'replace-draft', project: classicProject('house-x', NOW), assets: [] })
    expect(state.draft.houseId).toBe('house-a')
    expect(state.draft.revision).toBe(3)
    expect(state.draft.pages).toHaveLength(4)
    expect(state.page).toBe('index.html')
    expect(saveRequest(state).baseRevision).toBe(3)
  })

  it('reloads what storage has, dropping the draft', () => {
    const other = { ...blankProject('house-a', NOW), revision: 9, css: 'theirs' }
    const state = run(storedStudio({ css: 'mine' }), { type: 'reload', snapshot: { project: other, assets: [] } })
    expect(state.draft.css).toBe('theirs')
    expect(state.baseRevision).toBe(9)
    expect(isDirty(state)).toBe(false)
  })

  it('rebases the draft onto what storage has, so "Save anyway" overwrites it exactly', () => {
    const mine = asset('m', 'mine.png')
    const theirs = asset('t', 'theirs.png')
    let state = run(storedStudio(), { type: 'add-asset', asset: mine }, { type: 'edit-css', css: 'mine' })
    state = run(state, { type: 'rebase', snapshot: { project: { ...blankProject('house-a', NOW), revision: 7, assets: [meta(theirs)] }, assets: [theirs] } })
    expect(state.draft.css).toBe('mine')
    const request = saveRequest(state)
    expect(request.baseRevision).toBe(7)
    expect(request.putAssets.map(a => a.id)).toEqual(['m'])
    expect(request.deleteAssetIds).toEqual(['t'])
  })

  it('finds where an image is used', () => {
    const project = { pages: [{ name: 'a.html', html: '<img src="assets/Cat.png">' }, { name: 'b.html', html: '' }], css: 'body{background:url(assets/cat.png)}' }
    expect(assetUsedIn(project, 'cat.png')).toEqual(['a.html', 'style.css'])
    expect(assetUsedIn(project, 'dog.png')).toEqual([])
  })
})
