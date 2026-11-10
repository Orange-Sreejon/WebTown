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

  constructor() {
    super({ key: 'TownScene' })
  }

  create(): void {
    console.log('[TownScene] create start')

    try {
      this.physics.world.setBounds(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
      console.log('[TownScene] world bounds set')

      const map = new TownMap(this)
      map.build()
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

      console.log('[TownScene] create complete')
    } catch (e) {
      console.error('[TownScene] create failed:', e)
      emit('ERROR', `Scene creation failed: ${String(e)}`)
    }
  }

  update(_time: number, _delta: number): void {
    this.player?.update(this.cursors, this.wasd)
  }
}
