import type { SitePage } from '../../personal-spaces/site-project/types'

export interface PagesPanelProps {
  pages: readonly SitePage[]
  current: string
  homePage: string
  unsaved: ReadonlySet<string>
  onSelect: (name: string) => void
  onNew: () => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
  onSetHome: (name: string) => void
}

/** The website's pages: pick one to edit, add, rename, delete, choose the homepage. */
export function PagesPanel({ pages, current, homePage, unsaved, onSelect, onNew, onRename, onDelete, onSetHome }: PagesPanelProps): React.ReactElement {
  return (
    <section className="ws-panel" aria-labelledby="ws-pages-heading">
      <div className="ws-panel-head">
        <h2 id="ws-pages-heading" className="ws-panel-title">Pages</h2>
        <button type="button" className="wt-tool ws-small" onClick={onNew}>New page</button>
      </div>
      <ul className="ws-list" aria-label="Pages">
        {pages.map(page => {
          const isCurrent = page.name === current
          const isHome = page.name === homePage
          return (
            <li key={page.name} className={isCurrent ? 'ws-item ws-item--current' : 'ws-item'}>
              <button
                type="button"
                className="ws-item-name"
                onClick={() => onSelect(page.name)}
                aria-current={isCurrent ? 'page' : undefined}
                title={isHome ? `${page.name} (homepage)` : page.name}
              >
                <span aria-hidden="true" className="ws-home-mark">{isHome ? '★' : ''}</span>
                {page.name}
                {isHome && <span className="wt-sr-only"> (homepage)</span>}
                {unsaved.has(page.name) && <span className="ws-unsaved" title="Unsaved changes"> ●<span className="wt-sr-only"> unsaved</span></span>}
              </button>
              {isCurrent && (
                <span className="ws-item-actions">
                  <button type="button" className="ws-link" onClick={() => onRename(page.name)}>Rename</button>
                  {!isHome && <button type="button" className="ws-link" onClick={() => onSetHome(page.name)}>Set as homepage</button>}
                  <button
                    type="button"
                    className="ws-link"
                    onClick={() => onDelete(page.name)}
                    disabled={pages.length <= 1}
                    title={pages.length <= 1 ? 'A website needs at least one page.' : undefined}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
