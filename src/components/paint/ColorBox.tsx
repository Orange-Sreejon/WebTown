import { describeColor, toHex, type Rgba, type Swatch } from '../../personal-spaces/paint/color'

export interface ColorBoxProps {
  palette: readonly Swatch[]
  primary: Rgba
  secondary: Rgba
  onPrimary: (color: Rgba) => void
  onSecondary: (color: Rgba) => void
  /** Double-click: change this swatch to a custom colour. */
  onEditSwatch: (index: number) => void
  onSwap: () => void
}

const css = (c: Rgba): string => (c.a === 0 ? 'transparent' : toHex(c))

/**
 * The colour box: the foreground / background indicator and two rows of swatches.
 * Left click or Enter sets the foreground; right click or Shift+Enter the
 * background; double click edits the swatch.
 */
export function ColorBox({ palette, primary, secondary, onPrimary, onSecondary, onEditSwatch, onSwap }: ColorBoxProps): React.ReactElement {
  return (
    <div className="pt-colorbox">
      <button
        type="button"
        className="pt-current"
        onClick={onSwap}
        aria-label={`Foreground ${describeColor(primary)}, background ${describeColor(secondary)}. Swap them.`}
        title="Foreground and background colours (click to swap)"
      >
        <span className="pt-current-bg" style={{ background: css(secondary) }} data-testid="background-colour" />
        <span className="pt-current-fg" style={{ background: css(primary) }} data-testid="foreground-colour" />
      </button>
      <div className="pt-swatches" role="group" aria-label="Colours">
        {palette.map((swatch, i) => (
          <button
            key={i}
            type="button"
            className="pt-swatch"
            style={{ background: toHex(swatch.color) }}
            aria-label={describeColor(swatch.color, swatch.name)}
            title={`${describeColor(swatch.color, swatch.name)}: click for foreground, right-click for background, double-click to edit`}
            onClick={event => (event.shiftKey ? onSecondary(swatch.color) : onPrimary(swatch.color))}
            onContextMenu={event => {
              event.preventDefault()
              onSecondary(swatch.color)
            }}
            onDoubleClick={() => onEditSwatch(i)}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.shiftKey) {
                event.preventDefault()
                onSecondary(swatch.color)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}
