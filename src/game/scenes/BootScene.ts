import Phaser from 'phaser'
import { AssetKeys, AssetPaths } from '../config/AssetKeys'
import { WALK_FRAME_RATE } from '../config/GameConfig'
import { emit } from '../../lib/event-bus'

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
    const dirs: Array<{ dir: string; rowStart: number }> = [
      { dir: 'down',  rowStart: 0 },
      { dir: 'left',  rowStart: 3 },
      { dir: 'right', rowStart: 6 },
      { dir: 'up',    rowStart: 9 },
    ]

    for (const { dir, rowStart } of dirs) {
      const f0 = rowStart
      const f1 = rowStart + 1
      const f2 = rowStart + 2

      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(AssetKeys.TRAVELLER, {
          frames: [f0, f1, f2, f1],
        }),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      })

      this.anims.create({
        key: `idle-${dir}`,
        frames: this.anims.generateFrameNumbers(AssetKeys.TRAVELLER, {
          frames: [f1],
        }),
        frameRate: 1,
        repeat: 0,
      })
    }
  }
}
