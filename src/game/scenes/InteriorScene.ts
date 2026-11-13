import Phaser from 'phaser'
import { AssetKeys, AssetPaths } from '../config/AssetKeys'
import {
  DEPTH_GROUND,
  DEPTH_ROAD,
  INTERACT_COOLDOWN_MS,
  INTERIOR_BORDER_PX,
  INTERIOR_VIEW_MARGIN_PX,
  PROMPT_EXIT_TEXT,
  TRANSITION_FADE_MS,
} from '../config/GameConfig'
import { SceneKeys } from '../config/SceneKeys'
import { Player } from '../entities/Player'
import { InteractionPrompt } from '../entities/InteractionPrompt'
import { addStaticRects } from '../maps/collision-objects'
import {
  getInteriorCollisionRects,
  interiorViewRect,
  pieceBounds,
  pieceDepth,
  spawnFeet,
  type InteriorDefinition,
  type InteriorPiece,
} from '../maps/interior-layout'
import { OFFICE_KIT } from '../maps/interior-slices'
import { getTemplate } from '../maps/house/default-interior'
import type { HouseLayout } from '../maps/house/house-layout'
import { validateLayout } from '../maps/house/layout-rules'
import { resolveInterior } from '../maps/house/resolve-interior'
import {
  interiorSheetsLoaded,
  registerInteriorTextures,
  textureForSprite,
} from '../maps/interior-textures'
import { findNearbyTarget } from '../systems/interaction'
import { TransitionLock } from '../systems/transition'
import { chooseIntegerZoom } from '../systems/view-fit'

/** Passed by `TownScene` when it launches this scene. */
export interface InteriorSceneData {
  houseId: string
  interiorId: string
  /**
   * This house's own furniture layout, loaded from the `HouseLayoutStore`.
   * Absent when the load failed, in which case the scene returns to the town.
   */
  layout?: HouseLayout
}

/**
 * A walkable room, built entirely from an `InteriorDefinition`.
 *
 * Launched by `TownScene` (which goes to sleep) and stopped on exit, so every
 * visit starts from a clean slate and nothing outlives it. The scene owns its
 * own `Player`, physics world and input; movement, collision rects and depth
 * sorting come from the same modules the town uses.
 *
 * The interior art is loaded here, not in `BootScene`, so a missing file can
 * only ever cost the player a visit — never the town.
 */
export class InteriorScene extends Phaser.Scene {
  private interiorId = ''
  private definition: InteriorDefinition | undefined
  private loadFailed = false

  private player!: Player
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: {
    W: Phaser.Input.Keyboard.Key
    A: Phaser.Input.Keyboard.Key
    S: Phaser.Input.Keyboard.Key
    D: Phaser.Input.Keyboard.Key
  }
  private prompt!: InteractionPrompt
  private readonly lock = new TransitionLock(INTERACT_COOLDOWN_MS)
  private nearExit = false

  private onInteractKey: ((event: KeyboardEvent) => void) | undefined
  private onResize: (() => void) | undefined
  private onLoadError: ((file: Phaser.Loader.File) => void) | undefined

  constructor() {
    super({ key: SceneKeys.INTERIOR })
  }

  init(data: InteriorSceneData): void {
    this.interiorId = data.interiorId
    this.definition = this.buildDefinition(data)
    this.loadFailed = false
    this.nearExit = false
    this.lock.reset()
  }

  /**
   * This house's room: the template furnished with the house's own layout.
   * Anything wrong (unknown template, missing or rule-breaking layout) gives
   * undefined, and `create` then returns the player to the town.
   */
  private buildDefinition(data: InteriorSceneData): InteriorDefinition | undefined {
    const template = getTemplate(data.interiorId)
    if (!template || !data.layout) return undefined

    const violations = validateLayout(template, data.layout)
    if (violations.length > 0) {
      console.error(
        `[InteriorScene] layout for "${data.houseId}" breaks ${violations.length} rule(s)`,
        violations,
      )
      return undefined
    }
    return resolveInterior(template, data.layout)
  }

