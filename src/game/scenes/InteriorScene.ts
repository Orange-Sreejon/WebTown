import Phaser from 'phaser'
import { AssetKeys, AssetPaths } from '../config/AssetKeys'
import {
  DEPTH_GROUND,
  DEPTH_ROAD,
  DEPTH_DECORATION,
  DEPTH_STRUCTURE,
  INTERACT_COOLDOWN_MS,
  PROMPT_EXIT_TEXT,
  TRANSITION_FADE_MS,
  depthForFeetY,
} from '../config/GameConfig'
import { SceneKeys } from '../config/SceneKeys'
import { Player } from '../entities/Player'
import { InteractionPrompt } from '../entities/InteractionPrompt'
import { addStaticRects } from '../maps/collision-objects'
import {
  getInterior,
  getInteriorCollisionRects,
  pieceBounds,
  spawnFeet,
  type InteriorDefinition,
  type InteriorPiece,
} from '../maps/interior-layout'
import { OFFICE_KIT } from '../maps/interior-slices'
import {
  interiorSheetsLoaded,
  registerInteriorTextures,
  textureForSprite,
} from '../maps/interior-textures'
import { findNearbyTarget } from '../systems/interaction'
import { TransitionLock } from '../systems/transition'

/** Passed by `TownScene` when it launches this scene. */
export interface InteriorSceneData {
  houseId: string
  interiorId: string
}

/** Room margin, in pixels, kept clear around the room when choosing a zoom. */
const VIEW_MARGIN_PX = 32

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
  private houseId = ''
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

  constructor() {
    super({ key: SceneKeys.INTERIOR })
  }

  init(data: InteriorSceneData): void {
    this.houseId = data.houseId
    this.interiorId = data.interiorId
    this.definition = getInterior(data.interiorId)
    this.loadFailed = false
    this.nearExit = false
    this.lock.reset()
  }

  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.error('[InteriorScene] failed to load', file.key, file.url)
      this.loadFailed = true
    })

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
      .tileSprite(0, def.wallHeightPx, def.widthPx, def.heightPx - def.wallHeightPx, kit, 'floor')
      .setOrigin(0, 0)
      .setDepth(DEPTH_GROUND)

    const tile = OFFICE_KIT.wallUpper.w
    for (let x = 0; x < def.widthPx; x += tile) {
      this.add.image(x, 0, kit, 'wallUpper').setOrigin(0, 0).setDepth(DEPTH_ROAD)
      this.add
        .image(x, OFFICE_KIT.wallUpper.h, kit, 'wallLower')
        .setOrigin(0, 0)
        .setDepth(DEPTH_ROAD)
    }

    for (const piece of def.pieces) this.addPiece(piece)
  }

  private addPiece(piece: InteriorPiece): void {
    const { key, frame } = textureForSprite(piece.sprite)
    const bounds = pieceBounds(piece)

    this.add
      .image(bounds.x, bounds.y + bounds.h, key, frame)
      .setOrigin(0, 1)
      .setDepth(this.depthFor(piece))
  }

  /**
   * Flat things (rugs) sit just above the floor, wall decoration above the
   * wall, and everything else is y-sorted by its base with the same function
   * the player uses — so the player passes in front of or behind furniture.
   */
  private depthFor(piece: InteriorPiece): number {
    switch (piece.layer) {
      case 'flat':
        return DEPTH_DECORATION
      case 'decor':
        return DEPTH_STRUCTURE
      case 'sorted':
        return depthForFeetY(piece.sortBottom ?? piece.bottom)
    }
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
    const zoom = Math.max(
      1,
      Math.floor(
        Math.min(
          cam.width / (def.widthPx + VIEW_MARGIN_PX),
          cam.height / (def.heightPx + VIEW_MARGIN_PX),
        ),
      ),
    )

    cam.setZoom(zoom)
    cam.setBackgroundColor('#1d1a22')
    cam.roundPixels = true

    const fits = cam.width / zoom >= def.widthPx && cam.height / zoom >= def.heightPx
    if (fits) {
      cam.stopFollow()
      cam.removeBounds()
      cam.centerOn(def.widthPx / 2, def.heightPx / 2)
    } else {
      cam.setBounds(0, 0, def.widthPx, def.heightPx)
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
    this.scene.wake(SceneKeys.TOWN, { houseId: this.houseId })
    this.scene.stop()
  }

  private teardown(): void {
    if (this.onInteractKey) this.input.keyboard?.off('keydown-E', this.onInteractKey)
    this.onInteractKey = undefined

    if (this.onResize) this.scale.off('resize', this.onResize)
    this.onResize = undefined

    this.prompt?.destroy()
    this.nearExit = false
  }
}
