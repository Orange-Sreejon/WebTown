import {
  LAYOUT_SCHEMA_VERSION,
  type HouseLayout,
  type InteriorTemplate,
  type PlacedItem,
} from './house-layout'
import { resolveInterior } from './resolve-interior'
import type { InteriorDefinition } from '../interior-layout'

// ─── The default interior ──────────────────────────────────────────────────
// Every house starts as an independent copy of this one room: a 16 × 14 tile
// room with a 4-tile back wall over a 10-tile floor. Bed, nightstand and chest
// on the left; door, shelf and decor along the wall; computer desk in the right
// corner; table, chair and rug in the middle; plants in the corners.
//
// Positions are grid cells plus a pixel `nudge`. The nudges reproduce the
// room's original hand-placed pixel positions exactly, so adopting the grid
// did not move a single sprite. A nudge is dropped the first time an owner
// moves the item, which snaps it to the grid.

export const DEFAULT_TEMPLATE_ID = 'cozy-room'

export const DEFAULT_TEMPLATE: InteriorTemplate = {
  id: DEFAULT_TEMPLATE_ID,
  widthPx: 256,
  heightPx: 224,
  wallHeightPx: 64,
  style: { floor: 'floor', wallUpper: 'wallUpper', wallLower: 'wallLower' },
  spawn: { feetX: 132, feetY: 100, facing: 'down' },
  exit: {
    id: 'exit',
    // Doorway width plus 4px each side; reaches from the wall base to just
    // short of the spawn so the prompt does not greet the player on arrival.
    zone: { x: 112, y: 66, w: 40, h: 26 },
    promptX: 132,
    // Bottom of the label sits on the door's lintel, so the door stays visible.
    promptY: 10,
  },
  doorX: 116,
}

const grid = (col: number, row: number, nx: number, ny: number): PlacedItem['at'] => ({
  kind: 'grid', col, row, nudge: { x: nx, y: ny },
})
const resting = (to: string, dx: number, dy: number): PlacedItem['at'] => ({
  kind: 'attached', to, dx, dy,
})

/** Supports come before the items resting on them. */
const DEFAULT_ITEMS: readonly PlacedItem[] = [
  // Wall: windows, picture, clock
  { id: 'window-blue', type: 'window-blue', rotation: 0, at: grid(0, 3, 12, 2) },
  { id: 'window-pink', type: 'window-pink', rotation: 0, at: grid(13, 3, 2, 2) },
  { id: 'painting', type: 'painting', rotation: 0, at: grid(9, 2, 8, 11) },
  { id: 'clock', type: 'clock', rotation: 0, at: grid(12, 2, 0, 8) },

  // Floor covering
  { id: 'rug', type: 'rug-orange', rotation: 0, at: grid(3, 12, 12, 5) },

  // Left wall: bed, nightstand with lamp, chest at the foot of the bed
  { id: 'bed', type: 'bed-blue', rotation: 0, at: grid(0, 7, 12, 12) },
  { id: 'chest', type: 'chest', rotation: 0, at: grid(0, 9, 14, 4) },
  { id: 'nightstand', type: 'nightstand', rotation: 0, at: grid(2, 6, 12, 4) },
  { id: 'lamp', type: 'lamp', rotation: 0, at: resting('nightstand', 4, -14) },

  // Back wall: bookshelf, plant
  { id: 'bookshelf', type: 'bookshelf', rotation: 0, at: grid(3, 4, 12, 8) },
  { id: 'plant-pink', type: 'plant-pink', rotation: 0, at: grid(10, 5, 2, 6) },

  // Right corner: the computer desk with the large computer
  { id: 'computer-desk', type: 'computer-desk', rotation: 0, at: grid(12, 7, 12, 6) },

  // Middle: table with notebook and books, and a chair
  { id: 'table', type: 'table', rotation: 0, at: grid(11, 11, 0, 14) },
  { id: 'notebook', type: 'notebook', rotation: 0, at: resting('table', 22, -20) },
  { id: 'books', type: 'book-stack', rotation: 0, at: resting('table', 6, -22) },
  { id: 'chair', type: 'chair', rotation: 0, at: grid(9, 11, 13, 2) },

  // Corner plants
  { id: 'plant-green', type: 'plant-green', rotation: 0, at: grid(0, 13, 10, 10) },
  { id: 'plant-red', type: 'plant-red', rotation: 0, at: grid(14, 13, 10, 10) },
]

/** A fresh, independent copy of the default layout for one house. */
export function createDefaultLayout(houseId: string): HouseLayout {
  return {
    houseId,
    templateId: DEFAULT_TEMPLATE_ID,
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    items: DEFAULT_ITEMS.map(item => ({
      id: item.id,
      type: item.type,
      rotation: item.rotation,
      at:
        item.at.kind === 'grid'
          ? {
              kind: 'grid',
              col: item.at.col,
              row: item.at.row,
              ...(item.at.nudge ? { nudge: { ...item.at.nudge } } : {}),
            }
          : { ...item.at },
    })),
  }
}

/** The template for an id, or undefined for an unknown id. */
export function getTemplate(id: string): InteriorTemplate | undefined {
  return id === DEFAULT_TEMPLATE.id ? DEFAULT_TEMPLATE : undefined
}

/** The default room as the scene sees it: what a house looks like before anyone edits it. */
export const DEFAULT_INTERIOR: InteriorDefinition = resolveInterior(
  DEFAULT_TEMPLATE,
  createDefaultLayout('default'),
)