  preload(): void {
    this.onLoadError = (file: Phaser.Loader.File): void => {
      console.error('[InteriorScene] failed to load', file.key, file.url)
      this.loadFailed = true
    }
    this.load.on('loaderror', this.onLoadError)

    const sheets = [
      AssetKeys.INTERIOR_OFFICE_KIT,
      AssetKeys.INTERIOR_FURNITURE,
      AssetKeys.INTERIOR_COMPUTERS,
    ] as const
    for (const key of sheets) {
      if (!this.textures.exists(key)) this.load.image(key, AssetPaths[key])
    }
  }

  create(): void {
    // Loading is over; nothing needs the listener any more.
    this.removeLoadErrorListener()

    const def = this.definition
    if (!def || this.loadFailed || !interiorSheetsLoaded(this)) {
      console.error(`[InteriorScene] cannot open "${this.interiorId}" — returning to town`)
      this.returnToTown()
      return
    }

    this.physics.world.setBounds(0, 0, def.widthPx, def.heightPx)

    registerInteriorTextures(this)
    this.buildRoom(def)

    const walls = this.physics.add.staticGroup()
    addStaticRects(this, walls, getInteriorCollisionRects(def))

    const spawn = spawnFeet(def)
    this.player = new Player(this, 0, 0)
    this.player.placeFeet(spawn.x, spawn.y)
    this.player.setFacing(def.spawn.facing)
    this.physics.add.collider(this.player, walls)

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd
    // A key still held from the town must not count as pressed here.
    this.input.keyboard!.resetKeys()

    this.prompt = new InteractionPrompt(this)

    this.fitCamera()
    this.onResize = () => this.fitCamera()
    this.scale.on('resize', this.onResize)

    this.onInteractKey = (event: KeyboardEvent): void => {
      // A held key repeats; only a fresh press may open or close a door.
      if (event.repeat) return
      if (!this.nearExit || !this.lock.tryBegin(performance.now())) return
      this.leave()
    }
    this.input.keyboard!.on('keydown-E', this.onInteractKey)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())

