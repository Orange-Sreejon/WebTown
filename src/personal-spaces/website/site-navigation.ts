import { HOUSE_ID_PATTERN, isSectionId, type SectionId } from './site-types'

/**
 * Back, forward and home for the website window.
 *
 * The history lives only in this object. It never touches the page's address,
 * the hash or the browser's own history, and it can hold nothing but the four
 * page ids, so navigation can never lead anywhere else. Pure and immutable:
 * every action returns a new state.
 */

export interface NavState {
  readonly entries: readonly SectionId[]
  /** Which entry is showing. */
  readonly index: number
}

export type NavAction =
  | { type: 'go'; section: unknown }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'home' }

/** The most pages remembered; the oldest are forgotten first. */
export const NAV_HISTORY_LIMIT = 50

export function initialNavState(): NavState {
  return { entries: ['home'], index: 0 }
}

export function currentSection(state: NavState): SectionId {
  return state.entries[state.index] ?? 'home'
}

export const canGoBack = (state: NavState): boolean => state.index > 0
export const canGoForward = (state: NavState): boolean => state.index < state.entries.length - 1

function visit(state: NavState, section: SectionId): NavState {
  // Going where you already are is not a new page.
  if (section === currentSection(state)) return state

  // A new page ends the "forward" trail, as in a browser.
  const kept = [...state.entries.slice(0, state.index + 1), section]
  const dropped = Math.max(0, kept.length - NAV_HISTORY_LIMIT)
  const entries = kept.slice(dropped)
  return { entries, index: entries.length - 1 }
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'go':
      // Anything that is not one of the four pages is ignored.
      return isSectionId(action.section) ? visit(state, action.section) : state
    case 'home':
      return visit(state, 'home')
    case 'back':
      return canGoBack(state) ? { ...state, index: state.index - 1 } : state
    case 'forward':
      return canGoForward(state) ? { ...state, index: state.index + 1 } : state
  }
}

/**
 * The made-up address shown in the window: `webtown://house-a/about`. It is
 * only for show. It cannot be typed into and is not a real address.
 */
export function siteAddress(houseId: string, section: SectionId): string {
  const host = HOUSE_ID_PATTERN.test(houseId) ? houseId : 'unknown'
  return `webtown://${host}/${section === 'home' ? '' : section}`
}
