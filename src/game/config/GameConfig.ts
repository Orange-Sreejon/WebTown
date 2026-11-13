/** Base tile size in pixels at 1× scale. All tileset assets are on a 16px grid. */
export const TILE_SIZE = 16

/** Phaser camera zoom. Tiles render at 32×32 px on screen. */
export const DISPLAY_SCALE = 2

/** Map dimensions in tiles. */
export const MAP_TILES_W = 80
export const MAP_TILES_H = 64

/** Map dimensions in pixels at 1× scale. */
export const MAP_WIDTH_PX = MAP_TILES_W * TILE_SIZE   // 1280
export const MAP_HEIGHT_PX = MAP_TILES_H * TILE_SIZE  // 1024

/** Player movement speed in pixels per second (at 1× scale). */
export const PLAYER_SPEED = 80

/**
 * Player physics body dimensions and offset within the 48×64 sprite,
 * expressed in the sprite's LOCAL (pre-scale) pixel space.
 * Phaser applies setSize/setOffset before the display scale, so these
 * values must match the original 48×64 frame, not the scaled-down version.
 *
 * We want the collision box to cover roughly the bottom quarter of the
 * sprite (the feet). In the original 48×64 frame that's:
 *   width  : 28 px (centred, leaves 10 px each side)
 *   height : 16 px
 *   offset x: 10 (centres the 28-wide body in 48-wide sprite)
 *   offset y: 46 (places it at the very bottom, 48+16=64)
 */
export const PLAYER_BODY_W = 28
export const PLAYER_BODY_H = 16
export const PLAYER_BODY_OFFSET_X = 10
export const PLAYER_BODY_OFFSET_Y = 48

/** Walk animation frame rate in frames per second. */
export const WALK_FRAME_RATE = 6

/**
 * Phaser canvas base resolution — 16:9, used with Scale.EXPAND so the game
 * fills the whole browser window without black bars.
 * At 2× zoom, the minimum visible area is (1280/2)×(720/2) = 640×360 px
 * = 40×22.5 tiles. Wider screens show more map; narrower show less.
 */
export const CANVAS_WIDTH = 1280
export const CANVAS_HEIGHT = 720

/**
 * Visual scale factor applied to the player sprite.
 * 0.55 → ~26 px wide at 1× = ~52 px at 2× zoom ≈ 1.6 tiles wide.
 * Readable and proportionate against 32×32-px tiles.
 */
export const PLAYER_SPRITE_SCALE = 0.55

/** Player start position in tile coordinates — on the central crossroads. */
export const PLAYER_START_TILE_X = 40
export const PLAYER_START_TILE_Y = 30

/**
 * Entrance zones (Phase 2). A zone is as wide as the yard gate in front of each
 * door (3 tiles = ±24 px of the door centre) so it always lines up with the gap
 * in the fence. It runs 32 px south of the building's bottom edge and reaches
 * half a tile up into the footprint, because some houses (the Cute Fantasy
 * ones) have a recessed porch the player can step into.
 */
export const ENTRANCE_HALF_WIDTH = 24
export const ENTRANCE_DEPTH = 32
export const ENTRANCE_RISE = 8
/** How far above the building's bottom edge the prompt hovers. */
export const ENTRANCE_PROMPT_RISE = 36
/** Fallback return point: this far south of the door, always on the driveway. */
export const ENTRANCE_FALLBACK_OFFSET = 14

/** Prompt labels. */
export const PROMPT_ENTER_TEXT = 'E: Enter'
export const PROMPT_EXIT_TEXT = 'E: Exit'

/**
 * Decorative wall drawn outside an interior's physics bounds on the left,
 * right and bottom edges. Art only: it never collides.
 */
export const INTERIOR_BORDER_PX = 12
/**
 * Total slack, in WORLD pixels (1× room pixels, not screen pixels), kept around
 * the framed room when choosing a zoom. At zoom 3 it is 12 screen pixels.
 */
export const INTERIOR_VIEW_MARGIN_PX = 4
/**
 * A piece of furniture whose top edge sits closer than this to the back wall
 * (but not touching it) gets its collision extended up to the wall. A gap this
 * small cannot hold the player, but would let them wedge into a sliver behind it.
 */
export const INTERIOR_WALL_FILL_GAP_PX = 12
/**
 * How close the player must be able to stand to the computer or the notebook
 * for the layout to count as "reachable". Provisional: Phase 3 will define the
 * real interaction distance.
 */
export const INTERIOR_PROP_REACH_PX = 40

/** Fade-out / fade-in time when moving between town and interior. */
export const TRANSITION_FADE_MS = 180
/** After a transition, E is ignored for this long so a door cannot re-fire. */
export const INTERACT_COOLDOWN_MS = 450

/** Phaser depth values — higher = drawn on top. */
export const DEPTH_GROUND     = 0
export const DEPTH_ROAD       = 1
export const DEPTH_DECORATION = 2
export const DEPTH_STRUCTURE  = 3
export const DEPTH_PLAYER     = 4
export const DEPTH_TREETOP    = 5

/** Interaction prompts draw above everything, including the time-of-day overlay (90). */
export const DEPTH_PROMPT = 95

/**
 * Depth for anything tall enough to overlap the player — lamp posts, and the
 * player itself.
 *
 * Both are sorted by the ground point at their feet, inside a band just above
 * the structures and just below the tree tops. Sorting by `feetY` means whoever
 * is lower on screen draws in front, so walking behind a lamp puts you behind
 * its post and walking in front of it puts the post behind you.
 */
export function depthForFeetY(feetY: number): number {
  const clamped = Math.min(Math.max(feetY, 0), MAP_HEIGHT_PX)
  return DEPTH_PLAYER + (clamped / MAP_HEIGHT_PX) * 0.9
}
