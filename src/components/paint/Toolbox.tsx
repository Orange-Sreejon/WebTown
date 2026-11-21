import {
  AIRBRUSH_SIZES,
  BRUSH_SIZES,
  ERASER_SIZES,
  FILL_STYLES,
  FONT_SIZES,
  LINE_WIDTHS,
  TOOLS,
  type ToolId,
  type ToolSettings,
} from '../../personal-spaces/paint/tools'
import { RedoIcon, ToolIcon, UndoIcon } from './icons'

export interface ToolboxProps {
  tool: ToolId
  settings: ToolSettings
  onTool: (tool: ToolId) => void
  onSettings: (change: Partial<ToolSettings>) => void
  onHint: (hint: string | null) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** The two-column toolbox, the options box for the current tool, and Undo / Redo. */
export function Toolbox({ tool, settings, onTool, onSettings, onHint, canUndo, canRedo, onUndo, onRedo }: ToolboxProps): React.ReactElement {
  return (
    <div className="pt-toolbox">
      <div className="pt-tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        {TOOLS.map(info => (
          <button
            key={info.id}
            type="button"
            className="pt-tool"
            aria-pressed={tool === info.id}
            aria-label={info.label}
            title={info.label}
            data-tool={info.id}
            onClick={() => onTool(info.id)}
            onPointerEnter={() => onHint(info.hint)}
            onPointerLeave={() => onHint(null)}
            onFocus={() => onHint(info.hint)}
          >
            <ToolIcon tool={info.id} />
          </button>
        ))}
      </div>
      <ToolOptions tool={tool} settings={settings} onSettings={onSettings} />
      <div className="pt-history" role="group" aria-label="Undo and redo">
        <button type="button" className="pt-tool" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <UndoIcon />
        </button>
        <button type="button" className="pt-tool" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">
          <RedoIcon />
        </button>
      </div>
    </div>
  )
}

interface ChoiceProps<T> {
  label: string
  values: readonly T[]
  current: T
  describe: (value: T) => string
  draw: (value: T) => React.ReactNode
  onChoose: (value: T) => void
}

function Choices<T extends string | number>({ label, values, current, describe, draw, onChoose }: ChoiceProps<T>): React.ReactElement {
  return (
    <div className="pt-options" role="radiogroup" aria-label={label}>
      {values.map(value => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === current}
          aria-label={describe(value)}
          title={describe(value)}
          className={value === current ? 'pt-option pt-option--on' : 'pt-option'}
          onClick={() => onChoose(value)}
        >
          {draw(value)}
        </button>
      ))}
    </div>
  )
}

const dot = (size: number, max: number): React.ReactNode => {
  const shown = Math.max(1, Math.round((size / max) * 12))
  return <span className="pt-dot" style={{ width: shown, height: shown, borderRadius: size > 2 ? '50%' : 0 }} />
}
const bar = (width: number): React.ReactNode => <span className="pt-bar" style={{ height: width }} />

function FillStyleIcon({ style }: { style: 'outline' | 'both' | 'fill' }): React.ReactElement {
  return (
    <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true" shapeRendering="crispEdges">
      <rect x="1.5" y="1.5" width="21" height="7" fill={style === 'outline' ? 'none' : style === 'both' ? '#808080' : '#000'} stroke={style === 'fill' ? 'none' : '#000'} />
    </svg>
  )
}

/** The options box under the tools: what the current tool can be set to. */
export function ToolOptions({ tool, settings, onSettings }: Pick<ToolboxProps, 'tool' | 'settings' | 'onSettings'>): React.ReactElement {
  let body: React.ReactNode = null
  switch (tool) {
    case 'brush':
      body = <Choices label="Brush size" values={BRUSH_SIZES} current={settings.brushSize as typeof BRUSH_SIZES[number]} describe={v => `Brush size ${v} pixels`} draw={v => dot(v, 12)} onChoose={v => onSettings({ brushSize: v })} />
      break
    case 'eraser':
      body = <Choices label="Eraser size" values={ERASER_SIZES} current={settings.eraserSize as typeof ERASER_SIZES[number]} describe={v => `Eraser size ${v} pixels`} draw={v => <span className="pt-square" style={{ width: Math.round(v * 0.75), height: Math.round(v * 0.75) }} />} onChoose={v => onSettings({ eraserSize: v })} />
      break
    case 'airbrush':
      body = <Choices label="Spray size" values={AIRBRUSH_SIZES} current={settings.airbrushSize as typeof AIRBRUSH_SIZES[number]} describe={v => `Spray size ${v} pixels`} draw={v => dot(v, 24)} onChoose={v => onSettings({ airbrushSize: v })} />
      break
    case 'line':
      body = <Choices label="Line width" values={LINE_WIDTHS} current={settings.lineWidth as typeof LINE_WIDTHS[number]} describe={v => `Line width ${v} pixels`} draw={bar} onChoose={v => onSettings({ lineWidth: v })} />
      break
    case 'rectangle':
    case 'ellipse':
      body = (
        <>
          <Choices label="Fill style" values={FILL_STYLES.map(f => f.id)} current={settings.fillStyle} describe={v => FILL_STYLES.find(f => f.id === v)!.label} draw={v => <FillStyleIcon style={v} />} onChoose={v => onSettings({ fillStyle: v })} />
          <Choices label="Outline width" values={LINE_WIDTHS} current={settings.lineWidth as typeof LINE_WIDTHS[number]} describe={v => `Outline width ${v} pixels`} draw={bar} onChoose={v => onSettings({ lineWidth: v })} />
        </>
      )
      break
    case 'text':
      body = <Choices label="Font size" values={FONT_SIZES} current={settings.fontSize as typeof FONT_SIZES[number]} describe={v => `Font size ${v}`} draw={v => <span className="pt-font">{v}</span>} onChoose={v => onSettings({ fontSize: v })} />
      break
    default:
      body = null
  }
  return <div className="pt-options-box" aria-label="Tool options">{body}</div>
}
