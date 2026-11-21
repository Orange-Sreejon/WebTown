import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryArtworkRepository } from '../../personal-spaces/artwork-storage/memory-artwork-repository'
import { WHITE } from '../../personal-spaces/paint/color'
import { createBuffer } from '../../personal-spaces/paint/pixel-buffer'
import { SketchbookViewer } from './SketchbookViewer'
import { testCodec } from './paint-test-support.test-support'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let repo: MemoryArtworkRepository

beforeEach(() => {
  let t = 0
  repo = new MemoryArtworkRepository({ now: () => new Date(Date.UTC(2026, 10, 20, 12, 0, t++)).toISOString() })
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const add = async (houseId: string, title: string): Promise<void> => {
  await repo.save({ id: null, houseId, title, width: 8, height: 4, transparent: false, png: await testCodec.encode(createBuffer(8, 4, WHITE)) })
}
const button = (name: string): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)!

async function mount(houseId = 'house-a'): Promise<{ download: ReturnType<typeof vi.fn> }> {
  const download = vi.fn()
  act(() => root.render(<SketchbookViewer houseId={houseId} reader={repo} persistent onClose={vi.fn()} download={download} />))
  await settle()
  return { download }
}

describe("a visitor's Sketchbook", () => {
  it('says when there are no drawings', async () => {
    await mount()
    expect(container.textContent).toContain('No drawings yet')
  })

  it('shows the newest drawing first and pages through them', async () => {
    await add('house-a', 'First')
    await add('house-a', 'Second')
    await mount()
    expect(container.textContent).toContain('Second (1 of 2)')
    act(() => button('Next').click())
    expect(container.textContent).toContain('First (2 of 2)')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(container.textContent).toContain('Second (1 of 2)')
    expect(container.querySelector('img.pt-viewer-image')).not.toBeNull()
  })

  it('has no way to draw or change anything', async () => {
    await add('house-a', 'Art')
    await mount()
    expect(container.querySelector('canvas')).toBeNull()
    for (const name of ['Save', 'Delete', 'Rename', 'New', 'Undo', 'Clear']) {
      expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes(name))).toBe(false)
    }
  })

  it("shows only this house's drawings", async () => {
    await add('house-b', 'Not here')
    await mount('house-a')
    expect(container.textContent).not.toContain('Not here')
  })

  it('exports the drawing as a PNG', async () => {
    await add('house-a', 'My Sunset!')
    const { download } = await mount()
    act(() => button('Export PNG').click())
    expect(download.mock.calls[0]![1]).toBe('my-sunset.png')
  })
})
