// M2: two different guests (Chromium and Firefox, separate storage) join one world with an invitation and see
// each other with the right names; a dropped connection and leaving are reflected, without duplicates.
import { test, expect } from '@playwright/test'
import { createInvite, drawn, emulator, joinWithLink, launchPlayer, me, recordToasts, startGuest, status, toasts } from './helpers.mjs'

test('invitation, presence with names, disconnect and reconnect, leaving', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  try {
    await startGuest(a)
    await expect(status(a.page)).toHaveText('Online · only you here')
    const code = await createInvite(a.page)
    await recordToasts(a.page)

    await joinWithLink(b, code, [a])
    const [ia, ib] = [await me(a.page), await me(b.page)]
    expect(ib.worldId).toBe(ia.worldId)
    expect(ib.userId).not.toBe(ia.userId)
    expect(ib.ownedSlot).toBe('house-b')

    await expect(status(a.page)).toHaveText('Online · 2 players')
    await expect(status(b.page)).toHaveText('Online · 2 players')
    await expect.poll(() => toasts(a.page)).toContain(`${ib.name} joined`)
    await expect.poll(() => drawn(a.page)).toEqual([expect.objectContaining({ id: ib.userId, name: ib.name })])
    await expect.poll(() => drawn(b.page)).toEqual([expect.objectContaining({ id: ia.userId, name: ia.name })])
    const topic = `world:${ia.worldId}`
    expect(await emulator(`/__test/subscribers?topic=${encodeURIComponent(topic)}`)).toHaveLength(2)

    // The six looks exist, and each recolours a part of the sheet (hat and shirt), not all of it.
    const looks = await a.page.evaluate(() => {
      const g = window.__wtGame
      const pixels = key => {
        const src = g.textures.get(key).getSourceImage()
        const c = document.createElement('canvas')
        c.width = src.width
        c.height = src.height
        const ctx = c.getContext('2d')
        ctx.drawImage(src, 0, 0)
        return ctx.getImageData(0, 0, c.width, c.height).data
      }
      const base = pixels('traveller')
      let opaque = 0
      for (let i = 3; i < base.length; i += 4) if (base[i] > 0) opaque++
      return ['traveller-1', 'traveller-2', 'traveller-3', 'traveller-4', 'traveller-5'].map(key => {
        const v = pixels(key)
        let changed = 0
        for (let i = 0; i < base.length; i += 4) if (v[i] !== base[i] || v[i + 1] !== base[i + 1] || v[i + 2] !== base[i + 2]) changed++
        return changed / opaque
      })
    })
    for (const share of looks) {
      expect(share).toBeGreaterThan(0.03)
      expect(share).toBeLessThan(0.5)
    }

    // B's network drops for a few seconds: A sees B go, B reconnects, A sees B again, once.
    await emulator('/__test/drop', { userId: ib.userId, blockMs: 4000 })
    await expect(status(b.page)).toHaveAttribute('data-status', 'reconnecting')
    await expect.poll(() => drawn(a.page), { timeout: 15_000 }).toEqual([])
    await expect.poll(() => toasts(a.page)).toContain(`${ib.name} left`)
    await expect(status(b.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
    await expect.poll(() => drawn(a.page)).toEqual([expect.objectContaining({ id: ib.userId, name: ib.name })])
    await expect.poll(() => drawn(b.page)).toEqual([expect.objectContaining({ id: ia.userId })])
    await expect.poll(async () => (await emulator(`/__test/subscribers?topic=${encodeURIComponent(topic)}`)).length).toBe(2)

    // B closes the browser: gone for A.
    await b.context.close()
    await expect.poll(() => drawn(a.page), { timeout: 15_000 }).toEqual([])
    await expect(status(a.page)).toHaveText('Online · only you here')
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
