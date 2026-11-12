/**
 * Halloween Night Mode — the single source of truth for every timing.
 *
 * The length of an in-game day, the period boundaries, the lighting
 * keyframes, the decoration fade window and the decor tables all live here.
 * Nothing else in the game hard-codes a time of day.
 *
 * The mode is an enhancement on the finished Phase 1 town: the village, its
 * terrain, houses, props, collision and player are untouched. The seasonal
 * layer only *adds* objects after dark, and every one of them is hidden
 * during the day and evening.
 */

import { AssetKeys } from './AssetKeys'

/** One full in-game day: day back to day in 15 real minutes, as before. */
export const CYCLE_DURATION_MS = 15 * 60 * 1000

/** Where the town starts when no `?time=` override is given (mid-morning). */
export const DEFAULT_START_HOUR = 9

/**
 * Period boundaries, in in-game hours. `night` wraps midnight.
 * Day 06:00–17:59, evening 18:00–19:59, night 20:00–05:59.
 */
export const PERIODS = {
  day: { startHour: 6, endHour: 18 },
  evening: { startHour: 18, endHour: 20 },
  night: { startHour: 20, endHour: 6 },
} as const

export type Period = keyof typeof PERIODS

export interface SkyKeyframe {
  /** In-game hour, 0–24. The table starts at 0 and ends at 24. */
  hour: number
  /** Multiply colour laid over the world. White leaves daylight untouched. */
  tint: number
  /** 0 in full daylight, 1 in the dead of night. */
  night: number
  /** 0 with the street lamps off, 1 with them at full. */
  lamp: number
}

/**
 * The lighting curve, in in-game hours.
 *
 * Daytime is the town as it has always looked: white at noon, a touch warmer
 * in the afternoon. The light then warms through a long evening (lamps come
 * up from 18:00 and are full by nightfall) and settles into the same light
 * blue/purple night already tuned for readability — dark enough to read as
 * night, bright enough to walk around and see the whole map. Dawn lifts it
 * back to daylight between 05:30 and 06:00.
 *
 * Morning and night hold flat stretches on purpose: the shadows should not
 * drift while you are standing still.
 */
export const SKY_KEYFRAMES: readonly SkyKeyframe[] = [
  { hour: 0, tint: 0x9aa6d0, night: 1, lamp: 1 }, // midnight
  { hour: 3, tint: 0x9aa6d0, night: 1, lamp: 1 }, // deep of night
  { hour: 5, tint: 0x8f9bc8, night: 1, lamp: 1 }, // last of the night
  { hour: 5.5, tint: 0xb8b4c8, night: 0.5, lamp: 0.35 }, // first light
  { hour: 6, tint: 0xffffff, night: 0, lamp: 0 }, // dawn
  { hour: 12, tint: 0xffffff, night: 0, lamp: 0 }, // midday, untouched
  { hour: 16, tint: 0xfff3e0, night: 0, lamp: 0 }, // afternoon, a touch warmer
  { hour: 17, tint: 0xffefd2, night: 0, lamp: 0 }, // late afternoon
  { hour: 18, tint: 0xffcd93, night: 0.1, lamp: 0.35 }, // evening sets in
  { hour: 19, tint: 0xefa98a, night: 0.28, lamp: 0.75 }, // sunset
  { hour: 20, tint: 0xd79a7d, night: 0.45, lamp: 1 }, // nightfall
  { hour: 20.5, tint: 0xa87ab0, night: 0.85, lamp: 1 }, // dusk, warm purple
  { hour: 21, tint: 0x8f9bc8, night: 0.95, lamp: 1 }, // night
  { hour: 22, tint: 0x8f9bc8, night: 0.95, lamp: 1 },
  { hour: 23, tint: 0x9aa6d0, night: 1, lamp: 1 },
  { hour: 24, tint: 0x9aa6d0, night: 1, lamp: 1 }, // wraps back to midnight
]

