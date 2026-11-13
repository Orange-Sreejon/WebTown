import { describe, expect, it, vi } from 'vitest'
import type { Point } from '../../../lib/geometry'
import { TILE_SIZE } from '../../config/GameConfig'
import { pieceBounds } from '../interior-layout'
import { DEFAULT_TEMPLATE, createDefaultLayout } from './default-interior'
import { EditorSession } from './editor-session'
import type { HouseLayout } from './house-layout'
import { InMemoryHouseLayoutStore, type HouseLayoutStore } from './house-layout-store'

/** A store that records saves and can be told to fail or to hold a save open. */
class FakeStore implements HouseLayoutStore {
  saves: HouseLayout[] = []
  failWith: string | null = null
  private release: (() => void) | null = null
  hold = false

  async load(houseId: string): Promise<HouseLayout> {
    return createDefaultLayout(houseId)
  }

  save(layout: HouseLayout): Promise<void> {
    this.saves.push(JSON.parse(JSON.stringify(layout)) as HouseLayout)
    if (this.failWith) return Promise.reject(new Error(this.failWith))
    if (!this.hold) return Promise.resolve()
    return new Promise(resolve => { this.release = resolve })
  }

  finish(): void {
    this.release?.()
    this.release = null
  }
}

function setup(options: { canEdit?: boolean; store?: HouseLayoutStore; houseId?: string } = {}) {
  const houseId = options.houseId ?? 'house-a'
  const layout = createDefaultLayout(houseId)
  const original = JSON.stringify(layout)
  const store = options.store ?? new FakeStore()
  const session = new EditorSession({
    houseId,
    template: DEFAULT_TEMPLATE,
    layout,
    store,
    canEdit: options.canEdit ?? true,
  })
  session.setDragThreshold(3)
  return { session, layout, original, store }
}

const piece = (s: EditorSession, id: string) => s.definition().pieces.find(p => p.id === id)!
const centreOf = (s: EditorSession, id: string): Point => {
  const b = pieceBounds(piece(s, id))
  return { x: Math.floor(b.x + b.w / 2), y: Math.floor(b.y + b.h / 2) }
}
const itemAt = (s: EditorSession, id: string) => s.draft.items.find(i => i.id === id)?.at

/** Presses an item (at its centre unless told otherwise) and returns the pointer that lands its anchor on (col, row). */
function grabTowards(s: EditorSession, id: string, col: number, row: number, start = centreOf(s, id)): Point {
  const p = piece(s, id)
  s.pointerDown(start)
  return { x: col * TILE_SIZE + (start.x - p.x), y: row * TILE_SIZE + (start.y - p.bottom) }
}

/** A point on the table that nothing rests on: its bottom-left corner. */
const bareTable = (s: EditorSession): Point => {
  const b = pieceBounds(piece(s, 'table'))
  return { x: b.x + 4, y: b.y + b.h - 6 }
}

function dragTo(s: EditorSession, id: string, col: number, row: number): void {
  const end = grabTowards(s, id, col, row)
  s.pointerMove(end)
  s.pointerUp(end)
}

describe('entering and leaving edit mode', () => {
  it('starts in play mode and ignores the pointer there', () => {
    const { session } = setup()
    expect(session.mode).toBe('play')
    session.pointerDown(centreOf(session, 'chest'))
    expect(session.selectedId).toBeNull()
    expect(session.view()).toMatchObject({ mode: 'play', canEdit: true, catalogue: [] })
  })

  it('refuses edit mode in a house the player does not own', () => {
    const { session } = setup({ canEdit: false })
    expect(session.beginEdit()).toBe(false)
    expect(session.mode).toBe('play')
    expect(session.view().canEdit).toBe(false)
  })

  it('opens the catalogue in edit mode', () => {
    const { session } = setup()
    expect(session.beginEdit()).toBe(true)
    expect(session.view().mode).toBe('edit')
    expect(session.view().catalogue.length).toBeGreaterThan(5)
  })
})

