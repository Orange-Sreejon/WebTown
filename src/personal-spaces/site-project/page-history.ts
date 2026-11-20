/**
 * Back, forward and home for the WebTown Browser, over the site's page names.
 * Kept in memory only: it never touches the WebTown tab's address or history.
 */

export interface PageHistory {
  readonly entries: readonly string[]
  readonly index: number
}

export type HistoryAction =
  | { type: 'go'; page: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reset'; page: string }

export const HISTORY_LIMIT = 50

export const startHistory = (page: string): PageHistory => ({ entries: [page], index: 0 })
export const currentPage = (h: PageHistory): string => h.entries[h.index] ?? ''
export const canGoBack = (h: PageHistory): boolean => h.index > 0
export const canGoForward = (h: PageHistory): boolean => h.index < h.entries.length - 1

export function historyReducer(h: PageHistory, action: HistoryAction): PageHistory {
  switch (action.type) {
    case 'reset':
      return startHistory(action.page)
    case 'back':
      return canGoBack(h) ? { ...h, index: h.index - 1 } : h
    case 'forward':
      return canGoForward(h) ? { ...h, index: h.index + 1 } : h
    case 'go': {
      if (action.page === currentPage(h)) return h
      const kept = [...h.entries.slice(0, h.index + 1), action.page]
      const entries = kept.slice(Math.max(0, kept.length - HISTORY_LIMIT))
      return { entries, index: entries.length - 1 }
    }
  }
}
