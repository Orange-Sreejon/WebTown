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
  depthForFeetY,
} from '../config/GameConfig'
import { computeVelocity, inputToDirection, type Direction, type InputState } from '../systems/movement'
import { animKey, avatarTexture, type AvatarId } from '../systems/avatars'
import { isStepFrame } from '../../audio/footsteps'

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
  private moving = false
  /** Called when a foot lands (the walk animation's step frames). Set by the scene; sound only, no movement. */
  onStep: (() => void) | null = null

  /** @param look How the player looks (Phase 5); the original traveller unless chosen. */
  constructor(scene: Phaser.Scene, tileX: number, tileY: number, private readonly look: AvatarId = 'traveller') {
    // Position at centre of starting tile
    const px = tileX * TILE_SIZE + TILE_SIZE / 2
    const py = tileY * TILE_SIZE + TILE_SIZE / 2

    super(scene, px, py, scene.textures.exists(avatarTexture(look)) ? avatarTexture(look) : AssetKeys.TRAVELLER)

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

    this.setDepth(depthForFeetY(this.y + this.displayHeight / 2))
    this.play(this.anim('idle', 'down'))

    // Footsteps (audio only): a step on each foot-down frame of a walk, including the first frame of a new walk.
    const step = (anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame): void => {
      if (this.moving && isStepFrame(anim.key.replace(/@.*$/, ''), frame.index)) this.onStep?.()
    }
    this.on(Phaser.Animations.Events.ANIMATION_START, step)
    this.on(Phaser.Animations.Events.ANIMATION_UPDATE, step)
    this.once(Phaser.GameObjects.Events.DESTROY, () => { this.onStep = null })
  }

  /** The animation for this player's look; the original look if its variant could not be made. */
  private anim(kind: 'walk' | 'idle', dir: Direction): string {
    const key = animKey(kind, dir, this.look)
    return this.scene.anims.exists(key) ? key : animKey(kind, dir, 'traveller')
  }

  /** True while the player is walking (this frame's input). */
  get walking(): boolean {
    return this.moving
  }

  /** The direction the player last moved in (and so faces when idle). */
  get facing(): Direction {
    return this.lastDirection
  }

  /** Turns the player to face a direction and shows the matching idle frame. */
  setFacing(direction: Direction): void {
    this.lastDirection = direction
    this.play(this.anim('idle', direction))
  }

  /**
   * Teleports the player so their feet (body bottom, horizontally centred) are
   * at the given world position. Clears velocity so nothing carries over, and
   * re-sorts the depth for the new spot.
   *
   * `body.reset()` alone is not enough: it places the body at the sprite's
   * top-left and ignores the body offset, so on the next physics step the body
   * would jump to its real position. The sprite position is therefore solved
   * from the same formula the physics step uses —
   * `body = sprite + scale × (offset − displayOrigin)` — and the body is then
   * synced to it immediately.
   */
  placeFeet(feetX: number, feetY: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body

    // A freshly created body still has its unscaled size until the first
    // physics step; bring it up to date so the maths below uses real sizes.
    body.updateBounds()

    const bodyX = feetX - body.width / 2
    const bodyY = feetY - body.height
    const spriteX = bodyX - this.scaleX * (body.offset.x - this.displayOriginX)
    const spriteY = bodyY - this.scaleY * (body.offset.y - this.displayOriginY)

    // reset() moves the sprite and zeroes velocity and acceleration…
    body.reset(spriteX, spriteY)
    // …then put the body where the physics step will expect it, with no
    // movement recorded between the old and new spot.
    body.updateFromGameObject()
    body.prev.copy(body.position)
    body.prevFrame.copy(body.position)

    this.setDepth(depthForFeetY(body.bottom))
  }

  /**
   * The player's feet: the true horizontal middle and the bottom of the
   * physics body. (`body.center` uses floored half-sizes, which is up to a
   * pixel off for this body, so it is not used here.)
   */
  get feet(): { x: number; y: number } {
    const body = this.body as Phaser.Physics.Arcade.Body
    return { x: body.x + body.width / 2, y: body.bottom }
  }

  /** Stops dead and shows the idle frame. Used while a transition is running. */
  halt(): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    body.setVelocity(0, 0)
    this.moving = false
    const idleKey = this.anim('idle', this.lastDirection)
    if (this.anims.currentAnim?.key !== idleKey) this.play(idleKey)
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

    // Y-sorting: the feet decide who is in front, so a lamp post the player
    // walks behind covers them, and one they walk in front of does not.
    this.setDepth(depthForFeetY(body.bottom))

    const isMoving = vx !== 0 || vy !== 0
    this.moving = isMoving

    if (isMoving) {
      const dir = inputToDirection(input, this.lastDirection)
      this.lastDirection = dir
      const walkKey = this.anim('walk', dir)
      if (this.anims.currentAnim?.key !== walkKey) {
        this.play(walkKey)
      }
    } else {
      const idleKey = this.anim('idle', this.lastDirection)
      if (this.anims.currentAnim?.key !== idleKey) {
        this.play(idleKey)
      }
    }
  }
}
