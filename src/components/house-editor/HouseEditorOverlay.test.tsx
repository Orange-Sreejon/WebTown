import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_EDITOR_VIEW,
  emitEditorState,
  onEditorCommand,
  type EditorCommand,
  type EditorView,
} from '../../lib/editor-bridge'
import { RELOAD_NOTICE, statusText } from './EditorPanel'
import { thumbnailStyle } from './FurnitureCatalogue'
import { HouseEditorOverlay } from './HouseEditorOverlay'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLAY: EditorView = { ...HIDDEN_EDITOR_VIEW, houseId: 'house-a', canEdit: true }
const EDIT: EditorView = {
  ...PLAY,
  mode: 'edit',
  catalogue: [
    { type: 'chair', label: 'Chair', thumbnail: { url: '/assets/interior/work4.png', x: 528, y: 70, w: 15, h: 26, sheetW: 675, sheetH: 672 } },
    { type: 'book-stack', label: 'Books', thumbnail: null },
  ],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(sendCommand?: (c: EditorCommand) => void): void {
  act(() => root.render(<HouseEditorOverlay sendCommand={sendCommand} />))
}
function publish(view: EditorView): void {
  act(() => emitEditorState(view))
}
const button = (name: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(name))
  if (!found) throw new Error(`no button "${name}"`)
  return found
}
const click = (el: HTMLElement): void => act(() => el.click())

describe('HouseEditorOverlay', () => {
  it('shows nothing until a view says this house can be edited', () => {
    render()
    expect(container.innerHTML).toBe('')
    publish({ ...PLAY, canEdit: false })
    expect(container.innerHTML).toBe('')
  })

  it('shows Edit House in walkable mode, and sends enter-edit', () => {
    const send = vi.fn()
    render(send)
    publish(PLAY)
    expect(button('Edit House')).toBeTruthy()
    expect(container.textContent).not.toContain('Save')
    click(button('Edit House'))
    expect(send).toHaveBeenCalledWith({ type: 'enter-edit' })
  })

  it('sends commands over the event bus by default', () => {
    const handler = vi.fn()
    const stop = onEditorCommand(handler)
    render()
    publish(PLAY)
    click(button('Edit House'))
    expect(handler).toHaveBeenCalledWith({ type: 'enter-edit' })
    stop()
  })

  it('shows the panel in edit mode with Save disabled until something changes', () => {
    const send = vi.fn()
    render(send)
    publish(EDIT)
    // The panel's heading says "Edit House" too; what must be gone is the ✎ button.
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes('✎'))).toBe(false)
    expect(button('Save').disabled).toBe(true)
    expect(button('Cancel').disabled).toBe(false)

    publish({ ...EDIT, dirty: true })
    expect(button('Save').disabled).toBe(false)
    click(button('Save'))
    click(button('Cancel'))
    expect(send.mock.calls).toEqual([[{ type: 'save' }], [{ type: 'cancel' }]])
  })

  it('disables the controls while saving', () => {
    render(vi.fn())
    publish({ ...EDIT, dirty: true, saving: true, selected: { id: 'chest', label: 'Chest', canRemove: true, removeBlockedReason: null } })
    expect(button('Saving').disabled).toBe(true)
    expect(button('Cancel').disabled).toBe(true)
    expect(button('Remove').disabled).toBe(true)
    expect(button('Chair').disabled).toBe(true)
  })

  it('states that changes are lost after a reload, even with the panel collapsed', () => {
    render(vi.fn())
    publish(EDIT)
    expect(container.textContent).toContain(RELOAD_NOTICE)
    click(button('Hide'))
    expect(container.textContent).toContain(RELOAD_NOTICE)
  })

  it('shows the selection and removes it on request', () => {
    const send = vi.fn()
    render(send)
    publish({ ...EDIT, selected: { id: 'chest', label: 'Chest', canRemove: true, removeBlockedReason: null } })
    expect(container.textContent).toContain('Selected: Chest')
    click(button('Remove'))
    expect(send).toHaveBeenCalledWith({ type: 'remove-selected' })
  })

  it('disables Remove for mandatory or loaded furniture and says why', () => {
    render(vi.fn())
    publish({
      ...EDIT,
      selected: { id: 'computer-desk', label: 'Computer desk', canRemove: false, removeBlockedReason: 'Every house needs a computer' },
    })
    const remove = button('Remove')
    expect(remove.disabled).toBe(true)
    const reasonId = remove.getAttribute('aria-describedby')!
    expect(document.getElementById(reasonId)?.textContent).toBe('Every house needs a computer')
  })

  it('lists the catalogue, marks the entry being placed, and starts placing on click', () => {
    const send = vi.fn()
    render(send)
    publish({ ...EDIT, placingType: 'chair' })
    expect(button('Chair').getAttribute('aria-pressed')).toBe('true')
    expect(button('Books').getAttribute('aria-pressed')).toBe('false')
    click(button('Books'))
    expect(send).toHaveBeenCalledWith({ type: 'start-placing', furnitureType: 'book-stack' })
  })

  it('announces validity in a live region, in words and not only colour', () => {
    render()
    publish({ ...EDIT, preview: { valid: false, message: 'Overlaps the bed' } })
    const status = container.querySelector('[role="status"]')!
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('Overlaps the bed')
    publish({ ...EDIT, preview: { valid: true, message: null } })
    expect(status.textContent).toBe('This spot is free')
  })

  it('collapses the panel body but keeps Save, Cancel and the status', () => {
    render(vi.fn())
    publish(EDIT)
    const toggle = button('Hide')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    click(toggle)
    expect(button('Show').getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Add furniture')
    expect(button('Save')).toBeTruthy()
    expect(container.querySelector('[role="status"]')).not.toBeNull()
  })

  it('lets pointer events through to the canvas except on its controls', () => {
    render()
    publish(PLAY)
    const layer = container.firstElementChild as HTMLElement
    expect(layer.style.pointerEvents).toBe('none')
    expect(button('Edit House').style.pointerEvents).toBe('auto')
  })

  it('stops listening when unmounted', () => {
    render()
    act(() => root.unmount())
    expect(() => publish(PLAY)).not.toThrow()
    root = createRoot(container)
  })
})

