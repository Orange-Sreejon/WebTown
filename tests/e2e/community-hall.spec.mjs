// CH-02 on this device only (no accounts): the church door says the Community Hall opens online, and E does
// nothing there; the houses still open as before.
import { test, expect } from '@playwright/test'

const sleep = ms => new Promise(r => setTimeout(r, ms))

test('without an account the Community Hall stays closed, and houses still open', async ({ page }) => {
  await page.goto('/')
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

  const stand = id => page.evaluate(async id => {
    const { buildEntrances } = await import('/src/game/systems/interaction.ts')
    const { COMMUNITY_HALL, HOUSES } = await import('/src/game/config/houses.ts')
    const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
    const e = buildEntrances([...HOUSES, COMMUNITY_HALL], STRUCTURES).find(x => x.id === id)
    window.__wtGame.scene.getScene('TownScene').player.placeFeet(e.fallbackFeet.x, e.fallbackFeet.y)
  }, id)
  const prompt = () => page.evaluate(() => {
    const p = window.__wtGame.scene.getScene('TownScene').prompt
    return p?.isVisible ? p.label.text : null
  })
  const interior = () => page.evaluate(() => window.__wtGame.scene.isActive('InteriorScene'))

  await stand('community-hall')
  await expect.poll(prompt, { timeout: 30_000 }).toBe('Community Hall: opens when you play online')
  await page.keyboard.press('e')
  await sleep(1500)
  expect(await interior()).toBe(false)

  await stand('house-a')
  await expect.poll(prompt, { timeout: 30_000 }).toBe('E: Enter')
  await page.keyboard.press('e')
  await expect.poll(interior, { timeout: 60_000 }).toBe(true)
  expect(await page.evaluate(() => window.__wtGame.scene.getScene('InteriorScene').isHall)).toBe(false)
})
