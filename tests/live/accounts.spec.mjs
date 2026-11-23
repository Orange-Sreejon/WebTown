// Phase 4 acceptance against a real Supabase project: guests, reloads, upgrade, log out and in, persistence and
// isolation, in the real app. Skipped unless WEBTOWN_LIVE=1 (see playwright.config.mjs and docs/ACCOUNTS.md).
//
// Data is written through the app's own modules in the page (the game's `houseLayouts`, the account-backed
// Sketchbook and website repositories set up by the session gate), so every request is the app's real request
// with the player's real session. Isolation is checked with raw HTTP calls carrying another user's token.
import { test, expect } from '@playwright/test'
import './live-env.mjs'

const LIVE = process.env.WEBTOWN_LIVE === '1'
const URL_ = process.env.WEBTOWN_LIVE_SUPABASE_URL ?? ''
const KEY = process.env.WEBTOWN_LIVE_SUPABASE_KEY ?? ''
test.skip(!LIVE || !URL_ || !KEY, 'Set WEBTOWN_LIVE=1, WEBTOWN_LIVE_SUPABASE_URL and WEBTOWN_LIVE_SUPABASE_KEY to run against a test project.')

/** The session supabase-js saved in this browser: `sb-<ref>-auth-token` in localStorage. */
async function session(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))
    return key ? JSON.parse(localStorage.getItem(key)) : null
  })
}

async function waitForTown(page) {
  await expect(page.locator('.ac-corner')).toBeVisible({ timeout: 120_000 })
  await page.waitForFunction(async () => {
    const { activeCloud } = await import('/src/cloud/cloud-session.ts')
    return activeCloud() !== null
  })
}

/** The player's world as the app received it from bootstrap_player. */
const player = page => page.evaluate(async () => {
  const { activeCloud } = await import('/src/cloud/cloud-session.ts')
  const p = activeCloud().player
  return { userId: p.userId, worldId: p.world.id, ownedSlot: p.ownedSlot, houses: p.houses }
})

/** Calls a database function as whoever's access token is given, over HTTP, as any client could. */
async function rpcAs(token, fn, args) {
  const response = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

test('a guest plays at once, keeps the same identity and town across reloads, and their work persists', async ({ page }) => {
  await page.goto('/')
  await waitForTown(page)
  await expect(page.locator('.ac-corner')).toContainText('Guest')
  const first = await session(page)
  expect(first.user.is_anonymous).toBe(true)
  const me = await player(page)
  expect(me.ownedSlot).toBe('house-a')

  // Furniture: remove one piece through the game's own store, as Save in the editor does.
  const removed = await page.evaluate(async () => {
    const { houseLayouts } = await import('/src/game/maps/house/house-layout-store.ts')
    const { removeItem } = await import('/src/game/maps/house/layout-edits.ts')
    const { DEFAULT_TEMPLATE } = await import('/src/game/maps/house/default-interior.ts')
    const layout = await houseLayouts.load('house-a')
    const edit = layout.items.map(i => removeItem(DEFAULT_TEMPLATE, layout, i.id)).find(r => r.ok)
    await houseLayouts.save(edit.layout)
    return edit.layout.items.length
  })

  // Sketchbook: a drawing through the account-backed repository.
  await page.evaluate(async () => {
    const { getSiteStorage } = await import('/src/personal-spaces/composition.ts')
    const storage = await getSiteStorage()
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 2
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 4, 2)
    const png = await new Promise(r => canvas.toBlob(b => r(b.arrayBuffer()), 'image/png'))
    await storage.artworks.save({ id: null, houseId: 'house-a', title: 'Live test', width: 4, height: 2, transparent: false, png: await png })
  })

  await page.reload()
  await waitForTown(page)
  const again = await session(page)
  expect(again.user.id).toBe(first.user.id) // the same guest, not a new one
  expect((await player(page)).worldId).toBe(me.worldId)
  expect(await page.evaluate(async () => {
    const { houseLayouts } = await import('/src/game/maps/house/house-layout-store.ts')
    return (await houseLayouts.load('house-a')).items.length
  })).toBe(removed)
  expect(await page.evaluate(async () => {
    const { getSiteStorage } = await import('/src/personal-spaces/composition.ts')
    return (await (await getSiteStorage()).artworks.list('house-a')).items.map(i => i.title)
  })).toContain('Live test')
})