/**
 * When the Halloween decorations are visible, in in-game hours.
 *
 * 20:00–20:30 fade in, 20:30–05:30 fully visible, 05:30–06:00 fade out.
 * Completely hidden from 06:00 to 19:59 — day *and* evening.
 */
export const HALLOWEEN_FADE = {
  inStartHour: 20,
  inEndHour: 20.5,
  outStartHour: 5.5,
  outEndHour: 6,
} as const

/** The pumpkin sheet: 15×14 cells of 16×16 px. */
export const PUMPKIN_SHEET = {
  key: AssetKeys.HALLOWEEN_PUMPKINS,
  cell: 16,
  cols: 15,
} as const

/** A named cell in the pumpkin sheet: `frame = row * cols + col`. */
export interface PumpkinFrameRef {
  col: number
  row: number
}

/**
 * The small-pumpkin block of the sheet is cols 12–14, rows 0–6. The large
 * pumpkins elsewhere on the sheet overflow their cells and would need manual
 * cropping, so only this block is used.
 */
export const PUMPKIN_FRAMES = {
  litA: { col: 12, row: 5 },
  litB: { col: 13, row: 5 },
  litC: { col: 14, row: 5 },
  litWide: { col: 13, row: 6 },
  litWideLeft: { col: 12, row: 6 },
  litWideRight: { col: 14, row: 6 },
  plain: { col: 12, row: 0 },
} as const

export type PumpkinFrameName = keyof typeof PUMPKIN_FRAMES

/** The texture frame index for a cell of the sheet. */
export function pumpkinFrameIndex(ref: PumpkinFrameRef): number {
  return ref.row * PUMPKIN_SHEET.cols + ref.col
}

/** Decorative scale. Pixel art is drawn at whole/half steps only. */
export const PUMPKIN_SCALE = 1.5

export interface PumpkinSpot {
  frame: PumpkinFrameName
  /** Ground tile the pumpkin stands on. */
  tileX: number
  tileY: number
  scale?: number
}

/**
 * Hand-placed pumpkins: yards, gates, the market row, the pond edge and the
 * church path. Every spot is validated against the real layout by
 * `validatePumpkinPlacements` — grass only, clear of fences, buildings,
 * props, trees, the pond, the pasture, the garden and the player's spawn.
 */
export const PUMPKIN_PLACEMENTS: readonly PumpkinSpot[] = [
  // ── North street and the church path ──────────────────────────────────
  { frame: 'litA', tileX: 44, tileY: 12 },
  { frame: 'litWide', tileX: 46, tileY: 12 },
  { frame: 'litB', tileX: 56, tileY: 13 },
  { frame: 'litC', tileX: 59, tileY: 13 },

  // ── Market row and the north junction ─────────────────────────────────
  { frame: 'litWideLeft', tileX: 37, tileY: 15 },
  { frame: 'litA', tileX: 41, tileY: 16 },
  { frame: 'litWide', tileX: 45, tileY: 34 },
  { frame: 'litB', tileX: 47, tileY: 35 },
  { frame: 'litC', tileX: 52, tileY: 33 },
  { frame: 'litA', tileX: 56, tileY: 36 },

  // ── Pond approach and the shoreline ───────────────────────────────────
  { frame: 'litB', tileX: 12, tileY: 47 },
  { frame: 'litC', tileX: 11, tileY: 48 },
  { frame: 'litWide', tileX: 24, tileY: 46 },
  { frame: 'litA', tileX: 28, tileY: 47 },
  { frame: 'litWideRight', tileX: 29, tileY: 48 },

  // ── Farm yard ─────────────────────────────────────────────────────────
  { frame: 'litB', tileX: 43, tileY: 49 },
  { frame: 'litC', tileX: 58, tileY: 49 },

  // ── East park ─────────────────────────────────────────────────────────
  { frame: 'litWide', tileX: 57, tileY: 26 },
  { frame: 'litA', tileX: 66, tileY: 27 },

  // ── South-east street ─────────────────────────────────────────────────
  { frame: 'litB', tileX: 42, tileY: 43 },
  { frame: 'litC', tileX: 53, tileY: 43 },
  { frame: 'litWideLeft', tileX: 61, tileY: 43 },

  // ── Main road, west of the crossroads ─────────────────────────────────
  { frame: 'litA', tileX: 17, tileY: 28 },
  { frame: 'litB', tileX: 18, tileY: 32 },
]

