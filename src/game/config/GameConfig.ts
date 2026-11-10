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

/** Player start position in tile coordinates — on main path intersection. */
export const PLAYER_START_TILE_X = 28
export const PLAYER_START_TILE_Y = 28

/** Phaser depth values — higher = drawn on top. */
export const DEPTH_GROUND     = 0
export const DEPTH_ROAD       = 1
export const DEPTH_DECORATION = 2
export const DEPTH_STRUCTURE  = 3
export const DEPTH_PLAYER     = 4
export const DEPTH_TREETOP    = 5
