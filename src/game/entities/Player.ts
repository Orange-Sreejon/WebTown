import Phaser from 'phaser'
import { AssetKeys } from '../config/AssetKeys'
import {
  TILE_SIZE,
  PLAYER_SPEED,
  PLAYER_BODY_W,
  PLAYER_BODY_H,
  PLAYER_BODY_OFFSET_X,
  PLAYER_BODY_OFFSET_Y,
  PLAYER_SPRITE_SCALE,
  DEPTH_PLAYER,
} from '../config/GameConfig'
import { computeVelocity, inputToDirection, type Direction, type InputState } from '../systems/movement'

type WasdKeys = {
  W: Phaser.Input.Keyboard.Key
  A: Phaser.Input.Keyboard.Key
  S: Phaser.Input.Keyboard.Key
  D: Phaser.Input.Keyboard.Key
}

/**
 * The player-controlled character.
 *
 * Extends Arcade Sprite so the physics body is managed by Phaser.
 * Movement logic is delegated to the pure `computeVelocity` function.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private lastDirection: Direction = 'down'

  constructor(scene: Phaser.Scene, tileX: number, tileY: number) {
    // Position at centre of starting tile
    const px = tileX * TILE_SIZE + TILE_SIZE / 2
    const py = tileY * TILE_SIZE + TILE_SIZE / 2

    super(scene, px, py, AssetKeys.TRAVELLER)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    // Scale the sprite down — the raw frame is 48×64 which at 2× zoom
    // would be enormous against 32×32 tiles. PLAYER_SPRITE_SCALE reduces it
    // to roughly one tile wide.
    this.setScale(PLAYER_SPRITE_SCALE)

    // Physics body — covers lower legs/feet only.
    // setSize/setOffset work in the sprite's LOCAL pixel space (pre-scale).
    const body = this.body as Phaser.Physics.Arcade.Body
    body.setSize(PLAYER_BODY_W, PLAYER_BODY_H)
    body.setOffset(PLAYER_BODY_OFFSET_X, PLAYER_BODY_OFFSET_Y)
    body.setCollideWorldBounds(true)

    this.setDepth(DEPTH_PLAYER)
    this.play('idle-down')
  }

  /**
   * Called every frame from TownScene.update().
   * Reads input, computes velocity, selects animation.
   */
  update(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: WasdKeys,
  ): void {
    const input: InputState = {
      up:    cursors.up.isDown    || wasd.W.isDown,
      down:  cursors.down.isDown  || wasd.S.isDown,
      left:  cursors.left.isDown  || wasd.A.isDown,
      right: cursors.right.isDown || wasd.D.isDown,
    }

    const { vx, vy } = computeVelocity(input, PLAYER_SPEED)
    const body = this.body as Phaser.Physics.Arcade.Body
    body.setVelocity(vx, vy)

    const isMoving = vx !== 0 || vy !== 0

    if (isMoving) {
      const dir = inputToDirection(input, this.lastDirection)
      this.lastDirection = dir
      const animKey = `walk-${dir}`
      if (this.anims.currentAnim?.key !== animKey) {
        this.play(animKey)
      }
    } else {
      const idleKey = `idle-${this.lastDirection}`
      if (this.anims.currentAnim?.key !== idleKey) {
        this.play(idleKey)
      }
    }
  }
}
