import type { ReactNode } from 'react'
import type { ToolId } from '../../personal-spaces/paint/tools'

/**
 * WebTown Paint's own 16 x 16 pixel-style icons, drawn for WebTown (no
 * Microsoft artwork). Decorative: every button that shows one has a text name.
 */
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      {children}
    </svg>
  )
}

const ICONS: Record<ToolId, ReactNode> = {
  airbrush: (
    <>
      <rect x="7" y="7" width="6" height="8" fill="#808080" stroke="#000" strokeWidth="1" />
      <rect x="8" y="5" width="4" height="2" fill="#000" />
      <rect x="9" y="4" width="2" height="1" fill="#000" />
      <rect x="3" y="2" width="1" height="1" fill="#000" /><rect x="5" y="1" width="1" height="1" fill="#000" />
      <rect x="2" y="5" width="1" height="1" fill="#000" /><rect x="5" y="4" width="1" height="1" fill="#000" />
      <rect x="1" y="3" width="1" height="1" fill="#000" /><rect x="3" y="6" width="1" height="1" fill="#000" />
    </>
  ),
  fill: (
    <>
      <path d="M3 8 L8 3 L13 8 L8 13 Z" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M4 8 L12 8 L8 12 Z" fill="#000080" />
      <rect x="13" y="9" width="2" height="4" fill="#000080" />
      <rect x="7" y="1" width="2" height="3" fill="#000" />
    </>
  ),
  picker: (
    <>
      <path d="M3 13 L10 6" stroke="#000" strokeWidth="2" />
      <path d="M2 14 L4 12" stroke="#000080" strokeWidth="2" />
      <rect x="10" y="2" width="4" height="4" fill="#000" transform="rotate(45 12 4)" />
    </>
  ),
  text: <path d="M3 14 L7 2 H9 L13 14 H11 L10 11 H6 L5 14 Z M6.7 9 H9.3 L8 5 Z" fill="#000" />,
  pencil: (
    <>
      <path d="M3 13 L4 10 L11 3 L13 5 L6 12 Z" fill="#ffff00" stroke="#000" strokeWidth="1" />
      <path d="M3 13 L4 10 L6 12 Z" fill="#000" />
      <rect x="11" y="2" width="2" height="2" fill="#ff8080" transform="rotate(45 12 3)" />
    </>
  ),
  brush: (
    <>
      <rect x="9" y="1" width="3" height="7" fill="#804000" stroke="#000" strokeWidth="1" />
      <rect x="8" y="8" width="5" height="2" fill="#c0c0c0" stroke="#000" strokeWidth="1" />
      <path d="M8 10 H13 L12 14 L10 15 L9 14 Z" fill="#000080" />
    </>
  ),
  eraser: (
    <>
      <path d="M2 11 L8 5 L14 9 L9 14 H5 Z" fill="#ffff80" stroke="#000" strokeWidth="1" />
      <path d="M2 11 L5 8 L10 12 L9 14 H5 Z" fill="#ff8080" />
    </>
  ),
  line: <path d="M2 14 L14 2" stroke="#000" strokeWidth="1.5" />,
  rectangle: <rect x="2" y="4" width="12" height="9" fill="none" stroke="#000" strokeWidth="1" />,
  ellipse: <ellipse cx="8" cy="8.5" rx="6" ry="4.5" fill="none" stroke="#000" strokeWidth="1" shapeRendering="auto" />,
}

export function ToolIcon({ tool }: { tool: ToolId }): React.ReactElement {
  return <Icon>{ICONS[tool]}</Icon>
}

/** The window's own icon: an easel with a palette, original artwork. */
export function AppIcon(): React.ReactElement {
  return (
    <Icon>
      <path d="M8 1 L3 15 M8 1 L13 15 M8 1 V15" stroke="#804000" strokeWidth="1" />
      <rect x="2" y="3" width="12" height="8" fill="#fff" stroke="#000" strokeWidth="1" />
      <rect x="4" y="5" width="3" height="2" fill="#ff0000" />
      <rect x="8" y="6" width="3" height="3" fill="#0000ff" />
      <rect x="5" y="8" width="2" height="2" fill="#ffff00" />
    </Icon>
  )
}

export function UndoIcon(): React.ReactElement {
  return <Icon><path d="M4 6 H10 A3 3 0 0 1 10 12 H6" fill="none" stroke="#000" strokeWidth="1.5" /><path d="M1 6 L5 2 V10 Z" fill="#000" /></Icon>
}

export function RedoIcon(): React.ReactElement {
  return <Icon><path d="M12 6 H6 A3 3 0 0 0 6 12 H10" fill="none" stroke="#000" strokeWidth="1.5" /><path d="M15 6 L11 2 V10 Z" fill="#000" /></Icon>
}