describe('statusText', () => {
  it('ranks saving, then errors, then the live preview, then the last refusal', () => {
    expect(statusText({ ...EDIT, saving: true, error: 'x' }).text).toBe('Saving…')
    expect(statusText({ ...EDIT, error: 'Could not save: x', message: 'y' }).text).toBe('Could not save: x')
    expect(statusText({ ...EDIT, preview: { valid: false, message: 'Blocks the way to the door' }, message: 'y' }))
      .toEqual({ text: 'Blocks the way to the door', tone: 'invalid' })
    expect(statusText({ ...EDIT, message: 'Every house needs a notebook' }).tone).toBe('invalid')
    expect(statusText({ ...EDIT, placingType: 'stool' }).text).toMatch(/click a free spot/)
    expect(statusText(EDIT).text).toBe('')
  })
})

describe('thumbnailStyle', () => {
  it('draws the slice from the sheet, pixel-crisp, fitted to 32px', () => {
    const style = thumbnailStyle({ url: '/a.png', x: 528, y: 70, w: 15, h: 26, sheetW: 675, sheetH: 672 })
    // 32 / 26 ≈ 1.23 — under the ×2 cap.
    expect(style.height).toBe(32)
    expect(style.imageRendering).toBe('pixelated')
    expect(style.backgroundImage).toBe('url("/a.png")')
    expect(String(style.backgroundPosition)).toMatch(/^-\d/)
  })

  it('never scales small sprites beyond ×2', () => {
    const style = thumbnailStyle({ url: '/a.png', x: 0, y: 0, w: 6, h: 6, sheetW: 100, sheetH: 100 })
    expect(style.width).toBe(12)
  })
})
