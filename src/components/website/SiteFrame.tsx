import { useCallback, useEffect, useRef, useState } from 'react'
import {
  APP_MESSAGE_LIMIT_PER_SECOND,
  isFromHost,
  parseHostMessage,
  rateLimiter,
  splitPageTarget,
} from '../../personal-spaces/site-project/host-protocol'
import { validateExternalUrl } from '../../personal-spaces/website/url-policy'
import { siteHostUrl } from './site-urls'

/** Every powerful browser feature, denied to the website frames. */
const DENY = ['camera', 'microphone', 'geolocation', 'display-capture', 'fullscreen', 'payment', 'usb', 'serial', 'hid',
  'bluetooth', 'midi', 'clipboard-read', 'clipboard-write', 'publickey-credentials-get', 'screen-wake-lock',
  'xr-spatial-tracking', 'autoplay', 'encrypted-media', 'picture-in-picture', 'accelerometer', 'gyroscope',
  'magnetometer'].map(feature => `${feature} 'none'`).join('; ')

/** How long a page may take to appear before WebTown offers to stop it. */
export const SLOW_PAGE_MS = 3000

export interface SiteFrameProps {
  /** The built page (from `buildSitePage`), or null for nothing yet. */
  html: string | null
  /** Change to show the same page again (Refresh). */
  renderKey?: number
  /** A resident link to one of the site's pages was followed. */
  onPageLink: (page: string, fragment: string) => void
  /** Accessible name of the frame. */
  title: string
  /** Where the host page is; WebTown's own by default. Injected by tests. */
  hostUrl?: string
}

/**
 * Shows a resident's page inside two sandboxed frames (see
 * `public/site-host.html` and docs/site-sandbox-findings.md). The page runs no
 * script and reaches no network; it can only ask, through WebTown's static
 * navigation page, to follow a link.
 *
 * Every message from the host frame is checked: the sender must be that very
 * frame, with the opaque origin "null", within a rate limit, and in the closed
 * schema of `host-protocol.ts`. External links are never opened from inside
 * the frame: WebTown asks first, here, in its own interface.
 */
export function SiteFrame({ html, renderKey = 0, onPageLink, title, hostUrl }: SiteFrameProps): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [slow, setSlow] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [mountKey, setMountKey] = useState(0)
  const [external, setExternal] = useState<{ href: string; host: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const onPageLinkRef = useRef(onPageLink)
  onPageLinkRef.current = onPageLink

  // Send the page whenever it, or the Refresh counter, changes once the host is ready.
  useEffect(() => {
    if (!ready || stopped || html === null) return
    const target = frameRef.current?.contentWindow
    if (!target) return
    setWaiting(true)
    setSlow(false)
    setProblem(null)
    // The host is an opaque origin, so '*' is the only target that reaches it. It is the frame we created.
    target.postMessage({ t: 'render', html }, '*')
  }, [html, renderKey, ready, stopped, mountKey])

  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setSlow(true), SLOW_PAGE_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  useEffect(() => {
    const allow = rateLimiter(APP_MESSAGE_LIMIT_PER_SECOND)
    const onMessage = (event: MessageEvent): void => {
      if (!isFromHost(event, frameRef.current?.contentWindow ?? null)) return
      if (!allow()) return
      const message = parseHostMessage(event.data)
      if (!message) return
      switch (message.t) {
        case 'ready':
          setReady(true)
          break
        case 'rendered':
          setWaiting(false)
          setSlow(false)
          break
        case 'nav':
          if (message.kind === 'page') {
            const { page, fragment } = splitPageTarget(message.value)
            onPageLinkRef.current(page, fragment)
          } else {
            const check = validateExternalUrl(message.value)
            if (check.ok) setExternal({ href: check.href, host: new URL(check.href).host })
          }
          break
        case 'unexpected-nav':
          setProblem('This page tried to go somewhere else, so WebTown put it back.')
          break
        case 'loop-detected':
          setProblem('This page kept trying to go somewhere else, so WebTown stopped putting it back.')
          break
        case 'rate-limited':
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const stop = useCallback(() => {
    setStopped(true)
    setReady(false)
    setWaiting(false)
    setSlow(false)
  }, [])

  const restart = useCallback(() => {
    setStopped(false)
    setMountKey(n => n + 1)
  }, [])

  const openExternal = (): void => {
    const target = external
    setExternal(null)
    if (target && validateExternalUrl(target.href).ok) window.open(target.href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="wt-frame">
      {external !== null && (
        <div className="wt-confirm" role="alertdialog" aria-label="Open a link outside WebTown">
          <span>
            This page links to <strong>{external.host}</strong>, outside WebTown. Open it in a new tab?
          </span>
          <button type="button" className="wt-tool" onClick={openExternal}>Open</button>
          <button type="button" className="wt-tool" onClick={() => setExternal(null)}>Cancel</button>
        </div>
      )}
      {problem !== null && <p className="wt-notice" role="status">{problem}</p>}
      {slow && !stopped && (
        <div className="wt-notice" role="status">
          This page is taking a long time to show.{' '}
          <button type="button" className="wt-retry" onClick={stop}>Stop</button>
        </div>
      )}
      {stopped ? (
        <div className="wt-message" role="status">
          <p>The page was stopped.</p>
          <button type="button" className="wt-retry" onClick={restart}>Show it again</button>
        </div>
      ) : (
        <iframe
          key={mountKey}
          ref={frameRef}
          className="wt-frame-host"
          title={title}
          src={hostUrl ?? siteHostUrl()}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow={DENY}
        />
      )}
    </div>
  )
}
