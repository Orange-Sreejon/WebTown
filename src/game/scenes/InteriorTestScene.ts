import Phaser from 'phaser'
import { AssetKeys, AssetPaths } from '../config/AssetKeys'
import { PLAYER_SPRITE_SCALE } from '../config/GameConfig'
import { OFFICE_KIT } from '../maps/interior-slices'
import { preparedKey, registerInteriorTextures } from '../maps/interior-textures'

/** Room size in pixels at 1x scale: 14 x 13 tiles, including a 4-tile back wall. */
const ROOM_W = 224
const ROOM_H = 208
const WALL_H = 64

/** Integer camera zoom: furniture is 16px art, so non-integer zoom would shimmer. */
const VIEW_ZOOM = 3

/** Draw order: structure first, then everything y-sorted by its bottom edge. */
const DEPTH_FLOOR = 0
const DEPTH_WALL = 1
const DEPTH_FLAT = 2
const DEPTH_WALL_DECOR = 3
const DEPTH_SORTED = 10

/** The traveller's standing frame, scaled like the town player. */
const PLAYER_FRAME = 1

/**
 * Milestone 0 visual test room.
 *
 * Shows the floor, walls, door, bookshelf, books, a desk and a computer - built
 * two ways side by side - plus the town's player sprite for scale. It is an art
 * playground for comparing sprites; the real interior is `InteriorScene`. It
 * has no physics, no input and no game logic, and is only reachable from
 * `interior-test.html`.
 */
export class InteriorTestScene extends Phaser.Scene {
  constructor() {
    super({ key: 'InteriorTestScene' })
  }

  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.error('[InteriorTestScene] failed to load', file.key, file.url)
    })

    this.load.image(AssetKeys.INTERIOR_OFFICE_KIT, AssetPaths[AssetKeys.INTERIOR_OFFICE_KIT])
    this.load.image(AssetKeys.INTERIOR_FURNITURE, AssetPaths[AssetKeys.INTERIOR_FURNITURE])
    this.load.image(AssetKeys.INTERIOR_COMPUTERS, AssetPaths[AssetKeys.INTERIOR_COMPUTERS])
    this.load.spritesheet(AssetKeys.TRAVELLER, AssetPaths[AssetKeys.TRAVELLER], {
      frameWidth: 48,
      frameHeight: 64,
    })
  }

  create(): void {
    registerInteriorTextures(this)

    this.buildShell()
    this.buildWallDecor()
    this.buildBookshelfAndRug()
    this.buildDeskA()
    this.buildDeskB()
    this.buildReadingTable()
    this.buildPlayerForScale()

    this.cameras.main
      .setBackgroundColor('#1d1a22')
      .setZoom(VIEW_ZOOM)
      .centerOn(ROOM_W / 2, ROOM_H / 2)
  }

  private buildShell(): void {
    const kit = AssetKeys.INTERIOR_OFFICE_KIT

    this.add
      .tileSprite(0, WALL_H, ROOM_W, ROOM_H - WALL_H, kit, 'floor')
      .setOrigin(0, 0)
      .setDepth(DEPTH_FLOOR)

    for (let x = 0; x < ROOM_W; x += OFFICE_KIT.wallUpper.w) {
      this.add.image(x, 0, kit, 'wallUpper').setOrigin(0, 0).setDepth(DEPTH_WALL)
      this.add
        .image(x, OFFICE_KIT.wallUpper.h, kit, 'wallLower')
        .setOrigin(0, 0)
        .setDepth(DEPTH_WALL)
    }

    this.add.image(104, 0, kit, 'door').setOrigin(0, 0).setDepth(DEPTH_WALL_DECOR)
  }

  private buildWallDecor(): void {
    const furniture = AssetKeys.INTERIOR_FURNITURE
    const kit = AssetKeys.INTERIOR_OFFICE_KIT

    this.add.image(8, 12, furniture, 'windowBlue').setOrigin(0, 0).setDepth(DEPTH_WALL_DECOR)
    this.add.image(168, 12, furniture, 'windowPink').setOrigin(0, 0).setDepth(DEPTH_WALL_DECOR)
    this.add.image(140, 20, kit, 'chart').setOrigin(0, 0).setDepth(DEPTH_WALL_DECOR)
  }

  private buildBookshelfAndRug(): void {
    const furniture = AssetKeys.INTERIOR_FURNITURE

    this.add.image(57, 118, furniture, 'rugOrange').setOrigin(0, 0).setDepth(DEPTH_FLAT)
    this.placeBottom(furniture, 'bookshelfTall', 54, 72)
  }

  /**
   * Option A - everything from the 16px office kit: desk, monitor, keyboard and
   * mouse. Same pixel density as the walls and floor.
   */
  private buildDeskA(): void {
    const kit = AssetKeys.INTERIOR_OFFICE_KIT
    const x = 8
    const bottom = 100

    this.placeBottom(kit, 'desk', x, bottom)
    const onDesk = (name: string, dx: number, rise: number, lift: number): void => {
      this.add
        .image(x + dx, bottom - rise, kit, name)
        .setOrigin(0, 1)
        .setDepth(this.sortDepth(bottom) + lift)
    }
    onDesk('monitor', 6, 19, 0.001)
    onDesk('keyboard', 8, 12, 0.002)
    onDesk('mouse', 25, 14, 0.002)
  }

  /**
   * Option B - the large computer sheet, keyed to transparency and averaged
   * down to 48px wide so the desk is about as wide as the bookshelf.
   */
  private buildDeskB(): void {
    this.placeBottom(preparedKey('computerDesk'), undefined, 170, 116)
  }

  /** Reading table with a notebook and books from the large sheet, plus a chair. */
  private buildReadingTable(): void {
    const furniture = AssetKeys.INTERIOR_FURNITURE
    const tableX = 24
    const tableBottom = 198

    this.placeBottom(furniture, 'plankTable', tableX, tableBottom)

    const notebook = preparedKey('notebook')
    const books = preparedKey('bookStack')
    const depth = this.sortDepth(tableBottom)
    this.add.image(tableX + 22, tableBottom - 28, notebook).setOrigin(0, 1).setDepth(depth + 0.001)
    this.add.image(tableX + 6, tableBottom - 30, books).setOrigin(0, 1).setDepth(depth + 0.001)

    this.placeBottom(furniture, 'chair', 98, 176)
  }

  /** The same traveller sprite and scale the town uses, to judge furniture size. */
  private buildPlayerForScale(): void {
    const bottom = 190
    this.add
      .sprite(150, bottom, AssetKeys.TRAVELLER, PLAYER_FRAME)
      .setOrigin(0.5, 1)
      .setScale(PLAYER_SPRITE_SCALE)
      .setDepth(this.sortDepth(bottom))
  }

  /** Bottom-left anchored, y-sorted by its bottom edge. */
  private placeBottom(
    key: string,
    frame: string | undefined,
    x: number,
    bottom: number,
  ): Phaser.GameObjects.Image {
    return this.add
      .image(x, bottom, key, frame)
      .setOrigin(0, 1)
      .setDepth(this.sortDepth(bottom))
  }

  private sortDepth(bottom: number): number {
    return DEPTH_SORTED + bottom / 1000
  }
}