test('a guest upgrades to an account with the same id, logs out, and logs back in to the same town', async ({ page }) => {
  await page.goto('/')
  await waitForTown(page)
  const guest = await session(page)
  const town = await player(page)
  const email = `webtown-live-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'live-test-password-1'

  await page.locator('.ac-corner').click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send confirmation link' }).click()
  // The test project has "Confirm email" off, so the address is linked at once; the password step follows.
  await expect(page.getByRole('heading', { name: 'Choose a password' })).toBeVisible()
  await page.getByLabel('New password (at least 8 characters)').fill(password)
  await page.getByLabel('New password again').fill(password)
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByText(`Logged in as ${email}`)).toBeVisible()
  const upgraded = await session(page)
  expect(upgraded.user.id).toBe(guest.user.id)
  expect(upgraded.user.is_anonymous).toBe(false)
  expect((await player(page)).worldId).toBe(town.worldId)

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('button', { name: 'Play as guest' })).toBeVisible()
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await waitForTown(page)
  expect((await session(page)).user.id).toBe(guest.user.id)
  expect((await player(page)).worldId).toBe(town.worldId)
})

test('linking an email that already has an account changes nothing', async ({ page, browser }) => {
  // An account to collide with.
  const owner = await browser.newPage()
  await owner.goto('/')
  await waitForTown(owner)
  const email = `webtown-live-taken-${Date.now()}@example.com`
  await owner.locator('.ac-corner').click()
  await owner.getByLabel('Email').fill(email)
  await owner.getByRole('button', { name: 'Send confirmation link' }).click()
  await expect(owner.getByRole('heading', { name: 'Choose a password' })).toBeVisible()
  await owner.close()

  await page.goto('/')
  await waitForTown(page)
  const guest = await session(page)
  await page.locator('.ac-corner').click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send confirmation link' }).click()
  await expect(page.getByText('neither is merged')).toBeVisible()
  const still = await session(page)
  expect(still.user.id).toBe(guest.user.id)
  expect(still.user.is_anonymous).toBe(true)
})

test("one player cannot read or change another player's house, website or drawings", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await a.goto('/')
  await b.goto('/')
  await waitForTown(a)
  await waitForTown(b)
  const aTown = await player(a)
  const aHouse = aTown.houses.find(h => h.slot === 'house-a').id
  await a.evaluate(async () => {
    const { houseLayouts } = await import('/src/game/maps/house/house-layout-store.ts')
    await houseLayouts.save(await houseLayouts.load('house-a'))
  })
  const bToken = (await session(b)).access_token
  const aToken = (await session(a)).access_token

  expect((await rpcAs(aToken, 'get_house_layout', { p_house: aHouse })).status).toBe(200)
  for (const [fn, args] of [
    ['get_house_layout', { p_house: aHouse }],
    ['get_website', { p_house: aHouse }],
    ['list_artworks', { p_house: aHouse }],
    ['save_house_layout', { p_house: aHouse, p_base_revision: 1, p_template_id: 'cozy-room', p_schema_version: 1, p_items: [] }],
    ['delete_artwork', { p_house: aHouse, p_id: crypto.randomUUID() }],
  ]) {
    const r = await rpcAs(bToken, fn, args)
    expect(r.status, fn).toBeGreaterThanOrEqual(400)
    expect(r.body?.code, fn).toBe('42501')
  }
  // Tables read directly: RLS hides the other world entirely.
  const direct = await fetch(`${URL_}/rest/v1/houses?world_id=eq.${aTown.worldId}`, { headers: { apikey: KEY, Authorization: `Bearer ${bToken}` } })
  expect(await direct.json()).toEqual([])
  // Without any session (the publishable key alone), nothing at all.
  const anon = await fetch(`${URL_}/rest/v1/profiles?select=id`, { headers: { apikey: KEY } })
  expect(anon.status).toBeGreaterThanOrEqual(400)
})
