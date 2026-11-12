/**
 * Entry for the Phase 2 Milestone 0 interior art test.
 * Open: http://localhost:5173/interior-test.html
 *
 * Deliberately separate from the game entry (like phaser-test-entry.ts): the
 * production build only bundles index.html, so none of this ships.
 */
import Phaser from 'phaser'
import { InteriorTestScene } from './game/scenes/InteriorTestScene'

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  pixelArt: true,
  backgroundColor: '#1d1a22',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 640,
  },
  scene: [InteriorTestScene],
})
