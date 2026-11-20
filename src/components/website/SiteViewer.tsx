import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { buildSitePage, findPage, type RenderableSite } from '../../personal-spaces/site-project/builder'
import {
  canGoBack,
  canGoForward,
  currentPage,
  historyReducer,
  startHistory,
} from '../../personal-spaces/site-project/page-history'
import { SiteFrame } from './SiteFrame'
import { siteAppBase } from './site-urls'
import './website.css'

export interface SiteViewerProps {
  /** The house whose website this is; shown in the display-only address. */
  houseId: string
  /** The website, ready to build pages from. Read-only data; nothing here can save. */
  site: RenderableSite
  /** The page shown first and by Home. */
  homePage: string
  /** The website's name, shown when a page has no `<title>`. */
  siteTitle: string
  /** A line about where the website is kept. */
  status: string
  /** Extra toolbar controls (the owner's "Open Site Studio"). */
  actions?: ReactNode
  /** Shown above the page. */
  notice?: ReactNode
}

/** The display-only address of a page, for example `webtown://house-a/about.html`. */
export const pageAddress = (houseId: string, page: string): string => `webtown://${houseId}/${page}`

/**
 * WebTown Browser: Back, Forward, Home and a display-only address around one
 * resident's website. Pages are built by the same `buildSitePage` the Studio
 * preview uses, so visitors see exactly what the owner previewed.
 *
 * History lives in memory only; it never touches the WebTown tab's address.
 */
export function SiteViewer({ houseId, site, homePage, siteTitle, status, actions, notice }: SiteViewerProps): React.ReactElement {
  const [history, dispatch] = useReducer(historyReducer, homePage, startHistory)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => dispatch({ type: 'reset', page: homePage }), [homePage])

  const page = currentPage(history)
  const built = useMemo(() => buildSitePage(site, page, siteAppBase()), [site, page])

  const followLink = useCallback(
    (target: string) => {
      const name = findPage(site, target) ?? target
      if (name === page) setRefresh(n => n + 1)
      else dispatch({ type: 'go', page: name })
    },
    [site, page],
  )

  // Alt+Left and Alt+Right, like a browser. Every action also has a button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        dispatch({ type: 'back' })
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        dispatch({ type: 'forward' })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const pageTitle = built.title.trim() || siteTitle

  return (
    <div className="wt-window">
      <div className="wt-toolbar" role="toolbar" aria-label="Browser controls">
        <button type="button" className="wt-tool" onClick={() => dispatch({ type: 'back' })} disabled={!canGoBack(history)} title="Back (Alt+Left)">
          Back
        </button>
        <button type="button" className="wt-tool" onClick={() => dispatch({ type: 'forward' })} disabled={!canGoForward(history)} title="Forward (Alt+Right)">
          Forward
        </button>
        <button type="button" className="wt-tool" onClick={() => dispatch({ type: 'go', page: homePage })} aria-label="Home page">
          Home
        </button>
        <button type="button" className="wt-tool" onClick={() => setRefresh(n => n + 1)}>
          Reload
        </button>
        <div className="wt-address">
          <label htmlFor="wt-address-field">Address</label>
          <input
            id="wt-address-field"
            type="text"
            readOnly
            value={pageAddress(houseId, page)}
            aria-label="Website address (display only)"
            spellCheck={false}
          />
        </div>
        {actions}
      </div>
      {notice}
      <p className="wt-page-title" aria-live="polite">{pageTitle}</p>
      <div className="wt-viewport">
        <SiteFrame html={built.html} renderKey={refresh} onPageLink={followLink} title={`Website: ${pageTitle}`} />
      </div>
      <p className="wt-status">{status}</p>
    </div>
  )
}
