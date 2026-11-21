import { Suspense, lazy, useEffect, useState } from 'react'
import type { AppView } from '../../lib/app-bridge'
import { getSiteStorage, paintAccessFor, type PaintAccess, type SiteStorage } from '../../personal-spaces/composition'
import { SketchbookViewer } from '../paint/SketchbookViewer'
import { WindowFrame } from './WindowFrame'

/**
 * WebTown Paint (with the only Sketchbook writer) is loaded on demand and only
 * for the owner. A visitor never imports it, so nothing that can change a
 * drawing is downloaded or run for them.
 */
const OwnerPaintWindow = lazy(() => import('../paint/OwnerPaintWindow').then(module => ({ default: module.OwnerPaintWindow })))

interface PaintAppProps {
  /** What Phaser said: which house, and whether the player owns it. */
  view: AppView
  onClose: () => void
  /** Where storage comes from; the shared one by default. Injectable for tests. */
  getStorage?: () => Promise<SiteStorage>
}

type Opening =
  | { status: 'opening' }
  | { status: 'ready'; storage: SiteStorage; access: PaintAccess }
  | { status: 'failed' }

function Waiting({ onClose, children, alert = false }: { onClose: () => void; children: string; alert?: boolean }): React.ReactElement {
  return (
    <WindowFrame title="Sketchbook" onClose={onClose}>
      <p role={alert ? 'alert' : 'status'} style={{ margin: 0 }}>{children}</p>
    </WindowFrame>
  )
}

/**
 * Connects the Sketchbook to storage and to what the app bridge decided. The
 * bridge's `mode` goes straight into `paintAccessFor`; a writer exists only for
 * `owner`, and only the owner branch passes it on. Client-side only (Phase 3a).
 */
export function PaintApp({ view, onClose, getStorage = getSiteStorage }: PaintAppProps): React.ReactElement {
  const [opening, setOpening] = useState<Opening>({ status: 'opening' })
  const houseId = view.houseId
  const mode = view.mode

  useEffect(() => {
    let current = true
    getStorage().then(
      storage => { if (current) setOpening({ status: 'ready', storage, access: paintAccessFor({ houseId, mode }, storage) }) },
      (error: unknown) => {
        console.error('[WebTown] Storage could not be opened.', error)
        if (current) setOpening({ status: 'failed' })
      },
    )
    return () => { current = false }
  }, [getStorage, houseId, mode])

  if (opening.status === 'failed') return <Waiting onClose={onClose} alert>WebTown could not open its storage. Close this window and try again.</Waiting>
  if (opening.status === 'opening') return <Waiting onClose={onClose}>Opening the Sketchbook...</Waiting>

  const { access, storage } = opening
  if (access.mode === 'owner') {
    return (
      <Suspense fallback={<Waiting onClose={onClose}>Opening the Sketchbook...</Waiting>}>
        <OwnerPaintWindow access={access} persistent={storage.persistent} onClose={onClose} />
      </Suspense>
    )
  }
  return <SketchbookViewer houseId={houseId} reader={access.reader} persistent={storage.persistent} onClose={onClose} />
}
