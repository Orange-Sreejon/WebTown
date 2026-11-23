import Phaser from 'phaser'
import { AssetKeys, AssetPaths, MARKET_IMAGE_KEYS } from '../config/AssetKeys'
import { WALK_FRAME_RATE } from '../config/GameConfig'
import { emit } from '../../lib/event-bus'
import { AVATARS, animKey, avatarTexture, recolour } from '../systems/avatars'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload(): void {
    // Catch any asset load failure and surface it to React
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      const msg = `Failed to load: ${file.key} (${file.url as string})`
      console.error('[BootScene]', msg)
      emit('ERROR', msg)
    })

    this.load.spritesheet(AssetKeys.TRAVELLER, AssetPaths[AssetKeys.TRAVELLER], {
      frameWidth: 48,
      frameHeight: 64,
    })

    this.load.image(AssetKeys.GRASS_TILE,  AssetPaths[AssetKeys.GRASS_TILE])
    this.load.image(AssetKeys.GROUND_TILE, AssetPaths[AssetKeys.GROUND_TILE])
    this.load.image(AssetKeys.WATER_TILE,  AssetPaths[AssetKeys.WATER_TILE])

    this.load.image(AssetKeys.GRASS_DETAIL_1, AssetPaths[AssetKeys.GRASS_DETAIL_1])
    this.load.image(AssetKeys.GRASS_DETAIL_2, AssetPaths[AssetKeys.GRASS_DETAIL_2])
    this.load.image(AssetKeys.GRASS_DETAIL_3, AssetPaths[AssetKeys.GRASS_DETAIL_3])
    this.load.image(AssetKeys.GRASS_DETAIL_4, AssetPaths[AssetKeys.GRASS_DETAIL_4])
    this.load.image(AssetKeys.GRASS_DETAIL_5, AssetPaths[AssetKeys.GRASS_DETAIL_5])
    this.load.image(AssetKeys.GRASS_DETAIL_6, AssetPaths[AssetKeys.GRASS_DETAIL_6])

    this.load.image(AssetKeys.GROUND_DETAIL_1, AssetPaths[AssetKeys.GROUND_DETAIL_1])
    this.load.image(AssetKeys.GROUND_DETAIL_2, AssetPaths[AssetKeys.GROUND_DETAIL_2])
    this.load.image(AssetKeys.GROUND_DETAIL_3, AssetPaths[AssetKeys.GROUND_DETAIL_3])
    this.load.image(AssetKeys.GROUND_DETAIL_4, AssetPaths[AssetKeys.GROUND_DETAIL_4])
    this.load.image(AssetKeys.GROUND_DETAIL_5, AssetPaths[AssetKeys.GROUND_DETAIL_5])

    this.load.image(AssetKeys.WATER_DETAIL_1, AssetPaths[AssetKeys.WATER_DETAIL_1])
    this.load.image(AssetKeys.WATER_DETAIL_2, AssetPaths[AssetKeys.WATER_DETAIL_2])
    this.load.image(AssetKeys.WATER_DETAIL_3, AssetPaths[AssetKeys.WATER_DETAIL_3])
    this.load.image(AssetKeys.WATER_DETAIL_4, AssetPaths[AssetKeys.WATER_DETAIL_4])
    this.load.image(AssetKeys.WATER_DETAIL_5, AssetPaths[AssetKeys.WATER_DETAIL_5])

    this.load.image(AssetKeys.FENCE_1, AssetPaths[AssetKeys.FENCE_1])
    this.load.image(AssetKeys.FENCE_2, AssetPaths[AssetKeys.FENCE_2])

    this.load.image(AssetKeys.HOUSE_1, AssetPaths[AssetKeys.HOUSE_1])
    this.load.image(AssetKeys.HOUSE_2, AssetPaths[AssetKeys.HOUSE_2])
    this.load.image(AssetKeys.CHURCH,  AssetPaths[AssetKeys.CHURCH])
    this.load.image(AssetKeys.BRIDGE,  AssetPaths[AssetKeys.BRIDGE])
    this.load.image(AssetKeys.STAIRS,  AssetPaths[AssetKeys.STAIRS])
    this.load.image(AssetKeys.PIT,     AssetPaths[AssetKeys.PIT])

    this.load.image(AssetKeys.TREE_1, AssetPaths[AssetKeys.TREE_1])
    this.load.image(AssetKeys.TREE_2, AssetPaths[AssetKeys.TREE_2])
    this.load.image(AssetKeys.TREE_3, AssetPaths[AssetKeys.TREE_3])

    // ── Cute Fantasy Free pack ────────────────────────────────────────
    // Non-commercial use only, no redistribution of the raw assets.
    this.load.image(AssetKeys.CUTE_HOUSE, AssetPaths[AssetKeys.CUTE_HOUSE])
    this.load.image(AssetKeys.CUTE_BRIDGE, AssetPaths[AssetKeys.CUTE_BRIDGE])
    this.load.image(AssetKeys.OAK_TREE, AssetPaths[AssetKeys.OAK_TREE])
    this.load.spritesheet(AssetKeys.CUTE_DECOR, AssetPaths[AssetKeys.CUTE_DECOR], {
      frameWidth: 16,
      frameHeight: 16,
    })
    for (const animal of [AssetKeys.CHICKEN, AssetKeys.COW, AssetKeys.PIG, AssetKeys.SHEEP]) {
      this.load.spritesheet(animal, AssetPaths[animal], { frameWidth: 32, frameHeight: 32 })
    }

    // ── Farm RPG 16x16 pack ───────────────────────────────────────────
    this.load.spritesheet(AssetKeys.MAPLE_TREE, AssetPaths[AssetKeys.MAPLE_TREE], {
      frameWidth: 32,
      frameHeight: 48,
    })

    // ── Halloween pumpkins ────────────────────────────────────────────
    // 15×14 sheet of 16×16 cells; only the small-pumpkin block is used.
    this.load.spritesheet(AssetKeys.HALLOWEEN_PUMPKINS, AssetPaths[AssetKeys.HALLOWEEN_PUMPKINS], {
      frameWidth: 16,
      frameHeight: 16,
    })

    // ── Pixel Medieval Market Props ───────────────────────────────────
    // 28 single-tile 16×16 props (stalls, containers, street furniture).
    for (const key of MARKET_IMAGE_KEYS) {
      this.load.image(key, AssetPaths[key])
    }
  }

  create(): void {
    console.log('[BootScene] create — defining animations')
    try {
      this.createAnimations()
    } catch (e) {
      console.error('[BootScene] animation error:', e)
      emit('ERROR', `Animation setup failed: ${String(e)}`)
      return
    }
    console.log('[BootScene] emitting READY')
    emit('READY')
    this.scene.start('TownScene')
  }

  private createAnimations(): void {
    this.createAvatarTextures()

    const dirs: Array<{ dir: string; rowStart: number }> = [
      { dir: 'down',  rowStart: 0 },
      { dir: 'left',  rowStart: 3 },
      { dir: 'right', rowStart: 6 },
      { dir: 'up',    rowStart: 9 },
    ]

    for (const look of AVATARS) {
      const texture = avatarTexture(look)
      if (!this.textures.exists(texture)) continue
      for (const { dir, rowStart } of dirs) {
        const f0 = rowStart
        const f1 = rowStart + 1
        const f2 = rowStart + 2

        this.anims.create({
          key: animKey('walk', dir, look),
          frames: this.anims.generateFrameNumbers(texture, {
            frames: [f0, f1, f2, f1],
          }),
          frameRate: WALK_FRAME_RATE,
          repeat: -1,
        })

        this.anims.create({
          key: animKey('idle', dir, look),
          frames: this.anims.generateFrameNumbers(texture, {
            frames: [f1],
          }),
          frameRate: 1,
          repeat: 0,
        })
      }
    }
  }

  /**
   * The coloured variants of the traveller (Phase 5), drawn once from the loaded sheet into canvas textures
   * with the same 48 x 64 frames. If the canvas can't be read, the variants are skipped and everyone falls
   * back to the original look.
   */
  private createAvatarTextures(): void {
    const source = this.textures.get(AssetKeys.TRAVELLER).getSourceImage() as HTMLImageElement | HTMLCanvasElement
    const { width, height } = source
    for (const look of AVATARS) {
      if (look === 'traveller' || this.textures.exists(look)) continue
      const canvas = this.textures.createCanvas(look, width, height)
      if (!canvas) continue
      const ctx = canvas.getContext()
      ctx.drawImage(source, 0, 0)
      try {
        const image = ctx.getImageData(0, 0, width, height)
        recolour(image.data, look)
        ctx.putImageData(image, 0, 0)
      } catch (error) {
        console.warn(`[BootScene] could not recolour ${look}`, error)
        this.textures.remove(look)
        continue
      }
      canvas.refresh()
      let frame = 0
      for (let y = 0; y + 64 <= height; y += 64) {
        for (let x = 0; x + 48 <= width; x += 48) canvas.add(frame++, 0, x, y, 48, 64)
      }
    }
  }
}