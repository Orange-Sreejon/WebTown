// M3: two guests (Chromium and Firefox) walk with the real keyboard and see each other move smoothly; the send
// rate is measured at the server; a reconnect restores the right position; entering a house moves the character
// out of the town and into that house; a third guest in their own world sees nobody and is seen by nobody.
import { test, expect } from '@playwright/test'
import {
  createInvite, drawn, emulator, enterHouse, feet, hold, joinWithLink, launchPlayer, me, placeInTown, sleep,
  startGuest, startTrace, status, stopTrace, walkUntil,
} from './helpers.mjs'

test('walking together: smooth, throttled, reconnect-safe, house-aware and private to the world', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  const c = await launchPlayer('chromium')
  try {
    await startGuest(a)
    const code = await createInvite(a.page)
    await joinWithLink(b, code, [a])
    const [ia, ib] = [await me(a.page), await me(b.page)]
    await expect(status(a.page)).toHaveText('Online · 2 players')

    // Somewhere open in the middle of the road (the spawn), a little apart.
    await placeInTown(b.page, 560, 520)
    await placeInTown(a.page, 640, 520)
    await expect.poll(async () => (await drawn(a.page))[0]?.x).toBe(560)

    // B walks right about 100 px; A traces B every frame meanwhile.
    await emulator('/__test/reset-stats', {})
    await startTrace(a.page, ib.userId)
    const heldMs = await walkUntil(b.page, 'd', 'x', 100)
    const bAt = await feet(b.page)
    await sleep(1500)
    const path = await stopTrace(a.page)
    expect(bAt.x).toBeGreaterThan(560 + 90)
    // Smooth: always forward, never a jump, walking while moving.
    const moving = path.filter(p => p.x > 561 && p.x < bAt.x - 1)
    expect(moving.length).toBeGreaterThan(5)
    for (let i = 1; i < path.length; i++) {
      const step = path[i].x - path[i - 1].x
      const dt = path[i].t - path[i - 1].t
      expect(step, `frame ${i}: ${JSON.stringify(path.slice(Math.max(0, i - 4), i + 3).map(p => [Math.round(p.t), Math.round(p.x * 10) / 10, p.anim]))} stop at ${bAt.x}`).toBeGreaterThanOrEqual(-0.01)
      expect(step, `frame ${i}: ${step.toFixed(1)} px in ${dt.toFixed(0)} ms`).toBeLessThanOrEqual(0.08 * dt * 2.5 + 3)
    }
    expect(moving.every(p => p.anim?.startsWith('walk-right'))).toBe(true)
    // Where B stopped, standing.
    await expect.poll(async () => (await drawn(a.page))[0]).toMatchObject({ x: bAt.x, y: bAt.y, anim: expect.stringMatching(/^idle-right/) })

    // Throttled at the source: at most 10 a second while walking (plus the stop).
    const stats = await emulator('/__test/stats')
    const sent = stats.broadcasts.filter(m => m.user === ib.userId && m.event === 'mv')
    // ...and at least a few: B sent while walking, not only once.
    expect(sent.length).toBeGreaterThanOrEqual(Math.min(8, Math.floor(heldMs / 200)))
    expect(sent.length, `sent ${sent.length} in ${heldMs} ms`).toBeLessThanOrEqual(Math.ceil((heldMs / 1000) * 10) + 3)

    // A walks down; B sees it.
    const aStart = await feet(a.page)
    await walkUntil(a.page, 's', 'y', 40)
    const aAt = await feet(a.page)
    expect(aAt.y).toBeGreaterThan(aStart.y + 30)
    await expect.poll(async () => (await drawn(b.page))[0]).toMatchObject({ x: aAt.x, y: aAt.y })

    // B's connection drops; B keeps walking meanwhile; after the reconnect A sees B where B really is.
    await emulator('/__test/drop', { userId: ib.userId, blockMs: 4000 })
    await expect(status(b.page)).toHaveAttribute('data-status', 'reconnecting')
    await hold(b.page, 'w', 600)
    const bNow = await feet(b.page)
    await expect(status(b.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
    let seen = null
    await expect.poll(async () => (seen = (await drawn(a.page)).map(p => [p.id, p.x, p.y])), {
      timeout: 20_000, message: `A should draw B at B's position after the reconnect`
    }).toEqual([[ib.userId, bNow.x, bNow.y]]).catch(async e => {
      console.log('drawn by A:', JSON.stringify(seen), 'B is at:', JSON.stringify(await feet(b.page)), 'B status:', await status(b.page).getAttribute('data-status'))
      throw e
    })

    // A third guest, in their own world: sees nobody, and nobody sees them.
    await startGuest(c, '/', [a, b])
    const ic = await me(c.page)
    expect(ic.worldId).not.toBe(ia.worldId)
    await hold(c.page, 'd', 500)
    await sleep(1000)
    expect(await drawn(c.page)).toEqual([])
    expect((await drawn(a.page)).map(p => p.id)).toEqual([ib.userId])
    expect((await drawn(b.page)).map(p => p.id)).toEqual([ia.userId])
    await expect(status(c.page)).toHaveText('Online · only you here')

    // B goes into their house: gone from the town for A. A follows in: B is there.
    await enterHouse(b.page, 'house-b')
    await expect.poll(() => drawn(a.page)).toEqual([])
    await enterHouse(a.page, 'house-b')
    const bInside = await feet(b.page)
    await expect.poll(() => drawn(a.page, 'InteriorScene')).toEqual([expect.objectContaining({ id: ib.userId, x: bInside.x, y: bInside.y })])
    await hold(b.page, 'a', 400)
    const bMoved = await feet(b.page)
    await expect.poll(async () => (await drawn(a.page, 'InteriorScene'))[0]).toMatchObject({ x: bMoved.x, y: bMoved.y })
  } finally {
    await a.browser.close()
    await b.browser.close()
    await c.browser.close()
  }
})
