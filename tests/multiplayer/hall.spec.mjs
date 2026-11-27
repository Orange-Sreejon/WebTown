// CH-02 with two real players (Chromium owner, Firefox resident) on the Supabase stand-in: the church's door opens
// the Community Hall; players inside see each other and players outside don't; the kiosk opens the Community
// Website (CH-06; its own test: community-website.spec.mjs); there is no furniture editing; leaving brings you back to the church door; houses work as before.
import { test, expect } from '@playwright/test'
import {
  createInvite, drawn, enterHouse, feet, joinWithLink, launchPlayer, me, quietly, sleep, startGuest, walkUntil,
} from './helpers.mjs'

const hallDoor = page => page.evaluate(async () => {
  const { buildEntrances } = await import('/src/game/systems/interaction.ts')
  const { COMMUNITY_HALL, HOUSES } = await import('/src/game/config/houses.ts')
  const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
  return buildEntrances([...HOUSES, COMMUNITY_HALL], STRUCTURES).find(e => e.id === COMMUNITY_HALL.id).fallbackFeet
})
const townPrompt = page => page.evaluate(() => {
  const p = window.__wtGame.scene.getScene('TownScene').prompt
  return p?.isVisible ? p.label.text : null
})
const inHall = page => page.evaluate(() => {
  const g = window.__wtGame
  const i = g.scene.getScene('InteriorScene')
  return g.scene.isActive('InteriorScene') && i?.isHall === true && !!i.player && !i.lock.isBusy
})
const notice = page => page.evaluate(() => window.__wtGame.scene.getScene('InteriorScene').noticeLabel?.text ?? null)

async function enterHall(page) {
  const door = await hallDoor(page)
  await page.evaluate(d => window.__wtGame.scene.getScene('TownScene').player.placeFeet(d.x, d.y), door)
  await expect.poll(() => townPrompt(page), { timeout: 30_000 }).toBe('E: Enter Community Hall')
  await page.keyboard.press('e')
  await expect.poll(() => inHall(page), { timeout: 60_000 }).toBe(true)
  await sleep(600)
}

test('the church is the Community Hall: shared, placeholder objects, no editing, back out to the church', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  try {
    await startGuest(a)
    await joinWithLink(b, await createInvite(a.page), [a])
    const [ia, ib] = [await me(a.page), await me(b.page)]
    await expect.poll(() => drawn(a.page)).toEqual([expect.objectContaining({ id: ib.userId })])

    // A goes in: gone from the town for B, with a welcome line inside.
    await enterHall(a.page)
    await expect.poll(() => notice(a.page)).toMatch(/Community Hall/)
    await expect.poll(() => drawn(b.page)).toEqual([])

    // The owner of the town gets no "Edit House" in the Hall (nobody does).
    await expect(a.page.getByText('Edit House')).toHaveCount(0)

    // B follows: they see each other inside, and walking is synchronised.
    await enterHall(b.page)
    await expect.poll(() => drawn(a.page, 'InteriorScene')).toEqual([expect.objectContaining({ id: ib.userId, name: ib.name })])
    await expect.poll(() => drawn(b.page, 'InteriorScene')).toEqual([expect.objectContaining({ id: ia.userId })])
    await walkUntil(b.page, 'a', 'x', 20)
    const bAt = await feet(b.page)
    await expect.poll(async () => (await drawn(a.page, 'InteriorScene'))[0]).toMatchObject({ x: bAt.x, y: bAt.y })

    // The kiosk: its own prompt; E opens the Community Website window, and closing it gives the game back.
    await a.page.evaluate(() => {
      const i = window.__wtGame.scene.getScene('InteriorScene')
      const targets = i.currentObjectTargets()
      const t = targets.find(x => x.app === 'website')
      const top = Math.min(...targets.filter(x => x !== t).map(x => x.zone.y), t.zone.y + t.zone.h)
      i.player.placeFeet(t.zone.x + t.zone.w / 2, top - 3)
    })
    await expect.poll(() => a.page.evaluate(() => {
      const i = window.__wtGame.scene.getScene('InteriorScene')
      return i.prompt?.label?.visible ? i.prompt.label.text : null
    })).toBe('E: Community Website')
    await a.page.keyboard.press('e')
    const kiosk = a.page.getByRole('dialog', { name: 'Community Website' })
    await expect(kiosk).toBeVisible({ timeout: 60_000 })
    await expect(kiosk.getByText('Nothing has been published yet.')).toBeVisible({ timeout: 60_000 })
    await kiosk.getByRole('button', { name: 'Close' }).click()
    await expect(a.page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => inHall(a.page)).toBe(true)

    // A leaves: back in the town at the church; B still inside sees A go.
    await a.page.evaluate(() => {
      const i = window.__wtGame.scene.getScene('InteriorScene')
      const z = i.definition.exit.zone
      i.player.placeFeet(z.x + z.w / 2, z.y + z.h / 2)
    })
    await a.page.waitForFunction(() => window.__wtGame.scene.getScene('InteriorScene').nearExit, null, { timeout: 30_000 })
    await a.page.keyboard.press('e')
    await a.page.waitForFunction(() => window.__wtGame.scene.isActive('TownScene') && !window.__wtGame.scene.isActive('InteriorScene'), null, { timeout: 30_000 })
    const back = await feet(a.page)
    const door = await hallDoor(a.page)
    expect(Math.hypot(back.x - door.x, back.y - door.y)).toBeLessThan(48)
    await expect.poll(() => drawn(b.page, 'InteriorScene')).toEqual([])

    // Houses are unchanged: A's own house still opens, with editing.
    await quietly([b], () => enterHouse(a.page, ia.ownedSlot))
    expect(await a.page.evaluate(() => window.__wtGame.scene.getScene('InteriorScene').isHall)).toBe(false)
    await expect(a.page.getByText('Edit House')).toBeVisible({ timeout: 30_000 })
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