    // The E that opened the door must not also close it.
    this.lock.release(performance.now())
    this.cameras.main.fadeIn(TRANSITION_FADE_MS, 0, 0, 0)
  }

  update(): void {
    if (!this.player) return

    if (this.lock.isBusy) {
      this.player.halt()
      return
    }

    this.player.update(this.cursors, this.wasd)

    const def = this.definition
    if (!def) return

    const target = findNearbyTarget(this.player.feet, [def.exit])
    this.nearExit = target !== null
    if (target) {
      this.prompt.show(target.promptX, target.promptY, PROMPT_EXIT_TEXT)
    } else {
      this.prompt.hide()
    }
  }

  // ── Building the room ────────────────────────────────────────────────────

  private buildRoom(def: InteriorDefinition): void {
    const kit = AssetKeys.INTERIOR_OFFICE_KIT

    this.add
      .tileSprite(
        0, def.wallHeightPx, def.widthPx, def.heightPx - def.wallHeightPx, kit, def.style.floor,
      )
      .setOrigin(0, 0)
      .setDepth(DEPTH_GROUND)

    const tile = OFFICE_KIT.wallUpper.w
    for (let x = 0; x < def.widthPx; x += tile) {
      this.add.image(x, 0, kit, def.style.wallUpper).setOrigin(0, 0).setDepth(DEPTH_ROAD)
      this.add
        .image(x, OFFICE_KIT.wallUpper.h, kit, def.style.wallLower)
        .setOrigin(0, 0)
        .setDepth(DEPTH_ROAD)
    }

    for (const piece of def.pieces) this.addPiece(piece)

    this.buildBorders(def)
  }

  /**
   * Art-only frame outside the physics bounds: brick on the left, right and
   * bottom, plus soft shading where wall meets floor (under the skirting
   * board, and along the inner side and bottom edges). The brick tile is
   * cropped, not scaled, so pixels stay 1:1.
   */
  private buildBorders(def: InteriorDefinition): void {
    const kit = AssetKeys.INTERIOR_OFFICE_KIT
    const b = INTERIOR_BORDER_PX
    const brick = (x: number, y: number, w: number, h: number): void => {
      this.add.tileSprite(x, y, w, h, kit, 'brickWall').setOrigin(0, 0).setDepth(DEPTH_ROAD)
    }

    brick(-b, 0, b, def.heightPx + b)
    brick(def.widthPx, 0, b, def.heightPx + b)
    brick(0, def.heightPx, def.widthPx, b)

    // Shade strips sit above the floor and rug but below furniture and the player.
    const shade = this.add.graphics().setDepth(DEPTH_ROAD + 0.5)
    shade.fillStyle(0x000000, 0.22)
    shade.fillRect(0, def.wallHeightPx, def.widthPx, 4)
    shade.fillStyle(0x000000, 0.14)
    shade.fillRect(0, def.wallHeightPx + 4, def.widthPx, 3)
    shade.fillStyle(0x000000, 0.16)
    shade.fillRect(0, def.wallHeightPx, 3, def.heightPx - def.wallHeightPx)
    shade.fillRect(def.widthPx - 3, def.wallHeightPx, 3, def.heightPx - def.wallHeightPx)
    shade.fillRect(0, def.heightPx - 3, def.widthPx, 3)
  }

  private addPiece(piece: InteriorPiece): void {
    const { key, frame } = textureForSprite(piece.sprite)
    const bounds = pieceBounds(piece)

    this.add
      .image(bounds.x, bounds.y + bounds.h, key, frame)
      .setOrigin(0, 1)
      .setDepth(pieceDepth(piece))
  }

  // ── Camera ───────────────────────────────────────────────────────────────

  /**
   * Picks the largest whole-number zoom that shows the entire room, and
   * centres on it. Whole numbers keep the 16px art crisp. If the window is too
   * small to show the whole room even at 1×, the camera follows the player
   * instead.
   */
  private fitCamera(): void {
    const def = this.definition
    if (!def) return

    const cam = this.cameras.main
    const view = interiorViewRect(def)
    // cam.width/height are the real Phaser canvas size, which Scale.EXPAND keeps
    // equal to the browser's drawable area.
    const { zoom, fits } = chooseIntegerZoom(cam.width, cam.height, view, INTERIOR_VIEW_MARGIN_PX)

    cam.setZoom(zoom)
    cam.setBackgroundColor('#1d1a22')
    cam.roundPixels = true

    if (fits) {
      cam.stopFollow()
      cam.removeBounds()
      cam.centerOn(view.x + view.w / 2, view.y + view.h / 2)
    } else {
      cam.setBounds(view.x, view.y, view.w, view.h)
      cam.startFollow(this.player, true, 1, 1)
    }
  }

  // ── Leaving ──────────────────────────────────────────────────────────────

  private leave(): void {
    this.prompt.hide()
    this.player.halt()
    this.input.keyboard?.resetKeys()

    const cam = this.cameras.main
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.returnToTown())
    cam.fadeOut(TRANSITION_FADE_MS, 0, 0, 0)
  }

  /** Wakes the town and stops this scene. Also the safe path out of a failed load. */
  private returnToTown(): void {
    this.scene.wake(SceneKeys.TOWN)
    this.scene.stop()
  }

  private removeLoadErrorListener(): void {
    if (this.onLoadError) this.load.off('loaderror', this.onLoadError)
    this.onLoadError = undefined
  }

  private teardown(): void {
    this.removeLoadErrorListener()

    if (this.onInteractKey) this.input.keyboard?.off('keydown-E', this.onInteractKey)
    this.onInteractKey = undefined

    if (this.onResize) this.scale.off('resize', this.onResize)
    this.onResize = undefined

    this.prompt?.destroy()
    this.nearExit = false
  }
}
