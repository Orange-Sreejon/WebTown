// WebTown Paint in the real game, in Chromium, Firefox and WebKit.
//
// The player is put at the door and at the notebook (Player.placeFeet), and everything from there is the real
// flow: Phaser shows the prompt, a real E press enters the house and opens the Sketchbook, the real keyboard
// is checked to be handed over and given back, and drawing is done with the real mouse. The game instance is
// found through React's internal fiber on the game container (test-only; nothing is added to the app for it).
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitForTown(page) {
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
  }, null, { timeout: 180_000 })
}

const feet = page => page.evaluate(() => {
  const game = window.__wtGame
  const scene = game.scene.isActive('InteriorScene') ? game.scene.getScene('InteriorScene') : game.scene.getScene('TownScene')
  const f = scene.player.feet
  return { x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10 }
})

/** Walks in through the front door: the player is put at the door, then a real E. */
async function enterHouse(page, houseId) {
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
  await sleep(600) // the fade-in
}

/** Stands at the notebook and waits for Phaser's own prompt. */
async function goToSketchbook(page) {
  await page.evaluate(() => {
    const interior = window.__wtGame.scene.getScene('InteriorScene')
    const target = interior.currentObjectTargets().find(t => t.app === 'paint')
    interior.player.placeFeet(target.zone.x + target.zone.w / 2, target.zone.y + target.zone.h - 3)
  })
  await page.waitForFunction(() => {
    const interior = window.__wtGame.scene.getScene('InteriorScene')
    return interior.nearObject?.app === 'paint' && interior.prompt.label.visible && interior.prompt.label.text === 'E: Open Sketchbook'
  }, null, { timeout: 30_000 })
}

async function openSketchbook(page) {
  await goToSketchbook(page)
  await page.keyboard.press('e')
  await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 120_000 })
}

const gameKeyboardEnabled = page => page.evaluate(() => window.__wtGame.scene.getScene('InteriorScene').input.keyboard.enabled)

/** The canvas's pixel at x, y as [r, g, b, a]. */
const px = (page, x, y) => page.evaluate(([x, y]) => {
  const canvas = document.querySelector('canvas.pt-canvas') // null while the Sketchbook is still opening
  return canvas ? Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data) : null
}, [x, y])
const expectPx = async (page, x, y, rgba) => expect.poll(() => px(page, x, y)).toEqual(rgba)

/** Page coordinates of the middle of picture pixel (x, y), from the canvas's box as shown now. */
async function at(page, x, y) {
  const canvas = page.locator('canvas.pt-canvas')
  const box = await canvas.boundingBox()
  const size = await canvas.evaluate(c => ({ w: c.width, h: c.height }))
  return { x: box.x + ((x + 0.5) * box.width) / size.w, y: box.y + ((y + 0.5) * box.height) / size.h }
}
async function drag(page, points, { button = 'left', shift = false } = {}) {
  const first = await at(page, ...points[0])
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(first.x, first.y)
  await page.mouse.down({ button })
  for (const p of points.slice(1)) {
    const q = await at(page, ...p)
    await page.mouse.move(q.x, q.y, { steps: 4 })
  }
  await page.mouse.up({ button })
  if (shift) await page.keyboard.up('Shift')
}
const clickPx = (page, x, y) => drag(page, [[x, y]])
const tool = (page, name) => page.getByRole('button', { name, exact: true }).click()
const swatch = (page, name) => page.getByRole('button', { name }).first().click()
async function menu(page, title, item) {
  await page.locator('.pt-menu-title', { hasText: title }).click()
  await page.locator('.pt-menu-item', { hasText: item }).first().click()
}

const BLACK = [0, 0, 0, 255]
const WHITE = [255, 255, 255, 255]
const RED = [255, 0, 0, 255]
const BLUE = [0, 0, 255, 255]
const GREEN = [0, 255, 0, 255]
const YELLOW = [255, 255, 0, 255]

