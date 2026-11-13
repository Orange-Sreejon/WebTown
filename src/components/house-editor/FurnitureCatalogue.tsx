import type { CatalogueEntryView, CatalogueThumbnail } from '../../lib/editor-bridge'
import { EDITOR_COLORS, EDITOR_FONT } from './editor-styles'

interface FurnitureCatalogueProps {
  entries: readonly CatalogueEntryView[]
  /** The type being placed, shown as pressed. */
  placingType: string | null
  disabled: boolean
  onChoose: (type: string) => void
}

/** Thumbnails fit in this square, in CSS pixels. */
const THUMB_BOX_PX = 32

/** Furniture that can be added. Choosing an entry starts placing it; choosing it again stops. */
export function FurnitureCatalogue(props: FurnitureCatalogueProps): React.ReactElement {
  const { entries, placingType, disabled, onChoose } = props
  return (
    <ul style={styles.list} aria-label="Furniture you can add">
      {entries.map(entry => {
        const pressed = entry.type === placingType
        return (
          <li key={entry.type} style={styles.item}>
            <button
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              style={{ ...styles.entry, ...(pressed ? styles.pressed : {}) }}
              onClick={() => onChoose(entry.type)}
            >
              <span style={styles.thumbBox} aria-hidden="true">
                {entry.thumbnail ? <span style={thumbnailStyle(entry.thumbnail)} /> : null}
              </span>
              <span>{entry.label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** One sheet rectangle drawn with CSS, scaled to fit the box, pixel-crisp. */
export function thumbnailStyle(t: CatalogueThumbnail): React.CSSProperties {
  const scale = Math.min(2, THUMB_BOX_PX / Math.max(t.w, t.h))
  return {
    display: 'block',
    width: Math.round(t.w * scale),
    height: Math.round(t.h * scale),
    backgroundImage: `url("${t.url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `${-t.x * scale}px ${-t.y * scale}px`,
    backgroundSize: `${t.sheetW * scale}px ${t.sheetH * scale}px`,
    imageRendering: 'pixelated',
  }
}

const styles = {
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  item: { margin: 0 },
  entry: {
    width: '100%',
    minHeight: 64,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 4,
    background: EDITOR_COLORS.button,
    color: EDITOR_COLORS.text,
    border: `2px solid ${EDITOR_COLORS.panelEdge}`,
    borderRadius: 4,
    fontFamily: EDITOR_FONT,
    fontSize: 11,
    cursor: 'pointer',
  },
  pressed: {
    border: `2px solid ${EDITOR_COLORS.valid}`,
    background: EDITOR_COLORS.buttonHover,
  },
  thumbBox: {
    width: THUMB_BOX_PX,
    height: THUMB_BOX_PX,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
} as const
