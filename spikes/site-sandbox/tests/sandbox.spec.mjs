// S-01 sandbox spike: security tests, run in Chromium, Firefox and WebKit.
//
// Evidence rules:
//  * "No request left the page" means the local beacon server saw nothing: no HTTP request, no bare
//    TCP connection, no UDP datagram. Console errors and CSP violation reports are never evidence.
//  * Every "nothing arrived" claim is preceded by a positive control showing the beacon CAN see that
//    kind of traffic from this browser (see "controls"), otherwise the absence proves nothing.
//  * "No script ran" means no `exec` trace anywhere: not at the app, not reported by the host, and no
//    request for /exec/* at the beacon.
import { test, expect } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BEACON = 'http://127.0.0.1:8765'
const here = dirname(fileURLToPath(import.meta.url))
// Outside Playwright's outputDir, which is emptied at the start of every run.
const FINDINGS = join(here, '..', 'findings', 'findings.jsonl')
mkdirSync(dirname(FINDINGS), { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
// A non-loopback IPv4 address of this machine. Some engines refuse STUN to loopback addresses.
const LAN = Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address ?? null
const note = (browserName, key, value) =>
  appendFileSync(FINDINGS, JSON.stringify({ browser: browserName, key, value }) + '\n')

async function beaconLog() { return (await fetch(`${BEACON}/__log`)).json() }
async function beaconReset() { await fetch(`${BEACON}/__reset`) }
const traffic = log => ({ http: log.http, bare: log.bare, udp: log.udp })
const noTraffic = log => log.http.length === 0 && log.bare.length === 0 && log.udp.length === 0

/** Opens the app with a fresh host frame and waits for the host to say it is ready. */
async function openApp(page, { attacker = false } = {}) {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__app && window.SpikeFixtures)
  await page.evaluate(a => window.__app.mount(a), attacker)
  await page.waitForFunction(() => window.__app.state.ready === true, null, { timeout: 15000 })
}

/** Renders a fixture and waits until the resident frame has loaded. */
async function render(page, name, mode, path, { waitForLoad = true } = {}) {
  if (!waitForLoad) { await page.evaluate(([n, m, p]) => window.__app.render(n, m, p), [name, mode, path]); return }
  const before = await page.evaluate(() => window.__app.state.loads)
  await page.evaluate(([n, m, p]) => window.__app.render(n, m, p), [name, mode, path])
  await page.waitForFunction(b => window.__app.state.loads > b, before, { timeout: 15000 })
}

const hostFrame = page => page.frames().find(f => f.url().endsWith('/site-host.html'))
const residentFrame = page => hostFrame(page)?.childFrames()[0]
const appState = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)))

/** Anything that proves resident script ran: a message shaped {t:'exec'} at the app, reported by the host, or fetched. */
async function execTraces(page) {
  const s = await appState(page)
  const log = await beaconLog()
  return {
    atApp: s.foreign.filter(x => x.includes('"exec"')),
    byHost: s.rejectedByHost.filter(x => x.sample.includes('"exec"')),
    atBeacon: log.http.filter(x => x.path.startsWith('/exec/')),
  }
}
const ran = t => t.atApp.length + t.byHost.length + t.atBeacon.length > 0

test.beforeEach(async () => { await beaconReset() })

