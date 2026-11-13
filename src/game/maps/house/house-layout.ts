import type { InteractionTarget } from '../../systems/interaction'
import type { Direction } from '../../systems/movement'
import type { InteriorStyle } from '../interior-layout'

/**
 * Per-house furniture layout data (pure data, no Phaser).
 *
 * A house's layout is an independent copy of the shared default layout. It
 * says WHICH furniture is where; the catalogue says what each furniture type
 * looks like and how it collides; the template says what the room itself is.
 */

/** Quarter turns. Only types that list a rotation in the catalogue may use it. */
export type Rotation = 0 | 90 | 180 | 270

/** The version written into every layout, for future migrations. */
export const LAYOUT_SCHEMA_VERSION = 1

/**
 * Standing on the floor or hanging on the wall at a grid position. `col` and
 * `row` are grid LINES (multiples of the tile size): the anchor is the
 * sprite's left edge and bottom edge. `nudge` is a pixel offset kept only so
 * the default room stays pixel-identical; it is dropped on the first move.
 */
export interface GridPlacement {
  kind: 'grid'
  col: number
  row: number
  nudge?: { x: number; y: number }
}

/** Resting on another item (a notebook on a table). Moves with its support. */
export interface AttachedPlacement {
  kind: 'attached'
  /** Id of the supporting item. */
  to: string
  /** Offset of this item's left/bottom anchor from the support's anchor, in pixels. */
  dx: number
  dy: number
}

export interface PlacedItem {
  /** Unique within the house. */
  id: string
  /** Key into the furniture catalogue. */
  type: string
  rotation: Rotation
  at: GridPlacement | AttachedPlacement
}

export interface HouseLayout {
  houseId: string
  /** The template this layout furnishes. */
  templateId: string
  schemaVersion: number
  /** Draw order for equal depths follows this order; supports come before what rests on them. */
  items: PlacedItem[]
}

/** The room itself: everything about an interior that furniture does not change. */
export interface InteriorTemplate {
  id: string
  widthPx: number
  heightPx: number
  wallHeightPx: number
  style: InteriorStyle
  spawn: { feetX: number; feetY: number; facing: Direction }
  exit: InteractionTarget
  /** Left edge of the door in the back wall. The door is part of the room, not furniture. */
  doorX: number
}

/** Independent deep copy, so editing one house can never touch another. */
export function cloneLayout(layout: HouseLayout): HouseLayout {
  return {
    houseId: layout.houseId,
    templateId: layout.templateId,
    schemaVersion: layout.schemaVersion,
    items: layout.items.map(cloneItem),
  }
}

export function cloneItem(item: PlacedItem): PlacedItem {
  const at: PlacedItem['at'] =
    item.at.kind === 'grid'
      ? {
          kind: 'grid',
          col: item.at.col,
          row: item.at.row,
          ...(item.at.nudge ? { nudge: { x: item.at.nudge.x, y: item.at.nudge.y } } : {}),
        }
      : { kind: 'attached', to: item.at.to, dx: item.at.dx, dy: item.at.dy }
  return { id: item.id, type: item.type, rotation: item.rotation, at }
}
