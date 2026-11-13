/**
 * Where each interior sprite lives inside its source sheet.
 *
 * None of the three interior sheets is a regular grid of equal cells, so every
 * sprite is addressed by an explicit pixel rectangle. The rectangles were
 * measured from each sheet's own alpha (or ground colour) rather than guessed.
 *
 * Sheet files (all under `public/assets/interior/`):
 *   work3.png  288×64    walls, floor, door and desk-top items, 16px grid
 *   work4.png  675×672   loose furniture, 16px-aligned but irregular sizes
 *   work.png   1774×887  large computers and books on an opaque dark ground
 *
 * Provenance and licence of these files are NOT yet confirmed — see
 * docs/ASSETS.md.
 */

export interface SliceRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SheetSize {
  w: number
  h: number
}

export const OFFICE_KIT_SIZE: SheetSize = { w: 288, h: 64 }
export const FURNITURE_SIZE: SheetSize = { w: 675, h: 672 }
export const COMPUTERS_SIZE: SheetSize = { w: 1774, h: 887 }

/** work3.png — one 32×32 tile each unless noted. */
export const OFFICE_KIT = {
  brickWall: { x: 192, y: 0, w: 32, h: 32 },
  /** Floor: a 2×2 checker that tiles seamlessly. */
  floor: { x: 192, y: 32, w: 32, h: 32 },
  /** Upper wall: plain peach. Pair with `wallLower` for a 64px-tall wall. */
  wallUpper: { x: 224, y: 0, w: 32, h: 32 },
  /** Lower wall: mid peach with a skirting board along the bottom. */
  wallLower: { x: 224, y: 32, w: 32, h: 32 },
  /** Two tiles wide, four tall — exactly one wall height. */
  door: { x: 256, y: 0, w: 32, h: 64 },
  desk: { x: 0, y: 0, w: 32, h: 32 },
  monitor: { x: 103, y: 40, w: 20, h: 23 },
  keyboard: { x: 40, y: 43, w: 16, h: 9 },
  mouse: { x: 77, y: 44, w: 6, h: 6 },
  stickyNote: { x: 109, y: 13, w: 6, h: 6 },
  mug: { x: 12, y: 42, w: 10, h: 12 },
  paper: { x: 44, y: 11, w: 8, h: 11 },
  penCup: { x: 139, y: 9, w: 10, h: 12 },
  paperPile: { x: 167, y: 8, w: 20, h: 16 },
  chart: { x: 165, y: 39, w: 23, h: 17 },
  extinguisher: { x: 139, y: 40, w: 11, h: 17 },
} as const satisfies Record<string, SliceRect>

/** work4.png */
export const FURNITURE = {
  bookshelfTall: { x: 336, y: 38, w: 48, h: 58 },
  bookshelfWide: { x: 400, y: 61, w: 48, h: 35 },
  chair: { x: 528, y: 70, w: 15, h: 26 },
  /** Stacked books, an open book and an inkwell, as drawn. */
  bookGroup: { x: 400, y: 116, w: 37, h: 28 },
  windowBlue: { x: 572, y: 250, w: 40, h: 38 },
  windowPink: { x: 622, y: 250, w: 40, h: 38 },
  plankTable: { x: 140, y: 263, w: 64, h: 57 },
  rugOrange: { x: 112, y: 544, w: 110, h: 77 },
  rugBlue: { x: 544, y: 544, w: 79, h: 60 },
  /** Small round wooden stool, used as a desk seat. */
  stool: { x: 496, y: 77, w: 14, h: 19 },
  barrel: { x: 399, y: 377, w: 19, h: 23 },
  /** Single bed with blue blanket, head at the top. */
  bedBlue: { x: 64, y: 47, w: 30, h: 49 },
  nightstand: { x: 240, y: 181, w: 26, h: 27 },
  /** Teal table lamp. */
  lamp: { x: 207, y: 179, w: 18, h: 27 },
  chest: { x: 496, y: 428, w: 24, h: 20 },
  plantGreen: { x: 336, y: 424, w: 38, h: 24 },
  plantPink: { x: 432, y: 424, w: 19, h: 24 },
  plantRed: { x: 467, y: 424, w: 14, h: 24 },
  clock: { x: 549, y: 381, w: 17, h: 18 },
  paintingLandscape: { x: 501, y: 377, w: 36, h: 25 },
} as const satisfies Record<string, SliceRect>

/** work.png — source rectangles; they are scaled down before use. */
export const COMPUTERS = {
  deskPcBlank: { x: 53, y: 89, w: 260, h: 275 },
  deskPcLandscape: { x: 365, y: 85, w: 257, h: 275 },
  deskPcCat: { x: 675, y: 84, w: 257, h: 276 },
  deskPcWindow: { x: 983, y: 84, w: 257, h: 276 },
  monitorCat: { x: 541, y: 434, w: 174, h: 177 },
  bookStack: { x: 1545, y: 444, w: 152, h: 147 },
  booksFour: { x: 1043, y: 446, w: 166, h: 137 },
  notebookOpen: { x: 705, y: 674, w: 229, h: 152 },
  notebookCat: { x: 1379, y: 674, w: 236, h: 152 },
} as const satisfies Record<string, SliceRect>

/** The ground colour tolerance used to key the computer sheet (Manhattan distance). */
export const COMPUTERS_GROUND_TOLERANCE = 14

/** The computer is always prepared at exactly this width. Never 32px, never nearest-neighbour. */
export const COMPUTER_WIDTH_PX = 48

export interface PreparedSpec {
  source: SliceRect
  targetWidth: number
}

/**
 * Sprites cut from `work.png`, keyed to transparency and area-averaged down at
 * load time (see sprite-prep.ts) rather than scaled with nearest-neighbour.
 */
export const PREPARED = {
  computerDesk: { source: COMPUTERS.deskPcWindow, targetWidth: COMPUTER_WIDTH_PX },
  notebook: { source: COMPUTERS.notebookOpen, targetWidth: 26 },
  bookStack: { source: COMPUTERS.bookStack, targetWidth: 17 },
} as const satisfies Record<string, PreparedSpec>