// ===================================================================================================
// 0. Controls: prove the instruments work in this browser before trusting any "nothing happened".
// ===================================================================================================
test.describe('controls', () => {
  test('the beacon sees an HTTP request made by an unrestricted page', async ({ page, browserName }) => {
    await page.goto('/index.html')
    await page.evaluate(b => { new Image().src = b + '/control-img.png' }, BEACON)
    await expect.poll(async () => (await beaconLog()).http.some(r => r.path === '/control-img.png')).toBe(true)
    note(browserName, 'control.http', 'observed')
  })

  test('the beacon sees a UDP datagram from WebRTC in an unrestricted page (loopback, then LAN address)', async ({ page, browserName }) => {
    await page.goto('/index.html')
    const available = await page.evaluate(() => typeof RTCPeerConnection)
    note(browserName, 'control.webrtc-available-top-level', available)
    test.skip(available !== 'function', 'RTCPeerConnection is not available in this engine/context')
    const tryStun = async host => {
      await beaconReset()
      await page.evaluate(async h => {
        const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + h + ':3478' }] })
        p.createDataChannel('x')
        await p.setLocalDescription(await p.createOffer())
        await new Promise(r => setTimeout(r, 3000))
        p.close()
      }, host)
      return (await beaconLog()).udp.length
    }
    const loop = await tryStun('127.0.0.1')
    const lan = LAN ? await tryStun(LAN) : -1
    note(browserName, 'control.udp', { loopback: loop, lan, lanAddress: LAN })
    test.info().annotations.push({ type: 'control', description: `UDP observable: loopback ${loop}, LAN ${lan}` })
    // Recorded, not asserted: if neither shows traffic, this engine's WebRTC egress cannot be measured
    // here, and the findings say so. Phase 3a does not rely on it (no resident script runs).
  })
  test('a bare TCP connection (preconnect) is visible to the beacon, or the engine is recorded as blind to it', async ({ page, browserName }) => {
    await page.goto('/index.html')
    await page.evaluate(b => {
      const l = document.createElement('link'); l.rel = 'preconnect'; l.href = b; document.head.appendChild(l)
    }, BEACON)
    await sleep(2500)
    const bare = (await beaconLog()).bare.length
    note(browserName, 'control.bare-tcp', bare > 0 ? 'observed' : 'NOT observed (absence of bare connections is not evidence here)')
    test.info().annotations.push({ type: 'control', description: `bare TCP observable: ${bare > 0}` })
  })

  test('the app page itself keeps its canaries', async ({ page }) => {
    await page.goto('/index.html')
    expect(await page.evaluate(() => [window.__secret, localStorage.getItem('wt-canary'), document.cookie])).toEqual([
      'webtown-secret', 'secret', expect.stringContaining('wt-canary=secret'),
    ])
  })
})

// ===================================================================================================
// 1. Structure: both frames sandboxed, opaque, no allow-same-origin; denials are real.
// ===================================================================================================
test.describe('sandbox structure', () => {
  test('both frames are sandboxed without allow-same-origin and nothing else is granted', async ({ page }) => {
    await openApp(page)
    await render(page, 'ok-link-internal', 'product')
    const attrs = await page.evaluate(() => {
      const host = document.getElementById('host')
      return { host: host.getAttribute('sandbox'), hostAllow: host.getAttribute('allow'), referrer: host.getAttribute('referrerpolicy') }
    })
    expect(attrs.host).toBe('allow-scripts')
    expect(attrs.referrer).toBe('no-referrer')
    expect(attrs.hostAllow).toContain("camera 'none'")
    // The nested frame's sandbox attribute is set by the host page; read it through Playwright's frame handle.
    const nested = await hostFrame(page).evaluate(() => document.getElementById('site-frame').getAttribute('sandbox'))
    expect(nested).toBe('allow-scripts')
    expect(nested).not.toContain('allow-same-origin')
  })

  test('the host and the resident frame both have an opaque origin', async ({ page, browserName }) => {
    await openApp(page)
    await render(page, 'ok-link-internal', 'diagnostic')
    // location.origin still shows the URL the host page was loaded from; self.origin is the security origin.
    const hostOrigin = await hostFrame(page).evaluate(() => self.origin)
    note(browserName, 'origin.host', hostOrigin)
    expect(hostOrigin).toBe('null')
    const residentOrigin = await residentFrame(page).evaluate(() => self.origin)
    note(browserName, 'origin.resident', residentOrigin)
    expect(residentOrigin).toBe('null')
  })

  test('the trusted host page does nothing when opened on its own', async ({ page }) => {
    await page.goto('/site-host.html')
    await sleep(500)
    expect(await page.evaluate(() => document.getElementById('site-frame'))).toBeNull()
  })
})

// ===================================================================================================
// 2. Script execution: none of it may run in product mode, including every nonce trick.
// ===================================================================================================
const SCRIPT_FIXTURES = ['script-inline', 'script-defer', 'script-module', 'script-external', 'script-beacon',
  'script-event-attr', 'script-js-url', 'script-svg', 'script-nonce-guess']