test('definition of done: draw in my house, every tool works, and the drawing is still there after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await waitForTown(page)
  await enterHouse(page, 'house-a')
  await goToSketchbook(page)
  const before = await feet(page)

  // E opens WebTown Paint; the game no longer has the keyboard and the player does not move.
  await page.keyboard.press('e')
  await expect(page.getByText('Untitled - WebTown Paint')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('canvas.pt-canvas')).toBeVisible()
  expect(await gameKeyboardEnabled(page)).toBe(false)
  for (const key of ['d', 'ArrowLeft', 'w']) {
    await page.keyboard.down(key)
    await sleep(400)
    await page.keyboard.up(key)
  }
  expect(await feet(page)).toEqual(before)

  // Pencil, then colours and the brush.
  await drag(page, [[10, 10], [60, 10]])
  await expectPx(page, 30, 10, BLACK)
  await swatch(page, 'Red, #FF0000')
  await tool(page, 'Brush')
  await page.getByRole('radio', { name: 'Brush size 8 pixels' }).click()
  await expect(page.locator('.pt-status')).toContainText('Size: 8')
  await drag(page, [[20, 60], [100, 60], [200, 60]])
  await expectPx(page, 100, 60, RED)
  await expectPx(page, 100, 63, RED) // 8 pixels thick

  // Eraser back to white.
  await tool(page, 'Eraser')
  await page.getByRole('radio', { name: 'Eraser size 16 pixels' }).click()
  await drag(page, [[90, 60], [110, 60]])
  await expectPx(page, 100, 60, WHITE)
  await expectPx(page, 150, 60, RED)

  // Line, filled rectangle, ellipse outline, fill inside it.
  await swatch(page, 'Blue, #0000FF')
  await tool(page, 'Line')
  await drag(page, [[0, 100], [300, 104]], { shift: true })
  await expectPx(page, 150, 100, BLUE)
  await swatch(page, 'Lime, #00FF00')
  await tool(page, 'Rectangle')
  await page.getByRole('radio', { name: 'Filled', exact: true }).click()
  await drag(page, [[20, 120], [80, 180]])
  await expectPx(page, 50, 150, GREEN)
  await swatch(page, 'Black, #000000')
  await tool(page, 'Ellipse')
  await page.getByRole('radio', { name: 'Outline', exact: true }).click()
  await drag(page, [[100, 120], [200, 180]])
  await expectPx(page, 150, 150, WHITE)
  await expectPx(page, 100, 150, BLACK)
  await swatch(page, 'Yellow, #FFFF00')
  await tool(page, 'Fill With Color')
  await clickPx(page, 150, 150)
  await expectPx(page, 150, 150, YELLOW)
  await expectPx(page, 250, 150, WHITE) // the outline held the fill in

  // Pick colour takes the green from the rectangle and goes back to Fill.
  await tool(page, 'Pick Color')
  await clickPx(page, 50, 150)
  await expect(page.getByTestId('foreground-colour')).toHaveCSS('background-color', 'rgb(0, 255, 0)')
  await expect(page.getByRole('button', { name: 'Fill With Color', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Text, typed with the real keyboard (W A S D E reach the box, not the game), placed with Ctrl+Enter.
  await tool(page, 'Text')
  await page.getByRole('radio', { name: 'Font size 32' }).click()
  await clickPx(page, 300, 300)
  await page.keyboard.type('wasd E')
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('textarea.pt-textbox')).toHaveCount(0)
  const inked = () => page.evaluate(() => {
    const d = document.querySelector('canvas.pt-canvas').getContext('2d').getImageData(300, 300, 160, 45).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] === 0 && d[i + 1] === 255 && d[i + 2] === 0) n++
    return n
  })
  await expect.poll(inked).toBeGreaterThan(80)
  expect(await feet(page)).toEqual(before)

  // Undo and redo, by button and keyboard.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(inked).toBe(0)
  await page.keyboard.press('Control+y')
  await expect.poll(inked).toBeGreaterThan(80)

  // Clear asks first, and can be undone.
  await menu(page, 'Image', 'Clear Image')
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expectPx(page, 30, 10, WHITE)
  await page.keyboard.press('Control+z')
  await expectPx(page, 30, 10, BLACK)

  // Coordinates stay right at 200% and when the window is small.
  await swatch(page, 'Black, #000000')
  await tool(page, 'Pencil')
  await menu(page, 'View', 'Large Size (200%)')
  await expect(page.locator('canvas.pt-canvas')).toHaveAttribute('data-scale', '2')
  await clickPx(page, 120, 220)
  await expectPx(page, 120, 220, BLACK)
  await expectPx(page, 121, 220, WHITE)
  await menu(page, 'View', 'Zoom to Fit')
  await page.setViewportSize({ width: 760, height: 560 })
  await expect.poll(async () => Number(await page.locator('canvas.pt-canvas').getAttribute('data-scale'))).toBeLessThan(1)
  // Below 100% one screen pixel covers more than one picture pixel, so the dot lands on the nearest one.
  await clickPx(page, 400, 400)
  await expect.poll(() => page.evaluate(() => {
    const d = document.querySelector('canvas.pt-canvas').getContext('2d').getImageData(398, 398, 5, 5).data
    const hits = []
    for (let i = 0; i < 25; i++) if (d[i * 4] === 0 && d[i * 4 + 3] === 255) hits.push([398 + (i % 5), 398 + Math.floor(i / 5)])
    return hits.length === 1 && hits.every(([x, y]) => Math.abs(x - 400) <= 1 && Math.abs(y - 400) <= 1)
  })).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })

  // Export PNG.
  const downloading = page.waitForEvent('download')
  await menu(page, 'File', 'Export PNG...')
  const file = await downloading
  expect(file.suggestedFilename()).toBe('untitled.png')
  const bytes = readFileSync(await file.path())
  expect([...bytes.subarray(1, 4)].map(b => String.fromCharCode(b)).join('')).toBe('PNG')
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([640, 480])

  // Close: it saves, the game gets the keyboard back, the player is where they were and can walk.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
  expect(await feet(page)).toEqual(before)
  await expect.poll(() => gameKeyboardEnabled(page)).toBe(true)
  await page.keyboard.down('ArrowUp')
  await sleep(500)
  await page.keyboard.up('ArrowUp')
  expect(await feet(page)).not.toEqual(before)

  // Reopen: the same drawing.
  await openSketchbook(page)
  await expectPx(page, 30, 10, BLACK)
  await expectPx(page, 150, 150, YELLOW)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })

  // Reload the page: still there.
  await page.reload()
  await waitForTown(page)
  await enterHouse(page, 'house-a')
  await openSketchbook(page)
  await expect(page.locator('.pt-status')).toContainText('Saved on this device only')
  await expectPx(page, 30, 10, BLACK)
  await expectPx(page, 150, 60, RED)
  await expectPx(page, 150, 150, YELLOW)
  await expectPx(page, 50, 150, GREEN)
  await expect.poll(inked).toBeGreaterThan(80)
})

