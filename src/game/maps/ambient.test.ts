import { describe, it, expect } from 'vitest'
import { addChimneySmoke, createLampGlow } from './ambient'

interface FakeImage {
  x: number
  y: number
  key: string
  depth: number
  alpha: number
  scale: number
  blendMode: string
  destroyed: boolean
  setDepth(value: number): FakeImage
  setAlpha(value: number): FakeImage
  setScale(value: number): FakeImage
  setBlendMode(value: string): FakeImage
  destroy(): void
}

/** Just enough of a Scene for the smoke emitter, no Phaser boot required. */
function fakeScene() {
  const images: FakeImage[] = []
  const tweens: Array<Record<string, unknown>> = []
  const timers: Array<Record<string, unknown>> = []
  let textureExists = false
  let textureGenerations = 0
  let canvasTextures = 0

  const scene = {
    textures: {
      exists: () => textureExists,
      createCanvas: () => {
        textureExists = true
        canvasTextures++
        return {
          getContext: () => ({
            createRadialGradient: () => ({ addColorStop: () => {} }),
            fillRect: () => {},
            fillStyle: null,
          }),
          refresh: () => {},
        }
      },
    },
    make: {
      graphics: () => ({
        fillStyle: () => {},
        fillCircle: () => {},
        generateTexture: () => {
          textureGenerations++
          textureExists = true
        },
        destroy: () => {},
      }),
    },
    add: {
      image: (x: number, y: number, key: string): FakeImage => {
        const image: FakeImage = {
          x,
          y,
          key,
          depth: 0,
          alpha: 1,
          scale: 1,
          blendMode: 'NORMAL',
          destroyed: false,
          setBlendMode(value: string) {
            image.blendMode = value
            return image
          },
          setDepth(value: number) {
            image.depth = value
            return image
          },
          setAlpha(value: number) {
            image.alpha = value
            return image
          },
          setScale(value: number) {
            image.scale = value
            return image
          },
          destroy() {
            image.destroyed = true
          },
        }
        images.push(image)
        return image
      },
    },
    tweens: {
      add: (config: Record<string, unknown>) => {
        tweens.push(config)
        return config
      },
    },
    time: {
      addEvent: (config: Record<string, unknown>) => {
        timers.push(config)
        return config
      },
    },
  }

  return {
    scene: scene as unknown as Parameters<typeof addChimneySmoke>[0],
    images,
    tweens,
    timers,
    generations: () => textureGenerations,
    canvasTextures: () => canvasTextures,
  }
}

describe('street lamps', () => {
  it('creates a soft light that is off during the day', () => {
    const fake = fakeScene()
    const glow = createLampGlow(fake.scene, 100, 200, 32, 6)

    expect((glow as unknown as { key: string }).key).toBe('ambient-lamp-glow')
    expect(glow.blendMode).toBe('ADD') // adds light, never paints over the grass
    expect(glow.depth).toBe(6)
    expect(glow.alpha).toBe(0) // daylight: the lamp is off
    expect(glow.scale).toBeCloseTo(2, 5) // 128px of light, four tiles across
    expect(fake.tweens).toHaveLength(0) // steady light, nothing blinking
  })

  it('reuses one glow texture for every lamp', () => {
    const fake = fakeScene()
    createLampGlow(fake.scene, 10, 20, 32, 3)
    createLampGlow(fake.scene, 40, 50, 32, 3)

    expect(fake.images).toHaveLength(2)
    expect(fake.canvasTextures()).toBe(1)
  })
})

describe('chimney smoke', () => {
  it('registers one repeating emitter and no puff until it fires', () => {
    const fake = fakeScene()
    addChimneySmoke(fake.scene, 100, 200, 0)

    expect(fake.timers).toHaveLength(1)
    expect(fake.timers[0]!.loop).toBe(true)
    expect(fake.timers[0]!.delay as number).toBeGreaterThanOrEqual(3200)
    expect(fake.images).toHaveLength(0)
  })

  it('emits a faint puff that drifts up and destroys itself', () => {
    const fake = fakeScene()
    addChimneySmoke(fake.scene, 100, 200, 1)

    const emit = fake.timers[0]!.callback as () => void
    emit()

    expect(fake.images).toHaveLength(1)
    const puff = fake.images[0]!
    expect(puff.key).toBe('ambient-smoke-puff')
    expect(puff.y).toBe(200)
    expect(Math.abs(puff.x - 100)).toBeLessThanOrEqual(1)
    expect(puff.alpha).toBeLessThan(0.3) // subtle, not a smoke plume
    expect(puff.depth).toBeGreaterThan(4) // above the roof and the player

    expect(fake.tweens).toHaveLength(1)
    const tween = fake.tweens[0]!
    expect(tween.y).toBe(184)
    expect(tween.alpha).toBe(0)

    ;(tween.onComplete as () => void)()
    expect(puff.destroyed).toBe(true)
  })

  it('generates the puff texture once across every chimney', () => {
    const fake = fakeScene()
    addChimneySmoke(fake.scene, 10, 20, 0)
    addChimneySmoke(fake.scene, 30, 40, 1)
    addChimneySmoke(fake.scene, 50, 60, 2)

    expect(fake.generations()).toBe(1)
    expect(fake.timers).toHaveLength(3)
  })
})
