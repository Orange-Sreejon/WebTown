// M4: two guests (Chromium and Firefox). Standing close shows "Q: Wave to <name>"; a real Q waves and the other
// sees it with a notice; the button waves back; out of range the wave is refused with feedback; a forged wave
// sent straight over the channel from far away is relayed by the server but ignored by the receiver; emotes show
// above the sender.
import { test, expect } from '@playwright/test'
import { bubbles, createInvite, drawn, emulator, joinWithLink, launchPlayer, me, placeInTown, recordBubbles, recordToasts, sleep, startGuest, toasts } from './helpers.mjs'

const prompt = page => page.evaluate(() => {
  const p = window.__wtGame.scene.getScene('TownScene').remotes?.prompt
  return p?.isVisible ? p.label.text : null
})
const emotesFrom = async userId => (await emulator('/__test/stats')).broadcasts.filter(m => m.user === userId && m.event === 'em').length

test('waving and emotes, with range checked on both ends', async () => {
  const a = await launchPlayer('chromium')
  const b = await launchPlayer('firefox')
  try {
    await startGuest(a)
    await joinWithLink(b, await createInvite(a.page), [a])
    const [ia, ib] = [await me(a.page), await me(b.page)]
    await recordToasts(a.page)
    await recordToasts(b.page)
    await recordBubbles(a.page)
    await recordBubbles(b.page)

    // Side by side.
    await placeInTown(a.page, 600, 520)
    await placeInTown(b.page, 630, 520)
    await expect.poll(async () => (await drawn(a.page))[0]?.x).toBe(630)
    await expect.poll(async () => (await drawn(b.page))[0]?.x).toBe(600)
    await expect.poll(() => prompt(a.page)).toBe(`Q: Wave to ${ib.name}`)

    // A real Q.
    await a.page.keyboard.press('q')
    await expect.poll(() => toasts(b.page)).toContain(`${ia.name} waved at you`)
    await expect.poll(() => bubbles(b.page)).toContainEqual({ over: ia.userId, text: '👋 Hi!' })
    await expect.poll(() => bubbles(a.page)).toContainEqual({ over: 'me', text: '👋 Hi!' })

    // B waves back with the button.
    await sleep(1100)
    await b.page.getByRole('button', { name: /Wave/ }).click()
    await expect.poll(() => toasts(a.page)).toContain(`${ib.name} waved at you`)

    // Far apart: no prompt, and Q is refused with a reason; nothing is sent.
    await placeInTown(b.page, 900, 520)
    await expect.poll(async () => (await drawn(a.page))[0]?.x).toBe(900)
    await expect.poll(() => prompt(a.page)).toBeNull()
    await sleep(1100)
    const sentBefore = await emotesFrom(ia.userId)
    await a.page.keyboard.press('q')
    await expect.poll(() => toasts(a.page)).toContain('No one is close enough to wave to.')
    await sleep(500)
    expect(await emotesFrom(ia.userId)).toBe(sentBefore)

    // A modified client sends a wave aimed at B from far away, straight over the channel.
    const bSession = await b.page.evaluate(async () => (await import('/src/lib/multiplayer-link.ts')).multiplayerLink().o.sessionId)
    await a.page.evaluate(async to => {
      const link = (await import('/src/lib/multiplayer-link.ts')).multiplayerLink()
      link.channel.send('em', { v: 1, s: link.o.sessionId, q: 1_000_000, e: 'wave', to })
    }, bSession)
    await expect.poll(() => emotesFrom(ia.userId)).toBe(sentBefore + 1) // the server relayed it...
    await sleep(1000)
    expect((await toasts(b.page)).filter(t => t === `${ia.name} waved at you`)).toHaveLength(1) // ...and B ignored it
    expect(await b.page.evaluate(async () => (await import('/src/lib/multiplayer-link.ts')).multiplayerLink().dropped)).toBeGreaterThan(0)

    // An emote from the bar: everyone sees it above A, at any distance.
    await sleep(1100)
    await a.page.getByRole('button', { name: 'Heart' }).click()
    await expect.poll(() => bubbles(b.page)).toContainEqual({ over: ia.userId, text: '❤' })
  } finally {
    await a.browser.close()
    await b.browser.close()
  }
})
