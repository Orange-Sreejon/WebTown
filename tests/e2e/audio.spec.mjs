// Subtle audio in the real game (Chromium, Firefox, WebKit): a real AudioContext, unlocked by a real click, real keys
// walking, real E presses through doors and into the computer and the Sketchbook. What was played is read from the
// engine's own history; that audio really comes out is read from an analyser on the master output. Listening is
// still a person's job (see docs/TESTING.md).
import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
let page
/** Whether this browser has Web Audio (Playwright's WebKit build for Windows has none; Safari does). */
let hasAudio = true
const pageErrors = []
const NO_AUDIO = "This browser build has no Web Audio (Playwright's WebKit on Windows): the game must stay silent and keep working, checked by the next test."
test.beforeEach(({}, info) => { if (!info.title.startsWith('without Web Audio')) test.skip(!hasAudio, NO_AUDIO) })

async function waitForTown() {
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="application"]')
    if (!el) return false
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    for (let f = el[key]; f; f = f.return) {
      for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
        const v = h.memoizedState
        if (v && v.current && v.current.scene && typeof v.current.scene.getScene === 'function') {
          window.__wtGame = v.current
          return v.current.scene.isActive('TownScene') && !!v.current.scene.getScene('TownScene')?.player
        }
      }
    }
    return false
  }, null, { timeout: 240_000 })
}

/** Plays since the start of the test (name, and the surface under the player when a step was asked for). */
const log = () => page.evaluate(() => window.__audioLog)
const count = async name => (await log()).filter(e => e.name === name).length
const scene = () => page.evaluate(() => (window.__wtGame.scene.isActive('InteriorScene') ? 'interior' : 'town'))
const feet = () => page.evaluate(() => {
  const g = window.__wtGame
  const s = g.scene.isActive('InteriorScene') ? g.scene.getScene('InteriorScene') : g.scene.getScene('TownScene')
  return s.player.feet
})

async function walk(key, ms) {
  await page.keyboard.down(key)
  await sleep(ms)
  await page.keyboard.up(key)
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  page.on('pageerror', e => pageErrors.push(e.message))
  // Count every AudioContext the page makes: there must be exactly one (Phaser's own is switched off).
  await page.addInitScript(() => {
    window.__contexts = 0
    const Native = window.AudioContext ?? window.webkitAudioContext
    if (!Native) return
    const Counted = class extends Native { constructor(...a) { super(...a); window.__contexts++ } }
    window.AudioContext = Counted
    window.webkitAudioContext = Counted
  })
  await page.goto('/')
  await waitForTown()
  hasAudio = await page.evaluate(() => typeof (window.AudioContext ?? window.webkitAudioContext) === 'function')
  await page.evaluate(async () => {
    const { gameAudio } = await import('/src/audio/index.ts')
    const { townSurfaceAt } = await import('/src/audio/footsteps.ts')
    window.__gameAudio = gameAudio
    window.__audioLog = []
    const play = gameAudio.play.bind(gameAudio)
    gameAudio.play = (name, options) => {
      const ok = play(name, options)
      if (ok) {
        const g = window.__wtGame
        const surface = name.startsWith('step-') && g.scene.isActive('TownScene') ? townSurfaceAt(g.scene.getScene('TownScene').player.feet) : null
        window.__audioLog.push({ name, surface, at: performance.now() })
      }
      return ok
    }
  })
})
test.afterAll(async () => { await page.context().close() })

test('without Web Audio, the game runs silently: no errors, the town still plays, the sound button still works', async () => {
  test.skip(hasAudio, 'Only for browsers without Web Audio.')
  await page.locator('[role="application"]').click({ position: { x: 20, y: 20 } })
  expect(await page.evaluate(() => window.__gameAudio.state)).toBe('locked')
  const start = await feet()
  await walk('s', 800)
  expect((await feet()).y).toBeGreaterThan(start.y)
  expect(await log()).toEqual([])
  await page.getByRole('button', { name: 'Sound settings' }).click()
  await page.getByRole('checkbox', { name: 'Mute' }).check()
  await page.getByRole('checkbox', { name: 'Mute' }).uncheck()
  expect(pageErrors).toEqual([])
})

