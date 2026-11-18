import { Suspense, lazy, useEffect, useState } from 'react'
import type { AppView } from '../../lib/app-bridge'
import {
  getSiteStorage,
  onSiteLoad,
  siteAccessFor,
  type SiteAccess,
  type SiteStorage,
} from '../../personal-spaces/composition'
import { SiteWindow } from '../website/SiteWindow'
import type { RecoveryNotice } from '../website/SiteBrowser'
import { WindowFrame } from './WindowFrame'

/**
 * The owner's window, with the editor, is loaded on demand and only for an
 * owner. A visitor's page never imports it, so nothing that can write is even
 * downloaded or evaluated for them (it is a separate chunk in the build).
 */
const OwnerWebsiteWindow = lazy(() =>
  import('../website-editor/OwnerWebsiteWindow').then(module => ({ default: module.OwnerWebsiteWindow })),
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
  | { status: 'ready'; storage: SiteStorage; access: SiteAccess }
  | { status: 'failed'; message: string }

function Waiting({ onClose, children, alert = false }: { onClose: () => void; children: string; alert?: boolean }): React.ReactElement {
  return (
    <WindowFrame title="WebTown Browser" onClose={onClose} size="wide">
      <p role={alert ? 'alert' : 'status'} style={{ padding: 24, margin: 0 }}>{children}</p>
    </WindowFrame>
  )
}

/**
 * Connects the website window to storage and to what the app bridge decided.
 *
 * The bridge's `mode` goes straight into `siteAccessFor`; this is not a second
 * ownership check. `siteAccessFor` builds a writer only for `owner`, and only in
 * the owner branch below is it passed on, to the editor window. The visitor's
 * window is given `access.reader` and nothing else.
 *
 * Phaser decides who is the owner, from a client-side stand-in. Browser
 * developer tools can bypass all of this; real enforcement is Phase 3b.
 */
export function WebsiteApp({
  view,
  onClose,
  getStorage = getSiteStorage,
}: WebsiteAppProps): React.ReactElement {
  const [opening, setOpening] = useState<Opening>({ status: 'opening' })
  const [recovery, setRecovery] = useState<RecoveryNotice | null>(null)

  const houseId = view.houseId
  const mode = view.mode

  useEffect(() => {
    let current = true
    // Listen before storage is ready, so the first load's report is not missed.
    const stop = onSiteLoad(report => {
      if (report.houseId !== houseId) return
      setRecovery(report.origin === 'recovered' ? { problems: report.problems } : null)
    })

    getStorage().then(
      storage => {
        if (!current) return
        const access = siteAccessFor({ houseId, mode }, storage.repository)
        setOpening({ status: 'ready', storage, access })
      },
      (error: unknown) => {
        console.error('[WebTown] Storage could not be opened.', error)
        if (current) setOpening({ status: 'failed', message: 'WebTown could not open its storage.' })
      },
    )
    return () => {
      current = false
      stop()
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
        <OwnerWebsiteWindow
          houseId={houseId}
          reader={access.reader}
          writer={access.writer}
          persistent={storage.persistent}
          recovery={recovery}
          onClose={onClose}
        />
      </Suspense>
    )
  }

  return (
    <SiteWindow
      houseId={houseId}
      reader={access.reader}
      isOwner={false}
      persistent={storage.persistent}
      recovery={null}
      onClose={onClose}
    />
  )
}
