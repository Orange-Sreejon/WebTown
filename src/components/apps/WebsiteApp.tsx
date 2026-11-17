import { useEffect, useState } from 'react'
import type { AppView } from '../../lib/app-bridge'
import {
  getSiteStorage,
  onSiteLoad,
  siteAccessFor,
  type SiteAccess,
  type SiteStorage,
} from '../../personal-spaces/composition'
import { SiteWindow, type RecoveryNotice } from '../website/SiteWindow'
import { WindowFrame } from './WindowFrame'

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

/**
 * Connects the website window to storage and to what the app bridge decided.
 *
 * The bridge's `mode` goes straight into `siteAccessFor`; this is not a second
 * ownership check. The window below is handed `access.reader` and nothing
 * else: no writer is passed down in either mode (the editor, a separate task,
 * will be the first thing that gets one, and only for an owner).
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

  const reader = opening.status === 'ready' ? opening.access.reader : null
  const persistent = opening.status === 'ready' ? opening.storage.persistent : true
  const isOwner = opening.status === 'ready' && opening.access.mode === 'owner'

  if (reader === null) {
    return (
      <WindowFrame title="WebTown Browser" onClose={onClose} size="wide">
        <p role={opening.status === 'failed' ? 'alert' : 'status'} style={{ padding: 24, margin: 0 }}>
          {opening.status === 'failed' ? `${opening.message} Close this window and try again.` : 'Opening website...'}
        </p>
      </WindowFrame>
    )
  }

  return (
    <SiteWindow
      houseId={houseId}
      reader={reader}
      isOwner={isOwner}
      persistent={persistent}
      // Only the owner is told about a recovered record, and there is nothing to act on here.
      recovery={isOwner ? recovery : null}
      onClose={onClose}
    />
  )
}
