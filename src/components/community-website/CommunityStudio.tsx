import { useMemo, useRef, type ComponentType, type ReactNode } from 'react'
import type { CloudBackend } from '../../cloud/backend'
import { CommunityDraftWriter } from '../../cloud/community-website'
import { hallTarget } from '../../personal-spaces/site-project/site-target'
import type { SiteProjectWriter } from '../../personal-spaces/site-project-storage/project-repository'
import type { WebsiteState } from '../../personal-spaces/site-project-storage/resolve-website'
import type { StudioState } from '../../personal-spaces/site-project/studio-state'
import type { CodeEditorProps } from '../website-studio/editor-types'
import { SiteStudio } from '../website-studio/SiteStudio'

export interface CommunityStudioProps {
  backend: CloudBackend
  worldId: string
  initial: StudioState
  /** The draft as stored now; used after a conflict. */
  reload: () => Promise<WebsiteState>
  /** Told the number of every draft this Studio saved, so a hint about it is not shown as someone else's. */
  onSaved: (number: number) => void
  banner?: ReactNode
  onExit: () => void
  onClose: () => void
  Editor?: ComponentType<CodeEditorProps>
  now?: () => string
}

/**
 * The Site Studio on the town's shared draft (CH-06): the same Studio as for houses, with the Hall as its target and
 * a writer that saves to the Community Hall. Loaded on demand, so viewing the Community Website never downloads the
 * Studio or the code editor.
 */
export function CommunityStudio({ backend, worldId, initial, reload, onSaved, banner, onExit, onClose, Editor, now }: CommunityStudioProps): React.ReactElement {
  const savedRef = useRef(onSaved)
  savedRef.current = onSaved
  const writer = useMemo<SiteProjectWriter>(() => {
    const inner = new CommunityDraftWriter(backend, worldId, now)
    return {
      save: async save => {
        const project = await inner.save(save)
        savedRef.current(project.revision)
        return project
      },
    }
  }, [backend, worldId, now])
  const target = useMemo(() => hallTarget(worldId), [worldId])
  return (
    <SiteStudio
      target={target}
      initial={initial}
      writer={writer}
      reload={reload}
      persistent
      banner={banner}
      onExit={onExit}
      onClose={onClose}
      {...(Editor ? { Editor } : {})}
      {...(now ? { now } : {})}
    />
  )
}

export default CommunityStudio
