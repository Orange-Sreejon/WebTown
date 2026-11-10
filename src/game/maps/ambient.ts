import Phaser from 'phaser'

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
