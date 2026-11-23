// M1 in real browsers: a bad invitation is refused; a stranger can neither open the town nor join its live
// channel (refused by the database and by the channel policy); a resident leaves from the town window and the
// owner sees them go.
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { EMULATOR, createInvite, drawn, emulator, joinWithLink, launchPlayer, me, quietly, startGuest, status, waitForTown } from './helpers.mjs'

test('a bad invitation is refused, and a stranger can neither open the town nor join its channel', async () => {
  const a = await launchPlayer('chromium')
  const stranger = await launchPlayer('chromium')
  try {
    await startGuest(a)
    const ia = await me(a.page)

    console.log('[step] A ready')
    // A made-up code.
    await quietly([a], async () => {
      await stranger.page.goto('/?invite=ABCD-EFGH-JKLM', { waitUntil: 'commit' })
      await expect(stranger.page.getByRole('heading', { name: "This invitation doesn't work" })).toBeVisible({ timeout: 240_000 })
      await stranger.page.getByRole('button', { name: 'Open my town' }).click()
      await waitForTown(stranger.page)
    })
    const is = await me(stranger.page)
    expect(is.worldId).not.toBe(ia.worldId)

    console.log('[step] invalid code done')
    // The stranger tries to open A's town anyway (a remembered world id): the database refuses, they get their own.
    await stranger.page.evaluate(([u, w]) => localStorage.setItem(`webtown.world.${u}`, w), [is.userId, ia.worldId])
    await quietly([a], async () => {
      await stranger.page.reload({ waitUntil: 'commit' })
      await waitForTown(stranger.page)
    })
    expect((await me(stranger.page)).worldId).toBe(is.worldId)
    expect(await stranger.page.evaluate(u => localStorage.getItem(`webtown.world.${u}`), is.userId)).toBeNull()

    console.log('[step] remembered world refused')
    // A stranger joining A's live channel directly with supabase-js (a fresh guest, from Node): refused by the
    // channel policy, with nothing delivered to A.
    await emulator('/__test/reset-stats', {})
    const client = createClient(EMULATOR, 'sb_publishable_emulator_test', { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: signedIn } = await client.auth.signInAnonymously()
    await client.rpc('bootstrap_player')
    const outcome = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ status: 'no answer' }), 20_000)
      client.channel(`world:${ia.worldId}`, { config: { private: true } }).subscribe((s, err) => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR') {
          clearTimeout(timer)
          resolve({ status: s, message: err?.message ?? '' })
        }
      })
    })
    await client.removeAllChannels()
    expect(outcome.status).toBe('CHANNEL_ERROR')
    expect(outcome.message).toMatch(/Unauthorized/)
    const stats = await emulator('/__test/stats')
    expect(stats.refusals.some(r => r.user === signedIn.user.id && r.topic === `world:${ia.worldId}`)).toBe(true)
    expect(await drawn(a.page)).toEqual([])

    console.log('[step] channel refused')
  } finally {
    await a.browser.close()
    await stranger.browser.close()
  }
})

test('a resident leaves from the town window, and the owner sees them go', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  try {
    await startGuest(a)
    const ia = await me(a.page)
    // B joins properly, then leaves from the town window.
    const code = await createInvite(a.page)
    console.log('[step] invitation created')
    await joinWithLink(b, code, [a])
    const ib = await me(b.page)
    await expect(status(a.page)).toHaveText('Online · 2 players')
    console.log('[step] B joined')
    await b.page.getByRole('button', { name: /^Town: / }).click()
    await b.page.getByRole('button', { name: 'Leave this town' }).click()
    await b.page.getByRole('button', { name: 'Leave and delete my house there' }).click()
    await waitForTown(b.page)
    expect((await me(b.page)).worldId).not.toBe(ia.worldId)
    await expect.poll(() => drawn(a.page), { timeout: 15_000 }).toEqual([])
    await expect(status(a.page)).toHaveText('Online · only you here')
    await a.page.getByRole('button', { name: /^Town: / }).click()
    await expect(a.page.getByText('1 of 7 players.')).toBeVisible()
    await expect(a.page.getByText(ib.name)).toHaveCount(0)
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
