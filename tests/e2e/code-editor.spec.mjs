// The Site Studio's code editor (CodeMirror 6) with the real keyboard, in the real app, in Chromium, Firefox and
// WebKit: Tab and Enter, autocomplete, closing tags and brackets as you type, bracket matching, Format, warnings,
// and the dark theme (saved on the device, never touching the website).
import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const pause = ms => new Promise(r => setTimeout(r, ms))

/**
 * Opens the website window for a house as its owner by the real route: the player is put at the door, a real E
 * enters, the player is put at the computer, a real E opens it. That route matters here: the game hands the
 * keyboard to the page only when it opens an app itself (Phaser otherwise swallows W, A, S, D and Space).
 */
async function openStudio(page, houseId) {
  await page.goto(`/?owner=${houseId}`) // dev-only switch: be this house's owner
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="application"]')
    if (!el) return false
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    for (let f = el[key]; f; f = f.return) {
      for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
        const game = h.memoizedState?.current
        if (game?.scene && typeof game.scene.getScene === 'function') {
          window.__wtGame = game
          return game.scene.isActive('TownScene') && !!game.scene.getScene('TownScene')?.player
        }
      }
    }
    return false
  }, null, { timeout: 180_000 })
  await page.evaluate(async id => {
    const { buildEntrances } = await import('/src/game/systems/interaction.ts')
    const { HOUSES } = await import('/src/game/config/houses.ts')
    const { STRUCTURES } = await import('/src/game/maps/town-layout.ts')
    const e = buildEntrances(HOUSES, STRUCTURES).find(x => x.id === id)
    window.__wtGame.scene.getScene('TownScene').player.placeFeet(e.fallbackFeet.x, e.fallbackFeet.y)
  }, houseId)
  await page.waitForFunction(id => window.__wtGame.scene.getScene('TownScene').nearby?.id === id, houseId, { timeout: 30_000 })
  await page.keyboard.press('e')
  await page.waitForFunction(() => {
    const game = window.__wtGame
    const interior = game.scene.getScene('InteriorScene')
    return game.scene.isActive('InteriorScene') && interior?.player && interior.definition && !interior.lock.isBusy
  }, null, { timeout: 60_000 })
  await pause(600) // the fade-in
  await page.evaluate(() => {
    const interior = window.__wtGame.scene.getScene('InteriorScene')
    const targets = interior.currentObjectTargets()
    const target = targets.find(t => t.app === 'website')
    // In front of the desk, just above where the notebook's zone starts (where zones overlap, the nearer wins).
    const top = Math.min(...targets.filter(t => t !== target).map(t => t.zone.y), target.zone.y + target.zone.h)
    interior.player.placeFeet(target.zone.x + target.zone.w / 2, top - 3)
  })
  await page.waitForFunction(() => window.__wtGame.scene.getScene('InteriorScene').nearObject?.app === 'website', null, { timeout: 30_000 })
  await page.keyboard.press('e')
  await page.getByRole('button', { name: /Blank website/ }).click({ timeout: 120_000 })
  await expect(page.locator('.ws-code .cm-content')).toBeVisible()
}
const content = page => page.locator('.ws-code .cm-content')
/** The document, line by line, as CodeMirror shows it. */
const doc = page => page.evaluate(() => [...document.querySelectorAll('.ws-code .cm-line')].map(l => l.textContent).join('\n'))
/** Empties the editor and puts `text` in it as pasted text (no typing helpers). */
async function setDoc(page, text = '') {
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect.poll(() => doc(page)).toBe(text)
}
const focusInEditor = page => page.evaluate(() => document.activeElement?.classList.contains('cm-content') === true)
const options = page => page.locator('.cm-tooltip-autocomplete li')

let page
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await openStudio(page, 'house-e')
})
test.afterAll(async () => { await page.close() })

test('Tab indents, Shift+Tab unindents, selected lines move together, Enter keeps indentation, focus stays', async () => {
  await setDoc(page, '<p>hi</p>')
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect.poll(() => doc(page)).toBe('  <p>hi</p>')
  expect(await focusInEditor(page)).toBe(true)
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => doc(page)).toBe('<p>hi</p>')
  expect(await focusInEditor(page)).toBe(true)

  await setDoc(page, '<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Tab')
  await expect.poll(() => doc(page)).toBe('  <ul>\n  <li>a</li>\n  <li>b</li>\n  </ul>')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => doc(page)).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')

  await setDoc(page, '<div>\n  <p>x</p>\n</div>')
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('y')
  await expect.poll(() => doc(page)).toBe('<div>\n  <p>x</p>\n  y\n</div>')
})