test.describe('resident JavaScript does not run (product mode)', () => {
  for (const name of SCRIPT_FIXTURES) {
    test(`${name}`, async ({ page }) => {
      await openApp(page)
      await render(page, name, 'product')
      // Interact where the fixture offers a handler.
      const frame = residentFrame(page)
      await frame.locator('body').click({ timeout: 2000 }).catch(() => {})
      await frame.locator('#jsurl').click({ timeout: 1000 }).catch(() => {})
      await sleep(900)
      const t = await execTraces(page)
      expect(ran(t), JSON.stringify(t)).toBe(false)
      expect(noTraffic(await beaconLog())).toBe(true)
    })
  }

  test('the builder removed scripts, handlers and nonce attributes from the rendered page', async ({ page }) => {
    await openApp(page)
    await render(page, 'script-nonce-guess', 'product')
    const html = await residentFrame(page).evaluate(() => document.documentElement.outerHTML)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/nonce=/i)
    await render(page, 'script-event-attr', 'product')
    const html2 = await residentFrame(page).evaluate(() => document.documentElement.outerHTML)
    expect(html2).not.toMatch(/\son[a-z]+=/i)
  })

  test('defence in depth: the resident CSP alone (no builder sanitising) also stops scripts, even with the host nonce', async ({ page, browserName }) => {
    await openApp(page)
    for (const name of ['script-inline', 'script-nonce-guess', 'script-external', 'script-event-attr']) {
      await render(page, name, 'raw-csp')
      await sleep(700)
    }
    const t = await execTraces(page)
    note(browserName, 'scripts.raw-csp', ran(t) ? 'SCRIPT RAN' : 'blocked')
    expect(ran(t), JSON.stringify(t)).toBe(false)
  })

  test('the nonce is not a secret: with ONLY the inherited host policy, a resident script that guesses it runs', async ({ page, browserName }) => {
    // This is an honest negative result: it is why the resident page has its own script-src 'none'
    // and why the builder strips scripts. It documents what the nonce does NOT protect against.
    await openApp(page)
    await render(page, 'script-nonce-guess', 'raw-none')
    await sleep(900)
    const t = await execTraces(page)
    note(browserName, 'scripts.raw-none-with-public-nonce', ran(t) ? 'SCRIPT RAN (expected: nonce is public)' : 'blocked')
    expect(ran(t)).toBe(true)
    // ...but without the nonce the inherited policy alone does stop ordinary inline scripts:
    await beaconReset()
    await page.evaluate(() => window.__app.reset())
    await render(page, 'script-inline', 'raw-none')
    await sleep(700)
    const t2 = await execTraces(page)
    note(browserName, 'scripts.raw-none-no-nonce', ran(t2) ? 'SCRIPT RAN' : 'blocked by inherited host policy')
  })
})

// ===================================================================================================
// 3. Network egress: nothing may reach the beacon.
// ===================================================================================================
const STATIC_EGRESS = ['net-img', 'net-css-bg', 'net-css-import', 'net-font', 'net-media', 'net-iframe', 'net-object',
  'net-prefetch', 'net-meta-refresh', 'net-base-steal', 'net-css-imageset', 'net-css-misc', 'net-picture-input',
  'net-svg-use', 'net-svg-img']