describe('selection', () => {
  it('selects the item under the pointer, topmost first', () => {
    const { session } = setup()
    session.beginEdit()
    session.pointerDown(centreOf(session, 'notebook'))
    expect(session.selectedId).toBe('notebook')
    expect(session.view().selected).toMatchObject({ id: 'notebook', label: 'Notebook' })
    session.pointerUp(centreOf(session, 'notebook'))
    session.pointerDown(bareTable(session))
    expect(session.selectedId).toBe('table')
  })

  it('clears the selection on bare floor and never selects the door', () => {
    const { session } = setup()
    session.beginEdit()
    session.pointerDown(centreOf(session, 'chest'))
    session.pointerUp(centreOf(session, 'chest'))
    session.pointerDown({ x: 90, y: 110 })
    expect(session.selectedId).toBeNull()
    session.pointerDown(centreOf(session, 'door'))
    expect(session.selectedId).toBeNull()
  })

  it('treats a click without movement as selection only', () => {
    const { session, original } = setup()
    session.beginEdit()
    const start = centreOf(session, 'chest')
    session.pointerDown(start)
    session.pointerMove({ x: start.x + 2, y: start.y }) // under the 3px threshold
    expect(session.gesture.kind).toBe('pressed')
    session.pointerUp({ x: start.x + 2, y: start.y })
    expect(session.dirty).toBe(false)
    expect(JSON.stringify(session.draft)).toBe(original)
  })
})

describe('dragging and grid snapping', () => {
  it('moves an item to the snapped cell and drops the default-room nudge', () => {
    const { session } = setup()
    session.beginEdit()
    expect(itemAt(session, 'chest')).toMatchObject({ nudge: { x: 14, y: 4 } })
    dragTo(session, 'chest', 5, 13)
    expect(itemAt(session, 'chest')).toEqual({ kind: 'grid', col: 5, row: 13 })
    expect(piece(session, 'chest').x).toBe(5 * TILE_SIZE)
    expect(piece(session, 'chest').bottom).toBe(13 * TILE_SIZE)
    expect(session.dirty).toBe(true)
  })

  it('snaps to the nearest cell from anywhere inside it', () => {
    const { session } = setup()
    session.beginEdit()
    const end = grabTowards(session, 'chest', 5, 13)
    session.pointerMove({ x: end.x + 7, y: end.y - 7 })
    session.pointerUp({ x: end.x + 7, y: end.y - 7 })
    expect(itemAt(session, 'chest')).toEqual({ kind: 'grid', col: 5, row: 13 })
  })

  it('previews the item at the snapped spot, green, while hiding the original', () => {
    const { session } = setup()
    session.beginEdit()
    const end = grabTowards(session, 'chest', 5, 13)
    session.pointerMove(end)
    const preview = session.preview()!
    expect(preview.valid).toBe(true)
    expect(preview.message).toBeNull()
    expect(preview.hiddenIds).toEqual(['chest'])
    expect(preview.pieces[0]).toMatchObject({ id: 'chest', x: 80, bottom: 208 })
    expect(session.view().preview).toEqual({ valid: true, message: null })
  })

  it('keeps unrelated items exactly where they were', () => {
    const { session } = setup()
    session.beginEdit()
    const before = session.definition().pieces.filter(p => p.id !== 'chest')
    dragTo(session, 'chest', 5, 13)
    expect(session.definition().pieces.filter(p => p.id !== 'chest')).toEqual(before)
  })

  it('validates only when the snapped cell changes', () => {
    const { session } = setup()
    session.beginEdit()
    const end = grabTowards(session, 'chest', 5, 13)
    session.pointerMove(end)
    const resultOf = (): unknown => {
      const g = session.gesture
      return g.kind === 'dragging' ? g.result : undefined
    }
    const first = resultOf()
    expect(first).toBeDefined()

    // Small moves inside the same cell reuse the same validation result…
    session.pointerMove({ x: end.x + 1, y: end.y })
    session.pointerMove({ x: end.x + 2, y: end.y - 1 })
    expect(resultOf()).toBe(first)

    // …and crossing into the next cell validates afresh.
    session.pointerMove({ x: end.x + TILE_SIZE, y: end.y })
    expect(resultOf()).not.toBe(first)
  })
})

