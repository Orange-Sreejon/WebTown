/**
 * The Halloween layer: pumpkins, warm windows, a moon, stars and a few bats.
 *
 * Everything is created once per scene run and then driven by a single
 * multiplier — `setNightFactor` — so the whole seasonal layer fades in and out
 * with the clock without any per-frame object churn. Nothing here touches the
 * terrain, the houses, collision or the player: the layer only reads the
 * layout and adds sprites above it.
 *
 * Textures that are not in an asset pack (moon, stars, bat frames, window
 * glow, pumpkin light) are generated in code with hard edges, so the pixel
 * art stays crisp and nothing extra has to be licensed.
 */

import Phaser from 'phaser'
import { TILE_SIZE, depthForFeetY } from '../config/GameConfig'
import {
  BATS,
  MOON_POSITION,
  NIGHT_LIGHT,
  PUMPKIN_COLLIDER,
  PUMPKIN_FRAMES,
  PUMPKIN_PLACEMENTS,
  PUMPKIN_SCALE,
  PUMPKIN_SHEET,
  STAR_POSITIONS,
  WINDOW_LAYOUTS,
  pumpkinFrameIndex,
  type BatSpec,
} from '../config/halloween'
import { createLampGlow } from './ambient'
import { STRUCTURES } from './town-layout'

/** Below the time-of-day overlay (90), above the whole town. */
const SKY_DEPTH = 89

const WINDOW_TEXTURE = 'halloween-window-glow'
const MOON_TEXTURE = 'halloween-moon'
const STAR_TEXTURE = 'halloween-star'
const BAT_TEXTURE = 'halloween-bat'
const BAT_FRAME_W = 11
const BAT_FRAME_H = 7
const BAT_ANIM = 'halloween-bat-fly'

/** Bat silhouettes, one string per row, `X` for a drawn pixel. */
const BAT_FRAMES: readonly string[][] = [
  [
    '...........',
    '..X.....X..',
    '.XXX...XXX.',
    'XXXXXXXXXXX',
    '....XXX....',
    '.....X.....',
    '...........',
  ],
  [
    '...........',
    '...........',
    '....XXX....',
    'XXXXXXXXXXX',
    '.XXX...XXX.',
    '..X.....X..',
    '...........',
  ],
]

export class HalloweenLayer {
  private readonly scene: Phaser.Scene

  private built = false
  /** -1 forces the first `setNightFactor` call to apply. */
  private factor = -1

  private readonly pumpkins: Phaser.GameObjects.Image[] = []
  private readonly pumpkinGlows: Phaser.GameObjects.Image[] = []
  private readonly pumpkinZones: Phaser.GameObjects.Zone[] = []
  private readonly windowGlows: Phaser.GameObjects.Image[] = []
  private readonly bats: Phaser.GameObjects.Sprite[] = []
  private readonly stars: Phaser.GameObjects.Image[] = []
  private readonly batSpecs: readonly BatSpec[] = BATS

