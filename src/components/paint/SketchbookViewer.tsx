import { useEffect, useState } from 'react'
import type { Artwork } from '../../personal-spaces/artwork-storage/artwork'
import type { ArtworkReader } from '../../personal-spaces/artwork-storage/artwork-repository'
import { PersonalSpacesError } from '../../personal-spaces/errors'
import { VISITOR_LOCAL_NOTICE, VISITOR_NOT_SAVED_NOTICE } from '../../personal-spaces/labels'
import { WindowFrame } from '../apps/WindowFrame'
import { downloadPng, pngFileName } from './export'
import { ArtworkThumb } from './PaintDialogs'
import './paint.css'

export interface SketchbookViewerProps {
  houseId: string
  /** Read only: a visitor's window can look and nothing else. */
  reader: ArtworkReader
  persistent: boolean
  onClose: () => void
  download?: (bytes: ArrayBuffer, fileName: string) => void
}

type Load = { status: 'loading' } | { status: 'ready'; items: Artwork[]; skipped: number } | { status: 'error'; message: string }

/** A visitor's Sketchbook: the house's drawings, one at a time. Nothing here can change them. */
export function SketchbookViewer({ houseId, reader, persistent, onClose, download = downloadPng }: SketchbookViewerProps): React.ReactElement {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let current = true
    reader.list(houseId).then(
      list => { if (current) setLoad({ status: 'ready', items: list.items, skipped: list.skipped.length }) },
      (error: unknown) => {
        console.error('[WebTown] The Sketchbook could not be read.', error)
        if (current) setLoad({ status: 'error', message: error instanceof PersonalSpacesError ? error.message : 'The Sketchbook could not be opened.' })
      },
    )
    return () => { current = false }
  }, [houseId, reader])

  const items = load.status === 'ready' ? load.items : []
  const shown = items[index] ?? null
  const step = (by: number): void => setIndex(i => (items.length === 0 ? 0 : (i + by + items.length) % items.length))

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <WindowFrame title="Sketchbook (view only)" onClose={onClose} size="wide">
      <div className="pt-viewer">
        {load.status === 'loading' && <p className="pt-loading" role="status">Opening the Sketchbook...</p>}
        {load.status === 'error' && <p className="pt-loading" role="alert">{load.message}</p>}
        {load.status === 'ready' && items.length === 0 && (
          <p className="pt-loading">No drawings yet. The owner of this house hasn't drawn anything.</p>
        )}
        {shown && (
          <>
            <div className="pt-viewer-bar" role="toolbar" aria-label="Drawings">
              <button type="button" className="pt-button" onClick={() => step(-1)} disabled={items.length < 2}>Previous</button>
              <span className="pt-viewer-title" aria-live="polite">{shown.title} ({index + 1} of {items.length})</span>
              <button type="button" className="pt-button" onClick={() => step(1)} disabled={items.length < 2}>Next</button>
              <button type="button" className="pt-button" onClick={() => download(shown.png, pngFileName(shown.title))}>Export PNG</button>
            </div>
            <div className="pt-viewer-stage">
              <div className={shown.transparent ? 'pt-sheet pt-sheet--transparent' : 'pt-sheet'}>
                <ArtworkThumb artwork={shown} className="pt-viewer-image" />
              </div>
            </div>
            <p className="pt-viewer-meta">{shown.width} x {shown.height} pixels, changed {new Date(shown.updatedAt).toLocaleString()}</p>
          </>
        )}
        {load.status === 'ready' && load.skipped > 0 && <p className="pt-viewer-meta">Some drawings could not be shown.</p>}
        <p className="wt-status">{persistent ? VISITOR_LOCAL_NOTICE : VISITOR_NOT_SAVED_NOTICE}</p>
      </div>
    </WindowFrame>
  )
}
