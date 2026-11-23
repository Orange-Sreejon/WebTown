// Shared steps for the two-player tests. The game instance is found through React's internal fiber on the game
// container (test-only; nothing is added to the app for it), as in tests/e2e.
import { chromium, firefox, expect } from '@playwright/test'

export const EMULATOR = 'http://127.0.0.1:54399'
export const BASE = 'http://127.0.0.1:5181'

/** A separate browser with its own storage: a different guest. ase: the app under test. */
export async function launchPlayer(kind, base = BASE) {
  const browser = await (kind === 'firefox' ? firefox : chromium).launch()
  // Small: every page renders the game in software WebGL on one machine.
  const context = await browser.newContext({ viewport: { width: 960, height: 600 }, baseURL: base })
  const page = await context.newPage()
  page.on('pageerror', e => console.log(`[${kind}] page error: ${e.message}`))
  return { browser, context, page, kind }
}

export async function waitForTown(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="application"]')
    if (!el) return false
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    for (let f = el[key]; f; f = f.return) {
      for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
        const v = h.memoizedState
        if (v && v.current && v.current.scene && typeof v.current.scene.getScene === 'function') {
          window.__wtGame = v.current
          const town = v.current.scene.getScene('TownScene')
          return v.current.scene.isActive('TownScene') && !!town?.player
        }
      }
    }
    return false
  }, null, { timeout: 240_000 })
}

export const status = page => page.getByTestId('mp-status')

/** The signed-in player, as the app holds it. */
export const me = page => page.evaluate(async () => {
  const { activeCloud } = await import('/src/cloud/cloud-session.ts')
  const p = activeCloud()?.player
  return p ? { userId: p.userId, name: p.profile.displayName, worldId: p.world.id, ownedSlot: p.ownedSlot } : null
})

/** The other players drawn in a scene right now. */
export const drawn = (page, scene = 'TownScene') => page.evaluate(key => {
  const s = window.__wtGame?.scene.getScene(key)
  const r = s?.remotes
  if (!r) return []
  return [...r.byId.entries()].filter(([, p]) => p.visible).map(([id, p]) => ({
    id, name: p.label.text, x: Math.round(p.feetX * 10) / 10, y: Math.round(p.feetY * 10) / 10,
    anim: p.sprite.anims.currentAnim?.key ?? null, texture: p.sprite.texture.key,
  }))
}, scene)

/** Runs oot while the games in others sleep (see joinWithLink). */
export async function quietly(others, boot) {
  for (const o of others) await o.page.evaluate(() => window.__wtGame?.loop.sleep())
  try {
    return await boot()
  } finally {
    for (const o of others) await o.page.evaluate(() => window.__wtGame?.loop.wake())
  }
}

