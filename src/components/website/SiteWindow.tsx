import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import {
  LOCAL_ONLY_LABEL,
  NOT_SAVED_NOTICE,
  VISITOR_LOCAL_NOTICE,
  VISITOR_NOT_SAVED_NOTICE,
} from '../../personal-spaces/labels'
import {
  canGoBack,
  canGoForward,
  currentSection,
  initialNavState,
  navReducer,
  siteAddress,
} from '../../personal-spaces/website/site-navigation'
import type { SiteReader } from '../../personal-spaces/website/site-repository'
import {
  SITE_PAGES,
  type ReadonlySiteContent,
  type SectionId,
} from '../../personal-spaces/website/site-types'
import { WindowFrame } from '../apps/WindowFrame'
import { SiteRenderer } from './SiteRenderer'
import './website.css'

/** What the owner is told when a saved website could not be read. Plain data, no repository. */
export interface RecoveryNotice {
  problems: readonly string[]
}

interface SiteWindowProps {
  /** The house whose website this is. Also what the fictional address shows. */
  houseId: string
  /**
   * The only way this window gets data: it can load a site and nothing else.
   * There is no writer anywhere in this window or below it. Visitors and the
   * owner receive the same thing.
   */
  reader: SiteReader
  /**
   * True when the app bridge said the player owns this house. It only changes
   * what is *said* (the owner hears about a recovered record and about saving);
   * it grants nothing, and there is nothing to grant here.
   */
  isOwner: boolean
  /** False when browser storage was unusable and the site is held in memory. */
  persistent: boolean
  /** Set when the stored record was unreadable and the default is shown. Owner only. */
  recovery: RecoveryNotice | null
  onClose: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; site: ReadonlySiteContent }
  | { status: 'error'; message: string }

function describeFailure(error: unknown): string {
  if (error instanceof PersonalSpacesError) return error.message
  return 'Something went wrong while opening this website.'
}

/** What is said about where the website is kept. Never suggests anyone else can see it. */
export function storageStatus(isOwner: boolean, persistent: boolean): string {
  if (persistent) return isOwner ? `${LOCAL_ONLY_LABEL}.` : VISITOR_LOCAL_NOTICE
  return isOwner ? NOT_SAVED_NOTICE : VISITOR_NOT_SAVED_NOTICE
}

const pageLabel = (section: SectionId): string =>
  SITE_PAGES.find(page => page.id === section)?.label ?? section

/**
 * The website window: a small, fictional browser around one resident's site.
 *
 * It loads the site through a `SiteReader`, shows it with `SiteRenderer`, and
 * keeps its own back/forward history in memory. It does not touch Phaser, the
 * page's address bar or the browser's history. Closing it is the frame's
 * Close button or Escape; the host turns that into the `close` command.
 */
export function SiteWindow({
  houseId,
  reader,
  isOwner,
  persistent,
  recovery,
  onClose,
}: SiteWindowProps): React.ReactElement {
  const [nav, dispatch] = useReducer(navReducer, undefined, initialNavState)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const mainRef = useRef<HTMLElement>(null)
  const shownSection = useRef<SectionId | null>(null)

  const section = currentSection(nav)

  // Load. A stale answer (the window closed, or a retry started) is ignored.
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    reader.load(houseId).then(
      site => {
        if (current) setState({ status: 'ready', site })
      },
      (error: unknown) => {
        if (!current) return
        console.error('[WebTown] The website could not be loaded.', error)
        setState({ status: 'error', message: describeFailure(error) })
      },
    )
    return () => {
      current = false
    }
  }, [reader, houseId, attempt])

  // After the user moves to another page, put keyboard focus on it and say so.
  // Not on first show, so opening the window leaves focus on the window itself.
  useEffect(() => {
    if (state.status !== 'ready') return
    if (shownSection.current === null) {
      shownSection.current = section
      return
    }
    if (shownSection.current === section) return
    shownSection.current = section
    mainRef.current?.focus()
    setAnnouncement(`${pageLabel(section)} page`)
  }, [section, state.status])

  const navigate = useCallback((target: SectionId) => dispatch({ type: 'go', section: target }), [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // The browser's own shortcuts for back and forward.
    if (!event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      dispatch({ type: 'back' })
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      dispatch({ type: 'forward' })
    }
  }

  const address = useMemo(() => siteAddress(houseId, section), [houseId, section])
  const ready = state.status === 'ready'

  return (
    // The shortcuts are an extra; every action also has a button.
    <WindowFrame title="WebTown Browser" onClose={onClose} size="wide" onKeyDown={onKeyDown}>
      <div className="wt-window">
        <div className="wt-toolbar" role="toolbar" aria-label="Browser controls">
          <button
            type="button"
            className="wt-tool"
            onClick={() => dispatch({ type: 'back' })}
            disabled={!ready || !canGoBack(nav)}
            aria-label="Back"
            title="Back (Alt+Left)"
          >
            Back
          </button>
          <button
            type="button"
            className="wt-tool"
            onClick={() => dispatch({ type: 'forward' })}
            disabled={!ready || !canGoForward(nav)}
            aria-label="Forward"
            title="Forward (Alt+Right)"
          >
            Forward
          </button>
          <button
            type="button"
            className="wt-tool"
            onClick={() => dispatch({ type: 'home' })}
            disabled={!ready}
            aria-label="Home page"
          >
            Home
          </button>
          <div className="wt-address">
            <label htmlFor="wt-address-field">Address</label>
            <input
              id="wt-address-field"
              type="text"
              readOnly
              value={address}
              aria-label="Website address (display only)"
              spellCheck={false}
            />
          </div>
        </div>

        {isOwner && recovery !== null && (
          <div className="wt-notice wt-notice--problem" role="alert">
            Your saved website could not be read, so the default website is shown. Nothing was
            deleted: your saved data is only replaced when you save a new version.
            {recovery.problems.length > 0 && (
              <ul>
                {recovery.problems.slice(0, 3).map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="wt-viewport">
          {state.status === 'loading' && (
            <p className="wt-message" role="status">Loading website...</p>
          )}
          {state.status === 'error' && (
            <div className="wt-message" role="alert">
              <p>This website could not be opened. {state.message}</p>
              <button type="button" className="wt-retry" onClick={() => setAttempt(n => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {state.status === 'ready' && (
            <SiteRenderer site={state.site} section={section} onNavigate={navigate} mainRef={mainRef} />
          )}
        </div>

        <p className="wt-status">{storageStatus(isOwner, persistent)}</p>
        <p className="wt-sr-only" role="status" aria-live="polite">{announcement}</p>
      </div>
    </WindowFrame>
  )
}
