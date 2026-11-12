import Phaser from 'phaser'
import {
  MAP_WIDTH_PX,
  MAP_HEIGHT_PX,
  DISPLAY_SCALE,
  INTERACT_COOLDOWN_MS,
  PLAYER_START_TILE_X,
  PLAYER_START_TILE_Y,
  PROMPT_ENTER_TEXT,
  TRANSITION_FADE_MS,
} from '../config/GameConfig'
import { DEFAULT_START_HOUR } from '../config/halloween'
import { HOUSES } from '../config/houses'
import { SceneKeys } from '../config/SceneKeys'
import { TownMap } from '../maps/TownMap'
import { createCollisionObjects } from '../maps/collision-objects'
import { HalloweenLayer } from '../maps/halloween-layer'
import { STRUCTURES } from '../maps/town-layout'
import { skyAtHour, type SkyFrame } from '../systems/day-night'
import {
  GameClock,
  parseFrozenOverride,
  parseTimeOverride,
} from '../systems/game-clock'
import { buildEntrances, findNearbyTarget, type Entrance } from '../systems/interaction'
import { resolveReturnFeet, type TownReturnState } from '../systems/return-position'
import { TransitionLock } from '../systems/transition'
import { InteractionPrompt } from '../entities/InteractionPrompt'
import { Player } from '../entities/Player'
import { emit } from '../../lib/event-bus'
import type { Rect } from '../../lib/geometry'

