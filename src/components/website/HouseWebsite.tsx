import { useMemo, type ReactNode } from 'react'
import { toRenderable } from '../../personal-spaces/site-project/builder'
import type { SiteSnapshot } from '../../personal-spaces/site-project/types'
import type { WebsiteState } from '../../personal-spaces/site-project-storage/resolve-website'
import { SiteViewer } from './SiteViewer'
import type { WebsiteLoad } from './useWebsiteState'
import './website.css'

export interface HouseWebsiteProps {
  houseId: string
  load: WebsiteLoad
  onRetry: () => void
  /** A line about where the website is kept. */
  status: string
  /** Extra toolbar controls when a website is showing (the owner's Studio button). */
  actions?: ReactNode
  notice?: ReactNode
  /** What to show when there is no website: visitors and owners are told different things. */
  empty: ReactNode
  /** What to show when the stored website cannot be read. */
  damaged: (website: Extract<WebsiteState, { kind: 'damaged' }>) => ReactNode
}

function Viewer({ houseId, snapshot, status, actions, notice }: { houseId: string; snapshot: SiteSnapshot; status: string; actions?: ReactNode; notice?: ReactNode }): React.ReactElement {
  const site = useMemo(() => toRenderable(snapshot.project, snapshot.assets), [snapshot])
  return (
    <SiteViewer
      houseId={houseId}
      site={site}
      homePage={snapshot.project.homePage}
      siteTitle={snapshot.project.title}
      status={status}
      actions={actions}
      notice={notice}
    />
  )
}

/** A house's website as anyone sees it: loading, the site itself, nothing yet, or a problem. Read-only. */
export function HouseWebsite({ houseId, load, onRetry, status, actions, notice, empty, damaged }: HouseWebsiteProps): React.ReactElement {
  if (load.status === 'loading') return <p className="wt-message" role="status">Loading website...</p>
  if (load.status === 'error') {
    return (
      <div className="wt-message" role="alert">
        <p>This website could not be opened. {load.message}</p>
        <button type="button" className="wt-retry" onClick={onRetry}>Try again</button>
      </div>
    )
  }
  const { website } = load
  if (website.kind === 'none') return <div className="wt-window wt-empty">{empty}</div>
  if (website.kind === 'damaged') return <div className="wt-window wt-empty">{damaged(website)}</div>

  const skipped = website.kind === 'project' && website.skipped.length > 0
  return (
    <Viewer
      houseId={houseId}
      snapshot={website.snapshot}
      status={status}
      actions={actions}
      notice={
        <>
          {notice}
          {skipped && (
            <p className="wt-notice wt-notice--problem" role="status">
              Some images on this website could not be loaded and are left out.
            </p>
          )}
        </>
      }
    />
  )
}
