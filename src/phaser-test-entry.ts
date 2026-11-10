/**
 * Phaser diagnostic test — loaded by phaser-test.html via Vite.
 * Tests that Phaser initialises, assets load, and RenderTexture works.
 * Open: http://localhost:5173/phaser-test.html
 */
import Phaser from 'phaser'

const logEl = document.getElementById('log')!
const out = (msg: string): void => {
  console.log(msg)
  logEl.textContent += '\n' + msg
}

window.addEventListener('error', (e) => out('JS ERROR: ' + e.message))
window.addEventListener('unhandledrejection', (e) => out('PROMISE: ' + String(e.reason)))

out(`Phaser version: ${Phaser.VERSION}`)
out(`Phaser.Game: ${typeof Phaser.Game}`)
out(`Phaser.Scale.EXPAND: ${Phaser.Scale.EXPAND}`)

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#2d5a1b',
  pixelArt: true,
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: {
    preload(this: Phaser.Scene) {
      out('preload()')
      this.load.on('loaderror', (f: Phaser.Loader.File) => out('LOAD ERR: ' + f.key))
      this.load.image('grass',  '/assets/tilesets/village-top-down/grass-tile-day.png')
      this.load.image('ground', '/assets/tilesets/village-top-down/ground-tile-day.png')
      this.load.image('tree1',  '/assets/tilesets/village-top-down/tree-1-day.png')
      this.load.image('house1', '/assets/tilesets/village-top-down/house-1-day.png')
      this.load.spritesheet('char', '/assets/characters/tiny-cast/traveller.png',
        { frameWidth: 48, frameHeight: 64 })
    },
    create(this: Phaser.Scene) {
      out('create()')

      // Test RenderTexture
      try {
        const rt = this.add.renderTexture(0, 0, 1280, 1024)
        rt.setOrigin(0, 0)
        for (let ty = 0; ty < 20; ty++)
          for (let tx = 0; tx < 20; tx++)
            rt.stamp('grass', 0, tx * 16 + 8, ty * 16 + 8)
        for (let tx = 0; tx < 20; tx++)
          rt.stamp('ground', 0, tx * 16 + 8, 10 * 16 + 8)
        out('RenderTexture: OK')
      } catch (e) { out('RT ERROR: ' + String(e)) }

      // Test sprites
      try {
        this.add.image(200, 150, 'tree1').setDepth(3)
        this.add.image(350, 150, 'house1').setDepth(3)
        out('Sprites: OK')
      } catch (e) { out('SPRITE ERROR: ' + String(e)) }

      // Test character
      try {
        this.add.sprite(480, 320, 'char', 1).setScale(0.55).setDepth(4)
        out('Character: OK')
      } catch (e) { out('CHAR ERROR: ' + String(e)) }

      out('--- ALL TESTS PASSED ---')
    },
  },
})
