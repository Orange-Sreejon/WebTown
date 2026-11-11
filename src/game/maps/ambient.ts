import type Phaser from 'phaser'

/**
 * Ambient motion.
 *
 * Everything here is deliberately small and slow — a few pixels on a long
 * easing curve. The town should feel inhabited when you stop and look at it,
 * not busy while you walk through it.
 */

/**
 * Farm animals graze: they drift a few pixels either side of where they were
 * placed, switching between the two un-mirrored walk frames at each turn so it
 * reads as a step rather than a slide.
 */
export function addAnimalMotion(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Image,
  index: number,
): void {
  const homeX = sprite.x
  const stride = index % 2 === 0 ? 6 : -6
  const frames: readonly number[] = [0, 2]
  let step = 0

  const shuffle = (): void => {
    step = (step + 1) % frames.length
    sprite.setFrame(frames[step]!)
  }

  scene.tweens.add({
    targets: sprite,
    x: homeX + stride,
    duration: 1600 + (index % 4) * 280,
    delay: index * 300,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
    onYoyo: shuffle,
    onRepeat: shuffle,
  })
}

/** Deterministic jitter in [-1, 1], so no two wisps line up exactly. */
function wobble(seed: number): number {
  return ((seed * 37) % 3) - 1
}

/**
 * A thin wisp of chimney smoke above a roof: one small puff every few seconds
 * that drifts up and fades. Deliberately faint — it should catch the eye only
 * when you stop to look.
 */
export function addChimneySmoke(
  scene: Phaser.Scene,
  x: number,
  y: number,
  index: number,
): void {
  const key = 'ambient-smoke-puff'
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0xd8d8d8, 1)
    g.fillCircle(4, 4, 4)
    g.generateTexture(key, 8, 8)
    g.destroy()
  }

  let puffs = 0

  const puff = (): void => {
    puffs++
    const drift = wobble(puffs * 7 + index)
    const sprite = scene.add
      .image(x + drift, y, key)
      .setDepth(5)
      .setAlpha(0.22)
      .setScale(0.5)

    scene.tweens.add({
      targets: sprite,
      y: y - 16,
      x: sprite.x + drift * 3,
      scale: 1.3,
      alpha: 0,
      duration: 2800,
      ease: 'Sine.easeOut',
      onComplete: () => sprite.destroy(),
    })
  }

  scene.time.addEvent({
    delay: 3200 + (index % 4) * 700,
    startAt: index * 900,
    loop: true,
    callback: puff,
  })
}

/**
 * A street lamp's light.
 *
 * A wide, very soft falloff that only *adds* to whatever is under it, so the
 * grass and the lamp head brighten the way they would under a real lamp —
 * there is no disc or ring, because the gradient fades to nothing across four
 * tiles instead of ending on an edge.
 *
 * It starts at zero alpha: the scene brings it up from `skyAt().night`, so
 * lamps are dark through the day and light the street as the light fails.
 */
export function createLampGlow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  depth: number,
): Phaser.GameObjects.Image {
  const key = 'ambient-lamp-glow'

  // A 64×64 radial falloff, built once and shared by every lamp.
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, 64, 64)
    const ctx = texture?.getContext()

    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
      gradient.addColorStop(0, 'rgba(255, 236, 190, 0.9)')
      gradient.addColorStop(0.18, 'rgba(255, 216, 140, 0.5)')
      gradient.addColorStop(0.36, 'rgba(255, 200, 110, 0.24)')
      gradient.addColorStop(0.58, 'rgba(255, 190, 96, 0.09)')
      gradient.addColorStop(0.8, 'rgba(255, 182, 84, 0.03)')
      gradient.addColorStop(1, 'rgba(255, 180, 80, 0)')

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 64, 64)
      texture?.refresh()
    }
  }

  return scene.add
    .image(x, y, key)
    .setScale((size / 64) * 4)
    .setAlpha(0)
    .setDepth(depth)
    .setBlendMode('ADD')
}

/**
 * Reeds and lily pads rise and settle by a single pixel, so the pond is not
 * completely static.
 */
export function addWaterMotion(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Image,
  index: number,
): void {
  scene.tweens.add({
    targets: sprite,
    y: sprite.y - 1,
    duration: 2400 + (index % 5) * 200,
    delay: index * 140,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  })
}
