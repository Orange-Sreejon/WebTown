// The website HTML/CSS Studio in the real WebTown app, in Chromium, Firefox and WebKit.
//
// The window is opened with the same app-bridge message Phaser sends when the player uses the
// computer (the real module, imported in the page), so these tests cover everything from that
// message on: storage, the Studio, the builder, the two sandboxed frames and the viewer. Walking
// the avatar to the computer is covered by the game's own tests.
//
// Evidence rules (as in the S-01 spike): "nothing left the page" means the beacon saw no request and
// no bare connection, after a positive control showed it can see this browser's traffic.
import { test, expect } from '@playwright/test'

const BEACON = 'http://127.0.0.1:8766'
const GIF_2X2 = Buffer.from('R0lGODlhAgACAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAMgAAACwAAAAAAgACAAACAoRRACH5BAAyAAAALAAAAAACAAIAAAICDFQAOw==', 'base64')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const beaconLog = async () => (await fetch(`${BEACON}/__log`)).json()
const beaconReset = async () => { await fetch(`${BEACON}/__reset`) }

// A website with nothing in common with the classic template: a dark, grid-based one-page zine.
const ZINE_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NIGHT SHIFT zine</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="zine">
<header class="mast"><h1>NIGHT SHIFT</h1><img id="banner" src="assets/my-banner.gif" alt="banner"></header>
<article class="col"><h2 id="intro">Static</h2><p>Photocopied thoughts at 3am.</p><a id="toc" href="#outro">jump to the end</a></article>
<article class="col"><a id="next" href="issue-2.html">Issue 2</a></article>
<footer id="outro"><a id="out" href="https://example.com/zine">elsewhere</a></footer>
</div>
</body>
</html>`
const ZINE_CSS = `body { margin: 0; background: #111; color: #39ff14; font-family: monospace; }
.zine { display: grid; grid-template-columns: 2fr 1fr; gap: 6px; padding: 6px; }
.mast { grid-column: 1 / -1; border-bottom: 3px dashed #39ff14; }
#banner { width: 40px; image-rendering: pixelated; }
@media (max-width: 500px) { .zine { grid-template-columns: 1fr; } }`
const ISSUE_2 = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Issue 2</title><link rel="stylesheet" href="style.css"></head>
<body><div class="zine"><h1 id="issue2">ISSUE TWO</h1><a id="back" href="index.html">back to the cover</a></div></body></html>`

// Everything a page might try in order to run script, reach the network or reach WebTown.
const HOSTILE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>hostile</title>
<meta http-equiv="refresh" content="0;url=${BEACON}/refresh">
<link rel="prefetch" href="${BEACON}/prefetch"><link rel="preconnect" href="${BEACON}">
<link rel="stylesheet" href="${BEACON}/sheet.css">
<style>@import url("${BEACON}/import.css"); body { background: url("${BEACON}/bg.png"); }
@font-face { font-family: x; src: url("${BEACON}/font.woff"); } p { font-family: x; }</style>
<base href="${BEACON}/">
</head>
<body>
<p id="still-here">hostile page</p>
<script>fetch('${BEACON}/exec/fetch'); window.parent.postMessage({ t: 'nav', kind: 'external', value: 'https://evil.example/' }, '*');
try { parent.parent.document.title = 'owned' } catch (e) {} top.location = '${BEACON}/exec/top'</script>
<script src="${BEACON}/exec/script.js"></script>
<img src="${BEACON}/img.png" onerror="fetch('${BEACON}/exec/onerror')">
<img src="x" onerror="new Image().src='${BEACON}/exec/onerror2'">
<svg><image href="${BEACON}/svgimage.png"/></svg>
<video src="${BEACON}/video.mp4" poster="${BEACON}/poster.png"></video>
<iframe src="${BEACON}/iframe.html"></iframe><object data="${BEACON}/object"></object><embed src="${BEACON}/embed">
<form action="${BEACON}/form" method="get"><input name="q" value="x"><button id="submit">go</button></form>
<a id="js" href="javascript:fetch('${BEACON}/exec/js')">js link</a>
<a id="ping" href="#x" ping="${BEACON}/ping">ping</a>
<div style="background-image: url('${BEACON}/inline.png'); width: 10px; height: 10px"></div>
<template shadowrootmode="open"><img src="${BEACON}/shadow.png"></template>
</body></html>`

/** Opens WebTown and the website window for `houseId`, exactly as the interior scene does. */
async function openWebsite(page, houseId, mode) {
  if (!page.url().startsWith('http')) await page.goto('/')
  // Wait until the game is running (so the app is listening), not only until its container exists.
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="application"]')
    if (!el) return false
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    for (let f = el[key]; f; f = f.return) {
      for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
        const game = h.memoizedState?.current
        if (game?.scene && typeof game.scene.isActive === 'function') return game.scene.isActive('TownScene')
      }
    }
    return false
  }, null, { timeout: 180_000 })
  await page.evaluate(async ([h, m]) => {
    const bridge = await import('/src/lib/app-bridge.ts')
    bridge.emitAppState({ open: null, houseId: '', mode: 'visitor' })
    bridge.emitAppState({ open: 'website', houseId: h, mode: m })
  }, [houseId, mode])
  // The game boots in the same page; under headless software WebGL that can keep it busy for a while.
  await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/Opening website|Loading website/)).toHaveCount(0, { timeout: 120_000 })
}

async function closeWebsite(page) {
  await page.evaluate(async () => {
    const bridge = await import('/src/lib/app-bridge.ts')
    bridge.emitAppState({ open: null, houseId: '', mode: 'visitor' })
  })
}

/** The resident's frame inside the host frame (there is one website frame on screen at a time). */
async function residentFrame(page) {
  // The newest attached host frame: a closed window's frame can linger, detached, in WebKit's frame list.
  const hosts = () => page.frames().filter(f => !f.isDetached() && f.url().endsWith('/site-host.html'))
  await expect.poll(() => hosts().length).toBeGreaterThan(0)
  const host = hosts()[hosts().length - 1]
  await expect.poll(() => host.childFrames().length).toBe(1)
  return host.childFrames()[0]
}

/** Waits until the resident frame shows something matching `selector`. */
async function residentHas(page, selector) {
  await expect.poll(async () => {
    const frame = await residentFrame(page)
    return frame.evaluate(s => document.querySelector(s) !== null, selector).catch(() => false)
  }, { timeout: 20_000 }).toBe(true)
  return residentFrame(page)
}

/** Replaces the whole text of the code editor (CodeMirror). */
async function setCode(page, text) {
  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect.poll(() => content.evaluate(el => el.cmView?.view?.state.doc.toString() ?? el.textContent)).toContain(text.slice(-20).trim().split('\n').pop())
}

const status = page => page.locator('.ws-status')

test.beforeEach(async () => { await beaconReset() })

test('control: the beacon sees an ordinary request from this browser', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(b => { new Image().src = `${b}/control.png` }, BEACON)
  await expect.poll(async () => (await beaconLog()).http.some(r => r.path === '/control.png')).toBe(true)
})

test('definition of done: an owner builds a zine from scratch and a visitor sees the same site', async ({ page, context, browserName }) => {
  // 1. Nothing yet: the owner is offered a choice, and picks Blank.
  await openWebsite(page, 'house-a', 'owner')
  await expect(page.getByText('Nothing here yet.')).toBeVisible()
  await page.getByRole('button', { name: /Blank website/ }).click()
  await expect(page.getByText('Site Studio: My website')).toBeVisible()
  await expect(status(page)).toHaveText('Not saved yet')

  // 2. The website's name, its pages, an uploaded animated GIF, and a shared stylesheet.
  await page.locator('.ws-field input').fill('Night Shift')
  await page.locator('input[type="file"]').setInputFiles({ name: 'my-banner.gif', mimeType: 'image/gif', buffer: GIF_2X2 })
  await expect(page.getByText('assets/my-banner.gif').first()).toBeVisible()
  await setCode(page, ZINE_INDEX)
  await page.getByRole('tab', { name: 'style.css' }).click()
  await setCode(page, ZINE_CSS)
  await page.getByRole('button', { name: 'New page' }).click()
  await page.locator('.ws-dialog input').fill('issue-2')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('tab', { name: 'issue-2.html' })).toBeVisible()
  await setCode(page, ISSUE_2)
  await page.locator('.ws-item-name', { hasText: 'index.html' }).click()

  // 3. The live preview renders the owner's own HTML and CSS, with the GIF, in the sandbox.
  await page.getByRole('button', { name: 'Refresh' }).click()
  let frame = await residentHas(page, '.zine')
  expect(await frame.evaluate(() => getComputedStyle(document.querySelector('.zine')).display)).toBe('grid')
  expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 17, 17)')
  await expect.poll(() => frame.evaluate(() => document.getElementById('banner').naturalWidth)).toBe(2)
  expect(await frame.evaluate(() => document.getElementById('banner').src.startsWith('data:image/gif;base64,'))).toBe(true)
  expect(await frame.evaluate(() => document.getElementById('toc').getAttribute('href'))).toBe('about:srcdoc#outro')
  expect(await frame.evaluate(() => document.querySelectorAll('script').length)).toBe(0)

  // Phone width: the page's own media query takes over.
  await page.getByRole('button', { name: 'Phone' }).click()
  await expect.poll(async () => (await residentFrame(page)).evaluate(() => getComputedStyle(document.querySelector('.zine')).gridTemplateColumns.split(' ').length)).toBe(1)
  await page.getByRole('button', { name: 'Desktop' }).click()

  // A link in the preview moves the Studio to that page.
  frame = await residentFrame(page)
  await frame.click('#next')
  await expect(page.locator('.ws-preview-title')).toContainText('issue-2.html')
  await residentHas(page, '#issue2')

  // 4. Save, and the Studio says so.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(status(page)).toHaveText('Saved')
  await page.getByRole('button', { name: 'Exit' }).click()
  await expect(page.getByRole('button', { name: 'Open Site Studio' })).toBeVisible()

  // 5. After a reload, a visitor sees the very same site, and can browse it.
  await closeWebsite(page)
  await page.reload()
  await openWebsite(page, 'house-a', 'visitor')
  await expect(page.getByRole('button', { name: 'Open Site Studio' })).toHaveCount(0)
  frame = await residentHas(page, '.zine')
  expect(await frame.evaluate(() => document.querySelector('h1').textContent)).toBe('NIGHT SHIFT')
  expect(await frame.evaluate(() => getComputedStyle(document.querySelector('.zine')).display)).toBe('grid')
  await expect.poll(() => frame.evaluate(() => document.getElementById('banner').naturalWidth)).toBe(2)
  await expect(page.locator('#wt-address-field')).toHaveValue('webtown://house-a/index.html')
  await expect(page.locator('.wt-page-title')).toHaveText('NIGHT SHIFT zine')

  // A link to a place on the same page. Chromium and Firefox jump within the page. WebKit treats it as a
  // navigation, which the sandbox blocks, and the page is put back (a known limitation, see the findings).
  await frame.click('#toc')
  if (browserName === 'webkit') {
    await expect(page.getByText('tried to go somewhere else')).toBeVisible()
  } else {
    await expect.poll(() => frame.evaluate(() => location.hash)).toBe('#outro')
    await sleep(1500)
    await expect(page.getByText('tried to go somewhere else')).toHaveCount(0)
  }
  expect(await (await residentHas(page, '.zine')).evaluate(() => document.querySelector('h1').textContent)).toBe('NIGHT SHIFT')
  frame = await residentFrame(page)

  await frame.click('#next')
  await expect(page.locator('#wt-address-field')).toHaveValue('webtown://house-a/issue-2.html')
  await residentHas(page, '#issue2')
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.locator('#wt-address-field')).toHaveValue('webtown://house-a/index.html')

  // An external link is never followed from inside the page: WebTown asks first.
  let popups = 0
  context.on('page', () => popups++)
  frame = await residentHas(page, '#out')
  await frame.click('#out')
  await expect(page.getByRole('alertdialog')).toContainText('example.com')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await sleep(300)
  expect(popups).toBe(0)

  // 6. Another house is untouched.
  await closeWebsite(page)
  await openWebsite(page, 'house-b', 'visitor')
  await expect(page.getByText("Nothing here yet. The owner of this house hasn't made a website.")).toBeVisible()
})

test('a hostile page runs no script, reaches no network and cannot reach WebTown', async ({ page }) => {
  await openWebsite(page, 'house-c', 'owner')
  await page.getByRole('button', { name: /Blank website/ }).click()
  await setCode(page, HOSTILE)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(status(page)).toHaveText('Saved')
  await page.getByRole('button', { name: 'Exit' }).click()
  await closeWebsite(page)
  await beaconReset()

  await openWebsite(page, 'house-c', 'visitor')
  const frame = await residentHas(page, '#still-here')
  // Try the things that need a click, too.
  await frame.click('#submit').catch(() => undefined)
  await frame.click('#js').catch(() => undefined)
  await frame.click('#ping').catch(() => undefined)
  await sleep(2500)

  const log = await beaconLog()
  expect(log.http, JSON.stringify(log.http)).toEqual([])
  expect(log.bare).toEqual([])
  expect(await page.title()).not.toBe('owned')
  await expect(page.getByRole('alertdialog')).toHaveCount(0) // the script's postMessage never ran
  const residentNow = await residentFrame(page)
  expect(await residentNow.evaluate(() => document.querySelectorAll('script, iframe, object, embed, base').length)).toBe(0)
  expect(await residentNow.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content)).toContain("script-src 'none'")
  await expect(page.locator('#wt-address-field')).toHaveValue('webtown://house-c/index.html')
})

test('a visitor never downloads the Studio or the code editor', async ({ page }) => {
  const requested = []
  page.on('request', r => requested.push(new URL(r.url()).pathname))
  await openWebsite(page, 'house-d', 'visitor')
  await expect(page.getByText(/Nothing here yet/)).toBeVisible()
  expect(requested.filter(p => /website-studio|codemirror/i.test(p))).toEqual([])

  await closeWebsite(page)
  await openWebsite(page, 'house-d', 'owner')
  await expect(page.getByText('Build your website')).toBeVisible()
  expect(requested.some(p => /website-studio\/OwnerWebsiteWindow/.test(p))).toBe(true)
})
