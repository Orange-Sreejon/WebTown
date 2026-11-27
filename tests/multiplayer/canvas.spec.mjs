// CH-04 with two real players (Chromium owner, Firefox resident) on the Supabase stand-in: the Hall's easel opens
// the Community Canvas; what one draws, the other sees forming (preview) and then stored; undo and redo reach the
// other; a resident can't erase the owner's drawing; after a network cut the canvas catches up on what was missed.
// Both views start centred on the same world point, so "the same place" is the same offset from the canvas centre.
import { test, expect } from '@playwright/test'
import { createInvite, emulator, joinWithLink, launchPlayer, me, sleep, startGuest } from './helpers.mjs'

const hallDoor = page => page.evaluate(async () => {
  const { buildEntrances } = await import('/src/game/systems/interaction.ts')
  const { COMMUNITY_HALL, HOUSES } = await import('/src/game/config/houses.ts')
  const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
  return buildEntrances([...HOUSES, COMMUNITY_HALL], STRUCTURES).find(e => e.id === COMMUNITY_HALL.id).fallbackFeet
})
const inHall = page => page.evaluate(() => {
  const g = window.__wtGame
  const i = g.scene.getScene('InteriorScene')
  return g.scene.isActive('InteriorScene') && i?.isHall === true && !!i.player && !i.lock.isBusy
})

async function openCanvas(page) {
  const door = await hallDoor(page)
  await page.evaluate(d => window.__wtGame.scene.getScene('TownScene').player.placeFeet(d.x, d.y), door)
  await expect.poll(() => page.evaluate(() => {
    const p = window.__wtGame.scene.getScene('TownScene').prompt
    return p?.isVisible ? p.label.text : null
  }), { timeout: 30_000 }).toBe('E: Enter Community Hall')
  await page.keyboard.press('e')
  await expect.poll(() => inHall(page), { timeout: 60_000 }).toBe(true)
  await sleep(600)
  // To the easel (the notebook table): into its interaction zone.
  await page.evaluate(() => {
    const i = window.__wtGame.scene.getScene('InteriorScene')
    const t = i.currentObjectTargets().find(x => x.app === 'paint')
    i.player.placeFeet(t.zone.x + t.zone.w / 2, t.zone.y + t.zone.h / 2)
  })
  await expect.poll(() => page.evaluate(() => {
    const i = window.__wtGame.scene.getScene('InteriorScene')
    return i.prompt?.label?.visible ? i.prompt.label.text : null
  })).toBe('E: Community Canvas')
  await page.keyboard.press('e')
  await expect(page.getByRole('dialog', { name: 'Community Canvas' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('canvas.cc-canvas')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Everyone in town can draw here.' })).toBeVisible({ timeout: 60_000 })
}

/** The canvas centre on screen (CSS pixels). */
const centre = page => page.locator('canvas.cc-canvas').evaluate(c => {
  const r = c.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
/** How much ink is at (dx, dy) CSS pixels from the canvas centre: about 14 on paper, over 200 on solid ink. */
const ink = (page, dx, dy) => page.locator('canvas.cc-canvas').evaluate((c, [dx, dy]) => {
  const k = c.width / c.getBoundingClientRect().width
  const d = c.getContext('2d').getImageData(Math.round(c.width / 2 + dx * k), Math.round(c.height / 2 + dy * k), 1, 1).data
  return 255 - Math.min(d[0], d[1], d[2])
}, [dx, dy])

test('the easel opens a canvas the whole town draws on together', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  try {
    await startGuest(a)
    await joinWithLink(b, await createInvite(a.page), [a])
    const ib = await me(b.page)
    await openCanvas(a.page)
    await openCanvas(b.page)
    expect(await ink(b.page, 10, 20)).toBeLessThan(40)

    // A draws a line through (-60..60, 20) from the centre; B sees it forming, then stored.
    await a.page.getByRole('radio', { name: 'Size 8' }).click()
    const c = await centre(a.page)
    await a.page.mouse.move(c.x - 60, c.y + 20)
    await a.page.mouse.down()
    await a.page.mouse.move(c.x + 60, c.y + 20, { steps: 12 })
    await expect.poll(() => ink(b.page, 10, 20), { message: 'a faded preview on B while A still draws' }).toBeGreaterThan(40)
    await a.page.mouse.up()
    await expect.poll(() => ink(b.page, 10, 20), { message: 'the stored stroke on B' }).toBeGreaterThan(180)
    await expect.poll(() => ink(a.page, 10, 20)).toBeGreaterThan(180)

    // Undo and redo reach B.
    await a.page.keyboard.press('Control+z')
    await expect.poll(() => ink(b.page, 10, 20)).toBeLessThan(40)
    await a.page.keyboard.press('Control+Shift+z')
    await expect.poll(() => ink(b.page, 10, 20)).toBeGreaterThan(180)

    // B, a resident, can't erase the owner's drawing: the eraser finds nothing of B's there.
    await b.page.getByRole('button', { name: 'Eraser' }).click()
    const cb = await centre(b.page)
    await b.page.mouse.click(cb.x + 10, cb.y + 20)
    await sleep(1500)
    expect(await ink(a.page, 10, 20)).toBeGreaterThan(180)
    expect(await ink(b.page, 10, 20)).toBeGreaterThan(180)

    // B's connection drops for a few seconds; A draws meanwhile; B catches up once back.
    await emulator('/__test/drop', { userId: ib.userId, blockMs: 4000 })
    await a.page.mouse.move(c.x - 40, c.y - 50)
    await a.page.mouse.down()
    await a.page.mouse.move(c.x + 40, c.y - 50, { steps: 8 })
    await a.page.mouse.up()
    await expect.poll(() => ink(a.page, 0, -50)).toBeGreaterThan(180)
    await expect.poll(() => ink(b.page, 0, -50), { timeout: 60_000, message: 'B caught up after the cut' }).toBeGreaterThan(180)

    // Closing gives the game back.
    for (const p of [a.page, b.page]) {
      await p.getByRole('dialog', { name: 'Community Canvas' }).getByRole('button', { name: 'Close' }).click()
      await expect(p.getByRole('dialog', { name: 'Community Canvas' })).toHaveCount(0)
    }
    await expect.poll(() => inHall(a.page)).toBe(true)
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
