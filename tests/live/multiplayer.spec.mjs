// Phase 5 against a REAL Supabase test project (Phase 5.1). Skipped unless WEBTOWN_LIVE=1 with the project's URL and
// publishable key (environment or .env.live.local; see playwright.config.mjs and docs/MULTIPLAYER.md).
//
// Runs once, in the chromium project: the tests make their own clients and launch their own Chromium and Firefox.
// Three groups, each in order (a failure skips the rest of its group, so a problem is reported once):
//
//   1. Invitations, membership and permissions: eight Node test guests (supabase-js) and one test world, against
//      the real database functions, RLS and the Realtime channel policies.
//   2. Two players in two browsers (Chromium owner, Firefox resident): presence, names, looks, movement in four
//      directions, houses, refresh, dropped connections, closing and reopening, waving, emotes, forged and malformed
//      messages, a burst of messages, switching towns, leaving and rejoining.
//   3. An expired invitation (needs the one-time preparation in expired-invite.mjs).
//
// Every test guest is named `LT <run> ...`. Nothing is deleted. Anonymous sign-ins per run: 8 Node guests + 2
// browsers = 10 (group 3 reuses a group-1 guest).
import { test, expect } from '@playwright/test'
import './live-env.mjs'
import {
  createInvite, drawn, feet, joinWithLink, launchPlayer, me, placeInTown, quietly, recordBubbles, bubbles,
  recordToasts, toasts, sleep, startGuest, startTrace, status, stopTrace, waitForTown, walkUntil, enterHouse,
} from '../multiplayer/helpers.mjs'
import {
  KEY, PAGE_PROBES, RUN, URL_, arrivals, classifyRefusal, droppedCount, dropRealtimeSockets, expectedTexture, logArrivals, makeGuest,
  refusal, renameIn, rpc, sessionIdOf, statuses, subscribe, unsubscribe, wavePrompt,
} from './live-helpers.mjs'
import { EXPIRED_INVITE_FILE, readExpiredInvite } from './expired-invite.mjs'

const LIVE = process.env.WEBTOWN_LIVE === '1'
const APP = 'http://127.0.0.1:5190'
test.skip(!LIVE || !URL_ || !KEY, 'Set WEBTOWN_LIVE=1, WEBTOWN_LIVE_SUPABASE_URL and WEBTOWN_LIVE_SUPABASE_KEY to run against a test project.')

const topic = world => `world:${world}`
const onlyChromium = ({ browserName }) => browserName !== 'chromium'
const ONCE = 'Runs once, in the chromium project (it makes its own clients and browsers).'

/** The eight Node test guests, made on first use (so a skipped project signs in nobody). */
let guests = null
async function users() {
  if (!guests) {
    console.log(`[live] run ${RUN}: creating 8 test guests named "LT ${RUN} ..."`)
    const g = {}
    for (const label of ['owner', 'r1', 'r2', 'stranger', 'f1', 'f2', 'f3', 'f4']) g[label] = await makeGuest(label)
    guests = g
  }
  return guests
}
test.afterAll(async () => {
  for (const g of Object.values(guests ?? {})) await g.client.removeAllChannels().catch(() => undefined)
})

const members = async (client, world) => (await rpc(client, 'list_world_members', { p_world: world })).map(m => m.userId)

/**
 * A channel join that must be refused. Getting in at any point fails the test. A refusal without an
 * authorization-related reason is recorded in `inconclusive`, and `endInconclusive` then reports the test as
 * skipped with "INCONCLUSIVE", never as passed.
 */
function expectRefused(label, verdict, inconclusive) {
  expect(verdict.verdict, `${label}: a non-member must never join the channel (${verdict.detail})`).not.toBe('joined')
  if (verdict.verdict === 'inconclusive') {
    inconclusive.push(`${label}: ${verdict.detail}`)
    test.info().annotations.push({ type: 'inconclusive', description: `${label}: ${verdict.detail}` })
  }
}
const endInconclusive = inconclusive =>
  test.skip(inconclusive.length > 0, `INCONCLUSIVE (not a pass): no authorization-related refusal from the backend. ${inconclusive.join(' | ')}`)

// ── 1. Invitations, membership and permissions ─────────────────────────────────────────────────────────────