/** Opens WebTown as a new guest and waits until the town and the live session are up. */
export async function startGuest(player, path = '/', others = []) {
  await quietly(others, async () => {
    await player.page.goto(path, { waitUntil: 'commit' })
    await waitForTown(player.page)
  })
  await expect(status(player.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
}

/** The owner creates an invitation in the town window and closes it; returns the code. */
export async function createInvite(page) {
  await page.getByRole('button', { name: /^Town: / }).click()
  await page.getByRole('button', { name: 'Create invitation' }).click()
  const code = (await page.getByTestId('invite-code').textContent()).trim()
  await page.getByRole('button', { name: 'Close' }).first().click()
  return code
}

/**
 * Opens the invitation link as a new guest and joins. While the new page boots, the games already running in
 * others stop drawing (their game loop sleeps; timers and the live session keep running), so the boot is not
 * starved of CPU. Test set-up only.
 */
export async function joinWithLink(player, code, others = []) {
  await quietly(others, () => joinWithLinkNow(player, code))
}

async function joinWithLinkNow(player, code) {
  await player.page.goto(`/?invite=${code}`, { waitUntil: 'commit' })
  await player.page.getByRole('button', { name: 'Join', exact: true }).click({ timeout: 300_000 })
  await waitForTown(player.page)
  await expect(status(player.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
}

export const emulator = async (path, body) => {
  const res = await fetch(`${EMULATOR}${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)
  return res.json()
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** The local player's feet in the active scene. */
export const feet = page => page.evaluate(() => {
  const g = window.__wtGame
  const s = g.scene.isActive('InteriorScene') ? g.scene.getScene('InteriorScene') : g.scene.getScene('TownScene')
  const f = s.player.feet
  return { x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10 }
})

/** Holds a movement key with the real keyboard, then waits until the player has come to rest. */
export async function hold(page, key, ms) {
  await page.keyboard.down(key)
  await sleep(ms)
  await page.keyboard.up(key)
  await atRest(page)
}

/** Waits until the local player has stopped moving. */
export async function atRest(page) {
  let before = await feet(page)
  for (;;) {
    await sleep(150)
    const now = await feet(page)
    if (now.x === before.x && now.y === before.y) return
    before = now
  }
}

/** Puts the player somewhere open in the town (test set-up only; walking is done with the keyboard). */
export const placeInTown = (page, x, y) => page.evaluate(([x, y]) => {
  window.__wtGame.scene.getScene('TownScene').player.placeFeet(x, y)
}, [x, y])

/** Walks in through the front door of a house: placed at the door, then a real E. */
export async function enterHouse(page, slot) {
  await page.evaluate(async id => {
    const { buildEntrances } = await import('/src/game/systems/interaction.ts')
    const { HOUSES } = await import('/src/game/config/houses.ts')
    const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
    const e = buildEntrances(HOUSES, STRUCTURES).find(x => x.id === id)
    window.__wtGame.scene.getScene('TownScene').player.placeFeet(e.fallbackFeet.x, e.fallbackFeet.y)
  }, slot)
  await page.waitForFunction(id => window.__wtGame.scene.getScene('TownScene').nearby?.id === id, slot, { timeout: 30_000 })
  await page.keyboard.press('e')
  await page.waitForFunction(() => {
    const g = window.__wtGame
    const i = g.scene.getScene('InteriorScene')
    return g.scene.isActive('InteriorScene') && i?.player && i.definition && !i.lock.isBusy
  }, null, { timeout: 60_000 })
  await sleep(600)
}

/** Records where `id` is drawn on every animation frame for `ms`: [{t, x, anim}]. */
export const trace = (page, id, ms, scene = 'TownScene') => page.evaluate(([id, ms, key]) => new Promise(resolve => {
  const out = []
  const start = performance.now()
  const tick = () => {
    const p = window.__wtGame.scene.getScene(key).remotes?.byId.get(id)
    if (p?.visible) out.push({ t: performance.now() - start, x: p.feetX, y: p.feetY, anim: p.sprite.anims.currentAnim?.key ?? null })
    if (performance.now() - start < ms) requestAnimationFrame(tick)
    else resolve(out)
  }
  requestAnimationFrame(tick)
}), [id, ms, scene])
/** Every notice (toast) the page shows from now on, kept even after it fades. */
export async function recordToasts(page) {
  await page.evaluate(() => {
    if (window.__toasts) return
    window.__toasts = []
    const seen = new WeakSet()
    const scan = () => {
      for (const el of document.querySelectorAll('.mp-toast')) {
        if (seen.has(el)) continue
        seen.add(el)
        window.__toasts.push(el.textContent)
      }
    }
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
    scan()
  })
}
export const toasts = page => page.evaluate(() => window.__toasts ?? [])
/**
 * Holds a movement key until the player has walked `distance` px along `axis` (at most `maxMs`), then waits until
 * they are at rest. Returns how long the key was held. A slow machine draws fewer frames, so a fixed hold time
 * would cover a varying distance.
 */
export async function walkUntil(page, key, axis, distance, maxMs = 20_000) {
  const start = (await feet(page))[axis]
  const t0 = Date.now()
  await page.keyboard.down(key)
  try {
    while (Math.abs((await feet(page))[axis] - start) < distance && Date.now() - t0 < maxMs) await sleep(50)
  } finally {
    await page.keyboard.up(key)
  }
  const held = Date.now() - t0
  await atRest(page)
  return held
}

/** Starts recording where `id` is drawn on every animation frame; `stopTrace` returns [{t, x, y, anim}]. */
export const startTrace = (page, id, scene = 'TownScene') => page.evaluate(([id, key]) => {
  window.__trace = []
  window.__traceStop = false
  const start = performance.now()
  const tick = () => {
    const p = window.__wtGame.scene.getScene(key).remotes?.byId.get(id)
    if (p?.visible) window.__trace.push({ t: performance.now() - start, x: p.feetX, y: p.feetY, anim: p.sprite.anims.currentAnim?.key ?? null })
    if (!window.__traceStop) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}, [id, scene])
export const stopTrace = page => page.evaluate(() => {
  window.__traceStop = true
  return window.__trace
})
/**
 * Every emote bubble the page draws from now on: [{ over: player id or 'me', text }]. Bubbles last 2.5 s, which a
 * slow machine can miss between two checks; this records them as they are made (test-only wrapper).
 */
export async function recordBubbles(page) {
  await page.evaluate(async () => {
    if (window.__bubbles) return
    window.__bubbles = []
    const { RemotePlayer } = await import('/src/game/entities/RemotePlayer.ts')
    const { RemotePlayers } = await import('/src/game/entities/RemotePlayers.ts')
    const say = RemotePlayer.prototype.say
    RemotePlayer.prototype.say = function (text, ms) {
      const players = window.__wtGame.scene.getScenes(true).map(s => s.remotes).find(r => r)
      const id = players ? [...players.byId.entries()].find(([, p]) => p === this)?.[0] : undefined
      window.__bubbles.push({ over: id ?? '?', text })
      return say.call(this, text, ms)
    }
    const sayLocal = RemotePlayers.prototype.sayLocal
    RemotePlayers.prototype.sayLocal = function (text) {
      window.__bubbles.push({ over: 'me', text })
      return sayLocal.call(this, text)
    }
  })
}
export const bubbles = page => page.evaluate(() => window.__bubbles ?? [])