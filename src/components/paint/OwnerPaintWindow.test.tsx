import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryArtworkRepository } from '../../personal-spaces/artwork-storage/memory-artwork-repository'
import { QuotaError } from '../../personal-spaces/errors'
import { BLACK, TRANSPARENT, WHITE, parseHex, type Rgba } from '../../personal-spaces/paint/color'
import { createBuffer, setPixel, type PixelBuffer } from '../../personal-spaces/paint/pixel-buffer'
import type { Mask } from '../../personal-spaces/paint/raster'
import { OwnerPaintWindow } from './OwnerPaintWindow'
import { decodeTest, fakeCanvasLayout, pixel, testCodec } from './paint-test-support.test-support'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RED = parseHex('#ff0000')!
const BLUE = parseHex('#0000ff')!

let container: HTMLDivElement
let root: Root
let restore: () => void
let repo: MemoryArtworkRepository

beforeEach(() => {
  restore = fakeCanvasLayout()
  let n = 0
  let t = 0
  repo = new MemoryArtworkRepository({ newId: () => `d${++n}`, now: () => new Date(Date.UTC(2026, 10, 20, 12, 0, t++)).toISOString() })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  restore()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const settle = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

interface Mounted { onClose: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn> }

/** A text rasteriser stand-in: one solid pixel per character, on one row. */
const fakeText = (text: string): Mask | null =>
  text === '' ? null : { width: text.length, height: 1, bits: new Uint8Array(text.length).fill(1) }

async function mount(houseId = 'house-a', options: { writer?: MemoryArtworkRepository['save']; persistent?: boolean } = {}): Promise<Mounted> {
  const onClose = vi.fn()
  const download = vi.fn()
  const writer = { save: options.writer ?? repo.save.bind(repo), delete: repo.delete.bind(repo) }
  act(() =>
    root.render(
      <OwnerPaintWindow
        access={{ houseId, reader: repo, writer }}
        persistent={options.persistent ?? true}
        onClose={onClose}
        codec={testCodec}
        rasterizeText={fakeText}
        download={download}
        autosaveMs={60_000}
      />,
    ),
  )
  await settle()
  return { onClose, download }
}

const text = (): string => container.textContent ?? ''
const canvas = (): HTMLCanvasElement => container.querySelector('canvas.pt-canvas')!
const findButton = (name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name)
const button = (name: string): HTMLButtonElement => {
  const found = findButton(name)
  if (!found) throw new Error(`no button "${name}"`)
  return found
}
const click = (el: HTMLElement): void => act(() => el.click())
const tool = (name: string): void => click(button(name))
const menu = (title: string, itemLabel: string): void => {
  click([...container.querySelectorAll<HTMLButtonElement>('.pt-menu-title')].find(b => b.textContent === title)!)
  click([...container.querySelectorAll<HTMLButtonElement>('.pt-menu-item')].find(b => b.querySelector('.pt-menu-label')?.textContent === itemLabel)!)
}

function pointer(type: string, x: number, y: number, opts: { button?: number; shift?: boolean } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x + 0.5, clientY: y + 0.5, button: opts.button ?? 0, shiftKey: opts.shift ?? false })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  act(() => { canvas().dispatchEvent(event) })
}
function drag(points: Array<[number, number]>, opts: { button?: number; shift?: boolean } = {}): void {
  pointer('pointerdown', ...points[0]!, opts)
  for (const p of points.slice(1)) pointer('pointermove', ...p, opts)
  pointer('pointerup', ...points[points.length - 1]!, opts)
}
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}): void =>
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: mods.ctrl ?? false, shiftKey: mods.shift ?? false, bubbles: true, cancelable: true })) })

/** Saves now and returns the picture as storage has it. */
async function saved(houseId = 'house-a'): Promise<PixelBuffer> {
  key('s', { ctrl: true })
  await settle()
  const { items } = await repo.list(houseId)
  if (items.length === 0) throw new Error('nothing saved')
  return decodeTest(items[0]!.png)
}
const same = (a: Rgba | null, b: Rgba): boolean => !!a && a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
const countColor = (b: PixelBuffer, c: Rgba): number => {
  let n = 0
  for (let i = 0; i < b.data.length; i += 4) if (b.data[i] === c.r && b.data[i + 1] === c.g && b.data[i + 2] === c.b && b.data[i + 3] === c.a) n++
  return n
}

