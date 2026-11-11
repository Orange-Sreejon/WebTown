import Phaser from 'phaser'
import {
  MAP_WIDTH_PX,
  MAP_HEIGHT_PX,
  DISPLAY_SCALE,
  PLAYER_START_TILE_X,
  PLAYER_START_TILE_Y,
} from '../config/GameConfig'
import { TownMap } from '../maps/TownMap'
import { createCollisionObjects } from '../maps/collision-objects'
import { DAY_CYCLE_MS, skyAt } from '../systems/day-night'
import { Player } from '../entities/Player'
import { emit } from '../../lib/event-bus'

export class TownScene extends Phaser.Scene {
  private player!: Player
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: {
    W: Phaser.Input.Keyboard.Key
    A: Phaser.Input.Keyboard.Key
    S: Phaser.Input.Keyboard.Key
    D: Phaser.Input.Keyboard.Key
  }
  private obstacles!: Phaser.Physics.Arcade.StaticGroup
  private map!: TownMap
  /** Multiply overlay that carries the time of day across the whole view. */
  private sky!: Phaser.GameObjects.Rectangle
  private elapsedMs = 0

  constructor() {
    super({ key: 'TownScene' })
  }

  create(): void {
    console.log('[TownScene] create start')

    try {
      this.physics.world.setBounds(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
      console.log('[TownScene] world bounds set')

      this.map = new TownMap(this)
      this.map.build()
      console.log('[TownScene] map built')

      this.obstacles = createCollisionObjects(this)
      console.log('[TownScene] collision objects created')

      this.player = new Player(this, PLAYER_START_TILE_X, PLAYER_START_TILE_Y)
      console.log('[TownScene] player created')

      this.physics.add.collider(this.player, this.obstacles)

      this.cursors = this.input.keyboard!.createCursorKeys()
      this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as {
        W: Phaser.Input.Keyboard.Key
        A: Phaser.Input.Keyboard.Key
        S: Phaser.Input.Keyboard.Key
        D: Phaser.Input.Keyboard.Key
      }

      this.cameras.main.startFollow(this.player, true, 1, 1)
      this.cameras.main.setBounds(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
      this.cameras.main.setZoom(DISPLAY_SCALE)
      this.cameras.main.roundPixels = true

      // Time-of-day overlay. It multiplies the world, so a white tint leaves
      // the daylight untouched and the cycle darkens it from there.
      this.sky = this.add
        .rectangle(0, 0, this.scale.width, this.scale.height, 0xffffff, 1)
        .setOrigin(0.5, 0.5)
        .setDepth(90)
        .setBlendMode('MULTIPLY')

      this.applySky(0)

      console.log('[TownScene] create complete')
    } catch (e) {
      console.error('[TownScene] create failed:', e)
      emit('ERROR', `Scene creation failed: ${String(e)}`)
    }
  }

  update(_time: number, delta: number): void {
    this.player?.update(this.cursors, this.wasd)

    this.elapsedMs += delta
    this.applySky((this.elapsedMs % DAY_CYCLE_MS) / DAY_CYCLE_MS)
  }

  /**
   * Paints the time of day over the whole camera and passes the darkness on to
   * the street lamps. The overlay is sized to the camera every frame so it
   * still covers the view after a resize or zoom change.
   */
  private applySky(t: number): void {
    const frame = skyAt(t)
    const cam = this.cameras.main

    this.sky
      .setPosition(cam.midPoint.x, cam.midPoint.y)
      .setSize(cam.width / cam.zoom, cam.height / cam.zoom)
      .setFillStyle(frame.tint, 1)

    this.map.setLampLight(frame.lamp)
  }
}