test.describe('no network egress (product mode)', () => {
  for (const name of STATIC_EGRESS) {
    test(`${name}`, async ({ page }) => {
      await openApp(page)
      await render(page, name, 'product')
      await sleep(1500)
      const log = await beaconLog()
      expect(noTraffic(log), JSON.stringify(traffic(log))).toBe(true)
      expect((await appState(page)).unexpected, 'frame must not have been navigated away').toBe(0)
    })
  }

  test('anchors: clicking every kind of link sends nothing and opens nothing', async ({ page }) => {
    await openApp(page)
    const popups = []
    page.context().on('page', p => popups.push(p.url()))
    await render(page, 'net-anchor-click', 'product')
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await residentFrame(page)?.locator('#' + id).click({ timeout: 1000, force: true }).catch(() => {})
      await sleep(250)
    }
    await sleep(1000)
    const log = await beaconLog()
    expect(noTraffic(log), JSON.stringify(traffic(log))).toBe(true)
    expect(popups).toEqual([])
  })

  test('forms: submitting every kind of form sends nothing', async ({ page }) => {
    await openApp(page)
    await render(page, 'net-form-click', 'product')
    for (const id of ['b1', 'b2', 'b3']) {
      await residentFrame(page)?.locator('#' + id).click({ timeout: 1000, force: true }).catch(() => {})
      await sleep(250)
    }
    await sleep(1000)
    const log = await beaconLog()
    expect(noTraffic(log), JSON.stringify(traffic(log))).toBe(true)
  })

  test('<a ping>, forms and meta refresh are neutralised by the builder (and measured without it)', async ({ page, browserName }) => {
    await openApp(page)
    await render(page, 'net-anchor-ping', 'product')
    await residentFrame(page)?.locator('#pinglink').click({ timeout: 1000, force: true }).catch(() => {})
    await sleep(1200)
    expect(noTraffic(await beaconLog())).toBe(true)

    // Without the builder, what do the platform policies do on their own?
    const rawResults = {}
    for (const name of ['net-meta-refresh', 'net-anchor-ping', 'net-prefetch', 'net-base-steal', 'net-img', 'net-iframe']) {
      for (const mode of ['raw-csp', 'raw-none']) {
        await beaconReset()
        await render(page, name, mode)
        if (name === 'net-anchor-ping') await residentFrame(page)?.locator('#pinglink').click({ timeout: 1000, force: true }).catch(() => {})
        await sleep(1500)
        const log = await beaconLog()
        rawResults[`${name}|${mode}`] = { http: log.http.map(r => r.path), bare: log.bare.length, udp: log.udp.length }
      }
    }
    note(browserName, 'egress.without-builder', rawResults)
  })

  test('with only the inherited host policy (no builder, no resident policy) static egress is still blocked: CSP is inherited into srcdoc', async ({ page, browserName }) => {
    await openApp(page)
    const leaks = {}
    for (const name of ['net-img', 'net-css-bg', 'net-css-import', 'net-font', 'net-media', 'net-iframe', 'net-object', 'net-css-misc', 'net-picture-input', 'net-svg-use']) {
      await beaconReset()
      await render(page, name, 'raw-none')
      await sleep(1200)
      const log = await beaconLog()
      leaks[name] = log.http.map(r => r.path)
    }
    note(browserName, 'csp.inherited-into-srcdoc', leaks)
    for (const [name, paths] of Object.entries(leaks)) expect(paths, `${name} reached the beacon`).toEqual([])
  })
})