describe('the window', () => {
  it('looks like a classic paint program', async () => {
    await mount()
    expect(text()).toContain('Untitled - WebTown Paint')
    expect([...container.querySelectorAll('.pt-menu-title')].map(b => b.textContent)).toEqual(['File', 'Edit', 'View', 'Image', 'Colors', 'Help'])
    expect(container.querySelectorAll('.pt-tools .pt-tool')).toHaveLength(10)
    expect(container.querySelectorAll('.pt-swatch')).toHaveLength(28)
    for (const name of ['Minimise', 'Maximise', 'Close', 'Undo', 'Redo']) button(name)
    expect(button('Minimise').getAttribute('aria-disabled')).toBe('true')
    expect(canvas().width).toBe(640)
    expect(canvas().height).toBe(480)
    expect(text()).toContain('640 x 480')
    expect(text()).toContain('New drawing')
  })

  it('shows which tool is selected, its options and its size', async () => {
    await mount()
    expect(button('Pencil').getAttribute('aria-pressed')).toBe('true')
    tool('Brush')
    expect(button('Brush').getAttribute('aria-pressed')).toBe('true')
    expect(button('Pencil').getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[role="radiogroup"][aria-label="Brush size"]')).not.toBeNull()
    expect(text()).toContain('Size: 4')
    click(button('Brush size 12 pixels'))
    expect(text()).toContain('Size: 12')
    tool('Rectangle')
    expect(container.querySelector('[aria-label="Fill style"]')).not.toBeNull()
    expect(text()).toContain('Width: 1')
  })

  it('maximises and restores', async () => {
    await mount()
    click(button('Maximise'))
    expect(findButton('Restore')).toBeDefined()
    click(button('Restore'))
    expect(findButton('Maximise')).toBeDefined()
  })
})

describe('drawing', () => {
  it('draws with the pencil where the pointer is', async () => {
    await mount()
    drag([[10, 10], [20, 10]])
    const image = await saved()
    expect(same(pixel(image, 10, 10), BLACK)).toBe(true)
    expect(same(pixel(image, 20, 10), BLACK)).toBe(true)
    expect(same(pixel(image, 15, 11), WHITE)).toBe(true)
    expect(countColor(image, BLACK)).toBe(11)
  })

  it('maps the pointer correctly when the canvas is shown at 200%', async () => {
    restore()
    restore = fakeCanvasLayout(2)
    await mount()
    drag([[100, 60], [100, 60]])
    const image = await saved()
    expect(same(pixel(image, 50, 30), BLACK)).toBe(true)
  })

  it('uses the chosen palette colour at once, and the background colour with the right button', async () => {
    await mount()
    click(button('Red, #FF0000'))
    expect((container.querySelector('[data-testid="foreground-colour"]') as HTMLElement).style.background).toBe('rgb(255, 0, 0)')
    drag([[5, 5], [5, 5]])
    act(() => { button('Blue, #0000FF').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
    expect((container.querySelector('[data-testid="background-colour"]') as HTMLElement).style.background).toBe('rgb(0, 0, 255)')
    drag([[7, 7], [7, 7]], { button: 2 })
    const image = await saved()
    expect(same(pixel(image, 5, 5), RED)).toBe(true)
    expect(same(pixel(image, 7, 7), BLUE)).toBe(true)
  })

  it('brush size changes how much is painted', async () => {
    await mount()
    tool('Brush')
    click(button('Brush size 2 pixels'))
    drag([[50, 50], [50, 50]])
    click(button('Brush size 12 pixels'))
    drag([[150, 150], [150, 150]])
    const image = await saved()
    expect(countColor(image, BLACK)).toBe(4 + 112)
  })

  it('erases back to white', async () => {
    await mount()
    tool('Brush')
    drag([[30, 30], [60, 30]])
    tool('Eraser')
    click(button('Eraser size 16 pixels'))
    drag([[25, 30], [65, 30]])
    expect(countColor(await saved(), BLACK)).toBe(0)
  })

  it('draws lines, rectangles and ellipses', async () => {
    await mount()
    tool('Line')
    drag([[0, 0], [30, 5], [99, 0]])
    tool('Rectangle')
    click(button('Filled'))
    drag([[10, 10], [40, 20], [19, 19]])
    tool('Ellipse')
    click(button('Outline'))
    drag([[100, 100], [200, 160]])
    const image = await saved()
    for (let x = 0; x < 100; x++) expect(same(pixel(image, x, 0), BLACK)).toBe(true)
    expect(countColor(image, BLACK)).toBeGreaterThan(100 + 100 + 200)
    expect(same(pixel(image, 15, 15), BLACK)).toBe(true)
    expect(same(pixel(image, 30, 15), WHITE)).toBe(true) // the larger preview was not kept
    expect(same(pixel(image, 150, 130), WHITE)).toBe(true) // outline only
    expect(same(pixel(image, 100, 130), BLACK)).toBe(true)
  })

  it('fills an area', async () => {
    await mount()
    tool('Rectangle')
    drag([[10, 10], [30, 30]])
    tool('Fill With Color')
    click(button('Lime, #00FF00'))
    pointer('pointerdown', 20, 20)
    pointer('pointerup', 20, 20)
    const image = await saved()
    expect(same(pixel(image, 20, 20), parseHex('#00ff00')!)).toBe(true)
    expect(same(pixel(image, 5, 5), WHITE)).toBe(true)
  })

  it('picks a colour from the picture, then returns to the tool it was on', async () => {
    await mount()
    click(button('Red, #FF0000'))
    tool('Brush')
    drag([[40, 40], [40, 40]])
    click(button('Black, #000000'))
    tool('Pick Color')
    pointer('pointerdown', 40, 40)
    pointer('pointerup', 40, 40)
    expect((container.querySelector('[data-testid="foreground-colour"]') as HTMLElement).style.background).toBe('rgb(255, 0, 0)')
    expect(button('Brush').getAttribute('aria-pressed')).toBe('true')
  })

  it('adds text where it was clicked, in the foreground colour, as one undo step', async () => {
    await mount()
    click(button('Blue, #0000FF'))
    tool('Text')
    pointer('pointerdown', 100, 50)
    const box = container.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Hi!')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })) })
    expect(container.querySelector('textarea')).toBeNull()
    const image = await saved()
    expect([100, 101, 102].every(x => same(pixel(image, x, 50), BLUE))).toBe(true)
    click(button('Undo'))
    expect(countColor(await saved(), BLUE)).toBe(0)
  })

  it('cancels a text box with Escape without closing the window', async () => {
    const { onClose } = await mount()
    tool('Text')
    pointer('pointerdown', 10, 10)
    act(() => { container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(container.querySelector('textarea')).toBeNull()
    await settle()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('airbrush sprays while the button is held', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await mount()
    tool('Airbrush')
    pointer('pointerdown', 100, 100)
    act(() => { vi.advanceTimersByTime(600) })
    pointer('pointerup', 100, 100)
    vi.useRealTimers()
    expect(countColor(await saved(), BLACK)).toBeGreaterThan(30)
  })
})

describe('undo, redo and clear', () => {
  it('undoes and redoes drawing, with the buttons and the keyboard', async () => {
    await mount()
    expect(button('Undo').disabled).toBe(true)
    drag([[1, 1], [9, 1]])
    drag([[1, 5], [9, 5]])
    click(button('Undo'))
    expect(countColor(await saved(), BLACK)).toBe(9)
    key('z', { ctrl: true })
    expect(countColor(await saved(), BLACK)).toBe(0)
    expect(button('Undo').disabled).toBe(true)
    key('y', { ctrl: true })
    click(button('Redo'))
    expect(countColor(await saved(), BLACK)).toBe(18)
  })

  it('asks before clearing, and the clear can be undone', async () => {
    await mount()
    drag([[1, 1], [9, 1]])
    menu('Image', 'Clear Image')
    expect(text()).toContain('Clear the whole picture?')
    click(button('Cancel'))
    expect(countColor(await saved(), BLACK)).toBe(9)
    menu('Image', 'Clear Image')
    click(button('Clear'))
    expect(countColor(await saved(), BLACK)).toBe(0)
    click(button('Undo'))
    expect(countColor(await saved(), BLACK)).toBe(9)
  })

  it('Escape during a stroke cancels it and keeps the window open', async () => {
    const { onClose } = await mount()
    tool('Brush')
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 100, 100)
    key('Escape')
    pointer('pointerup', 100, 100)
    await settle()
    expect(onClose).not.toHaveBeenCalled()
    expect(button('Undo').disabled).toBe(true)
  })
})

describe('canvas size', () => {
  it('resizes the canvas and makes it transparent, undoably', async () => {
    await mount()
    drag([[5, 5], [5, 5]])
    menu('Image', 'Attributes...')
    const [w, h] = [...container.querySelectorAll<HTMLInputElement>('.pt-dialog input.pt-input--number')]
    const type = (input: HTMLInputElement, value: string): void => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type(w!, '2000')
    expect(button('OK').disabled).toBe(true)
    type(w!, '320')
    type(h!, '200')
    click([...container.querySelectorAll<HTMLInputElement>('.pt-dialog input[type="radio"]')][1]!)
    click(button('OK'))
    expect(canvas().width).toBe(320)
    expect(text()).toContain('320 x 200')
    let image = await saved()
    expect([image.width, image.height]).toEqual([320, 200])
    expect(same(pixel(image, 5, 5), BLACK)).toBe(true)
    const stored = (await repo.list('house-a')).items[0]!
    expect(stored.transparent).toBe(true)
    tool('Eraser')
    drag([[5, 5], [5, 5]])
    image = await saved()
    expect(same(pixel(image, 5, 5), TRANSPARENT)).toBe(true)
    click(button('Undo'))
    click(button('Undo'))
    expect(canvas().width).toBe(640)
  })
})

describe('colours', () => {
  it('edits a swatch with a custom colour', async () => {
    await mount()
    act(() => { button('Black, #000000').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const hex = [...container.querySelectorAll<HTMLInputElement>('.pt-dialog input.pt-input')][0]!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hex, '#123456')
      hex.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(button('OK'))
    expect(findButton('Custom, #123456')).toBeDefined()
    drag([[3, 3], [3, 3]])
    expect(same(pixel(await saved(), 3, 3), parseHex('#123456')!)).toBe(true)
  })

  it('swaps foreground and background', async () => {
    await mount()
    click(container.querySelector<HTMLButtonElement>('.pt-current')!)
    expect((container.querySelector('[data-testid="foreground-colour"]') as HTMLElement).style.background).toBe('rgb(255, 255, 255)')
  })
})

describe('saving and the Sketchbook', () => {
  it('saves automatically after a change', async () => {
    act(() =>
      root.render(
        <OwnerPaintWindow access={{ houseId: 'house-a', reader: repo, writer: repo }} persistent onClose={vi.fn()} codec={testCodec} rasterizeText={fakeText} download={vi.fn()} autosaveMs={20} />,
      ),
    )
    await settle()
    drag([[1, 1], [2, 1]])
    expect(text()).toContain('Unsaved changes')
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    await settle()
    expect(text()).toContain('Saved on this device only')
    expect((await repo.list('house-a')).items).toHaveLength(1)
  })

  it('saves when closed, then closes; and reopening shows the drawing', async () => {
    const { onClose } = await mount()
    drag([[10, 10], [11, 10]])
    click(button('Close'))
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect((await repo.list('house-a')).items).toHaveLength(1)

    act(() => root.unmount())
    root = createRoot(container)
    await mount()
    expect(text()).toContain('Saved on this device only')
    // Draw nothing: the stored picture is what the window holds.
    menu('File', 'Export PNG...')
    await settle()
  })

  it('reopens the latest drawing exactly as it was left', async () => {
    const image = createBuffer(64, 32, WHITE)
    setPixel(image, 3, 4, RED)
    await repo.save({ id: null, houseId: 'house-a', title: 'Old one', width: 64, height: 32, transparent: false, png: await testCodec.encode(createBuffer(64, 32, WHITE)) })
    await repo.save({ id: null, houseId: 'house-a', title: 'Latest', width: 64, height: 32, transparent: false, png: await testCodec.encode(image) })
    const { download } = await mount()
    expect(text()).toContain('Latest - WebTown Paint')
    expect(canvas().width).toBe(64)
    menu('File', 'Export PNG...')
    await settle()
    expect(download).toHaveBeenCalledTimes(1)
    const [bytes, name] = download.mock.calls[0] as [ArrayBuffer, string]
    expect(name).toBe('latest.png')
    expect(same(pixel(await decodeTest(bytes), 3, 4), RED)).toBe(true)
  })

  it("keeps each house's drawings to itself", async () => {
    await mount('house-a')
    drag([[1, 1], [5, 1]])
    click(button('Close'))
    await settle()
    act(() => root.unmount())
    root = createRoot(container)
    await mount('house-b')
    expect(text()).toContain('New drawing')
    expect((await repo.list('house-b')).items).toHaveLength(0)
  })

  it('asks before closing when the save fails, and can close without saving', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = vi.fn(async () => { throw new QuotaError() })
    const { onClose } = await mount('house-a', { writer: failing })
    drag([[1, 1], [5, 1]])
    click(button('Close'))
    await settle()
    expect(onClose).not.toHaveBeenCalled()
    expect(text()).toContain('could not be saved')
    expect(text()).toContain("There isn't enough storage space")
    click(button('Keep drawing'))
    expect(onClose).not.toHaveBeenCalled()
    click(button('Close'))
    await settle()
    click(button('Close without saving'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape, saving first', async () => {
    const { onClose } = await mount()
    drag([[1, 1], [5, 1]])
    key('Escape')
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect((await repo.list('house-a')).items).toHaveLength(1)
  })

  it('starts a new drawing, keeps the old one, and can open it again', async () => {
    await mount()
    drag([[1, 1], [5, 1]])
    menu('File', 'New')
    await settle()
    expect(text()).toContain('New drawing')
    drag([[1, 9], [5, 9]])
    menu('File', 'Rename...')
    const input = container.querySelector<HTMLInputElement>('.pt-dialog input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Second page')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(button('Rename'))
    await settle()
    expect(text()).toContain('Second page - WebTown Paint')
    expect((await repo.list('house-a')).items.map(i => i.title)).toEqual(['Second page', 'Untitled'])

    menu('File', 'Open...')
    await settle()
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    expect(options.map(o => o.querySelector('.pt-gallery-title')!.textContent)).toEqual(['Second page (open)', 'Untitled'])
    click(options[1]!)
    click(button('Open'))
    await settle()
    expect(text()).toContain('Untitled - WebTown Paint')
    const image = await decodeTest((await repo.list('house-a')).items.find(i => i.title === 'Untitled')!.png)
    expect(same(pixel(image, 1, 1), BLACK)).toBe(true)
    expect(same(pixel(image, 1, 9), WHITE)).toBe(true)
  })

  it('deletes a drawing after asking', async () => {
    await mount()
    drag([[1, 1], [5, 1]])
    await saved()
    menu('File', 'Delete Drawing...')
    expect(text()).toContain('Delete Untitled for good?')
    click(button('Delete'))
    await settle()
    expect((await repo.list('house-a')).items).toHaveLength(0)
    expect(text()).toContain('New drawing')
  })

  it('says when drawings are kept in memory only', async () => {
    await mount('house-a', { persistent: false })
    drag([[1, 1], [5, 1]])
    await saved()
    expect(text()).toContain('Not saved: kept until you close this tab')
  })

  it('asks the browser to warn before the tab closes with unsaved work', async () => {
    await mount()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    drag([[1, 1], [5, 1]])
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('menus by keyboard', () => {
  it('opens with Arrow Down, moves with arrows, and closes with Escape without closing the window', async () => {
    const { onClose } = await mount()
    const file = [...container.querySelectorAll<HTMLButtonElement>('.pt-menu-title')][0]!
    act(() => { file.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })) })
    expect(container.querySelector('[role="menu"][aria-label="File"]')).not.toBeNull()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
    expect(container.querySelector('[role="menu"][aria-label="Edit"]')).not.toBeNull()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(container.querySelector('[role="menu"]')).toBeNull()
    await settle()
    expect(onClose).not.toHaveBeenCalled()
  })
})