describe('invalid placement', () => {
  const cases: Array<[string, number, number, string]> = [
    ['onto the bed', 0, 7, 'Overlaps the bed'],
    ['into the doorway', 8, 6, 'Blocks the way to the door'],
    ['onto the arrival spot', 8, 7, 'Blocks the spot inside the door'],
    ['outside the room', 30, 9, "Doesn't fit on the floor here"],
  ]

  for (const [name, col, row, reason] of cases) {
    it(`shows red with a reason, and changes nothing on drop: ${name}`, () => {
      const { session, original } = setup()
      session.beginEdit()
      const version = session.version
      const end = grabTowards(session, 'chest', col, row)
      session.pointerMove(end)
      expect(session.preview()).toMatchObject({ valid: false, message: reason })
      expect(session.view().preview).toEqual({ valid: false, message: reason })

      session.pointerUp(end)
      expect(JSON.stringify(session.draft)).toBe(original)
      expect(session.version).toBe(version)
      expect(session.view().message).toBe(reason)
      expect(session.dirty).toBe(false)
    })
  }

  it('cancels a drag with Escape', () => {
    const { session, original } = setup()
    session.beginEdit()
    const end = grabTowards(session, 'chest', 5, 13)
    session.pointerMove(end)
    session.escape()
    expect(session.gesture.kind).toBe('idle')
    session.pointerUp(end)
    expect(JSON.stringify(session.draft)).toBe(original)
  })
})

describe('supporting furniture', () => {
  it('moves the notebook and the books with their table', () => {
    const { session } = setup()
    session.beginEdit()
    const before = ['table', 'notebook', 'books'].map(id => ({ ...piece(session, id) }))
    const end = grabTowards(session, 'table', 5, 11, bareTable(session))
    session.pointerMove(end)
    expect(session.preview()!.hiddenIds.sort()).toEqual(['books', 'notebook', 'table'])
    session.pointerUp(end)

    const dx = piece(session, 'table').x - before[0]!.x
    const dy = piece(session, 'table').bottom - before[0]!.bottom
    expect(dx).not.toBe(0)
    for (const [i, id] of ['table', 'notebook', 'books'].entries()) {
      expect(piece(session, id).x - before[i]!.x, id).toBe(dx)
      expect(piece(session, id).bottom - before[i]!.bottom, id).toBe(dy)
    }
  })

  it('keeps the notebook on a support: red over the floor, green over the nightstand', () => {
    const { session } = setup()
    session.beginEdit()
    const start = centreOf(session, 'notebook')
    session.pointerDown(start)
    session.pointerMove({ x: 110, y: 120 })
    expect(session.preview()).toMatchObject({ valid: false, message: 'Must rest on a table or nightstand' })
    session.pointerUp({ x: 110, y: 120 })
    expect(itemAt(session, 'notebook')).toMatchObject({ kind: 'attached', to: 'table' })

    session.pointerDown(centreOf(session, 'notebook'))
    session.pointerMove(centreOf(session, 'nightstand'))
    expect(session.preview()!.valid).toBe(true)
    session.pointerUp(centreOf(session, 'nightstand'))
    expect(itemAt(session, 'notebook')).toMatchObject({ kind: 'attached', to: 'nightstand' })
  })

  it('blocks removing a loaded table, then allows it once emptied', () => {
    const { session } = setup()
    session.beginEdit()
    session.pointerDown(bareTable(session))
    session.pointerUp(bareTable(session))
    expect(session.view().selected).toMatchObject({
      canRemove: false,
      removeBlockedReason: 'Move the notebook and the books off it first',
    })
    session.removeSelected()
    expect(itemAt(session, 'table')).toBeDefined()
    expect(session.view().message).toBe('Move the notebook and the books off it first')

    for (const id of ['notebook', 'books']) {
      session.pointerDown(centreOf(session, id))
      session.pointerMove(centreOf(session, 'nightstand'))
      session.pointerUp(centreOf(session, 'nightstand'))
      expect(itemAt(session, id), id).toMatchObject({ to: 'nightstand' })
    }

    session.pointerDown(bareTable(session))
    session.pointerUp(bareTable(session))
    expect(session.view().selected).toMatchObject({ canRemove: true, removeBlockedReason: null })
    session.removeSelected()
    expect(itemAt(session, 'table')).toBeUndefined()
    expect(itemAt(session, 'notebook')).toBeDefined()
  })
})

describe('mandatory objects', () => {
  for (const [id, reason] of [
    ['computer-desk', 'Every house needs a computer'],
    ['notebook', 'Every house needs a notebook'],
  ] as const) {
    it(`never removes the ${id}`, () => {
      const { session } = setup()
      session.beginEdit()
      session.pointerDown(centreOf(session, id))
      session.pointerUp(centreOf(session, id))
      expect(session.view().selected).toMatchObject({ canRemove: false, removeBlockedReason: reason })
      session.removeSelected()
      expect(itemAt(session, id)).toBeDefined()
      expect(session.view().message).toBe(reason)
    })
  }

  it('never offers or places a second computer or notebook', () => {
    const { session } = setup()
    session.beginEdit()
    const types = session.view().catalogue.map(c => c.type)
    expect(types).not.toContain('computer-desk')
    expect(types).not.toContain('notebook')
    session.startPlacing('computer-desk')
    session.startPlacing('notebook')
    expect(session.gesture.kind).toBe('idle')
  })
})