test("drawings belong to their house: another house's owner starts blank, visitors only look", async ({ page }) => {
  await page.goto('/')
  await waitForTown(page)
  await enterHouse(page, 'house-a')
  await openSketchbook(page)
  await expect(page.getByText('Untitled - WebTown Paint')).toBeVisible()
  await swatch(page, 'Red, #FF0000')
  await tool(page, 'Rectangle')
  await page.getByRole('radio', { name: 'Filled', exact: true }).click()
  await drag(page, [[2, 2], [99, 99]])
  await expectPx(page, 50, 50, RED)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })

  // As the owner of house-b (dev-only switch), house-a is someone else's: view only.
  await page.goto('/?owner=house-b')
  await waitForTown(page)
  await enterHouse(page, 'house-a')
  await openSketchbook(page)
  await expect(page.getByText('Sketchbook (view only)')).toBeVisible()
  await expect(page.getByText('Untitled (1 of 1)')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(1) // only the game's canvas; no drawing surface
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
  await page.evaluate(() => window.__wtGame.scene.getScene('InteriorScene').leave())
  await page.waitForFunction(() => window.__wtGame.scene.isActive('TownScene') && !window.__wtGame.scene.isActive('InteriorScene'), null, { timeout: 30_000 })
  await sleep(600)

  // house-b's own Sketchbook is blank, and drawing there leaves house-a's alone.
  await enterHouse(page, 'house-b')
  await openSketchbook(page)
  await expect(page.getByText('Untitled - WebTown Paint')).toBeVisible()
  await expect(page.locator('.pt-status')).toContainText('New drawing')
  await expectPx(page, 50, 50, WHITE)
  await drag(page, [[50, 50], [60, 50]])
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })

  await page.goto('/')
  await waitForTown(page)
  await enterHouse(page, 'house-a')
  await openSketchbook(page)
  await expectPx(page, 50, 50, RED)
  await expectPx(page, 55, 150, WHITE)
  await menu(page, 'File', 'Open...')
  await expect(page.getByRole('option')).toHaveCount(1)
})
