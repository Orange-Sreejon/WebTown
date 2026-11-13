import Phaser from 'phaser'
import type { Point, Rect } from '../../lib/geometry'
import {
  HIDDEN_EDITOR_VIEW,
  emitEditorState,
  onEditorCommand,
  type EditorCommand,
} from '../../lib/editor-bridge'
import { AssetKeys, AssetPaths } from '../config/AssetKeys'
import {
  DEPTH_GROUND,
  DEPTH_ROAD,
  EDITOR_DRAG_THRESHOLD_PX,
  INTERACT_COOLDOWN_MS,
  INTERIOR_BORDER_PX,
  INTERIOR_VIEW_MARGIN_PX,
  PROMPT_EXIT_TEXT,
  TRANSITION_FADE_MS,
} from '../config/GameConfig'
import { canEditHouse } from '../config/ownership'
import { SceneKeys } from '../config/SceneKeys'
import { EditorOverlay } from '../entities/EditorOverlay'
import { InteractionPrompt } from '../entities/InteractionPrompt'
import { Player } from '../entities/Player'
import { addStaticRects } from '../maps/collision-objects'
import { getTemplate } from '../maps/house/default-interior'
import { EditorSession, type EditorMode } from '../maps/house/editor-session'
import type { HouseLayout, InteriorTemplate } from '../maps/house/house-layout'
import { houseLayouts } from '../maps/house/house-layout-store'
import { validateLayout } from '../maps/house/layout-rules'
import { resolveInterior } from '../maps/house/resolve-interior'
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
import {
  interiorSheetsLoaded,
  registerInteriorTextures,
  textureForSprite,
} from '../maps/interior-textures'
import { findNearbyTarget } from '../systems/interaction'
import { isFeetSafe } from '../systems/return-position'
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

type PointerEvent = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerupoutside'

/**
 * A walkable room, built entirely from an `InteriorDefinition`.
 *
 * Launched by `TownScene` (which goes to sleep) and stopped on exit, so every
 * visit starts from a clean slate and nothing outlives it. The scene owns its
 * own `Player`, physics world and input; movement, collision rects and depth
 * sorting come from the same modules the town uses.
 *
 * In the player's own house the scene also hosts the furniture editor. All
 * editing state lives in an `EditorSession`; the scene feeds it pointer input
 * and the React UI's commands, and redraws what it reports. While editing,
 * the player stands still and the door does not open.
 *
 * The interior art is loaded here, not in `BootScene`, so a missing file can
 * only ever cost the player a visit — never the town.
 */
export class InteriorScene extends Phaser.Scene {
  private houseId = ''
  private interiorId = ''
  private template: InteriorTemplate | undefined
  private layout: HouseLayout | undefined
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

  private walls: Phaser.Physics.Arcade.StaticGroup | undefined
  private readonly pieceImages = new Map<string, Phaser.GameObjects.Image>()

  private session: EditorSession | undefined
  private overlay: EditorOverlay | undefined
  private renderedVersion = -1
  private renderedMode: EditorMode = 'play'
  private lastViewJson = ''
  private readonly cleanups: Array<() => void> = []

  private onInteractKey: ((event: KeyboardEvent) => void) | undefined
  private onResize: (() => void) | undefined
  private onLoadError: ((file: Phaser.Loader.File) => void) | undefined

  constructor() {
    super({ key: SceneKeys.INTERIOR })
  }

