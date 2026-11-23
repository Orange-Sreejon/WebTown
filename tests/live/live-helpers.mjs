// Helpers for the live multiplayer tests (a REAL Supabase test project). Two kinds:
//
// - Node clients (supabase-js, the same client the app uses) acting as extra test guests: anonymous sign-in,
//   database functions, direct table requests and Realtime channels. Each `makeGuest` is ONE anonymous sign-in;
//   the guest's display name starts with `LT <run>` so live-test data is easy to recognise in the project.
// - In-page probes for the browsers: the connection status over time, broadcasts as they arrive, and closing the
//   page's Realtime WebSocket (supabase-js then reconnects, as after a dropped connection).
//
// Nothing here deletes anything, prints a key or a token, or talks to anything but the configured test project.
import { createClient } from '@supabase/supabase-js'
import './live-env.mjs'

export const URL_ = process.env.WEBTOWN_LIVE_SUPABASE_URL ?? ''
export const KEY = process.env.WEBTOWN_LIVE_SUPABASE_KEY ?? ''
/** Short id of this run, in every test guest's name. */
export const RUN = Date.now().toString(36).slice(-6)

// ── Node test guests ────────────────────────────────────────────────────────────────────────────────────────

/** A database function's error, with its SQLSTATE (`42501`, `22023`, `WTINV`, `WTEXP`, `WTFUL`...). */
export class RpcError extends Error {
  constructor(fn, error) {
    super(`${fn}: ${error.code ?? '?'} ${error.message ?? ''}`)
    this.code = error.code
  }
}

/** Calls a database function as this client's user; throws `RpcError`. */
export async function rpc(client, fn, args = {}) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new RpcError(fn, error)
  return data
}

/** The SQLSTATE a call was refused with; fails the test if it was not refused. */
export async function refusal(promise) {
  try {
    await promise
  } catch (error) {
    if (error instanceof RpcError) return error.code
    throw error
  }
  throw new Error('expected the database to refuse this call')
}

/**
 * A new anonymous test guest with a profile, personal world and house (`bootstrap_player`), named `LT <run> <label>`.
 * One anonymous sign-in.
 */
export async function makeGuest(label) {
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInAnonymously()
  if (error) {
    const hint = error.status === 429 ? ' (rate limited: raise "anonymous sign-ins per hour" in the test project)' : ''
    throw new Error(`anonymous sign-in for test guest "${label}" failed: ${error.code ?? error.status ?? ''} ${error.message}${hint}`)
  }
  const name = `LT ${RUN} ${label}`
  const boot = await rpc(client, 'bootstrap_player', { p_display_name: name })
  return { client, label, name, id: data.user.id, worldId: boot.world.id }
}

/**
 * Subscribes to a Realtime channel and waits for the first outcome: `SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`,
 * `CLOSED` or `no answer` (30 s). Broadcasts of `events` arriving afterwards are collected in `received`, and every
 * status supabase-js reports, including after its own automatic retries, in `history`.
 */
export function subscribe(client, topic, { isPrivate = true, events = [], presenceKey } = {}) {
  const received = []
  const history = []
  const config = { private: isPrivate, broadcast: { self: false, ack: false }, ...(presenceKey ? { presence: { key: presenceKey } } : {}) }
  const channel = client.channel(topic, { config })
  for (const event of events) channel.on('broadcast', { event }, m => received.push({ event, payload: m.payload }))
  return new Promise(resolve => {
    let done = false
    const finish = (status, message = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ channel, status, message, received, history })
    }
    const timer = setTimeout(() => finish('no answer'), 30_000)
    channel.subscribe((s, err) => {
      history.push({ status: s, message: err?.message ?? '' })
      if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') finish(s, err?.message ?? '')
    })
  })
}

/** An authorization refusal, by meaning rather than exact wording (the same rule as src/cloud/supabase-backend.ts). */
const AUTHORIZATION_REFUSAL = /unauthori[sz]ed|permission|not allowed|forbidden|denied/i

/**
 * What a subscription attempt that should be refused actually showed, after watching it `watchMs` longer (so an
 * automatic retry that succeeds is caught):
 * - `joined`: it got in at some point. A security failure.
 * - `refused`: the first outcome was CHANNEL_ERROR with an authorization-related reason, and it never got in.
 * - `inconclusive`: it never got in, but the backend gave no authorization-related reason (a timeout, a close, or an
 *   error that does not say why). Not proof of a refusal.
 */