  private sky?: Phaser.GameObjects.Container
  private moon?: Phaser.GameObjects.Image
  /** Solid pumpkin footprints, registered with the player by the scene. */
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup
  private onResize?: () => void

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.obstacles = scene.physics.add.staticGroup()
  }

  /** Create the layer. Idempotent: a second call does nothing. */
  build(): void {
    if (this.built) return
    this.built = true

    this.ensureTextures()
    this.buildPumpkins()
    this.buildWindows()
    this.buildSky()

    this.onResize = () => this.layoutSky()
    this.scene.scale.on('resize', this.onResize)

    // Start fully hidden: the clock raises it after 20:00.
    this.factor = -1
    this.setNightFactor(0)
  }

  /**
   * 0 hides every Halloween object, 1 shows it at full strength. A single
   * multiplier for the whole layer, applied to a fixed list.
   */
  setNightFactor(factor: number): void {
    const f = Math.min(Math.max(factor, 0), 1)
    if (f === this.factor) return
    this.factor = f

    for (const pumpkin of this.pumpkins) pumpkin.setAlpha(NIGHT_LIGHT.pumpkin * f)
    for (const glow of this.pumpkinGlows) glow.setAlpha(NIGHT_LIGHT.pumpkinGlow * f)
    for (const glow of this.windowGlows) glow.setAlpha(NIGHT_LIGHT.window * f)
    for (const bat of this.bats) bat.setAlpha(NIGHT_LIGHT.bat * f)

    // Pumpkins are solid only while they are actually visible.
    const solid = f >= PUMPKIN_COLLIDER.solidAt
    for (const zone of this.pumpkinZones) {
      const body = zone.body as Phaser.Physics.Arcade.StaticBody | null
      if (body) body.enable = solid
    }
    this.moon?.setAlpha(NIGHT_LIGHT.moon * f)
    for (const star of this.stars) star.setAlpha(NIGHT_LIGHT.star * f)
  }

  /** Tear down every object, tween and listener. Safe to call twice. */
  destroy(): void {
    if (!this.built) return
    this.built = false

    if (this.onResize) {
      this.scene.scale.off('resize', this.onResize)
      this.onResize = undefined
    }

    for (const bat of this.bats) this.scene.tweens.killTweensOf(bat)
    for (const pumpkin of this.pumpkins) pumpkin.destroy()
    for (const glow of this.pumpkinGlows) glow.destroy()
    for (const glow of this.windowGlows) glow.destroy()

    this.pumpkins.length = 0
    this.pumpkinGlows.length = 0
    this.windowGlows.length = 0
    this.pumpkinZones.length = 0
    this.obstacles.clear(true, true)
    this.obstacles.destroy()
    this.bats.length = 0
    this.stars.length = 0

    this.sky?.destroy(true)
    this.sky = undefined
    this.moon = undefined
  }

  // ── Pumpkins ─────────────────────────────────────────────────────────────
  private buildPumpkins(): void {
    for (const spot of PUMPKIN_PLACEMENTS) {
      const x = (spot.tileX + 0.5) * TILE_SIZE
      const baseY = (spot.tileY + 1) * TILE_SIZE
      const depth = depthForFeetY(baseY)
      const frame = pumpkinFrameIndex(PUMPKIN_FRAMES[spot.frame])

      this.pumpkins.push(
        this.scene.add
          .image(x, baseY, PUMPKIN_SHEET.key, frame)
          .setOrigin(0.5, 1)
          .setScale(spot.scale ?? PUMPKIN_SCALE)
          .setDepth(depth)
          .setAlpha(0),
      )

      // A small warm pool from the carved face, just under the pumpkin so the
      // player still draws over it when walking in front.
      this.pumpkinGlows.push(
        createLampGlow(this.scene, x, baseY - TILE_SIZE * 0.5, TILE_SIZE * 0.9, depth - 0.01),
      )

      // A small solid footprint at the base, so you bump into a pumpkin the
      // way you would a barrel instead of walking through it. It is disabled
      // until the decorations are visible.
      const zone = this.scene.add.zone(
        x,
        baseY - PUMPKIN_COLLIDER.height / 2,
        PUMPKIN_COLLIDER.width,
        PUMPKIN_COLLIDER.height,
      )
      this.scene.physics.add.existing(zone, true)

      const body = zone.body as Phaser.Physics.Arcade.StaticBody
      body.setSize(PUMPKIN_COLLIDER.width, PUMPKIN_COLLIDER.height)
      body.reset(x, baseY - PUMPKIN_COLLIDER.height / 2)
      body.enable = false

      this.obstacles.add(zone)
      this.pumpkinZones.push(zone)
    }
  }

  // ── Warm windows ─────────────────────────────────────────────────────────
  private buildWindows(): void {
    for (const structure of STRUCTURES) {
      const windows = WINDOW_LAYOUTS[structure.key]
      if (!windows) continue

      // The sprite fills its footprint exactly, so texture pixels map 1:1
      // onto world pixels from the structure's top-left corner.
      const originX = structure.tileX * TILE_SIZE
      const originY = structure.tileY * TILE_SIZE

      for (const pane of windows) {
        this.windowGlows.push(
          this.scene.add
            .image(originX + pane.x + pane.w / 2, originY + pane.y + pane.h / 2, WINDOW_TEXTURE)
            .setDisplaySize(pane.w + 2, pane.h + 2)
            .setDepth(structure.depth + 0.01)
            .setBlendMode('ADD')
            .setAlpha(0),
        )
      }
    }
  }

  // ── Moon, stars and bats ─────────────────────────────────────────────────
  private buildSky(): void {
    const cam = this.scene.cameras.main
    this.sky = this.scene.add
      .container(cam.midPoint.x, cam.midPoint.y)
      .setScrollFactor(0)
      .setDepth(SKY_DEPTH)

    this.moon = this.scene.add.image(0, 0, MOON_TEXTURE).setAlpha(0)
    this.sky.add(this.moon)

    for (const spot of STAR_POSITIONS) {
      const star = this.scene.add
        .image(0, 0, STAR_TEXTURE)
        .setAlpha(0)
        .setData('nx', spot.nx)
        .setData('ny', spot.ny)
      this.stars.push(star)
      this.sky.add(star)
    }

    this.ensureBatAnimation()

    this.batSpecs.forEach((spec, index) => {
      const bat = this.scene.add
        .sprite(spec.fromX, spec.y, BAT_TEXTURE, 0)
        .setScale(spec.scale)
        .setAlpha(0)
        .play(BAT_ANIM)

      this.bats.push(bat)
      this.sky!.add(bat)

      this.scene.tweens.add({
        targets: bat,
        x: spec.toX,
        duration: spec.durationMs,
        delay: spec.delayMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onYoyo: () => bat.setFlipX(true),
        onRepeat: () => bat.setFlipX(false),
      })

      // A slow bob so the bat reads as flying rather than sliding.
      this.scene.tweens.add({
        targets: bat,
        y: spec.y + spec.bob,
        duration: 2200 + index * 380,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    })

    this.layoutSky()
  }

  /**
   * The sky sits in a screen-space container at the camera's midpoint, so it
   * follows the view without scrolling with the map. Its children are laid
   * out in view pixels; recompute them when the camera or viewport changes.
   */
  private layoutSky(): void {
    if (!this.sky) return

    const cam = this.scene.cameras.main
    const viewW = cam.width / cam.zoom
    const viewH = cam.height / cam.zoom
    const halfW = viewW / 2
    const halfH = viewH / 2

    this.sky.setPosition(cam.midPoint.x, cam.midPoint.y)

    this.moon?.setPosition(MOON_POSITION.nx * halfW, MOON_POSITION.ny * halfH)

    for (const star of this.stars) {
      star.setPosition(Number(star.getData('nx')) * halfW, Number(star.getData('ny')) * halfH)
    }

    this.bats.forEach((bat, index) => {
      const spec = this.batSpecs[index]
      if (!spec) return
      bat.setY(Math.max(Math.min(spec.y, -halfH + 24), -halfH + 18))
    })
  }

  // ── Generated textures ───────────────────────────────────────────────────
  private ensureTextures(): void {
    const textures = this.scene.textures

    if (!textures.exists(WINDOW_TEXTURE)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false)
      // Hard alpha steps only — no blur, so the window stays pixel art.
      // It is stretched to each pane, and the bright core is what reads as a
      // lit window inside the frame.
      g.fillStyle(0xffc46a, 0.06)
      g.fillRect(0, 0, 16, 16)
      g.fillStyle(0xffcc78, 0.18)
      g.fillRect(2, 2, 12, 12)
      g.fillStyle(0xffdaa0, 0.45)
      g.fillRect(4, 4, 8, 8)
      g.fillStyle(0xffe8be, 0.85)
      g.fillRect(6, 6, 4, 4)
      g.generateTexture(WINDOW_TEXTURE, 16, 16)
      g.destroy()
    }

    if (!textures.exists(MOON_TEXTURE)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0xf3ead2, 1)
      g.fillCircle(24, 24, 19)
      g.fillStyle(0xd9cdb0, 1)
      g.fillCircle(17, 18, 4)
      g.fillCircle(29, 27, 5)
      g.fillCircle(22, 32, 3)
      g.generateTexture(MOON_TEXTURE, 48, 48)
      g.destroy()
    }

    if (!textures.exists(STAR_TEXTURE)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0xffffff, 0.45)
      g.fillRect(1, 2, 3, 1)
      g.fillRect(2, 1, 1, 3)
      g.fillStyle(0xffffff, 1)
      g.fillRect(2, 2, 1, 1)
      g.generateTexture(STAR_TEXTURE, 5, 5)
      g.destroy()
    }

    if (!textures.exists(BAT_TEXTURE)) {
      const texture = textures.createCanvas(BAT_TEXTURE, BAT_FRAME_W * 2, BAT_FRAME_H)
      const ctx = texture?.getContext()

      if (ctx && texture) {
        ctx.fillStyle = '#241a33'
        BAT_FRAMES.forEach((rows, index) => {
          const offsetX = index * BAT_FRAME_W
          rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) {
              if (row[x] === 'X') ctx.fillRect(offsetX + x, y, 1, 1)
            }
          })
        })
        texture.refresh()
        texture.add(0, 0, 0, 0, BAT_FRAME_W, BAT_FRAME_H)
        texture.add(1, 0, BAT_FRAME_W, 0, BAT_FRAME_W, BAT_FRAME_H)
      }
    }
  }

  private ensureBatAnimation(): void {
    if (this.scene.anims.exists(BAT_ANIM)) return

    this.scene.anims.create({
      key: BAT_ANIM,
      frames: [
        { key: BAT_TEXTURE, frame: 0 },
        { key: BAT_TEXTURE, frame: 1 },
      ],
      frameRate: 6,
      repeat: -1,
    })
  }
}