/** A window pane in the building sprite's own texture pixels. */
export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where each building's windows sit, measured from the art itself.
 *
 * Keyed by texture, so every house of the same kind gets warm windows in the
 * same place — the footprint and the sprite are the same size, so these
 * offsets map straight onto world pixels. Both houses and the church are
 * covered; the bridge has no windows.
 */
export const WINDOW_LAYOUTS: Readonly<Record<string, readonly WindowRect[]>> = {
  // Pixeljad house 1 (80×112): the round gable window above the door.
  [AssetKeys.HOUSE_1]: [{ x: 32, y: 62, w: 12, h: 13 }],
  // Pixeljad house 2 (128×112): two ground-floor windows and the annex one.
  [AssetKeys.HOUSE_2]: [
    { x: 14, y: 82, w: 11, h: 13 },
    { x: 52, y: 82, w: 11, h: 13 },
    { x: 91, y: 71, w: 11, h: 12 },
  ],
  // Cute Fantasy house (96×128): the gable window and the side window.
  [AssetKeys.CUTE_HOUSE]: [
    { x: 41, y: 60, w: 11, h: 12 },
    { x: 58, y: 87, w: 10, h: 15 },
  ],
  // Church (128×112): the porch window and the two nave windows.
  [AssetKeys.CHURCH]: [
    { x: 60, y: 63, w: 11, h: 11 },
    { x: 10, y: 71, w: 10, h: 12 },
    { x: 105, y: 71, w: 10, h: 12 },
  ],
}

export interface BatSpec {
  /** Horizontal path ends, in view pixels relative to the camera centre. */
  fromX: number
  toX: number
  /** Vertical offset from the camera centre (negative is up). */
  y: number
  durationMs: number
  delayMs: number
  scale: number
  /** Pixel bob amplitude while flying. */
  bob: number
}

/** Three bats, sparse and slow. No more than three on screen. */
export const BATS: readonly BatSpec[] = [
  { fromX: -300, toX: 300, y: -150, durationMs: 28000, delayMs: 0, scale: 1, bob: 4 },
  { fromX: 270, toX: -270, y: -205, durationMs: 34000, delayMs: 5000, scale: 0.85, bob: 5 },
  { fromX: -250, toX: 280, y: -110, durationMs: 40000, delayMs: 12000, scale: 0.75, bob: 3 },
]

/** Moon position as a fraction of the view (0,0 = centre, 1 = right edge). */
export const MOON_POSITION = { nx: 0.55, ny: -0.6 } as const

/** Star positions, same normalised view coordinates. */
export const STAR_POSITIONS: ReadonlyArray<{ nx: number; ny: number }> = [
  { nx: -0.7, ny: -0.75 },
  { nx: -0.35, ny: -0.9 },
  { nx: 0.05, ny: -0.8 },
  { nx: 0.28, ny: -0.95 },
  { nx: 0.82, ny: -0.82 },
  { nx: 0.9, ny: -0.55 },
]

/**
 * The solid footprint of a pumpkin: a small box at its base, like a lamp
 * post's. It is only switched on once the decorations are visibly faded in,
 * so you never bump into something you cannot see during the day.
 */
export const PUMPKIN_COLLIDER = {
  width: 12,
  height: 8,
  /** Night factor at which the footprint becomes solid. */
  solidAt: 0.35,
} as const

/** Peak alpha of every Halloween object when fully visible. */
export const NIGHT_LIGHT = {
  pumpkin: 1,
  pumpkinGlow: 0.5,
  window: 0.4,
  bat: 0.75,
  moon: 0.85,
  star: 0.7,
} as const