/** One entrance per enterable house, derived once from the town layout. */
const ENTRANCES: readonly Entrance[] = buildEntrances(HOUSES, STRUCTURES)

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

  /** "E — Enter House" label shown at the door the player is standing in front of. */
  private prompt!: InteractionPrompt
  /** Stops a door from firing twice, and from re-firing right after a return. */
  private readonly lock = new TransitionLock(INTERACT_COOLDOWN_MS)
  private nearby: Entrance | null = null
  /** Where to put the player back when the interior hands control back. */
  private returnState: TownReturnState | undefined
  /** True when `?timeFrozen=1` holds the clock; it must stay frozen after a visit. */
  private frozenByOverride = false
  private onInteractKey: ((event: KeyboardEvent) => void) | undefined

  constructor() {
    super({ key: SceneKeys.TOWN })
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
      this.frozenByOverride = frozen

      this.halloween = new HalloweenLayer(this)
      this.halloween.build()

      // Pumpkins are solid while they are visible; the layer switches their
      // bodies off during the day.
      this.physics.add.collider(this.player, this.halloween.obstacles)

      this.setUpHouseEntrances()
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
    // Phaser can run one more update after sleep() is called inside a camera
    // callback; the town must not tick, move or show a prompt once it is asleep.
    if (this.sys.isSleeping()) return

    // While a door is opening or closing the player stands still, so the spot
    // that was saved is the spot that will be restored.
    if (this.lock.isBusy) {
      this.player?.halt()
    } else {
      this.player?.update(this.cursors, this.wasd)
    }

    this.updateEntrancePrompt()

    // The clock stops from the moment a door is used, not only once the town
    // is asleep, so the fade does not cost the player in-game minutes.
    if (!this.lock.isBusy) this.clock?.tick(delta)
    if (this.clock) this.applySky(skyAtHour(this.clock.hour))
  }

  // ── Houses ───────────────────────────────────────────────────────────────

  private setUpHouseEntrances(): void {
    this.prompt = new InteractionPrompt(this)

    this.onInteractKey = (event: KeyboardEvent): void => {
      // Only a fresh press counts: a held key repeats, and the E that closed a
      // door in the interior must not reopen this one.
      if (event.repeat) return
      const entrance = this.nearby
      if (!entrance || !this.lock.tryBegin(performance.now())) return
      this.enterHouse(entrance)
    }
    this.input.keyboard!.on('keydown-E', this.onInteractKey)

    this.events.on(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.events.on(Phaser.Scenes.Events.WAKE, this.onWake, this)
  }

  /** Shows the prompt while the player's feet are in front of an enterable door. */
  private updateEntrancePrompt(): void {
    if (!this.player || !this.prompt) return

    const entrance = this.lock.isBusy ? null : findNearbyTarget(this.player.feet, ENTRANCES)
    this.nearby = entrance

    if (entrance) {
      this.prompt.show(entrance.promptX, entrance.promptY, PROMPT_ENTER_TEXT)
    } else {
      this.prompt.hide()
    }
  }

  /**
   * Saves exactly where the player is, fades out, then hands over to the
   * interior and goes to sleep. Sleeping (rather than stopping) keeps the map,
   * the physics world and the Halloween layer exactly as they were.
   */
  private enterHouse(entrance: Entrance): void {
    const cam = this.cameras.main
    const feet = this.player.feet

    this.returnState = {
      houseId: entrance.id,
      feetX: feet.x,
      feetY: feet.y,
      facing: this.player.facing,
      cameraScrollX: cam.scrollX,
      cameraScrollY: cam.scrollY,
      cameraZoom: cam.zoom,
    }

    this.prompt.hide()
    this.player.halt()

    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.launch(SceneKeys.INTERIOR, {
        houseId: entrance.id,
        interiorId: entrance.interiorId,
      })
      this.scene.sleep()
    })
    cam.fadeOut(TRANSITION_FADE_MS, 0, 0, 0)
  }

  /** The town clock stops while the player is indoors. */
  private onSleep(): void {
    this.clock?.freeze(true)
    this.input.keyboard?.resetKeys()
    this.prompt?.hide()
    this.player?.halt()
  }

  /** Restores the player and the clock, then fades back in. */
  private onWake(): void {
    this.clock?.freeze(this.frozenByOverride)
    this.input.keyboard?.resetKeys()

    const saved = this.returnState
    this.returnState = undefined
    if (saved) this.restorePlayer(saved)

    const cam = this.cameras.main
    cam.resetFX()
    cam.fadeIn(TRANSITION_FADE_MS, 0, 0, 0)

    // Wall-clock time: the scene clock (`this.time.now`) does not advance while
    // the town sleeps, so after a visit it would still read the moment the
    // player went in and the cooldown would already have expired.
    this.lock.release(performance.now())
  }

  /**
   * Puts the player back at the saved spot after checking it is still clear.
   * If something now occupies it, the player appears in front of the door.
   */
  private restorePlayer(saved: TownReturnState): void {
    const entrance = ENTRANCES.find(e => e.id === saved.houseId)
    const fallback = entrance?.fallbackFeet ?? { x: saved.feetX, y: saved.feetY }
    const bounds: Rect = { x: 0, y: 0, w: MAP_WIDTH_PX, h: MAP_HEIGHT_PX }

    const result = resolveReturnFeet(saved, this.collectObstacleRects(), bounds, fallback)

    this.player.placeFeet(result.feetX, result.feetY)
    this.player.setFacing(result.usedFallback ? 'down' : saved.facing)

    const cam = this.cameras.main
    cam.setZoom(saved.cameraZoom)
    if (result.usedFallback) {
      console.warn('[TownScene] saved return position was blocked; using the door-front fallback')
    } else {
      cam.setScroll(saved.cameraScrollX, saved.cameraScrollY)
    }
  }

  /** Every enabled static obstacle body in the town, as plain rectangles. */
  private collectObstacleRects(): Rect[] {
    const rects: Rect[] = []
    const collect = (group: Phaser.Physics.Arcade.StaticGroup): void => {
      for (const child of group.getChildren()) {
        const body = child.body as Phaser.Physics.Arcade.StaticBody | null
        if (body?.enable) rects.push({ x: body.x, y: body.y, w: body.width, h: body.height })
      }
    }
    collect(this.obstacles)
    collect(this.halloween.obstacles)
    return rects
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

    if (this.onInteractKey) keyboard?.off('keydown-E', this.onInteractKey)
    this.onInteractKey = undefined
    this.events.off(Phaser.Scenes.Events.SLEEP, this.onSleep, this)
    this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.prompt?.destroy()

    this.halloween?.destroy()
  }
}