test.describe('live 1: invitations, membership and permissions (real database)', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 })
  test.skip(onlyChromium, ONCE)
  let u
  let W
  let J // the invitation residents join with

  test('1.1 an unknown invitation code is refused, by preview and by join', async () => {
    u = await users()
    W = u.owner.worldId
    for (const code of ['AAAA-BBBB-CCCC', 'short', "x'; select 1; --", '']) {
      expect(await refusal(rpc(u.stranger.client, 'preview_world_invite', { p_code: code })), code).toBe('WTINV')
    }
    expect(await refusal(rpc(u.stranger.client, 'join_world', { p_code: 'AAAA-BBBB-CCCC' }))).toBe('WTINV')
    expect(await refusal(rpc(u.stranger.client, 'enter_world', { p_world: W }))).toBe('42501')
  })

  test('1.2 a revoked invitation is refused, and only the owner can revoke', async () => {
    const R = await rpc(u.owner.client, 'create_world_invite', { p_world: W, p_days: 1 })
    expect(R.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(await refusal(rpc(u.stranger.client, 'revoke_world_invite', { p_invite: R.id }))).toBe('42501')
    expect((await rpc(u.stranger.client, 'preview_world_invite', { p_code: R.code })).worldId).toBe(W)
    await rpc(u.owner.client, 'revoke_world_invite', { p_invite: R.id })
    expect(await refusal(rpc(u.stranger.client, 'preview_world_invite', { p_code: R.code }))).toBe('WTINV')
    expect(await refusal(rpc(u.stranger.client, 'join_world', { p_code: R.code }))).toBe('WTINV')
    const listed = await rpc(u.owner.client, 'list_world_invites', { p_world: W })
    expect(listed.find(i => i.id === R.id)).toMatchObject({ revoked: true, uses: 0 })
    expect(JSON.stringify(listed)).not.toContain(R.code)
  })

  test('1.3 joining makes a resident with a free house; joining twice changes nothing', async () => {
    J = await rpc(u.owner.client, 'create_world_invite', { p_world: W, p_days: 1 })
    const preview = await rpc(u.r1.client, 'preview_world_invite', { p_code: J.code })
    expect(preview).toMatchObject({ worldId: W, ownerName: u.owner.name, members: 1, max: 7, alreadyMember: false })
    expect(await rpc(u.r1.client, 'join_world', { p_code: J.code })).toEqual({ worldId: W, joined: true })
    expect(await rpc(u.r1.client, 'join_world', { p_code: J.code })).toEqual({ worldId: W, joined: false })
    expect(await rpc(u.owner.client, 'join_world', { p_code: J.code })).toEqual({ worldId: W, joined: false })
    const list = await rpc(u.owner.client, 'list_world_members', { p_world: W })
    expect(list.filter(m => m.userId === u.r1.id)).toEqual([expect.objectContaining({ role: 'resident', displayName: u.r1.name })])
    expect(list.find(m => m.userId === u.r1.id).slot).toMatch(/^house-[a-g]$/)
    expect(list).toHaveLength(2)
    const ctx = await rpc(u.r1.client, 'enter_world', { p_world: W })
    expect(ctx.world).toMatchObject({ id: W, role: 'resident' })
    expect(ctx.houses.filter(h => h.ownerId === u.r1.id)).toHaveLength(1)
    const mine = await rpc(u.r1.client, 'list_my_worlds')
    expect(mine.map(w => [w.id, w.role])).toEqual(expect.arrayContaining([[u.r1.worldId, 'owner'], [W, 'resident']]))
    expect((await rpc(u.r1.client, 'list_world_invites', { p_world: W }).catch(e => e)).code).toBe('42501')
    expect((await rpc(u.owner.client, 'list_world_invites', { p_world: W })).find(i => i.id === J.id).uses).toBe(1)
  })

  test('1.4 a resident cannot do what only the owner may, nor change memberships or invitations directly', async () => {
    const r1 = u.r1.client
    expect(await refusal(rpc(r1, 'create_world_invite', { p_world: W, p_days: 1 }))).toBe('42501')
    expect(await refusal(rpc(r1, 'revoke_world_invite', { p_invite: J.id }))).toBe('42501')
    expect(await refusal(rpc(r1, 'remove_world_member', { p_world: W, p_user: u.owner.id }))).toBe('42501')
    expect(await refusal(rpc(u.stranger.client, 'remove_world_member', { p_world: W, p_user: u.r1.id }))).toBe('42501')

    // Straight at the tables, as any client could: refused by the grants (no write privileges at all).
    const denied = async (what, request) => {
      const { error } = await request
      expect(error?.code, what).toBe('42501')
    }
    await denied('insert a membership', r1.from('world_members').insert({ world_id: W, user_id: u.stranger.id, role: 'resident' }))
    await denied('promote yourself', r1.from('world_members').update({ role: 'owner' }).eq('world_id', W).eq('user_id', u.r1.id))
    await denied('remove the owner', r1.from('world_members').delete().eq('world_id', W).eq('user_id', u.owner.id))
    await denied('take a house', r1.from('houses').update({ owner_id: u.r1.id }).eq('world_id', W))
    await denied('read invitations', r1.from('world_invites').select('*'))
    await denied('make an invitation', r1.from('world_invites').insert({ world_id: W, code_hash: '0'.repeat(64), hint: 'AAAA', created_by: u.r1.id, expires_at: new Date(Date.now() + 864e5).toISOString() }))
    await denied('un-revoke or extend', r1.from('world_invites').update({ revoked_at: null }).eq('world_id', W))
    // Renaming someone else's world: allowed column, but RLS matches no row.
    const { data: renamed, error: renameError } = await r1.from('worlds').update({ name: `LT ${RUN} hijacked` }).eq('id', W).select()
    expect(renameError).toBeNull()
    expect(renamed).toEqual([])
    // A stranger sees nothing of the world at all.
    expect((await u.stranger.client.from('world_members').select('*').eq('world_id', W)).data).toEqual([])
    expect((await u.stranger.client.from('worlds').select('*').eq('id', W)).data).toEqual([])

    // Nothing changed.
    expect((await u.owner.client.from('worlds').select('name').eq('id', W)).data).toEqual([{ name: 'My WebTown' }])
    expect(await members(u.owner.client, W)).toEqual([u.owner.id, u.r1.id])
    expect(await rpc(u.stranger.client, 'preview_world_invite', { p_code: J.code })).toMatchObject({ worldId: W, members: 2 })
  })

  test('1.5 the world channel is for members only, and a non-member hears nothing of it', async () => {
    const ownerSub = await subscribe(u.owner.client, topic(W), { events: ['lt'] })
    expect(ownerSub.status, ownerSub.message).toBe('SUBSCRIBED')
    const r1Sub = await subscribe(u.r1.client, topic(W), { events: ['lt'] })
    expect(r1Sub.status, r1Sub.message).toBe('SUBSCRIBED')

    const inconclusive = []
    // The stranger's attempt stays open while members broadcast, so a later automatic retry that got in would show.
    const refused = await subscribe(u.stranger.client, topic(W), { events: ['lt'] })
    expect(refused.status, `a non-member must not join (${refused.message})`).not.toBe('SUBSCRIBED')
    console.log(`[live] non-member on the private channel: ${refused.status} ${JSON.stringify(refused.message)}`)
    // The same topic as a PUBLIC channel, by another non-member (f2 joins W only in 1.8; supabase-js reuses a
    // channel per topic, so it can't be the stranger): either refused (public access off), or a separate channel.
    const publicTry = await subscribe(u.f2.client, topic(W), { isPrivate: false, events: ['lt'] })
    console.log(`[live] non-member on the public channel of the same name: ${publicTry.status}`)
    if (publicTry.status !== 'SUBSCRIBED' && publicTry.status !== 'CHANNEL_ERROR') {
      inconclusive.push(`public channel of the same name: ${publicTry.status}`)
      test.info().annotations.push({ type: 'inconclusive', description: `public channel of the same name: ${publicTry.status}` })
    }
    // The stranger's own world: allowed (control: the stranger's client and token work).
    const own = await subscribe(u.stranger.client, topic(u.stranger.worldId), { events: ['lt'] })
    expect(own.status, own.message).toBe('SUBSCRIBED')

    for (let i = 1; i <= 3; i++) await r1Sub.channel.send({ type: 'broadcast', event: 'lt', payload: { run: RUN, i } })
    await expect.poll(() => ownerSub.received.length, { timeout: 20_000 }).toBe(3)
    expectRefused('non-member on the private world channel', await classifyRefusal(refused), inconclusive)
    expect(refused.received).toEqual([])
    expect(publicTry.received).toEqual([])
    expect(own.received).toEqual([])

    for (const [g, s] of [[u.owner, ownerSub], [u.r1, r1Sub], [u.stranger, refused], [u.f2, publicTry], [u.stranger, own]]) await unsubscribe(g.client, s.channel)
    endInconclusive(inconclusive)
  })

  test('1.6 a resident can leave: access ends (database and channel); a valid invitation brings them back', async () => {
    expect(await rpc(u.r2.client, 'join_world', { p_code: J.code })).toEqual({ worldId: W, joined: true })
    await rpc(u.r2.client, 'leave_world', { p_world: W })
    expect(await refusal(rpc(u.r2.client, 'enter_world', { p_world: W }))).toBe('42501')
    expect(await members(u.owner.client, W)).not.toContain(u.r2.id)
    const inconclusive = []
    const sub = await subscribe(u.r2.client, topic(W))
    expectRefused('resident who left, on the private world channel', await classifyRefusal(sub), inconclusive)
    await unsubscribe(u.r2.client, sub.channel)
    expect(await refusal(rpc(u.owner.client, 'leave_world', { p_world: W }))).toBe('22023')
    // Rejoining.
    expect(await rpc(u.r2.client, 'join_world', { p_code: J.code })).toEqual({ worldId: W, joined: true })
    expect(await members(u.owner.client, W)).toContain(u.r2.id)
    endInconclusive(inconclusive)
  })

  test('1.7 the owner removes a resident, who loses access; the owner cannot remove themselves', async () => {
    await rpc(u.owner.client, 'remove_world_member', { p_world: W, p_user: u.r2.id })
    expect(await refusal(rpc(u.r2.client, 'enter_world', { p_world: W }))).toBe('42501')
    expect(await members(u.owner.client, W)).toEqual([u.owner.id, u.r1.id])
    const inconclusive = []
    const sub = await subscribe(u.r2.client, topic(W))
    expectRefused('removed resident, on the private world channel', await classifyRefusal(sub), inconclusive)
    await unsubscribe(u.r2.client, sub.channel)
    expect(await refusal(rpc(u.owner.client, 'remove_world_member', { p_world: W, p_user: u.owner.id }))).toBe('22023')
    expect(await refusal(rpc(u.owner.client, 'remove_world_member', { p_world: W, p_user: u.stranger.id }))).toBe('22023')
    endInconclusive(inconclusive)
  })

  test('1.8 a town holds 7 players; the 8th is refused', async () => {
    for (const g of [u.r2, u.f1, u.f2, u.f3, u.f4]) {
      expect(await rpc(g.client, 'join_world', { p_code: J.code }), g.label).toEqual({ worldId: W, joined: true })
    }
    expect(await members(u.owner.client, W)).toHaveLength(7)
    expect(await rpc(u.stranger.client, 'preview_world_invite', { p_code: J.code })).toMatchObject({ members: 7, max: 7, alreadyMember: false })
    expect(await refusal(rpc(u.stranger.client, 'join_world', { p_code: J.code }))).toBe('WTFUL')
    expect(await refusal(rpc(u.stranger.client, 'enter_world', { p_world: W }))).toBe('42501')
    expect(await members(u.owner.client, W)).toHaveLength(7)
    // Joining again as a member of a full town is still "nothing changes", not "full".
    expect(await rpc(u.r1.client, 'join_world', { p_code: J.code })).toEqual({ worldId: W, joined: false })
  })
})