  init(data: InteriorSceneData): void {
    this.houseId = data.houseId
    this.interiorId = data.interiorId
    this.template = getTemplate(data.interiorId)
    this.layout = data.layout
    this.definition = this.buildDefinition(data)
    this.loadFailed = false
    this.nearExit = false
    this.renderedVersion = -1
    this.renderedMode = 'play'
    this.lastViewJson = ''
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
    if (!def || !this.template || !this.layout || this.loadFailed || !interiorSheetsLoaded(this)) {
      console.error(`[InteriorScene] cannot open "${this.interiorId}" — returning to town`)
      this.returnToTown()
      return
    }

    this.physics.world.setBounds(0, 0, def.widthPx, def.heightPx)

    registerInteriorTextures(this)
    this.buildShell(def)
    this.renderPieces(def)

    this.walls = this.physics.add.staticGroup()
    addStaticRects(this, this.walls, getInteriorCollisionRects(def))

    const spawn = spawnFeet(def)
    this.player = new Player(this, 0, 0)
    this.player.placeFeet(spawn.x, spawn.y)
    this.player.setFacing(def.spawn.facing)
    this.physics.add.collider(this.player, this.walls)

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd
    // A key still held from the town must not count as pressed here.
    this.input.keyboard!.resetKeys()

    this.prompt = new InteractionPrompt(this)

    this.setUpEditor(def)

    this.fitCamera()
    this.onResize = () => this.fitCamera()
    this.scale.on('resize', this.onResize)

    this.onInteractKey = (event: KeyboardEvent): void => {
      // A held key repeats; only a fresh press may open or close a door.
      if (event.repeat || this.isEditing()) return
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

    if (this.lock.isBusy || this.isEditing()) {
      this.player.halt()
      this.nearExit = false
      this.prompt.hide()
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

  /** Floor, back wall and borders: everything furniture never changes. */
  private buildShell(def: InteriorDefinition): void {
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

  /** (Re)draws the door and every piece of furniture. About twenty sprites, so cheap. */
  private renderPieces(def: InteriorDefinition): void {
    for (const image of this.pieceImages.values()) image.destroy()
    this.pieceImages.clear()
    for (const piece of def.pieces) this.pieceImages.set(piece.id, this.addPiece(piece))
  }

  private addPiece(piece: InteriorPiece): Phaser.GameObjects.Image {
    const { key, frame } = textureForSprite(piece.sprite)
    const bounds = pieceBounds(piece)

    return this.add
      .image(bounds.x, bounds.y + bounds.h, key, frame)
      .setOrigin(0, 1)
      .setDepth(pieceDepth(piece))
  }

  private rebuildColliders(def: InteriorDefinition): void {
    if (!this.walls) return
    this.walls.clear(true, true)
    addStaticRects(this, this.walls, getInteriorCollisionRects(def))
  }

  // ── Furniture editor ─────────────────────────────────────────────────────

  private isEditing(): boolean {
    return this.session?.mode === 'edit'
  }

  private setUpEditor(def: InteriorDefinition): void {
    this.session = new EditorSession({
      houseId: this.houseId,
      template: this.template!,
      layout: this.layout!,
      store: houseLayouts,
      canEdit: canEditHouse(this.houseId),
    })
    this.renderedVersion = this.session.version
    this.overlay = new EditorOverlay(this, def)

    this.cleanups.push(this.session.subscribe(() => this.onSessionChange()))
    this.cleanups.push(onEditorCommand(command => this.handleCommand(command)))

    const toRoom = (pointer: Phaser.Input.Pointer): Point => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      return { x: world.x, y: world.y }
    }
    const pointerHandlers: Array<[PointerEvent, (p: Phaser.Input.Pointer) => void]> = [
      ['pointerdown', p => this.session?.pointerDown(toRoom(p))],
      ['pointermove', p => this.session?.pointerMove(toRoom(p))],
      ['pointerup', p => this.session?.pointerUp(toRoom(p))],
      ['pointerupoutside', p => this.session?.pointerUp(toRoom(p))],
    ]
    for (const [event, handler] of pointerHandlers) {
      this.input.on(event, handler)
      this.cleanups.push(() => this.input.off(event, handler))
    }

    const keyboard = this.input.keyboard!
    const keyHandlers: Array<[string, () => void]> = [
      ['keydown-ESC', () => this.session?.escape()],
      ['keydown-DELETE', () => this.session?.removeSelected()],
      ['keydown-BACKSPACE', () => this.session?.removeSelected()],
    ]
    for (const [event, handler] of keyHandlers) {
      keyboard.on(event, handler)
      this.cleanups.push(() => keyboard.off(event, handler))
    }

    this.publishView()
  }

  private handleCommand(command: EditorCommand): void {
    const session = this.session
    // Nothing is edited while a door is opening or closing.
    if (!session || this.lock.isBusy) return

    switch (command.type) {
      case 'enter-edit':
        session.beginEdit()
        return
      case 'save':
        void session.save()
        return
      case 'cancel':
        session.cancel()
        return
      case 'remove-selected':
        session.removeSelected()
        return
      case 'escape':
        session.escape()
        return
      case 'start-placing':
        session.startPlacing(command.furnitureType)
        return
    }
  }

  /** Brings the room, the overlay and the UI in line with the session. */
  private onSessionChange(): void {
    const session = this.session
    if (!session) return

    if (session.version !== this.renderedVersion) {
      this.definition = session.definition()
      this.renderPieces(this.definition)
      this.renderedVersion = session.version
    }

    if (session.mode !== this.renderedMode) {
      this.renderedMode = session.mode
      if (session.mode === 'edit') this.enterEditMode()
      else this.enterPlayMode()
    }

    if (session.mode === 'edit') this.renderEditing(session)
    this.publishView()
  }

  private enterEditMode(): void {
    this.player.halt()
    this.prompt.hide()
    this.nearExit = false
    this.overlay?.setVisible(true)
  }

  /**
   * Back to walking: collide with the room as saved (or as it was, after a
   * cancel). If furniture now stands where the player is, they step to the
   * spot inside the door, which the rules always keep clear.
   */
  private enterPlayMode(): void {
    this.overlay?.setVisible(false)
    for (const image of this.pieceImages.values()) image.setVisible(true)

    const def = this.session!.definition()
    this.definition = def
    this.rebuildColliders(def)

    const bounds: Rect = { x: 0, y: 0, w: def.widthPx, h: def.heightPx }
    if (!isFeetSafe(this.player.feet, getInteriorCollisionRects(def), bounds)) {
      const spawn = spawnFeet(def)
      this.player.placeFeet(spawn.x, spawn.y)
      this.player.setFacing(def.spawn.facing)
    }
    this.input.keyboard?.resetKeys()
  }

  private renderEditing(session: EditorSession): void {
    const def = session.definition()
    const preview = session.preview()
    const hidden = new Set(preview?.hiddenIds ?? [])
    for (const [id, image] of this.pieceImages) image.setVisible(!hidden.has(id))

    const selected = session.selectedId
      ? def.pieces.find(p => p.id === session.selectedId) ?? null
      : null
    this.overlay?.render(selected, preview)
  }

  /** Sends the UI a new view, but only when something in it changed. */
  private publishView(): void {
    if (!this.session) return
    const view = this.session.view()
    const json = JSON.stringify(view)
    if (json === this.lastViewJson) return
    this.lastViewJson = json
    emitEditorState(view)
  }

  /** Tells the UI there is nothing to edit (leaving, or shut down). */
  private hideEditorUi(): void {
    this.lastViewJson = ''
    emitEditorState(HIDDEN_EDITOR_VIEW)
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

    // The drag threshold is in screen pixels; the session works in room pixels.
    this.session?.setDragThreshold(EDITOR_DRAG_THRESHOLD_PX / zoom)
  }

  // ── Leaving ──────────────────────────────────────────────────────────────

  private leave(): void {
    this.hideEditorUi()
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

    // An unsaved draft is dropped here; the store only ever changes on Save.
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.session?.dispose()
    this.session = undefined
    this.overlay?.destroy()
    this.overlay = undefined
    this.hideEditorUi()

    this.pieceImages.clear()
    this.walls = undefined
    this.prompt?.destroy()
    this.nearExit = false
  }
}
