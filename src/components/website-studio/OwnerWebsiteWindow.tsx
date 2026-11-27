import { useState, type ComponentType } from 'react'
import type { OwnerWebsiteAccess } from '../../personal-spaces/composition'
import { NOT_SAVED_NOTICE, savedLabel } from '../../personal-spaces/labels'
import { startStudio, type StudioState } from '../../personal-spaces/site-project/studio-state'
import { blankProject, classicProject } from '../../personal-spaces/site-project/templates'
import { houseTarget } from '../../personal-spaces/site-project/site-target'
import { WindowFrame } from '../apps/WindowFrame'
import { HouseWebsite } from '../website/HouseWebsite'
import { useWebsiteState } from '../website/useWebsiteState'
import type { CodeEditorProps } from './editor-types'
import { SiteStudio, unsavedStudio } from './SiteStudio'

export interface OwnerWebsiteWindowProps {
  /** Given only when the app bridge said `owner`. Its writer saves only this house. */
  access: Pick<OwnerWebsiteAccess, 'houseId' | 'open' | 'writer'>
  persistent: boolean
  onClose: () => void
  Editor?: ComponentType<CodeEditorProps>
  now?: () => string
}

function StartChoices({ onChoose, intro }: { onChoose: (kind: 'blank' | 'classic') => void; intro: React.ReactNode }): React.ReactElement {
  return (
    <div className="wt-start">
      {intro}
      <h2 className="wt-start-title">Build your website</h2>
      <p>Write your own pages in HTML and style them with CSS. Pick a starting point; you can change everything.</p>
      <div className="wt-start-choices">
        <button type="button" className="wt-tool wt-start-choice" onClick={() => onChoose('blank')}>
          <strong>Blank website</strong>
          <span>One empty page and an empty stylesheet.</span>
        </button>
        <button type="button" className="wt-tool wt-start-choice" onClick={() => onChoose('classic')}>
          <strong>Classic personal homepage</strong>
          <span>A few linked pages in a nostalgic style, to edit or tear apart.</span>
        </button>
      </div>
    </div>
  )
}

/**
 * The owner's website window: their website as visitors see it, with
 * "Open Site Studio"; or, when there is nothing yet, a choice of starting
 * point. Loaded on demand, only for the owner, so visitors never download the
 * Studio or the code editor.
 */
export function OwnerWebsiteWindow({ access, persistent, onClose, Editor, now = () => new Date().toISOString() }: OwnerWebsiteWindowProps): React.ReactElement {
  const { load, reload } = useWebsiteState(access.open)
  const [studio, setStudio] = useState<StudioState | null>(null)

  if (studio !== null) {
    return (
      <SiteStudio
        target={houseTarget(access.houseId)}
        initial={studio}
        writer={access.writer}
        reload={access.open}
        persistent={persistent}
        onExit={() => { setStudio(null); reload() }}
        onClose={onClose}
        Editor={Editor}
        now={now}
      />
    )
  }

  const startFrom = (kind: 'blank' | 'classic', baseRevision = 0): void => {
    const project = kind === 'blank' ? blankProject(access.houseId, now()) : classicProject(access.houseId, now())
    setStudio(unsavedStudio(project, [], baseRevision))
  }

  const website = load.status === 'ready' ? load.website : null
  const openStudio = (): void => {
    if (website?.kind === 'project') setStudio(startStudio(website.snapshot, { stored: true }))
    else if (website?.kind === 'migrated') setStudio(unsavedStudio(website.snapshot.project))
  }

  return (
    <WindowFrame title="WebTown Browser" onClose={onClose} size="wide">
      <HouseWebsite
        houseId={access.houseId}
        load={load}
        onRetry={reload}
        status={persistent ? `${savedLabel(true)}.` : NOT_SAVED_NOTICE}
        actions={<button type="button" className="wt-tool" onClick={openStudio}>Open Site Studio</button>}
        notice={website?.kind === 'migrated' && (
          <p className="wt-notice" role="status">
            This is your earlier website, turned into HTML and CSS files. Open Site Studio and save to keep this version.
            Your earlier website is not changed.
          </p>
        )}
        empty={<StartChoices onChoose={kind => startFrom(kind)} intro={<p className="wt-start-lead">Nothing here yet.</p>}/>}
        damaged={damaged => (
          <StartChoices
            onChoose={kind => startFrom(kind, damaged.revision)}
            intro={
              <div className="wt-notice wt-notice--problem" role="alert">
                Your saved website could not be read, so it can't be shown. Nothing was deleted: it is only replaced when
                you save a new website.
                <ul>{damaged.problems.slice(0, 3).map((problem, i) => <li key={i}>{problem}</li>)}</ul>
              </div>
            }
          />
        )}
      />
    </WindowFrame>
  )
}