// ── 2. Two players in two browsers ─────────────────────────────────────────────────────────────────────────

test.describe('live 2: two players in two browsers (Chromium owner, Firefox resident)', () => {
  test.describe.configure({ mode: 'serial', timeout: 900_000 })
  test.skip(onlyChromium, ONCE)
  let a
  let b
  let ia
  let ib
  let WA
  /** The Node member sending forged messages in 2.8 and 2.9: its presence key and channel. */
  let fSession
  let fChannel
  const A_NAME = `LT ${RUN} A`
  const B_NAME = `LT ${RUN} B`

  test.afterAll(async () => {
    await a?.browser.close().catch(() => undefined)
    await b?.browser.close().catch(() => undefined)
  })

  /** The players drawn in a scene, as [id, name] pairs (one entry per player, by construction). */
  const ids = async (page, scene) => (await drawn(page, scene)).map(p => p.id)
  /** Waits until `page` draws `id` exactly where `at` is, and still there a second later (no drift). */
  async function drawnStillAt(page, id, at, scene) {
    await expect.poll(async () => (await drawn(page, scene)).find(p => p.id === id), { timeout: 30_000 }).toMatchObject({ x: at.x, y: at.y })
    await sleep(1000)
    expect((await drawn(page, scene)).find(p => p.id === id)).toMatchObject({ x: at.x, y: at.y })
  }
  /** Every frame moves along `sign` (+1 right, -1 left), never back, never by a jump. */
  function expectSmooth(path, sign, label) {
    expect(path.length, `${label}: frames traced`).toBeGreaterThan(10)
    for (let i = 1; i < path.length; i++) {
      const step = sign * (path[i].x - path[i - 1].x)
      const dt = path[i].t - path[i - 1].t
      expect(step, `${label} frame ${i}: moved back ${(-step).toFixed(2)} px`).toBeGreaterThanOrEqual(-0.01)
      expect(step, `${label} frame ${i}: jumped ${step.toFixed(1)} px in ${dt.toFixed(0)} ms`).toBeLessThanOrEqual(0.08 * dt * 2.5 + 3)
    }
  }
  /** Reloads a page while the other game sleeps, and waits for the town and the live session. */
  async function reload(player, others) {
    await quietly(others, async () => {
      await player.page.reload({ waitUntil: 'commit' })
      await waitForTown(player.page)
    })
    await expect(status(player.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
  }
  /** Opens the town window and clicks a button there; waits until the app is in another world, then the town. */
  async function townWindow(player, button, others) {
    const before = (await me(player.page)).worldId
    await player.page.getByRole('button', { name: /^Town: / }).click()
    await quietly(others, async () => {
      for (const name of [].concat(button)) await player.page.getByRole('button', { name, exact: true }).click()
      await expect.poll(async () => (await me(player.page))?.worldId ?? before, { timeout: 120_000 }).not.toBe(before)
      await waitForTown(player.page)
    })
    await expect(status(player.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
  }

  test('2.1 two guests join with an invitation and see each other, with the names from the database', async () => {
    a = await launchPlayer('chromium', APP)
    b = await launchPlayer('firefox', APP)
    await a.context.addInitScript(PAGE_PROBES)
    await b.context.addInitScript(PAGE_PROBES)
    await startGuest(a)
    ia = await me(a.page)
    WA = ia.worldId
    await renameIn(a.page, A_NAME)
    await expect(status(a.page)).toHaveText('Online · only you here')
    const code = await createInvite(a.page)
    await joinWithLink(b, code, [a])
    ib = await me(b.page)
    expect(ib.worldId).toBe(WA)
    expect(ib.userId).not.toBe(ia.userId)
    expect(ib.ownedSlot).toMatch(/^house-[b-g]$/)
    await expect(status(a.page)).toHaveText('Online · 2 players')
    await expect(status(b.page)).toHaveText('Online · 2 players')
    await expect.poll(() => drawn(b.page)).toEqual([expect.objectContaining({ id: ia.userId, name: A_NAME })])
    await expect.poll(() => drawn(a.page)).toEqual([expect.objectContaining({ id: ib.userId, name: ib.name })])
    // Their looks: what the stored profile says (here the default, picked from the user id).
    expect((await drawn(a.page))[0].texture).toBe(await expectedTexture(a.page, 'villager', ib.userId))
    expect((await drawn(b.page))[0].texture).toBe(await expectedTexture(b.page, 'villager', ia.userId))
  })

  test('2.2 walking in four directions: smooth, never backwards, stops without drift, at most 10 updates a second', async () => {
    await placeInTown(b.page, 560, 520)
    await placeInTown(a.page, 640, 520)
    await drawnStillAt(a.page, ib.userId, await feet(b.page))
    await logArrivals(a.page)
    const bSession = await sessionIdOf(b.page)

    // Right, traced on every frame, with B's sends counted where they arrive.
    const before = (await arrivals(a.page)).length
    await startTrace(a.page, ib.userId)
    const heldMs = await walkUntil(b.page, 'd', 'x', 100)
    const right = await feet(b.page)
    await sleep(1500)
    expectSmooth(await stopTrace(a.page), +1, 'right')
    await drawnStillAt(a.page, ib.userId, right)
    const sent = (await arrivals(a.page)).slice(before).filter(m => m.event === 'mv' && m.s === bSession).length
    console.log(`[live] B sent ${sent} moves in ${heldMs} ms of walking`)
    expect(sent).toBeGreaterThanOrEqual(2)
    expect(sent).toBeLessThanOrEqual(Math.ceil(heldMs / 100) + 3)

    // Left, traced too.
    await startTrace(a.page, ib.userId)
    await walkUntil(b.page, 'a', 'x', 40)
    const left = await feet(b.page)
    await sleep(1500)
    expectSmooth(await stopTrace(a.page), -1, 'left')
    expect(right.x - left.x).toBeGreaterThan(20)
    await drawnStillAt(a.page, ib.userId, left)

    // Up and down.
    for (const [key, sign] of [['w', -1], ['s', +1]]) {
      const start = await feet(b.page)
      await walkUntil(b.page, key, 'y', 30)
      const at = await feet(b.page)
      expect(sign * (at.y - start.y), `walked ${key}`).toBeGreaterThan(15)
      await drawnStillAt(a.page, ib.userId, at)
    }

    // And the other way round: A walks, B sees it.
    await walkUntil(a.page, 's', 'y', 40)
    await drawnStillAt(b.page, ia.userId, await feet(a.page))
  })

  test('2.3 houses: a player inside is seen only inside, by players in the same house', async () => {
    await enterHouse(b.page, ib.ownedSlot)
    await expect.poll(() => ids(a.page)).toEqual([])
    await enterHouse(a.page, ib.ownedSlot)
    await drawnStillAt(a.page, ib.userId, await feet(b.page), 'InteriorScene')
    await walkUntil(b.page, 'a', 'x', 20)
    await drawnStillAt(a.page, ib.userId, await feet(b.page), 'InteriorScene')
    // Back to the town for the next tests (a reload starts in the town).
    await reload(a, [b])
    await reload(b, [a])
    await expect.poll(() => ids(a.page)).toEqual([ib.userId])
  })

  test('2.4 refreshing, three times, never shows the player twice; a new name shows after a reconnect', async () => {
    await renameIn(b.page, B_NAME)
    for (let i = 0; i < 3; i++) {
      await reload(b, [a])
      await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([ib.userId])
      await expect(status(a.page)).toHaveText('Online · 2 players')
    }
    expect((await me(b.page)).userId).toBe(ib.userId) // the same guest: a refresh signs nobody in
    await expect.poll(async () => (await drawn(a.page))[0]?.name, { timeout: 30_000 }).toBe(B_NAME)
  })

  test('2.5 dropped connections (closed by the test, three times) reconnect, once, at the right place', async () => {
    for (let i = 1; i <= 3; i++) {
      const from = (await statuses(b.page)).length
      expect(await dropRealtimeSockets(b.page), `drop ${i}: an open Realtime socket`).toBeGreaterThan(0)
      await expect.poll(async () => {
        const seen = (await statuses(b.page)).slice(from)
        const k = seen.indexOf('reconnecting')
        return k >= 0 && seen.indexOf('joined', k) > k
      }, { timeout: 90_000, message: `drop ${i}: B should show Reconnecting, then Online` }).toBe(true)
      await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([ib.userId])
    }
    console.log(`[live] B's status line during the drops: ${JSON.stringify(await statuses(b.page))}`)
    await walkUntil(b.page, 'd', 'x', 30)
    await drawnStillAt(a.page, ib.userId, await feet(b.page))
    await expect(status(a.page)).toHaveText('Online · 2 players')
    await expect(status(b.page)).toHaveText('Online · 2 players')
  })

  test('2.6 closing the browser removes the player; reopening it is the same guest, back in the same town', async () => {
    const state = await b.context.storageState()
    await b.context.close()
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([])
    await expect(status(a.page)).toHaveText('Online · only you here')

    b.context = await b.browser.newContext({ storageState: state, viewport: { width: 960, height: 600 }, baseURL: APP })
    await b.context.addInitScript(PAGE_PROBES)
    b.page = await b.context.newPage()
    b.page.on('pageerror', e => console.log(`[firefox] page error: ${e.message}`))
    await quietly([a], async () => {
      await b.page.goto('/', { waitUntil: 'commit' })
      await waitForTown(b.page)
    })
    await expect(status(b.page)).toHaveAttribute('data-status', 'joined', { timeout: 60_000 })
    const again = await me(b.page)
    expect(again.userId).toBe(ib.userId)
    expect(again.worldId).toBe(WA)
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([ib.userId])
  })

  test('2.7 waving: the prompt only in range; Q and the button both wave; out of range is refused; emotes', async () => {
    await recordToasts(a.page)
    await recordToasts(b.page)
    await recordBubbles(a.page)
    await recordBubbles(b.page)
    await placeInTown(a.page, 600, 520)
    await placeInTown(b.page, 630, 520)
    await drawnStillAt(a.page, ib.userId, await feet(b.page))
    await drawnStillAt(b.page, ia.userId, await feet(a.page))
    await expect.poll(() => wavePrompt(a.page)).toBe(`Q: Wave to ${B_NAME}`)

    await a.page.keyboard.press('q')
    await expect.poll(() => toasts(b.page)).toContain(`${A_NAME} waved at you`)
    await expect.poll(() => bubbles(b.page)).toContainEqual({ over: ia.userId, text: '👋 Hi!' })
    await expect.poll(() => bubbles(a.page)).toContainEqual({ over: 'me', text: '👋 Hi!' })

    await sleep(1100) // one emote a second per player
    await b.page.getByRole('button', { name: /Wave/ }).click()
    await expect.poll(() => toasts(a.page)).toContain(`${B_NAME} waved at you`)

    // Far apart: no prompt; Q is refused with a reason, and nothing reaches B.
    await placeInTown(b.page, 900, 520)
    await drawnStillAt(a.page, ib.userId, await feet(b.page))
    await expect.poll(() => wavePrompt(a.page)).toBeNull()
    await sleep(1100)
    const wavesAtB = (await toasts(b.page)).length
    await a.page.keyboard.press('q')
    await expect.poll(() => toasts(a.page)).toContain('No one is close enough to wave to.')
    await sleep(3000)
    expect((await toasts(b.page)).length).toBe(wavesAtB)

    // An emote shows above A for B, at any distance.
    await a.page.getByRole('button', { name: 'Heart' }).click()
    await expect.poll(() => bubbles(b.page)).toContainEqual({ over: ia.userId, text: '❤' })
  })

  test('2.8 a member sending forged names, non-member presence, malformed, oversized, out-of-bounds, teleporting, stale and forged-wave messages changes nothing', async () => {
    const u = await users()
    const f = u.f1
    expect((await rpc(f.client, 'join_world', { p_code: await createInvite(a.page) })).worldId).toBe(WA)
    await logArrivals(a.page)
    await recordToasts(a.page)
    const aSession = await sessionIdOf(a.page)
    fSession = crypto.randomUUID()
    const sub = await subscribe(f.client, topic(WA), { presenceKey: fSession })
    expect(sub.status, sub.message).toBe('SUBSCRIBED')
    const ch = (fChannel = sub.channel)

    // Presence claiming to be a non-member: ignored.
    await ch.track({ v: 1, s: fSession, u: u.stranger.id, j: Date.now(), q: 0, sc: 'town', x: 300, y: 300, f: 'down' })
    await sleep(7000) // long enough for A to reload its member list once
    expect(await ids(a.page)).toEqual([ib.userId])
    // Its own id, with a forged name and look: drawn with the database's name and look.
    await ch.track({ v: 1, s: fSession, u: f.id, j: Date.now(), q: 0, sc: 'town', x: 300, y: 300, f: 'down', name: 'Forged Name', displayName: 'Forged', avatar: 'traveller-3' })
    await expect.poll(async () => (await drawn(a.page)).find(p => p.id === f.id), { timeout: 30_000 }).toMatchObject({ name: f.name, x: 300, y: 300 })
    expect((await drawn(a.page)).find(p => p.id === f.id).texture).toBe(await expectedTexture(a.page, 'villager', f.id))

    const dropped0 = await droppedCount(a.page)
    const mark = (await arrivals(a.page)).length
    const send = async (event, payload) => {
      await ch.send({ type: 'broadcast', event, payload })
      await sleep(150) // keep them in order
    }
    const mv = (q, x, extra = {}) => ({ v: 1, s: fSession, q, t: q * 100, sc: 'town', x, y: 300, f: 'down', w: 0, ...extra })
    await send('mv', mv(1, 304)) // accepted
    await send('mv', mv(2, 704)) // 400 px in 100 ms: too fast
    await send('mv', mv(1, 306)) // stale sequence
    await send('mv', mv(3, 304, { f: 'sideways' })) // malformed
    await send('mv', mv(4, 99999)) // outside the map
    await send('mv', mv(5, 304, { pad: 'x'.repeat(600) })) // oversized
    await send('mv', { v: 1, junk: 'garbage' }) // malformed object (no session, nothing else)
    await send('em', { v: 1, s: fSession, q: 6, e: 'explode' }) // unknown emote
    await send('em', { v: 1, s: fSession, q: 7, e: 'wave', to: aSession }) // a wave aimed at A from ~300 px away
    await send('mv', { ...mv(8, 304), s: crypto.randomUUID() }) // a session that is not here
    await expect.poll(async () => (await arrivals(a.page)).slice(mark).length, { timeout: 20_000, message: 'all 10 messages should reach A' }).toBeGreaterThanOrEqual(10)
    await sleep(2500) // the unknown session's move waits up to 2 s for a presence that never comes

    expect((await droppedCount(a.page)) - dropped0).toBe(8)
    expect((await drawn(a.page)).find(p => p.id === f.id)).toMatchObject({ x: 304, y: 300, name: f.name })
    expect((await ids(a.page)).sort()).toEqual([ib.userId, f.id].sort())
    expect(await toasts(a.page)).not.toContain(`${f.name} waved at you`)
    await expect(status(a.page)).toHaveAttribute('data-status', 'joined')
  })

  test('2.9 a burst of 60 messages from one member is cut down by the receiver, and nothing breaks', async () => {
    const f = (await users()).f1
    const ch = fChannel
    expect(ch, 'the channel from 2.8').toBeTruthy()
    await sleep(2000) // the receiver's allowance refills
    const from = (await arrivals(a.page)).length
    const dropped0 = await droppedCount(a.page)
    // One burst, same spot, valid and in order: only the rate is wrong.
    await Promise.all(Array.from({ length: 60 }, (_, i) => ch.send({ type: 'broadcast', event: 'mv', payload: { v: 1, s: fSession, q: 100 + i, t: 10_000 + i, sc: 'town', x: 304, y: 300, f: 'down', w: 0 } })))
    let count = -1
    await expect.poll(async () => {
      const n = (await arrivals(a.page)).slice(from).filter(m => m.s === fSession).length
      const settled = n === count
      count = n
      return settled && n > 0
    }, { timeout: 30_000, intervals: [1000] }).toBe(true)
    const got = (await arrivals(a.page)).slice(from).filter(m => m.s === fSession)
    const windowS = (got[got.length - 1].t - got[0].t) / 1000
    const refused = (await droppedCount(a.page)) - dropped0
    const accepted = got.length - refused
    console.log(`[live] burst: Supabase delivered ${got.length} of 60 within ${windowS.toFixed(2)} s; A accepted ${accepted}, refused ${refused}`)
    expect(accepted).toBeLessThanOrEqual(30 + 20 * windowS + 1)
    // Otherwise the limit was never exercised (Supabase delivered too few, or too slowly): that is not a pass.
    expect(refused, `the burst must exceed what the receiver allows (delivered ${got.length} in ${windowS.toFixed(2)} s)`).toBeGreaterThan(0)
    await expect(status(a.page)).toHaveAttribute('data-status', 'joined')
    await expect(status(b.page)).toHaveAttribute('data-status', 'joined')

    // The member leaves the channel: gone for A.
    await ch.untrack().catch(() => undefined)
    await unsubscribe(f.client, ch)
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([ib.userId])
  })

  test('2.10 switching towns and leaving: the player goes, other worlds stay apart, rejoining brings them back once', async () => {
    // To B's own town: A and B no longer see each other.
    await townWindow(b, 'Go to My WebTown', [a])
    expect((await me(b.page)).worldId).not.toBe(WA)
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([])
    await expect(status(b.page)).toHaveText('Online · only you here')
    expect(await ids(b.page)).toEqual([])
    // And back.
    await townWindow(b, 'Go to My WebTown', [a])
    expect((await me(b.page)).worldId).toBe(WA)
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([ib.userId])

    // Leaving from the town window.
    await townWindow(b, ['Leave this town', 'Leave and delete my house there'], [a])
    expect((await me(b.page)).worldId).not.toBe(WA)
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([])
    await expect(status(a.page)).toHaveText('Online · only you here')

    // Rejoining with a new invitation: once, as the same guest.
    await joinWithLink(b, await createInvite(a.page), [a])
    const back = await me(b.page)
    expect(back).toMatchObject({ userId: ib.userId, worldId: WA })
    await expect.poll(() => ids(a.page), { timeout: 30_000 }).toEqual([ib.userId])
    await expect(status(a.page)).toHaveText('Online · 2 players')
  })
})

// ── 3. An expired invitation ───────────────────────────────────────────────────────────────────────────────

test.describe('live 3: an expired invitation', () => {
  test.skip(onlyChromium, ONCE)

  test('3.1 an expired invitation is refused, by preview and by join', async () => {
    const inv = readExpiredInvite()
    test.skip(!inv, `Not prepared: run "node tests/live/expired-invite.mjs", then the SQL it prints, in the test project (creates ${EXPIRED_INVITE_FILE}).`)
    const u = await users()
    let preview
    try {
      preview = await rpc(u.stranger.client, 'preview_world_invite', { p_code: inv.code })
    } catch (error) {
      expect(error.code, error.message).toBe('WTEXP')
    }
    // Never join with an invitation that still works: that would add the stranger to the prepared world.
    expect(preview, `invitation ${inv.id} is not expired yet: run the SQL printed by node tests/live/expired-invite.mjs`).toBeUndefined()
    expect(await refusal(rpc(u.stranger.client, 'join_world', { p_code: inv.code }))).toBe('WTEXP')
    expect(await refusal(rpc(u.stranger.client, 'enter_world', { p_world: inv.worldId }))).toBe('42501')
  })
})
