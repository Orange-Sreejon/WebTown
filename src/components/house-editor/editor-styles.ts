/**
 * Shared look for the house editor: the dark-wood palette of the in-game
 * prompt, monospace, and focus outlines left intact for keyboard users.
 */
export const EDITOR_COLORS = {
  panel: '#2b1d14',
  panelEdge: '#5a3d28',
  text: '#fff4d6',
  muted: '#d8c7a4',
  button: '#4a3020',
  buttonHover: '#5e3d29',
  primary: '#2f6b3a',
  valid: '#8fe39a',
  invalid: '#ffaaa0',
  disabledText: '#9c8b70',
} as const

export const EDITOR_FONT = 'monospace'

/** The panel docks to the right; at 1280×720 the room ends at x 1060, so 200px clears it. */
export const EDITOR_PANEL_WIDTH_PX = 200
