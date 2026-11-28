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
  /**
   * Told when a save starts and how it ended (the draft number it made, or null when it failed), so the database's
   * announcement of this very save, which can arrive before the answer, is never shown as someone else's.
   */
  onSaveStart: () => void
  onSaveEnd: (number: number | null) => void
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
export function CommunityStudio({ backend, worldId, initial, reload, onSaveStart, onSaveEnd, banner, onExit, onClose, Editor, now }: CommunityStudioProps): React.ReactElement {
  const told = useRef({ onSaveStart, onSaveEnd })
  told.current = { onSaveStart, onSaveEnd }
  const writer = useMemo<SiteProjectWriter>(() => {
    const inner = new CommunityDraftWriter(backend, worldId, now)
    return {
      save: async save => {
        told.current.onSaveStart()
        let number: number | null = null
        try {
          const project = await inner.save(save)
          number = project.revision
          return project
        } finally {
          told.current.onSaveEnd(number)
        }
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