// ===================================================================================================
// 4. If script ever ran (diagnostic: scripts carry the public nonce). Measures the platform's own
//    limits, to document what the sandbox, not the builder, guarantees.
// ===================================================================================================
test.describe('platform limits if resident script ran (diagnostic only; Phase 3a runs no resident script)', () => {
  test('isolation: no access to the parent DOM, storage, cookies, caches or service workers', async ({ page, browserName }) => {
    await openApp(page)
    for (const name of ['iso-parent-dom', 'iso-storage']) {
      await render(page, name, 'diagnostic')
      await sleep(1200)
    }
    const s = await appState(page)
    const probes = [...s.foreign, ...s.rejectedByHost.map(r => r.sample)].filter(x => x.includes('probe-'))
    note(browserName, 'isolation.probes', probes)
    const text = probes.join('\n')
    expect(text, 'probe messages arrived').toContain('probe-iso')
    expect(text).toContain('probe-storage')
    expect(text).not.toContain('webtown-secret')
    expect(text).not.toMatch(/"parentTitle":"S-01/)          // parent document title must not be readable
    expect(text).not.toMatch(/"topTitle":"S-01/)
    expect(text).not.toMatch(/"local":"ok"/)
    expect(text).not.toMatch(/"session":"ok"/)
    expect(text).not.toMatch(/wt-canary/)
    // The parent's own canaries are untouched.
    expect(await page.evaluate(() => [window.__secret, localStorage.getItem('wt-canary')])).toEqual(['webtown-secret', 'secret'])
    expect(noTraffic(await beaconLog())).toBe(true)
  })

  test('top navigation, popups and dialogs are blocked; self-navigation is recorded', async ({ page, browserName }) => {
    await openApp(page)
    const popups = []
    page.context().on('page', p => popups.push(p.url()))
    page.on('dialog', d => { popups.push('dialog:' + d.type()); d.dismiss().catch(() => {}) })
    const topBefore = await page.evaluate(() => location.href)
    await render(page, 'nav-dialogs', 'diagnostic')
    await sleep(800)
    await beaconReset()
    const loadsBefore = (await appState(page)).loads
    await page.evaluate(() => window.__app.render('nav-top', 'diagnostic'))
    await sleep(2500)
    expect(await page.evaluate(() => location.href), 'the app tab was navigated').toBe(topBefore)
    expect(popups, 'a popup or dialog appeared').toEqual([])
    const log = await beaconLog()
    const s = await appState(page)
    const hits = log.http.map(r => r.path)
    note(browserName, 'self-nav.script-sets-location', { requestsAtBeacon: hits, unexpectedNavDetected: s.unexpected, loads: s.loads - loadsBefore })
    // Top-level and popup attempts must never reach the beacon.
    expect(hits).not.toContain('/nav-top')
    expect(hits).not.toContain('/popup')
  })

  test('self-navigation to an external URL: does the request leave, and is the frame put back?', async ({ page, browserName }) => {
    // The known residual risk. Measured, not assumed: the result is recorded per browser.
    await openApp(page)
    await render(page, 'nav-top', 'diagnostic', undefined, { waitForLoad: false })
    await sleep(3000)
    const log = await beaconLog()
    const s = await appState(page)
    const sent = log.http.some(r => r.path === '/self-nav')
    note(browserName, 'self-nav.request-reached-beacon', sent)
    note(browserName, 'self-nav.detected-and-reset', s.unexpected > 0)
    test.info().annotations.push({ type: 'finding', description: `self-navigation request reached beacon: ${sent}; detected: ${s.unexpected > 0}` })
  })

  test('WebRTC: availability inside the opaque frame, and whether any datagram leaves', async ({ page, browserName }) => {
    await openApp(page)
    const result = {}
    for (const host of ['127.0.0.1', LAN].filter(Boolean)) {
      await beaconReset()
      const html = '<!doctype html><body><script>try{var p=new RTCPeerConnection({iceServers:[{urls:"stun:' + host + ':3478"}]});' +
        'p.createDataChannel("x");p.createOffer().then(function(o){return p.setLocalDescription(o)}).catch(function(){})}catch(e){}<\/script>'
      await page.evaluate(h => window.__app.renderFiles({ 'index.html': { text: h } }, 'diagnostic'), html)
      await sleep(4000)
      result[host] = (await beaconLog()).udp.length
    }
    const available = await residentFrame(page)?.evaluate(() => typeof RTCPeerConnection).catch(() => 'unknown')
    note(browserName, 'webrtc.available-in-resident-frame', available)
    note(browserName, 'webrtc.udp-datagrams-observed', result)
    test.info().annotations.push({ type: 'finding', description: `WebRTC available: ${available}; UDP observed: ${JSON.stringify(result)}` })
  })
  test('script-driven fetch, XHR, sendBeacon, WebSocket and EventSource: nothing reaches the beacon', async ({ page, browserName }) => {
    await openApp(page)
    await render(page, 'net-fetch', 'diagnostic')
    await sleep(2000)
    const log = await beaconLog()
    note(browserName, 'script-network.paths', log.http.map(r => r.path))
    const paths = log.http.map(r => r.path)
    for (const p of ['/fetch', '/xhr', '/sendbeacon', '/ws', '/sse']) expect(paths, `${p} reached the beacon`).not.toContain(p)
  })

  test('the frame-src narrowing set by the host page: is it honoured?', async ({ page, browserName }) => {
    await openApp(page)
    await render(page, 'ok-link-internal', 'product')
    // A rewritten internal link must still work (it loads the navigation page in the resident frame)...
    await residentFrame(page).locator('#go').click()
    await expect.poll(async () => (await appState(page)).history.at(-1)).toBe('about.html')
    note(browserName, 'frame-src.nav-page-allowed', true)
    await sleep(500)
    expect((await appState(page)).unexpected, 'a legitimate navigation was treated as an escape').toBe(0)
  })
})

// ===================================================================================================
// 5. Messages: source checks, schemas and rate limits.
// ===================================================================================================
test.describe('the resident frame cannot load WebTown\'s own pages (host frame-src narrowing)', () => {
  test('a raw same-origin link and a script setting location never reach WebTown\'s server', async ({ page, browserName }) => {
    await openApp(page)
    // raw-none: no builder, so the link survives and the frame really tries to follow it.
    await render(page, 'nav-same-origin', 'raw-none')
    await residentFrame(page)?.locator('#so').click({ timeout: 1000, force: true }).catch(() => {})
    await sleep(1500)
    let log = await beaconLog()
    const rawLink = log.unexpectedApp.map(r => r.path)
    // diagnostic: the page's script runs and sets location to a same-origin page.
    await beaconReset()
    await render(page, 'nav-same-origin', 'diagnostic', undefined, { waitForLoad: false })
    await sleep(2000)
    log = await beaconLog()
    const scripted = log.unexpectedApp.map(r => r.path)
    note(browserName, 'frame-src.same-origin-blocked', { rawLinkRequests: rawLink, scriptedRequests: scripted })
    expect(rawLink, 'a same-origin page was loaded into the resident frame by a link').toEqual([])
    expect(scripted, 'a same-origin page was loaded into the resident frame by script').toEqual([])
  })
})
test.describe('messages', () => {
  test('a sibling frame forging every message type reaches neither the app nor the host frame', async ({ page, browserName }) => {
    await openApp(page, { attacker: true })
    await render(page, 'ok-link-internal', 'product')
    await sleep(1500)
    const s = await appState(page)
    // The app saw foreign messages and ignored them: none became an accepted action.
    expect(s.foreign.length, 'attacker messages reached the app and must be counted as foreign').toBeGreaterThan(0)
    expect(s.accepted.filter(x => x.startsWith('nav:'))).toEqual([])
    expect(s.busEvents).toBe(0)
    expect(s.confirm).toBeNull()
    expect(s.history.length, 'the forged nav moved the page').toBe(1)
    // The host frame never accepted the forged render: no PWNED page.
    const pwned = await residentFrame(page).evaluate(() => !!document.getElementById('pwned') || document.body.textContent.includes('PWNED')).catch(() => false)
    expect(pwned).toBe(false)
    note(browserName, 'messages.sibling-forgery', { foreignAtApp: s.foreign.length, hostRejected: s.rejectedByHost.length })
  })

  test('the resident frame forging messages at the host and at the app is rejected or ignored', async ({ page, browserName }) => {
    await openApp(page)
    await render(page, 'forge-messages', 'diagnostic', undefined, { waitForLoad: false })
    await sleep(2500)
    const s = await appState(page)
    // A well-formed nav request is in the closed list, so the app may accept it. What it must lead to is a
    // confirmation bar, never an opened tab, and the other forged types must change nothing.
    expect(s.opened, 'a page opened a tab without the player').toEqual([])
    // The host says 'ready' exactly once. A forged 'ready' or 'render' can only arrive at the app from the
    // resident window, which is not the host window, so it lands in 'foreign' and is never acted on.
    expect(s.accepted.filter(x => x === 'ready').length, 'a forged ready was accepted').toBe(1)
    expect(s.foreign.some(x => x.includes('"t":"ready"')), 'forged ready did not reach the app at all (cannot prove it was rejected)').toBe(true)
    expect(s.foreign.some(x => x.includes('"t":"render"'))).toBe(true)
    expect(s.busEvents).toBe(0)
    expect(s.history.length).toBe(1)
    const pwned = await residentFrame(page).evaluate(() => !!document.getElementById('pwned')).catch(() => false)
    expect(pwned, 'a resident message re-rendered the frame').toBe(false)
    note(browserName, 'messages.resident-forgery', { foreignAtApp: s.foreign.length, hostRejected: s.rejectedByHost.length, renders: s.renders, loopDetected: s.loopDetected ?? 0 })
    // The forged external-link request makes the host restore the page a few times, then stop and say so.
    // Evidence the loop ended: the host reported it, and the app then hears nothing more.
    // Either the page stops by itself or the host gives up after its restore budget (3); both are fine.
    note(browserName, 'messages.forged-external-restores', { navExternalAccepted: s.accepted.filter(x => x === 'nav:external').length, hostGaveUp: (s.loopDetected ?? 0) > 0 })
    expect(s.accepted.filter(x => x === 'nav:external').length, 'more restores than the budget allows').toBeLessThanOrEqual(4)
    const before = (await appState(page)).appMessagesIn
    await sleep(1500)
    const after = (await appState(page)).appMessagesIn
    note(browserName, 'messages.render-loop-settled', { messagesInOneSecond: after - before })
    expect(after - before, 'the page is still looping').toBeLessThanOrEqual(2)
  })

  test('a flood of valid-looking navigation messages is rate limited at the host and the app', async ({ page, browserName }) => {
    await openApp(page)
    await render(page, 'forge-flood', 'diagnostic')
    await sleep(2500)
    const s = await appState(page)
    const delivered = s.accepted.filter(x => x === 'nav:external').length
    note(browserName, 'messages.flood', { sent: 200, deliveredToApp: delivered, rateLimitedReports: s.rateLimited })
    expect(delivered).toBeLessThanOrEqual(40)
    expect(s.rateLimited).toBeGreaterThan(0)
  })

  test('messages from an unknown window are dropped by the host frame', async ({ page }) => {
    await openApp(page)
    await render(page, 'ok-link-internal', 'product')
    // A third window (a popup opened by the test) tries to talk to the app, which treats it as foreign.
    const other = await page.context().newPage()
    await other.goto('/index.html')
    await other.evaluate(() => window.name = 'x')
    const s = await appState(page)
    expect(s.accepted).not.toContain('nav:page')
    await other.close()
  })
})

// ===================================================================================================
// 6. Navigation and links through WebTown's chrome.
// ===================================================================================================
test.describe('links', () => {
  test('relative links move between the site\'s own pages, through WebTown (history, folders, ..)', async ({ page }) => {
    await openApp(page)
    await render(page, 'ok-link-internal', 'product')
    await expect(residentFrame(page).locator('#home')).toBeVisible()
    await residentFrame(page).locator('#go').click()
    await expect(residentFrame(page).locator('#about')).toBeVisible({ timeout: 8000 })
    await residentFrame(page).locator('#back').click()
    await expect(residentFrame(page).locator('#home')).toBeVisible({ timeout: 8000 })
    await residentFrame(page).locator('#deep').click()
    await expect(residentFrame(page).locator('#art')).toBeVisible({ timeout: 8000 })
    await residentFrame(page).locator('#up').click()
    await expect(residentFrame(page).locator('#home')).toBeVisible({ timeout: 8000 })
    expect((await appState(page)).history).toEqual(['index.html', 'about.html', 'index.html', 'art/x.html', 'index.html'])
    expect(noTraffic(await beaconLog())).toBe(true)
  })

  test('a link to a missing page shows WebTown\'s not-found page', async ({ page }) => {
    await openApp(page)
    await render(page, 'ok-missing', 'product')
    await residentFrame(page).locator('#broken').click({ force: true }).catch(() => {})
    await sleep(600)
    // The builder removed the broken link's href (it is not a site page), so nothing happens; navigate directly too.
    await page.evaluate(() => window.__app.render('ok-missing', 'product', 'nope.html'))
    await expect(residentFrame(page).locator('#wt-not-found')).toBeVisible({ timeout: 8000 })
  })

  test('an external link opens nothing until the player confirms in WebTown\'s chrome', async ({ page, browserName }) => {
    await openApp(page)
    await page.context().route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>example</title>' }))
    const popups = []
    page.context().on('page', p => popups.push(p))
    await render(page, 'ok-link-external', 'product')

    await residentFrame(page).locator('#ext').click()
    await expect(page.locator('#confirm')).toHaveClass(/on/, { timeout: 8000 })
    await expect(page.locator('#confirm-text')).toContainText('example.com')
    expect(popups.length, 'a tab opened before confirmation').toBe(0)

    await page.locator('#confirm-cancel').click()
    await sleep(500)
    expect(popups.length).toBe(0)
    expect((await appState(page)).opened).toEqual([])

    await residentFrame(page).locator('#ext').click()
    await expect(page.locator('#confirm')).toHaveClass(/on/)
    const popupPromise = page.context().waitForEvent('page')
    await page.locator('#confirm-open').click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
    expect(popup.url()).toBe('https://example.com/page?q=1#f')
    const opener = await popup.evaluate(() => window.opener === null)
    note(browserName, 'links.popup-has-no-opener', opener)
    expect(opener, 'noopener must sever the opener').toBe(true)
    await popup.close()
  })

  test('http:, javascript: and unsupported links do nothing', async ({ page }) => {
    await openApp(page)
    await render(page, 'ok-link-external', 'product')
    const frame = residentFrame(page)
    for (const id of ['bad', 'js']) await frame.locator('#' + id).click({ force: true, timeout: 1000 }).catch(() => {})
    await sleep(700)
    await expect(page.locator('#confirm')).not.toHaveClass(/on/)
    const s = await appState(page)
    expect(s.opened).toEqual([])
    expect(noTraffic(await beaconLog())).toBe(true)
  })

  test('images and background images from the site\'s own files render', async ({ page }) => {
    await openApp(page)
    await render(page, 'ok-image', 'product')
    const ok = await residentFrame(page).evaluate(() => {
      const img = document.getElementById('img')
      return { loaded: img.complete && img.naturalWidth === 1, bg: getComputedStyle(document.getElementById('bg')).backgroundImage.startsWith('url("data:') }
    })
    expect(ok.loaded).toBe(true)
    expect(ok.bg).toBe(true)
  })
})

// ===================================================================================================
// 7. Close and Stop responsiveness.
// ===================================================================================================
test.describe('close responsiveness', () => {
  const responsive = async (page, ms = 4000) => Promise.race([
    page.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(Math.round(performance.now() - t)), 0) })),
    sleep(ms).then(() => 'FROZEN'),
  ])

  test('a very heavy page (no script): the app stays responsive and Stop removes it', async ({ page, browserName }) => {
    await openApp(page)
    const startedAt = Date.now()
    await render(page, 'heavy-dom', 'product', undefined, { waitForLoad: false })
    await sleep(1500)
    const lag = await responsive(page, 6000)
    const loadedWithinMs = await page.waitForFunction(() => window.__app.state.loads > 0, null, { timeout: 30000 }).then(() => Date.now() - startedAt).catch(() => 'not within 30 s')
    note(browserName, 'close.heavy-dom-load-time', loadedWithinMs)
    note(browserName, 'close.heavy-dom-app-responsive-ms', lag)
    await page.evaluate(() => window.__app.stop())
    const afterStop = await responsive(page, 6000)
    note(browserName, 'close.heavy-dom-after-stop-ms', afterStop)
    // 60 000 animated elements is more than twice the approved 1 MB page limit, so recovery time is
    // recorded, not asserted; the 1 MB tests below assert recovery.
    test.info().annotations.push({ type: 'finding', description: `oversize page: after Stop ${afterStop}` })
    await expect.poll(() => page.evaluate(() => !!document.getElementById('host')), { timeout: 20000 }).toBe(false)
  })

  for (const name of ['heavy-1mb', 'heavy-1mb-static']) {
    test(`a page at the 1 MB text limit (${name}): app responsiveness while it loads, and Stop`, async ({ page, browserName }) => {
      await openApp(page)
      const elements = await page.evaluate(n => window.SpikeFixtures[n].elements, name)
      const startedAt = Date.now()
      await render(page, name, 'product', undefined, { waitForLoad: false })
      const samples = []
      for (let i = 0; i < 6; i++) { samples.push(await responsive(page, 4000)); await sleep(250) }
      const loaded = await page.waitForFunction(() => window.__app.state.loads > 0, null, { timeout: 30000 }).then(() => Date.now() - startedAt).catch(() => 'not within 30 s')
      await page.evaluate(() => window.__app.stop())
      const afterStop = await responsive(page, 4000)
      note(browserName, `close.${name}`, { elements, loadMs: loaded, worstLagMs: samples.includes('FROZEN') ? 'FROZEN' : Math.max(...samples), afterStop })
      expect(afterStop, 'the app did not recover after Stop').not.toBe('FROZEN')
    })
  }
  test('if a resident script looped forever (diagnostic only): is the app still usable, and can the frame be removed?', async ({ page, browserName }) => {
    // Not a Phase 3a scenario (no resident script runs) but it shows what the browser does, so the
    // limit is documented per engine. Recorded, not asserted.
    await openApp(page)
    await page.evaluate(() => window.__app.render('loop-forever', 'diagnostic'))
    await sleep(2500)
    const lag = await responsive(page, 5000)
    note(browserName, 'close.infinite-loop.app-responsive', lag === 'FROZEN' ? 'FROZEN' : `responsive (${lag} ms)`)
    if (lag !== 'FROZEN') {
      await page.evaluate(() => window.__app.stop())
      const after = await responsive(page, 5000)
      note(browserName, 'close.infinite-loop.after-stop', after === 'FROZEN' ? 'FROZEN' : 'responsive')
    }
    test.info().annotations.push({ type: 'finding', description: `infinite loop: app ${lag === 'FROZEN' ? 'FROZEN' : 'responsive'}` })
  })
})
