import { useEffect, useState } from 'react'
import { onAppState } from '../../lib/app-bridge'
import {
  HIDDEN_EDITOR_VIEW,
  emitEditorCommand,
  onEditorState,
  type EditorCommand,
  type EditorView,
} from '../../lib/editor-bridge'
import { EditHouseButton } from './EditHouseButton'
import { EditorPanel } from './EditorPanel'

interface HouseEditorOverlayProps {
  /** Where commands go; the event bus by default. Injectable for tests. */
  sendCommand?: (command: EditorCommand) => void
}

/**
 * The editor UI over the game canvas. It renders whatever the interior scene
 * last published and sends commands back over the event bus; it never reaches
 * into Phaser. The layer itself lets pointer events through, so the canvas
 * keeps receiving drags; only the button and the panel take clicks.
 */
export function HouseEditorOverlay({ sendCommand = emitEditorCommand }: HouseEditorOverlayProps): React.ReactElement | null {
  const [view, setView] = useState<EditorView>(HIDDEN_EDITOR_VIEW)
  const [collapsed, setCollapsed] = useState(false)
  // The website and Paint cover the game; the editor controls stay out of the way.
  const [appOpen, setAppOpen] = useState(false)

  useEffect(() => onEditorState(setView), [])
  useEffect(() => onAppState(app => setAppOpen(app.open !== null)), [])

  // A fresh edit always opens with the panel showing.
  useEffect(() => {
    if (view.mode === 'play') setCollapsed(false)
  }, [view.mode])

  if (!view.canEdit || appOpen) return null

  return (
    <div style={styles.layer}>
      {view.mode === 'play' ? (
        <EditHouseButton onClick={() => sendCommand({ type: 'enter-edit' })} />
      ) : (
        <EditorPanel
          view={view}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(c => !c)}
          onCommand={sendCommand}
        />
      )}
    </div>
  )
}

const styles = {
  layer: {
    position: 'absolute' as const,
    inset: 0,
    pointerEvents: 'none' as const,
  },
} as const
