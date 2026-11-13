import { EDITOR_COLORS, EDITOR_FONT } from './editor-styles'

interface EditHouseButtonProps {
  onClick: () => void
}

/** Shown in the player's own house while walking around; opens the editor. */
export function EditHouseButton({ onClick }: EditHouseButtonProps): React.ReactElement {
  return (
    <button type="button" style={styles.button} onClick={onClick}>
      <span aria-hidden="true">✎ </span>Edit House
    </button>
  )
}

const styles = {
  button: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    pointerEvents: 'auto' as const,
    padding: '8px 14px',
    background: EDITOR_COLORS.panel,
    color: EDITOR_COLORS.text,
    border: `2px solid ${EDITOR_COLORS.panelEdge}`,
    borderRadius: 4,
    fontFamily: EDITOR_FONT,
    fontSize: 14,
    cursor: 'pointer',
  },
} as const