test('HTML: tag and attribute suggestions, accepted with the keyboard, and closing tags as you type', async () => {
  await setDoc(page)
  await page.keyboard.type('<blockq')
  await expect(options(page).filter({ hasText: 'blockquote' })).toBeVisible()
  await pause(150)
  await page.keyboard.press('Enter')
  await page.keyboard.type('>')
  await expect.poll(() => doc(page)).toBe('<blockquote></blockquote>')

  await setDoc(page)
  await page.keyboard.type('<a hr')
  await expect.poll(() => doc(page)).toBe('<a hr')
  await expect(options(page).filter({ hasText: /^href$/ })).toBeVisible()
  await pause(150)
  await page.keyboard.press('Enter')
  await expect.poll(() => doc(page)).toMatch(/^<a href/)

  await setDoc(page, '<section><p>hi</p>')
  await page.keyboard.type('</')
  await expect.poll(() => doc(page)).toBe('<section><p>hi</p></section>')

  // Escape closes the list and leaves the window open.
  await setDoc(page)
  await page.keyboard.type('<di')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
  await expect(page.locator('.ws-studio')).toBeVisible()
})

test('CSS: property and value suggestions in context, with arrow keys', async () => {
  await page.getByRole('tab', { name: 'style.css' }).click()
  await setDoc(page)
  await page.keyboard.type('p { backg')
  await expect(options(page).filter({ hasText: 'background-color' })).toBeVisible()
  const first = await page.locator('.cm-tooltip-autocomplete li[aria-selected="true"]').textContent()
  await pause(150) // CodeMirror ignores keys for 75 ms after the list opens
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected="true"]')).not.toHaveText(first)
  await page.keyboard.press('Escape')

  await setDoc(page, 'p { display: ')
  await page.keyboard.press('End')
  await page.keyboard.type('fle')
  await expect(options(page).filter({ hasText: /^flex$/ }).first()).toBeVisible()
  await expect(options(page).filter({ hasText: 'background-color' })).toHaveCount(0)
  await pause(150)
  await page.keyboard.press('Enter')
  await expect.poll(() => doc(page)).toMatch(/^p \{ display: flex/)
})

test('brackets and quotes close themselves, and matching brackets are highlighted', async () => {
  await setDoc(page)
  await page.keyboard.type('a {')
  await expect.poll(() => doc(page)).toBe('a {}')
  await page.keyboard.type(' b: url(')
  await expect.poll(() => doc(page)).toBe('a { b: url()}')
  await setDoc(page, 'a { b: c }')
  await page.keyboard.press('ControlOrMeta+Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(page.locator('.cm-matchingBracket')).toHaveCount(2)

  await page.getByRole('tab', { name: 'index.html' }).click()
  await setDoc(page)
  await page.keyboard.type('<p class="')
  await expect.poll(() => doc(page)).toBe('<p class=""')
})

test('Format re-indents the document; warnings appear on the lines they are about', async () => {
  await setDoc(page, '<div>\n<ul>   \n<li>a</li>\n</ul>\n</div>')
  await page.getByRole('button', { name: 'Format', exact: true }).click()
  await expect.poll(() => doc(page)).toBe('<div>\n  <ul>\n    <li>a</li>\n  </ul>\n</div>')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => doc(page)).toBe('<div>\n<ul>   \n<li>a</li>\n</ul>\n</div>')
  await page.keyboard.press('Shift+Alt+F')
  await expect.poll(() => doc(page)).toBe('<div>\n  <ul>\n    <li>a</li>\n  </ul>\n</div>')

  await setDoc(page, '<div>\n<p>open')
  await expect(page.locator('.cm-lint-marker-warning').first()).toBeVisible({ timeout: 10_000 })
  await setDoc(page, '<p>fine</p>')
  await expect(page.locator('.cm-lint-marker-warning')).toHaveCount(0, { timeout: 10_000 })
})

test('dark mode switches the Studio and the editor, is remembered, and leaves the website alone', async () => {
  const resident = async () => {
    const host = page.frames().filter(f => !f.isDetached() && f.url().endsWith('/site-host.html')).pop()
    await expect.poll(() => host.childFrames().length).toBe(1)
    return host.childFrames()[0]
  }
  await setDoc(page, '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Light site</h1></body></html>')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(async () => (await resident()).evaluate(() => document.querySelector('h1')?.textContent).catch(() => null)).toBe('Light site')
  const before = await (await resident()).evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('h1')).color, document.documentElement.outerHTML])

  const toggle = page.getByRole('button', { name: 'Dark mode' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.ws-code .cm-editor')).toHaveCSS('background-color', 'rgb(40, 44, 52)')
  await expect(page.locator('.ws-studio')).toHaveCSS('background-color', 'rgb(30, 31, 36)')
  await expect(page.locator('.ws-toolbar .wt-tool').first()).toHaveCSS('background-color', 'rgb(43, 45, 52)')

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(async () => (await resident()).evaluate(() => document.querySelector('h1')?.textContent).catch(() => null)).toBe('Light site')
  const after = await (await resident()).evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('h1')).color, document.documentElement.outerHTML])
  expect(after).toEqual(before)

  // Remembered on this device: a reload and a new Studio open dark.
  await openStudio(page, 'house-f')
  await expect(page.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.ws-code .cm-editor')).toHaveCSS('background-color', 'rgb(40, 44, 52)')
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('.ws-code .cm-editor')).not.toHaveCSS('background-color', 'rgb(40, 44, 52)')
})