test('nothing plays before a gesture; one click starts a single AudioContext', async () => {
  expect(await page.evaluate(() => window.__gameAudio.state)).toBe('locked')
  expect(await page.evaluate(() => window.__contexts)).toBe(0)
  await page.locator('[role="application"]').click({ position: { x: 20, y: 20 } })
  await expect.poll(() => page.evaluate(() => window.__gameAudio.state)).toBe('running')
  expect(await page.evaluate(() => window.__contexts)).toBe(1)
})

test('footsteps follow the walk, on the right surface, and stop when the player stops', async () => {
  // Walk down and back up from the start: across the road and onto the grass.
  await walk('s', 1800)
  await walk('w', 1800)
  const steps = (await log()).filter(e => e.name.startsWith('step-'))
  expect(steps.length).toBeGreaterThan(6)
  for (const s of steps) expect(s.name, JSON.stringify(s)).toBe(s.surface === 'path' ? 'step-path' : 'step-grass')
  const gaps = steps.slice(1).map((s, i) => s.at - steps[i].at).filter(g => g < 1000)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(150)
  // In step with the legs: two steps per walk cycle at 6 frames a second, about one every 333 ms (measured as the
  // median gap, which does not depend on how long the machine took to run the walk).
  const sorted = [...gaps].sort((x, y) => x - y)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`[audio] ${steps.length} steps, median gap ${Math.round(median)} ms, shortest ${Math.round(sorted[0])} ms`)
  expect(median).toBeGreaterThan(250)
  expect(median).toBeLessThan(450)

  const before = steps.length
  await sleep(800)
  expect((await log()).filter(e => e.name.startsWith('step-')).length).toBe(before)
})

test('real sound comes out while walking, and the ambience plays in the town', async () => {
  await page.keyboard.down('d')
  let level = 0
  for (let i = 0; i < 20 && level === 0; i++) {
    await sleep(100)
    level = await page.evaluate(() => window.__gameAudio.measure())
  }
  await page.keyboard.up('d')
  expect(level).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__gameAudio.loops.length)).toBe(2)
})

test('day turns to night: crickets come up; morning: they go', async () => {
  const crickets = () => page.evaluate(() => window.__gameAudio.cricketGain?.gain.value ?? 0)
  await page.keyboard.press('3') // dev key: 22:00
  await expect.poll(crickets, { timeout: 15_000 }).toBeGreaterThan(0.4)
  await page.keyboard.press('1') // 09:00
  await expect.poll(crickets, { timeout: 15_000 }).toBeLessThan(0.05)
})

test('a door opens once going in, the floor is wooden inside, and the door closes once going out', async () => {
  await page.evaluate(async () => {
    const { buildEntrances } = await import('/src/game/systems/interaction.ts')
    const { HOUSES } = await import('/src/game/config/houses.ts')
    const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
    const e = buildEntrances(HOUSES, STRUCTURES).find(x => x.id === 'house-a')
    window.__wtGame.scene.getScene('TownScene').player.placeFeet(e.fallbackFeet.x, e.fallbackFeet.y)
  })
  await page.waitForFunction(() => window.__wtGame.scene.getScene('TownScene').nearby?.id === 'house-a', null, { timeout: 30_000 })
  await page.keyboard.press('e')
  await page.waitForFunction(() => {
    const i = window.__wtGame.scene.getScene('InteriorScene')
    return window.__wtGame.scene.isActive('InteriorScene') && i?.player && !i.lock.isBusy
  }, null, { timeout: 60_000 })
  await sleep(500)
  expect(await count('door-open')).toBe(1)
  expect(await count('door-close')).toBe(0)

  await walk('a', 900)
  expect(await count('step-wood')).toBeGreaterThan(1)

  // Out through the door.
  await page.evaluate(() => {
    const i = window.__wtGame.scene.getScene('InteriorScene')
    const z = i.definition.exit.zone
    i.player.placeFeet(z.x + z.w / 2, z.y + z.h / 2)
  })
  await page.waitForFunction(() => window.__wtGame.scene.getScene('InteriorScene').nearExit, null, { timeout: 30_000 })
  await page.keyboard.press('e')
  await expect.poll(scene, { timeout: 30_000 }).toBe('town')
  await sleep(600)
  expect(await count('door-close')).toBe(1)
  expect(await count('door-open')).toBe(1)

  // The interior's player is gone: walking in the town steps on grass or road, never on wood.
  const wood = await count('step-wood')
  await walk('s', 700)
  expect(await count('step-wood')).toBe(wood)
  expect(await page.evaluate(() => window.__contexts)).toBe(1)
})

