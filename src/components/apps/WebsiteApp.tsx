import { Suspense, lazy, useEffect, useState } from 'react'
import type { AppView } from '../../lib/app-bridge'
import {
  getSiteStorage,
  websiteAccessFor,
  type SiteStorage,
  type WebsiteAccess,
} from '../../personal-spaces/composition'
import { visitorNotice } from '../../personal-spaces/labels'
import { HouseWebsite } from '../website/HouseWebsite'
import { useWebsiteState } from '../website/useWebsiteState'
import { WindowFrame } from './WindowFrame'

/**
 * The owner's window, with the Site Studio and the code editor, is loaded on
 * demand and only for an owner. A visitor never imports it, so nothing that
 * can write is downloaded or evaluated for them (it is a separate chunk).
 */
const OwnerWebsiteWindow = lazy(() =>
  import('../website-studio/OwnerWebsiteWindow').then(module => ({ default: module.OwnerWebsiteWindow })),
)

interface WebsiteAppProps {
  /** What Phaser said: which house, and whether the player owns it. */
  view: AppView
  onClose: () => void
  /** Where storage comes from; the shared one by default. Injectable for tests. */
  getStorage?: () => Promise<SiteStorage>
}

type Opening =
  | { status: 'opening' }
  | { status: 'ready'; storage: SiteStorage; access: WebsiteAccess }
  | { status: 'failed'; message: string }

function Waiting({ onClose, children, alert = false }: { onClose: () => void; children: string; alert?: boolean }): React.ReactElement {
  return (
    <WindowFrame title="WebTown Browser" onClose={onClose} size="wide">
      <p role={alert ? 'alert' : 'status'} style={{ padding: 24, margin: 0 }}>{children}</p>
    </WindowFrame>
  )
}

/** A visitor's window: the website, read-only, and nothing that can save. */
function VisitorWebsiteWindow({ houseId, open, persistent, onClose }: { houseId: string; open: WebsiteAccess['open']; persistent: boolean; onClose: () => void }): React.ReactElement {
  const { load, reload } = useWebsiteState(open)
  return (
    <WindowFrame title="WebTown Browser" onClose={onClose} size="wide">
      <HouseWebsite
        houseId={houseId}
        load={load}
        onRetry={reload}
        status={visitorNotice(persistent)}
        empty={<p className="wt-message">Nothing here yet. The owner of this house hasn't made a website.</p>}
        damaged={() => <p className="wt-message">This website can't be shown right now.</p>}
      />
    </WindowFrame>
  )
}

/**
 * Connects the website window to storage and to what the app bridge decided.
 *
 * The bridge's `mode` goes straight into `websiteAccessFor`; this is not a
 * second ownership check. A writer exists only for `owner`, and only in the
 * owner branch below is it passed on. The visitor's window gets `access.open`
 * and nothing else.
 *
 * Phaser decides who is the owner, from a client-side stand-in. Browser
 * developer tools can bypass all of this; real enforcement is Phase 3b.
 */
export function WebsiteApp({ view, onClose, getStorage = getSiteStorage }: WebsiteAppProps): React.ReactElement {
  const [opening, setOpening] = useState<Opening>({ status: 'opening' })
  const houseId = view.houseId
  const mode = view.mode

  useEffect(() => {
    let current = true
    getStorage().then(
      storage => {
        if (current) setOpening({ status: 'ready', storage, access: websiteAccessFor({ houseId, mode }, storage) })
      },
      (error: unknown) => {
        console.error('[WebTown] Storage could not be opened.', error)
        if (current) setOpening({ status: 'failed', message: 'WebTown could not open its storage.' })
      },
    )
    return () => {
      current = false
    }
  }, [getStorage, houseId, mode])

  if (opening.status === 'failed') {
    return <Waiting onClose={onClose} alert>{`${opening.message} Close this window and try again.`}</Waiting>
  }
  if (opening.status === 'opening') return <Waiting onClose={onClose}>Opening website...</Waiting>

  const { access, storage } = opening

  if (access.mode === 'owner') {
    return (
      <Suspense fallback={<Waiting onClose={onClose}>Opening website...</Waiting>}>
        <OwnerWebsiteWindow access={access} persistent={storage.persistent} onClose={onClose} />
      </Suspense>
    )
  }

  return <VisitorWebsiteWindow houseId={houseId} open={access.open} persistent={storage.persistent} onClose={onClose} />
}