export async function classifyRefusal(result, watchMs = 3000) {
  await new Promise(r => setTimeout(r, watchMs))
  const seen = result.history.map(h => h.status).join(' > ') || result.status
  if (result.status === 'SUBSCRIBED' || result.history.some(h => h.status === 'SUBSCRIBED')) return { verdict: 'joined', detail: `statuses: ${seen}` }
  if (result.status === 'CHANNEL_ERROR' && AUTHORIZATION_REFUSAL.test(result.message)) return { verdict: 'refused', detail: `statuses: ${seen}` }
  return { verdict: 'inconclusive', detail: `statuses: ${seen}; reason: ${JSON.stringify(result.message)}` }
}

/** Leaves a channel (Realtime only; nothing in the database). */
export async function unsubscribe(client, channel) {
  await client.removeChannel(channel).catch(() => undefined)
}

// ── In-page probes ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Installed with `context.addInitScript` before the app loads, so it runs on every load of the page:
 * - keeps every WebSocket the page opens (to close the Realtime one later);
 * - records each change of the multiplayer status line (`data-status`) in `window.__statuses`.
 */
export const PAGE_PROBES = () => {
  const Native = window.WebSocket
  const sockets = []
  window.__sockets = sockets
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args)
      sockets.push(this)
    }
  }
  window.__statuses = []
  const record = () => {
    const s = document.querySelector('[data-testid="mp-status"]')?.getAttribute('data-status') ?? null
    if (window.__statuses[window.__statuses.length - 1] !== s) window.__statuses.push(s)
  }
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] })
    record()
  })
}

/** The status line's values so far on this page load, in order (null: no status line). */
export const statuses = page => page.evaluate(() => window.__statuses ?? [])

/**
 * Closes the page's Realtime WebSocket(s) from the browser side, as a dropped connection would; supabase-js sees an
 * unexpected close and reconnects on its own. Other sockets (Vite's dev server) are left alone. Returns how many.
 */
export const dropRealtimeSockets = page => page.evaluate(() => {
  let n = 0
  for (const s of window.__sockets ?? []) {
    if (String(s.url).includes('/realtime/v1/websocket') && s.readyState === 1) {
      s.close(4000, 'live test: simulated connection drop')
      n++
    }
  }
  return n
})

/** This page's multiplayer session id (the presence key), as other players see it. */
export const sessionIdOf = page => page.evaluate(async () => (await import('/src/lib/multiplayer-link.ts')).multiplayerLink()?.o.sessionId ?? null)

/** How many incoming messages this page's session has refused so far. */
export const droppedCount = page => page.evaluate(async () => (await import('/src/lib/multiplayer-link.ts')).multiplayerLink()?.dropped ?? null)

/**
 * Starts logging every broadcast this page's session receives ({ t, event, s }) in `window.__arrivals`. Must be called
 * again after a reload (a new session).
 */
export const logArrivals = page => page.evaluate(async () => {
  const link = (await import('/src/lib/multiplayer-link.ts')).multiplayerLink()
  if (!link || link.__logged) return
  link.__logged = true
  window.__arrivals = []
  const original = link.onBroadcast
  link.onBroadcast = function (event, payload) {
    window.__arrivals.push({ t: performance.now(), event, s: payload && typeof payload === 'object' ? payload.s : null })
    return original.call(this, event, payload)
  }
})
export const arrivals = page => page.evaluate(() => window.__arrivals ?? [])

/** Renames the signed-in player (`update_profile`, as the account window does). */
export const renameIn = (page, name) => page.evaluate(async name => {
  const { activeCloud } = await import('/src/cloud/cloud-session.ts')
  await activeCloud().backend.rpc('update_profile', { p_display_name: name, p_avatar: null, p_settings: null })
}, name)

/** The "Q: Wave to <name>" prompt in the town, or null. */
export const wavePrompt = page => page.evaluate(() => {
  const p = window.__wtGame.scene.getScene('TownScene').remotes?.prompt
  return p?.isVisible ? p.label.text : null
})

/** The look the app would draw for a user with this stored avatar (the same rule as the game). */
export const expectedTexture = (page, avatar, userId) => page.evaluate(async ([avatar, userId]) => {
  const { avatarFor, avatarTexture } = await import('/src/game/systems/avatars.ts')
  return avatarTexture(avatarFor(avatar, userId))
}, [avatar, userId])
