import { describe, expect, it } from 'vitest'
import {
  NAV_HISTORY_LIMIT,
  canGoBack,
  canGoForward,
  currentSection,
  initialNavState,
  navReducer,
  siteAddress,
  type NavAction,
  type NavState,
} from './site-navigation'
import { SECTION_IDS } from './site-types'

const run = (...actions: NavAction[]): NavState =>
  actions.reduce<NavState>((state, action) => navReducer(state, action), initialNavState())

const go = (section: unknown): NavAction => ({ type: 'go', section })

describe('navigation history', () => {
  it('starts on the home page with nowhere to go back or forward', () => {
    const state = initialNavState()
    expect(currentSection(state)).toBe('home')
    expect(canGoBack(state)).toBe(false)
    expect(canGoForward(state)).toBe(false)
  })

  it('moves to another page and can come back', () => {
    const state = run(go('about'))
    expect(currentSection(state)).toBe('about')
    expect(canGoBack(state)).toBe(true)
    expect(currentSection(navReducer(state, { type: 'back' }))).toBe('home')
  })

  it('goes forward again after going back', () => {
    const back = run(go('about'), { type: 'back' })
    expect(canGoForward(back)).toBe(true)
    expect(currentSection(navReducer(back, { type: 'forward' }))).toBe('about')
  })

  it('walks through several pages in order, both ways', () => {
    let state = run(go('about'), go('projects'), go('links'))
    const seen = [currentSection(state)]
    while (canGoBack(state)) {
      state = navReducer(state, { type: 'back' })
      seen.push(currentSection(state))
    }
    expect(seen).toEqual(['links', 'projects', 'about', 'home'])
    while (canGoForward(state)) state = navReducer(state, { type: 'forward' })
    expect(currentSection(state)).toBe('links')
  })

  it('ends the forward trail when a new page is visited, as a browser does', () => {
    const state = run(go('about'), go('projects'), { type: 'back' }, go('links'))
    expect(currentSection(state)).toBe('links')
    expect(canGoForward(state)).toBe(false)
    expect(state.entries).toEqual(['home', 'about', 'links'])
  })

  it('does not add an entry for the page already showing', () => {
    const state = run(go('about'), go('about'), go('about'))
    expect(state.entries).toEqual(['home', 'about'])
    expect(run(go('home')).entries).toEqual(['home'])
  })

  it('goes home from anywhere, and home is a page in the history', () => {
    const state = run(go('about'), go('links'), { type: 'home' })
    expect(currentSection(state)).toBe('home')
    expect(state.entries).toEqual(['home', 'about', 'links', 'home'])
    expect(currentSection(navReducer(state, { type: 'back' }))).toBe('links')
  })

  it('does nothing when there is nowhere to go', () => {
    const start = initialNavState()
    expect(navReducer(start, { type: 'back' })).toBe(start)
    expect(navReducer(start, { type: 'forward' })).toBe(start)
    expect(navReducer(start, { type: 'home' })).toBe(start)
  })

  it('ignores anything that is not one of the four pages', () => {
    const start = initialNavState()
    for (const bad of ['', 'settings', 'ABOUT', 'about ', '../about', 'https://evil.example/', 'javascript:alert(1)',
      '<script>', 5, null, undefined, {}, ['about']]) {
      expect(navReducer(start, go(bad)), JSON.stringify(bad)).toBe(start)
    }
  })

  it('accepts exactly the four pages', () => {
    for (const section of SECTION_IDS) expect(currentSection(run(go(section)))).toBe(section)
  })

  it('never changes a state it was given', () => {
    const start = run(go('about'))
    const snapshot = JSON.stringify(start)
    navReducer(start, go('links'))
    navReducer(start, { type: 'back' })
    expect(JSON.stringify(start)).toBe(snapshot)
  })

  it('remembers a limited number of pages, forgetting the oldest', () => {
    let state = initialNavState()
    for (let i = 0; i < NAV_HISTORY_LIMIT * 3; i++) {
      state = navReducer(state, go(i % 2 === 0 ? 'about' : 'links'))
    }
    expect(state.entries.length).toBe(NAV_HISTORY_LIMIT)
    expect(state.index).toBe(NAV_HISTORY_LIMIT - 1)
    expect(canGoForward(state)).toBe(false)
    expect(currentSection(state)).toBe('links')
  })
})

describe('siteAddress', () => {
  it('shows a made-up address for each page', () => {
    expect(siteAddress('house-a', 'home')).toBe('webtown://house-a/')
    expect(siteAddress('house-a', 'about')).toBe('webtown://house-a/about')
    expect(siteAddress('house-b', 'projects')).toBe('webtown://house-b/projects')
    expect(siteAddress('house-c', 'links')).toBe('webtown://house-c/links')
  })

  it('never puts an unexpected house id into the address', () => {
    expect(siteAddress('House A/../x', 'about')).toBe('webtown://unknown/about')
    expect(siteAddress('', 'home')).toBe('webtown://unknown/')
    expect(siteAddress('<script>', 'links')).toBe('webtown://unknown/links')
  })
})