describe('adding furniture', () => {
  it('places a catalogue item where the ghost is green, and selects it', () => {
    const { session } = setup()
    session.beginEdit()
    session.startPlacing('stool')
    expect(session.view().placingType).toBe('stool')
    expect(session.view().preview).toBeNull() // pointer not over the room yet

    // The stool is held by its centre (7, -10); this lands its anchor on (6, 13).
    const spot = { x: 6 * TILE_SIZE + 7, y: 13 * TILE_SIZE - 10 }
    session.pointerMove(spot)
    expect(session.preview()).toMatchObject({ valid: true, hiddenIds: [] })
    expect(session.preview()!.pieces[0]).toMatchObject({ id: 'stool', x: 96, bottom: 208 })

    session.pointerDown(spot)
    expect(itemAt(session, 'stool')).toEqual({ kind: 'grid', col: 6, row: 13 })
    expect(session.selectedId).toBe('stool')
    expect(session.gesture.kind).toBe('idle')
  })

  it('numbers repeated additions', () => {
    const { session } = setup()
    session.beginEdit()
    for (const col of [6, 9]) {
      session.startPlacing('stool')
      const spot = { x: col * TILE_SIZE + 7, y: 13 * TILE_SIZE - 10 }
      session.pointerMove(spot)
      session.pointerDown(spot)
    }
    expect(session.draft.items.filter(i => i.type === 'stool').map(i => i.id)).toEqual(['stool', 'stool-2'])
  })

  it('refuses to place on an invalid spot and keeps placing', () => {
    const { session, original } = setup()
    session.beginEdit()
    session.startPlacing('stool')
    const onBed = centreOf(session, 'bed')
    session.pointerMove(onBed)
    expect(session.preview()!.valid).toBe(false)
    session.pointerDown(onBed)
    expect(JSON.stringify(session.draft)).toBe(original)
    expect(session.gesture.kind).toBe('placing')
    expect(session.view().message).toBe('Overlaps the bed')
  })

  it('stops placing on Escape or when the same entry is chosen again', () => {
    const { session } = setup()
    session.beginEdit()
    session.startPlacing('stool')
    session.escape()
    expect(session.gesture.kind).toBe('idle')
    session.startPlacing('chair')
    session.startPlacing('chair')
    expect(session.gesture.kind).toBe('idle')
  })

  it('places a resting item only on a support', () => {
    const { session } = setup()
    session.beginEdit()
    session.startPlacing('lamp')
    session.pointerMove({ x: 110, y: 120 })
    expect(session.preview()).toMatchObject({ valid: false, message: 'Must rest on a table or nightstand' })
    session.pointerMove(centreOf(session, 'table'))
    session.pointerDown(centreOf(session, 'table'))
    expect(itemAt(session, 'lamp-2')).toMatchObject({ kind: 'attached', to: 'table' })
  })
})

describe('removing furniture', () => {
  it('removes the selected optional item', () => {
    const { session } = setup()
    session.beginEdit()
    session.pointerDown(centreOf(session, 'chest'))
    session.pointerUp(centreOf(session, 'chest'))
    session.removeSelected()
    expect(itemAt(session, 'chest')).toBeUndefined()
    expect(session.selectedId).toBeNull()
    expect(session.dirty).toBe(true)
  })

  it('does nothing without a selection', () => {
    const { session, original } = setup()
    session.beginEdit()
    session.removeSelected()
    expect(JSON.stringify(session.draft)).toBe(original)
  })
})

