import Phaser from 'phaser'
import {
  MAP_WIDTH_PX,
  MAP_HEIGHT_PX,
  DISPLAY_SCALE,
  PLAYER_START_TILE_X,
  PLAYER_START_TILE_Y,
} from '../config/GameConfig'
import { DEFAULT_START_HOUR } from '../config/halloween'
import { TownMap } from '../maps/TownMap'
import { createCollisionObjects } from '../maps/collision-objects'
import { HalloweenLayer } from '../maps/halloween-layer'
import { skyAtHour, type SkyFrame } from '../systems/day-night'
import {
  GameClock,
  parseFrozenOverride,
  parseTimeOverride,
} from '../systems/game-clock'
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
  /** In-game clock. Elapsed play time only — never the system clock. */
  private clock!: GameClock
  /** Seasonal layer: hidden by day, lit at night. */
  private halloween!: HalloweenLayer
  private devKeyHandlers: Array<{ event: string; handler: () => void }> = []

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

      const search = typeof window === 'undefined' ? '' : window.location.search
      this.clock = new GameClock(parseTimeOverride(search) ?? DEFAULT_START_HOUR)
      const frozen = parseFrozenOverride(search)
      if (frozen) this.clock.freeze(true)

      this.halloween = new HalloweenLayer(this)
      this.halloween.build()

      // Pumpkins are solid while they are visible; the layer switches their
      // bodies off during the day.
      this.physics.add.collider(this.player, this.halloween.obstacles)

      this.registerDevTimeKeys()
      this.events.once('shutdown', () => this.teardown())

      this.applySky(skyAtHour(this.clock.hour))

      console.log('[TownScene] create complete')
    } catch (e) {
      console.error('[TownScene] create failed:', e)
      emit('ERROR', `Scene creation failed: ${String(e)}`)
    }
  }

  update(_time: number, delta: number): void {
    this.player?.update(this.cursors, this.wasd)

    this.clock?.tick(delta)
    if (this.clock) this.applySky(skyAtHour(this.clock.hour))
  }

  /**
   * Paints the time of day over the whole camera and passes the darkness on to
   * the street lamps and the seasonal layer. The overlay is sized to the
   * camera every frame so it still covers the view after a resize or zoom
   * change.
   */
  private applySky(frame: SkyFrame): void {
    const cam = this.cameras.main

    this.sky
      .setPosition(cam.midPoint.x, cam.midPoint.y)
      .setSize(cam.width / cam.zoom, cam.height / cam.zoom)
      .setFillStyle(frame.tint, 1)

    this.map.setLampLight(frame.lamp)
    this.halloween?.setNightFactor(frame.halloween)
  }

  /**
   * Developer-only time jumps: `1` → 09:00, `2` → 18:30, `3` → 22:00. Compiled
   * out of production builds, and removed on scene shutdown.
   */
  private registerDevTimeKeys(): void {
    const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
    if (!isDev) return

    const keyboard = this.input.keyboard
    if (!keyboard) return

    const bind = (key: string, hour: number): void => {
      const event = `keydown-${key}`
      const handler = (): void => {
        this.clock.setHour(hour)
        this.applySky(skyAtHour(hour))
      }
      keyboard.on(event, handler)
      this.devKeyHandlers.push({ event, handler })
    }

    bind('ONE', 9)
    bind('TWO', 18.5)
    bind('THREE', 22)
  }

  private teardown(): void {
    const keyboard = this.input.keyboard
    if (keyboard) {
      for (const { event, handler } of this.devKeyHandlers) keyboard.off(event, handler)
    }
    this.devKeyHandlers = []

    this.halloween?.destroy()
  }
}
