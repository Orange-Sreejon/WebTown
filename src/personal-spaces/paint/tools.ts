import type { FillStyle } from './raster'

export type ToolId = 'airbrush' | 'fill' | 'picker' | 'text' | 'pencil' | 'brush' | 'eraser' | 'line' | 'rectangle' | 'ellipse'

export interface ToolInfo {
  id: ToolId
  label: string
  /** Shown in the status bar while the tool is hovered or active. */
  hint: string
}

/** In toolbox order: two columns, read left to right. */
export const TOOLS: readonly ToolInfo[] = [
  { id: 'airbrush', label: 'Airbrush', hint: 'Sprays paint while you hold the button down.' },
  { id: 'fill', label: 'Fill With Color', hint: 'Fills an area with the current colour.' },
  { id: 'picker', label: 'Pick Color', hint: 'Picks up a colour from the picture.' },
  { id: 'text', label: 'Text', hint: 'Click where the text should start, then type.' },
  { id: 'pencil', label: 'Pencil', hint: 'Draws a free-form line one pixel wide.' },
  { id: 'brush', label: 'Brush', hint: 'Draws using a brush of the selected size.' },
  { id: 'eraser', label: 'Eraser', hint: 'Erases part of the picture back to the canvas.' },
  { id: 'line', label: 'Line', hint: 'Draws a straight line. Hold Shift for 45-degree steps.' },
  { id: 'rectangle', label: 'Rectangle', hint: 'Draws a rectangle. Hold Shift for a square.' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Draws an ellipse. Hold Shift for a circle.' },
]

export const toolInfo = (id: ToolId): ToolInfo => TOOLS.find(t => t.id === id)!

export const BRUSH_SIZES = [1, 2, 4, 6, 8, 12] as const
export const ERASER_SIZES = [4, 6, 8, 10, 16] as const
export const AIRBRUSH_SIZES = [8, 16, 24] as const
export const LINE_WIDTHS = [1, 2, 3, 4, 5] as const
export const FONT_SIZES = [12, 16, 24, 32, 48] as const
export const FILL_STYLES: readonly { id: FillStyle; label: string }[] = [
  { id: 'outline', label: 'Outline' },
  { id: 'both', label: 'Outline, filled with the background colour' },
  { id: 'fill', label: 'Filled' },
]

/** The choices that belong to the tools, as the options box sets them. */
export interface ToolSettings {
  brushSize: number
  eraserSize: number
  airbrushSize: number
  lineWidth: number
  fillStyle: FillStyle
  fontSize: number
}

export const DEFAULT_SETTINGS: ToolSettings = {
  brushSize: 4,
  eraserSize: 8,
  airbrushSize: 16,
  lineWidth: 1,
  fillStyle: 'outline',
  fontSize: 16,
}

/** The size that matters for a tool, for the status bar; null when it has none. */
export function sizeFor(tool: ToolId, s: ToolSettings): { label: string; value: number } | null {
  switch (tool) {
    case 'pencil': return { label: 'Size', value: 1 }
    case 'brush': return { label: 'Size', value: s.brushSize }
    case 'eraser': return { label: 'Size', value: s.eraserSize }
    case 'airbrush': return { label: 'Size', value: s.airbrushSize }
    case 'line': case 'rectangle': case 'ellipse': return { label: 'Width', value: s.lineWidth }
    case 'text': return { label: 'Font', value: s.fontSize }
    default: return null
  }
}
