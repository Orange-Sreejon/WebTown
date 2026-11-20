import { useRef, useState } from 'react'
import { ASSET_FOLDER, type SiteAssetMeta } from '../../personal-spaces/site-project/types'
import { formatBytes } from '../../personal-spaces/site-project/rules'

export interface AssetsPanelProps {
  assets: readonly SiteAssetMeta[]
  /** A preview address for each image id (a data URL). */
  thumbnail: (id: string) => string | undefined
  onUpload: (files: File[]) => void
  onCopyPath: (asset: SiteAssetMeta) => void
  onInsert: (asset: SiteAssetMeta) => void
  onDelete: (asset: SiteAssetMeta) => void
  /** False when no editor is showing, so there is nowhere to insert. */
  canInsert: boolean
}

export const ACCEPTED_UPLOADS = '.png,.jpg,.jpeg,.gif,.webp,.svg,image/png,image/jpeg,image/gif,image/webp,image/svg+xml'

/** Uploaded images: add (button or drag and drop), copy the path, insert, delete. */
export function AssetsPanel({ assets, thumbnail, onUpload, onCopyPath, onInsert, onDelete, canInsert }: AssetsPanelProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <section
      className={dragging ? 'ws-panel ws-drop ws-drop--on' : 'ws-panel ws-drop'}
      aria-labelledby="ws-assets-heading"
      onDragOver={event => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        const files = [...event.dataTransfer.files]
        if (files.length > 0) onUpload(files)
      }}
    >
      <div className="ws-panel-head">
        <h2 id="ws-assets-heading" className="ws-panel-title">Images</h2>
        <button type="button" className="wt-tool ws-small" onClick={() => inputRef.current?.click()}>Upload</button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_UPLOADS}
          multiple
          hidden
          aria-label="Upload images"
          onChange={event => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) onUpload(files)
          }}
        />
      </div>
      <p className="ws-hint">PNG, JPEG, GIF (animated too), WebP or SVG, up to 5 MB each. Drop files here.</p>
      {assets.length === 0 ? (
        <p className="ws-hint">No images yet.</p>
      ) : (
        <ul className="ws-list" aria-label="Images">
          {assets.map(asset => {
            const src = thumbnail(asset.id)
            const path = `${ASSET_FOLDER}/${asset.name}`
            return (
              <li key={asset.id} className="ws-asset">
                {src ? <img className="ws-thumb" src={src} alt="" /> : <span className="ws-thumb" aria-hidden="true" />}
                <span className="ws-asset-text">
                  <code className="ws-path">{path}</code>
                  <span className="ws-hint">{formatBytes(asset.size)}</span>
                  <span className="ws-item-actions">
                    <button type="button" className="ws-link" onClick={() => onCopyPath(asset)} aria-label={`Copy path ${path}`}>Copy path</button>
                    <button type="button" className="ws-link" onClick={() => onInsert(asset)} disabled={!canInsert} aria-label={`Insert ${asset.name}`}>Insert</button>
                    <button type="button" className="ws-link" onClick={() => onDelete(asset)} aria-label={`Delete ${asset.name}`}>Delete</button>
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