describe('save and cancel', () => {
  it('saves the whole draft in one store call, then returns to play', async () => {
    const store = new FakeStore()
    const { session } = setup({ store })
    session.beginEdit()
    dragTo(session, 'chest', 5, 13)
    const draft = session.draft

    const outcome = await session.save()
    expect(outcome).toEqual({ ok: true })
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0]).toEqual(draft)
    expect(session.mode).toBe('play')
    expect(session.committed).toEqual(draft)
    expect(session.dirty).toBe(false)
  })

  it('is disabled while saving and ignores a second save', async () => {
    const store = new FakeStore()
    store.hold = true
    const { session } = setup({ store })
    session.beginEdit()
    dragTo(session, 'chest', 5, 13)

    const first = session.save()
    expect(session.view().saving).toBe(true)
    expect(await session.save()).toMatchObject({ ok: false })
    // Clicks are ignored while saving: the selection from the drag stays as it was.
    session.pointerDown(centreOf(session, 'bed'))
    expect(session.selectedId).toBe('chest')
    store.finish()
    expect(await first).toEqual({ ok: true })
    expect(store.saves).toHaveLength(1)
  })

  it('keeps the draft and edit mode when the store refuses, and shows why', async () => {
    const store = new FakeStore()
    store.failWith = 'disk on fire'
    const { session, original } = setup({ store })
    session.beginEdit()
    dragTo(session, 'chest', 5, 13)
    const draft = session.draft

    const outcome = await session.save()
    expect(outcome).toEqual({ ok: false, error: 'disk on fire' })
    expect(session.mode).toBe('edit')
    expect(session.draft).toEqual(draft)
    expect(JSON.stringify(session.committed)).toBe(original)
    expect(session.view()).toMatchObject({ saving: false, error: 'Could not save: disk on fire', dirty: true })
  })

  it('does not call the store when nothing changed', async () => {
    const store = new FakeStore()
    const { session } = setup({ store })
    session.beginEdit()
    expect(await session.save()).toEqual({ ok: true })
    expect(store.saves).toHaveLength(0)
    expect(session.mode).toBe('play')
  })

  it('cancel restores the layout from before editing and never touches the store', () => {
    const store = new FakeStore()
    const { session, original } = setup({ store })
    session.beginEdit()
    dragTo(session, 'chest', 5, 13)
    session.pointerDown(centreOf(session, 'plant-red'))
    session.pointerUp(centreOf(session, 'plant-red'))
    session.removeSelected()
    expect(session.dirty).toBe(true)

    session.cancel()
    expect(session.mode).toBe('play')
    expect(JSON.stringify(session.draft)).toBe(original)
    expect(session.dirty).toBe(false)
    expect(store.saves).toHaveLength(0)
  })

  it('a later edit starts from the last saved layout', async () => {
    const { session } = setup()
    session.beginEdit()
    dragTo(session, 'chest', 5, 13)
    await session.save()
    session.beginEdit()
    expect(itemAt(session, 'chest')).toEqual({ kind: 'grid', col: 5, row: 13 })
    session.cancel()
    expect(itemAt(session, 'chest')).toEqual({ kind: 'grid', col: 5, row: 13 })
  })

  it('never mutates the layout it was given', async () => {
    const { session, layout, original } = setup()
    session.beginEdit()
    dragTo(session, 'chest', 5, 13)
    await session.save()
    expect(JSON.stringify(layout)).toBe(original)
  })
})

describe('house isolation', () => {
  it('saving one house through the real store leaves every other house at the default', async () => {
    const store = new InMemoryHouseLayoutStore()
    const a = new EditorSession({
      houseId: 'house-a', template: DEFAULT_TEMPLATE, layout: await store.load('house-a'), store, canEdit: true,
    })
    a.setDragThreshold(3)
    a.beginEdit()
    dragTo(a, 'chest', 5, 13)
    expect(await a.save()).toEqual({ ok: true })

    expect((await store.load('house-a')).items.find(i => i.id === 'chest')!.at).toEqual({
      kind: 'grid', col: 5, row: 13,
    })
    for (const other of ['house-b', 'house-c', 'house-g']) {
      expect((await store.load(other)).items, other).toEqual(createDefaultLayout(other).items)
    }
    expect(createDefaultLayout('fresh').items.find(i => i.id === 'chest')!.at).toMatchObject({
      nudge: { x: 14, y: 4 },
    })
  })
})

describe('notifications', () => {
  it('notifies subscribers of changes, and stops after unsubscribe or dispose', () => {
    const { session } = setup()
    const listener = vi.fn()
    const stop = session.subscribe(listener)
    session.beginEdit()
    expect(listener).toHaveBeenCalled()
    stop()
    const count = listener.mock.calls.length
    session.escape()
    expect(listener.mock.calls.length).toBe(count)

    const other = vi.fn()
    session.subscribe(other)
    session.dispose()
    session.cancel()
    expect(other).not.toHaveBeenCalled()
    expect(session.view().canEdit).toBe(false)
  })
})
