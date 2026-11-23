// Phase 5 acceptance against a REAL Supabase project: two guests in two different browsers (Chromium and
// Firefox) join one world with an invitation, see each other with names, walk and wave; a stranger can't join
// the world's channel; leaving is seen. Skipped unless WEBTOWN_LIVE=1 (see playwright.config.mjs and
// docs/MULTIPLAYER.md). Runs once (it launches its own two browsers), in the chromium project.
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  createInvite, drawn, feet, joinWithLink, launchPlayer, me, placeInTown, recordToasts, startGuest, status, toasts,
  walkUntil,
} from '../multiplayer/helpers.mjs'

const LIVE = process.env.WEBTOWN_LIVE === '1'
const URL_ = process.env.WEBTOWN_LIVE_SUPABASE_URL ?? ''
const KEY = process.env.WEBTOWN_LIVE_SUPABASE_KEY ?? ''
const APP = 'http://127.0.0.1:5190'
test.skip(!LIVE || !URL_ || !KEY, 'Set WEBTOWN_LIVE=1, WEBTOWN_LIVE_SUPABASE_URL and WEBTOWN_LIVE_SUPABASE_KEY to run against a test project.')

test('two real players: invitation, presence, movement, waving, strangers kept out, leaving', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Launches its own Chromium and Firefox; runs once.')
  test.setTimeout(900_000)
  const a = await launchPlayer('chromium', APP)
  const b = await launchPlayer('firefox', APP)
  try {
    await startGuest(a)
    const code = await createInvite(a.page)
    await joinWithLink(b, code, [a])
    const [ia, ib] = [await me(a.page), await me(b.page)]
    expect(ib.worldId).toBe(ia.worldId)
    await recordToasts(a.page)
    await recordToasts(b.page)

    await expect(status(a.page)).toHaveText('Online · 2 players')
    await expect.poll(() => drawn(a.page)).toEqual([expect.objectContaining({ id: ib.userId, name: ib.name })])
    await expect.poll(() => drawn(b.page)).toEqual([expect.objectContaining({ id: ia.userId, name: ia.name })])

    // Movement over the real network.
    await placeInTown(b.page, 560, 520)
    await placeInTown(a.page, 640, 520)
    await walkUntil(b.page, 'd', 'x', 60)
    const bAt = await feet(b.page)
    await expect.poll(async () => (await drawn(a.page))[0]).toMatchObject({ x: bAt.x, y: bAt.y })

    // Waving: close enough, a real Q.
    await placeInTown(a.page, bAt.x + 24, bAt.y)
    await expect.poll(async () => (await drawn(b.page))[0]?.x).toBe(bAt.x + 24)
    await a.page.keyboard.press('q')
    await expect.poll(() => toasts(b.page)).toContain(`${ia.name} waved at you`)

    // A stranger (a fresh guest) can't join this world's channel: refused by the policy on realtime.messages.
    const stranger = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    await stranger.auth.signInAnonymously()
    await stranger.rpc('bootstrap_player')
    const outcome = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('no answer'), 30_000)
      stranger.channel(`world:${ia.worldId}`, { config: { private: true } }).subscribe(s => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR') { clearTimeout(timer); resolve(s) }
      })
    })
    await stranger.removeAllChannels()
    expect(outcome).toBe('CHANNEL_ERROR')

    // B leaves (closes the browser): gone for A.
    await b.context.close()
    await expect.poll(() => drawn(a.page), { timeout: 60_000 }).toEqual([])
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
