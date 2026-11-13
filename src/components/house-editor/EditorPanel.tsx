import type { EditorCommand, EditorView } from '../../lib/editor-bridge'
import { EDITOR_COLORS, EDITOR_FONT, EDITOR_PANEL_WIDTH_PX } from './editor-styles'
import { FurnitureCatalogue } from './FurnitureCatalogue'

interface EditorPanelProps {
  view: EditorView
  collapsed: boolean
  onToggleCollapsed: () => void
  onCommand: (command: EditorCommand) => void
}

export const RELOAD_NOTICE = 'Changes are kept only until you reload the page.'

/** What the status line says: an error first, then the live preview, then the last refusal. */
export function statusText(view: EditorView): { text: string; tone: 'valid' | 'invalid' | 'neutral' } {
  if (view.saving) return { text: 'Saving…', tone: 'neutral' }
  if (view.error) return { text: view.error, tone: 'invalid' }
  if (view.preview) {
    return view.preview.valid
      ? { text: 'This spot is free', tone: 'valid' }
      : { text: view.preview.message ?? 'This spot is not free', tone: 'invalid' }
  }
  if (view.message) return { text: view.message, tone: 'invalid' }
  if (view.placingType) return { text: 'Move into the room and click a free spot. Esc stops.', tone: 'neutral' }
  return { text: '', tone: 'neutral' }
}

/** The editing controls: save/cancel, the selection, live status and the catalogue. */
export function EditorPanel(props: EditorPanelProps): React.ReactElement {
  const { view, collapsed, onToggleCollapsed, onCommand } = props
  const status = statusText(view)
  const removeReasonId = 'house-editor-remove-reason'

  return (
    <section aria-label="House editor" style={{ ...styles.panel, ...(collapsed ? styles.collapsed : {}) }}>
      <div style={styles.header}>
        <h2 style={styles.title}>Edit House</h2>
        <button
          type="button"
          style={styles.small}
          aria-expanded={!collapsed}
          aria-controls="house-editor-body"
          onClick={onToggleCollapsed}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          style={{ ...styles.button, ...styles.primary }}
          disabled={!view.dirty || view.saving}
          onClick={() => onCommand({ type: 'save' })}
        >
          {view.saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          style={styles.button}
          disabled={view.saving}
          onClick={() => onCommand({ type: 'cancel' })}
        >
          Cancel
        </button>
      </div>

      <p
        role="status"
        aria-live="polite"
        style={{ ...styles.status, color: TONE_COLORS[status.tone] }}
      >
        {status.text}
      </p>

      {/* Next to Save on purpose: it must be visible without scrolling. */}
      <p style={styles.notice}>{RELOAD_NOTICE}</p>

      {collapsed ? null : (
        <div id="house-editor-body">
          <div style={styles.block}>
            {view.selected ? (
              <>
                <p style={styles.line}>
                  Selected: <strong>{view.selected.label}</strong>
                </p>
                <button
                  type="button"
                  style={styles.button}
                  disabled={!view.selected.canRemove || view.saving}
                  aria-describedby={view.selected.removeBlockedReason ? removeReasonId : undefined}
                  onClick={() => onCommand({ type: 'remove-selected' })}
                >
                  Remove
                </button>
                {view.selected.removeBlockedReason ? (
                  <p id={removeReasonId} style={styles.hint}>{view.selected.removeBlockedReason}</p>
                ) : null}
              </>
            ) : (
              <p style={styles.hint}>Click furniture to select it. Drag it to move it.</p>
            )}
          </div>

          <h3 style={styles.subtitle}>Add furniture</h3>
          <FurnitureCatalogue
            entries={view.catalogue}
            placingType={view.placingType}
            disabled={view.saving}
            onChoose={type => onCommand({ type: 'start-placing', furnitureType: type })}
          />
        </div>
      )}
    </section>
  )
}

const TONE_COLORS = {
  valid: EDITOR_COLORS.valid,
  invalid: EDITOR_COLORS.invalid,
  neutral: EDITOR_COLORS.muted,
} as const

const styles = {
  panel: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: EDITOR_PANEL_WIDTH_PX,
    pointerEvents: 'auto' as const,
    overflowY: 'auto' as const,
    padding: 12,
    background: EDITOR_COLORS.panel,
    color: EDITOR_COLORS.text,
    borderLeft: `2px solid ${EDITOR_COLORS.panelEdge}`,
    fontFamily: EDITOR_FONT,
    fontSize: 12,
  },
  collapsed: { bottom: 'auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { margin: 0, fontSize: 14 },
  subtitle: { margin: '14px 0 6px', fontSize: 12 },
  actions: { display: 'flex', gap: 6, marginTop: 10 },
  button: {
    flex: 1,
    padding: '6px 8px',
    background: EDITOR_COLORS.button,
    color: EDITOR_COLORS.text,
    border: `2px solid ${EDITOR_COLORS.panelEdge}`,
    borderRadius: 4,
    fontFamily: EDITOR_FONT,
    fontSize: 12,
    cursor: 'pointer',
  },
  primary: { background: EDITOR_COLORS.primary },
  small: {
    padding: '2px 8px',
    background: EDITOR_COLORS.button,
    color: EDITOR_COLORS.text,
    border: `1px solid ${EDITOR_COLORS.panelEdge}`,
    borderRadius: 4,
    fontFamily: EDITOR_FONT,
    fontSize: 11,
    cursor: 'pointer',
  },
  status: { minHeight: 32, margin: '10px 0 0', lineHeight: 1.35 },
  block: { marginTop: 8 },
  line: { margin: '0 0 6px' },
  hint: { margin: '6px 0 0', color: EDITOR_COLORS.muted, lineHeight: 1.35 },
  notice: {
    margin: '6px 0 0',
    padding: 6,
    border: `1px dashed ${EDITOR_COLORS.panelEdge}`,
    color: EDITOR_COLORS.muted,
    lineHeight: 1.35,
  },
} as const
