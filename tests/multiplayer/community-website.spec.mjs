// CH-06 with two real players (Chromium owner, Firefox resident) on the Supabase stand-in: the Hall's kiosk opens
// the Community Website; the resident writes the shared draft in the Site Studio (CodeMirror) and saves it; the owner
// sees who is editing, looks at the draft and publishes it; the resident, looking at the published version, gets it
// without reopening; both see the page the resident wrote.
import { test, expect } from '@playwright/test'
import { createInvite, joinWithLink, launchPlayer, me, sleep, startGuest } from './helpers.mjs'

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

async function openKiosk(page) {
  const door = await hallDoor(page)
  await page.evaluate(d => window.__wtGame.scene.getScene('TownScene').player.placeFeet(d.x, d.y), door)
  await expect.poll(() => page.evaluate(() => {
    const p = window.__wtGame.scene.getScene('TownScene').prompt
    return p?.isVisible ? p.label.text : null
  }), { timeout: 30_000 }).toBe('E: Enter Community Hall')
  await page.keyboard.press('e')
  await expect.poll(() => inHall(page), { timeout: 60_000 }).toBe(true)
  await sleep(600)
  await page.evaluate(() => {
    const i = window.__wtGame.scene.getScene('InteriorScene')
    const t = i.currentObjectTargets().find(x => x.app === 'website')
    i.player.placeFeet(t.zone.x + t.zone.w / 2, t.zone.y + t.zone.h / 2)
  })
  await expect.poll(() => page.evaluate(() => {
    const i = window.__wtGame.scene.getScene('InteriorScene')
    return i.prompt?.label?.visible ? i.prompt.label.text : null
  })).toBe('E: Community Website')
  await page.keyboard.press('e')
  const win = page.getByRole('dialog', { name: 'Community Website' })
  await expect(win).toBeVisible({ timeout: 60_000 })
  return win
}

/** The text of the page the website viewer shows: the sandboxed page inside its host frame (as in website-studio.spec.mjs). */
async function shownText(page) {
  const host = page.frames().filter(f => !f.isDetached() && f.url().endsWith('/site-host.html')).pop()
  const frame = host?.childFrames()[0]
  return frame ? frame.evaluate(() => document.body?.textContent ?? '').catch(() => '') : ''
}

/** Replaces the whole text of the code editor (CodeMirror), as in tests/e2e/website-studio.spec.mjs. */
async function setCode(page, text) {
  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect.poll(() => content.evaluate(el => el.cmView?.view?.state.doc.toString() ?? el.textContent)).toContain('Hello from')
}

test('the kiosk opens a Community Website the town writes together and a moderator publishes', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  try {
    await startGuest(a)
    await joinWithLink(b, await createInvite(a.page), [a])
    const ib = await me(b.page)
    const wa = await openKiosk(a.page)
    const wb = await openKiosk(b.page)
    await expect(wb.getByText('Nothing has been published yet.')).toBeVisible({ timeout: 60_000 })

    // B starts the draft and writes the homepage in the Studio.
    await wb.getByRole('button', { name: 'Edit the draft' }).click()
    await b.page.getByRole('button', { name: /Blank website/ }).click()
    const studio = b.page.getByRole('dialog', { name: /Site Studio/ })
    await expect(studio).toBeVisible({ timeout: 60_000 })
    await setCode(b.page, '<h1>Hello from the whole town</h1>')
    await studio.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(studio.locator('.ws-status')).toHaveText('Saved', { timeout: 30_000 })

    // A opens the draft in the Studio too: B is shown as editing.
    await wa.getByRole('button', { name: 'Edit the draft' }).click()
    const studioA = a.page.getByRole('dialog', { name: /Site Studio/ })
    await expect(studioA).toBeVisible({ timeout: 60_000 })
    await expect(studioA.getByText(`${ib.name} is editing the draft too.`)).toBeVisible({ timeout: 30_000 })
    await studioA.getByRole('button', { name: 'Exit' }).click()

    // B goes back to the published view (still nothing) while A publishes the draft.
    await studio.getByRole('button', { name: 'Exit' }).click()
    const viewB = b.page.getByRole('dialog', { name: 'Community Website' })
    await viewB.getByRole('button', { name: 'Published', exact: true }).click()
    await expect(viewB.getByText('Nothing has been published yet.')).toBeVisible()

    const viewA = a.page.getByRole('dialog', { name: 'Community Website' })
    await viewA.getByRole('button', { name: 'Draft', exact: true }).click()
    await expect(viewA.getByText(`Not published: version 1, saved by ${ib.name}`)).toBeVisible({ timeout: 30_000 })
    await viewA.getByRole('button', { name: 'Publish this version' }).click()
    const confirm = a.page.getByRole('alertdialog', { name: 'Publish version 1?' })
    await expect(confirm.getByText('New pages: index.html')).toBeVisible()
    await confirm.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(viewA.getByText('Version 1 is now what visitors see.')).toBeVisible({ timeout: 30_000 })

    // B gets the published version without doing anything; both see B's page.
    await expect(viewB.getByText('Published: version 1')).toBeVisible({ timeout: 30_000 })
    for (const page of [a.page, b.page]) {
      await expect.poll(() => shownText(page), { timeout: 30_000 }).toContain('Hello from the whole town')
    }

    // Closing gives the game back.
    for (const [page, view] of [[a.page, viewA], [b.page, viewB]]) {
      await view.getByRole('button', { name: 'Close' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    await expect.poll(() => inHall(a.page)).toBe(true)
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