test('the computer and the Sketchbook make their sounds once per opening and closing', async () => {
  const goIn = async () => {
    await page.evaluate(async () => {
      const { buildEntrances } = await import('/src/game/systems/interaction.ts')
      const { HOUSES } = await import('/src/game/config/houses.ts')
      const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
      const e = buildEntrances(HOUSES, STRUCTURES).find(x => x.id === 'house-a')
      window.__wtGame.scene.getScene('TownScene').player.placeFeet(e.fallbackFeet.x, e.fallbackFeet.y)
    })
    await page.waitForFunction(() => window.__wtGame.scene.getScene('TownScene').nearby?.id === 'house-a', null, { timeout: 30_000 })
    await page.keyboard.press('e')
    await page.waitForFunction(() => {
      const i = window.__wtGame.scene.getScene('InteriorScene')
      return window.__wtGame.scene.isActive('InteriorScene') && i?.player && !i.lock.isBusy
    }, null, { timeout: 60_000 })
    await sleep(500)
  }
  const standAt = async app => {
    await page.evaluate(app => {
      const i = window.__wtGame.scene.getScene('InteriorScene')
      const targets = i.currentObjectTargets()
      const t = targets.find(x => x.app === app)
      const others = targets.filter(x => x !== t)
      const y = app === 'website' ? Math.min(...others.map(o => o.zone.y), t.zone.y + t.zone.h) - 3 : t.zone.y + t.zone.h - 3
      i.player.placeFeet(t.zone.x + t.zone.w / 2, y)
    }, app)
    await page.waitForFunction(app => window.__wtGame.scene.getScene('InteriorScene').nearObject?.app === app, app, { timeout: 30_000 })
  }
  await goIn()

  await standAt('website')
  await page.keyboard.press('e')
  await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 120_000 })
  await expect.poll(() => count('computer-on')).toBe(1)
  await sleep(1500) // idle with the window open: no typing sounds
  expect(await count('key')).toBe(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => count('computer-off')).toBe(1)
  expect(await count('computer-on')).toBe(1)

  await sleep(600)
  await standAt('paint')
  await page.keyboard.press('e')
  await expect(page.locator('canvas.pt-canvas')).toBeVisible({ timeout: 120_000 })
  await expect.poll(() => count('page-turn')).toBe(1)
  await sleep(1000)
  expect(await count('pencil')).toBe(0) // the open book is silent until drawn on
  const box = await page.locator('canvas.pt-canvas').boundingBox()
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 20 + i * 12, box.y + 20 + i * 4)
    await sleep(40)
  }
  await page.mouse.up()
  const strokes = await count('pencil')
  expect(strokes).toBeGreaterThan(0)
  await page.mouse.move(box.x + 200, box.y + 150) // moving without drawing
  await sleep(300)
  expect(await count('pencil')).toBe(strokes)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => count('book-close')).toBe(1)
})

test('mute silences everything, volumes do not restart anything, and the settings survive a reload', async () => {
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sound settings' }).click()
  const loopsBefore = await page.evaluate(() => window.__gameAudio.loops.length)
  await page.getByRole('slider', { name: 'Ambience' }).fill('20')
  expect(await page.evaluate(() => window.__gameAudio.loops.length)).toBe(loopsBefore)
  expect(await page.evaluate(() => window.__gameAudio.currentSettings.ambient)).toBeCloseTo(0.2)

  await page.getByRole('checkbox', { name: 'Mute' }).check()
  await expect.poll(() => page.evaluate(() => window.__gameAudio.state)).toBe('suspended')
  const muted = await count('step-grass') + await count('step-path')
  await walk('s', 800)
  expect(await count('step-grass') + await count('step-path')).toBe(muted)

  await page.reload()
  await waitForTown()
  await page.getByRole('button', { name: 'Sound settings' }).click()
  await expect(page.getByRole('checkbox', { name: 'Mute' })).toBeChecked()
  await expect(page.getByRole('slider', { name: 'Ambience' })).toHaveValue('20')
  await page.getByRole('checkbox', { name: 'Mute' }).uncheck()
  await expect.poll(() => page.evaluate(async () => (await import('/src/audio/index.ts')).gameAudio.currentSettings.muted)).toBe(false)
})
