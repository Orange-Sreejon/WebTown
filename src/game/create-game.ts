import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { TownScene } from './scenes/TownScene'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config/GameConfig'
import { emit } from '../lib/event-bus'

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  console.log('[createPhaserGame] Phaser version:', Phaser.VERSION)
  console.log('[createPhaserGame] parent element:', parent)

  const debugPhysics = new URLSearchParams(window.location.search).get('debug') === '1'

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    backgroundColor: '#2d5a1b',
    scale: {
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    },
    physics: {
      default: 'arcade',
      arcade: { debug: debugPhysics },
    },
    scene: [BootScene, TownScene],
    callbacks: {
      preBoot: (game) => {
        console.log('[Phaser] preBoot — game object created', game)
      },
      postBoot: (game) => {
        console.log('[Phaser] postBoot — renderer:', game.renderer?.type)
      },
    },
  }

  let game: Phaser.Game
  try {
    game = new Phaser.Game(config)
  } catch (e) {
    console.error('[createPhaserGame] Failed to create game:', e)
    emit('ERROR', `Phaser failed to initialise: ${String(e)}`)
    throw e
  }

  return game
}
