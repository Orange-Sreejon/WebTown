import { describe, expect, it } from 'vitest'
import { BLACK, TRANSPARENT, WHITE, parseHex, sameColor, type Rgba } from './color'
import { PaintSession, type StrokeInput } from './paint-session'
import { getPixel, type PixelBuffer } from './pixel-buffer'
import { DEFAULT_SETTINGS, type ToolId } from './tools'

const RED = parseHex('#ff0000')!
const BLUE = parseHex('#0000ff')!

const input = (tool: ToolId, change: Partial<StrokeInput> = {}): StrokeInput => ({
  tool, primary: BLACK, secondary: RED, button: 'primary', settings: DEFAULT_SETTINGS, shift: false, ...change,
})
const at = (s: PaintSession, x: number, y: number): Rgba => getPixel(s.image, x, y)!
const count = (b: PixelBuffer, c: Rgba): number => {
  let n = 0
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (sameColor(getPixel(b, x, y)!, c)) n++
  return n
}
const drag = (s: PaintSession, tool: ToolId, from: [number, number], to: [number, number], change: Partial<StrokeInput> = {}): void => {
  s.begin({ x: from[0], y: from[1] }, input(tool, change))
  s.move([{ x: (from[0] + to[0]) / 2 | 0, y: (from[1] + to[1]) / 2 | 0 }], change.shift)
  s.end({ x: to[0], y: to[1] }, change.shift)
}

describe('PaintSession', () => {
  it('starts as a white 640 x 480 canvas', () => {
    const s = PaintSession.blank(640, 480, 'white')
    expect([s.width, s.height]).toEqual([640, 480])
    expect(at(s, 639, 479)).toEqual(WHITE)
    expect(s.canUndo).toBe(false)
  })

  it('pencil draws one-pixel freehand lines in the foreground colour', () => {
    const s = PaintSession.blank(20, 20, 'white')
    drag(s, 'pencil', [1, 1], [10, 1])
    expect(count(s.image, BLACK)).toBe(10)
    expect(s.canUndo).toBe(true)
  })

  it('brush uses its size, and the right button the background colour', () => {
    const s = PaintSession.blank(40, 40, 'white')
    drag(s, 'brush', [20, 20], [20, 20], { settings: { ...DEFAULT_SETTINGS, brushSize: 8 }, button: 'secondary' })
    expect(count(s.image, RED)).toBeGreaterThan(40)
    expect(count(s.image, BLACK)).toBe(0)
  })

  it('eraser restores white, or transparency on a transparent canvas', () => {
    const s = PaintSession.blank(20, 20, 'white')
    drag(s, 'brush', [2, 10], [18, 10], { settings: { ...DEFAULT_SETTINGS, brushSize: 4 } })
    drag(s, 'eraser', [2, 10], [18, 10], { primary: BLUE })
    expect(count(s.image, BLACK)).toBe(0)
    expect(count(s.image, BLUE)).toBe(0)

    const clear = PaintSession.blank(20, 20, 'transparent')
    drag(clear, 'pencil', [5, 5], [6, 5])
    drag(clear, 'eraser', [5, 5], [6, 5])
    expect(at(clear, 5, 5)).toEqual(TRANSPARENT)
  })

  it('line, rectangle and ellipse preview while dragging and commit once on release', () => {
    const s = PaintSession.blank(30, 30, 'white')
    s.begin({ x: 2, y: 2 }, input('rectangle'))
    s.move([{ x: 20, y: 20 }])
    expect(count(s.view, BLACK)).toBeGreaterThan(0)
    expect(count(s.image, BLACK)).toBe(0) // not committed yet
    s.move([{ x: 10, y: 10 }]) // the earlier, bigger preview is gone
    expect(getPixel(s.view, 20, 20)).toEqual(WHITE)
    s.end()
    expect(at(s, 10, 10)).toEqual(BLACK)
    expect(at(s, 2, 2)).toEqual(BLACK)
    s.undo()
    expect(count(s.image, BLACK)).toBe(0)

    drag(s, 'line', [0, 0], [29, 0])
    expect(count(s.image, BLACK)).toBe(30)
    drag(s, 'ellipse', [5, 5], [25, 25], { settings: { ...DEFAULT_SETTINGS, fillStyle: 'both' } })
    expect(at(s, 15, 15)).toEqual(RED)
  })

  it('Shift makes a square and a straight line', () => {
    const s = PaintSession.blank(30, 30, 'white')
    drag(s, 'rectangle', [0, 0], [10, 5], { shift: true, settings: { ...DEFAULT_SETTINGS, fillStyle: 'fill' } })
    expect(count(s.image, BLACK)).toBe(121)
    const l = PaintSession.blank(30, 30, 'white')
    drag(l, 'line', [0, 5], [20, 7], { shift: true })
    expect(count(l.image, BLACK)).toBe(21)
    expect(at(l, 20, 5)).toEqual(BLACK)
  })

  it('fill is one step; filling with the same colour records nothing', () => {
    const s = PaintSession.blank(10, 10, 'white')
    expect(s.begin({ x: 3, y: 3 }, input('fill', { primary: BLUE }))).toEqual({ kind: 'done' })
    expect(count(s.image, BLUE)).toBe(100)
    expect(s.revision).toBe(1)
    s.begin({ x: 3, y: 3 }, input('fill', { primary: BLUE }))
    expect(s.revision).toBe(1)
  })

  it('pick colour reads the pixel and changes nothing', () => {
    const s = PaintSession.blank(10, 10, 'white')
    drag(s, 'pencil', [4, 4], [4, 4], { primary: BLUE })
    expect(s.begin({ x: 4, y: 4 }, input('picker'))).toEqual({ kind: 'picked', color: BLUE })
    expect(s.begin({ x: 40, y: 4 }, input('picker'))).toEqual({ kind: 'picked', color: null })
    expect(s.revision).toBe(1)
  })

  it('text asks for a box, then draws its mask as one step', () => {
    const s = PaintSession.blank(10, 10, 'white')
    expect(s.begin({ x: 2, y: 3 }, input('text'))).toEqual({ kind: 'text', at: { x: 2, y: 3 } })
    expect(s.applyMask({ width: 2, height: 1, bits: new Uint8Array([1, 1]) }, 2, 3, BLUE)).toBe(true)
    expect(at(s, 3, 3)).toEqual(BLUE)
    s.undo()
    expect(at(s, 3, 3)).toEqual(WHITE)
  })

  it('airbrush sprays while held still', () => {
    let seed = 7
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    const s = PaintSession.blank(40, 40, 'white', { random })
    s.begin({ x: 20, y: 20 }, input('airbrush'))
    const first = count(s.image, BLACK)
    for (let i = 0; i < 10; i++) s.tick()
    expect(count(s.image, BLACK)).toBeGreaterThan(first)
    s.end()
    expect(s.canUndo).toBe(true)
  })

  it('cancel puts the picture back and records nothing', () => {
    const s = PaintSession.blank(20, 20, 'white')
    s.begin({ x: 0, y: 0 }, input('brush'))
    s.move([{ x: 19, y: 19 }])
    expect(count(s.image, BLACK)).toBeGreaterThan(0)
    expect(s.cancel()).toBe(true)
    expect(count(s.image, BLACK)).toBe(0)
    expect(s.canUndo).toBe(false)
    s.begin({ x: 0, y: 0 }, input('ellipse'))
    s.move([{ x: 19, y: 19 }])
    s.cancel()
    expect(count(s.view, BLACK)).toBe(0)
  })

  it('undo and redo every kind of action, in order', () => {
    const s = PaintSession.blank(20, 20, 'white')
    drag(s, 'pencil', [0, 0], [5, 0])
    drag(s, 'rectangle', [2, 2], [8, 8])
    s.begin({ x: 15, y: 15 }, input('fill', { primary: BLUE }))
    s.clear()
    expect(count(s.image, WHITE)).toBe(400)
    s.undo()
    expect(at(s, 15, 15)).toEqual(BLUE)
    s.undo()
    expect(at(s, 15, 15)).toEqual(WHITE)
    expect(at(s, 2, 2)).toEqual(BLACK)
    s.undo()
    s.undo()
    expect(count(s.image, BLACK)).toBe(0)
    expect(s.canUndo).toBe(false)
    s.redo()
    expect(count(s.image, BLACK)).toBe(6)
    s.redo(); s.redo(); s.redo()
    expect(count(s.image, WHITE)).toBe(400)
    expect(s.canRedo).toBe(false)
  })

  it('a new action after undo drops the redo', () => {
    const s = PaintSession.blank(10, 10, 'white')
    drag(s, 'pencil', [0, 0], [0, 0])
    s.undo()
    drag(s, 'pencil', [1, 1], [1, 1])
    expect(s.canRedo).toBe(false)
  })

  it('resizes and changes the base as one undoable step', () => {
    const s = PaintSession.blank(10, 10, 'white')
    drag(s, 'pencil', [9, 9], [9, 9])
    expect(s.setAttributes(20, 5, 'transparent')).toBe(true)
    expect([s.width, s.height, s.base]).toEqual([20, 5, 'transparent'])
    expect(at(s, 15, 2)).toEqual(TRANSPARENT)
    expect(at(s, 2, 2)).toEqual(WHITE)
    s.undo()
    expect([s.width, s.height, s.base]).toEqual([10, 10, 'white'])
    expect(at(s, 9, 9)).toEqual(BLACK)
    s.redo()
    expect(s.width).toBe(20)
    expect(s.setAttributes(20, 5, 'transparent')).toBe(false)
  })

  it('counts revisions for autosave and tells listeners', () => {
    const s = PaintSession.blank(10, 10, 'white')
    let heard = 0
    const stop = s.onChange(() => heard++)
    drag(s, 'pencil', [0, 0], [3, 3])
    expect(s.revision).toBe(1)
    expect(heard).toBeGreaterThan(0)
    expect(s.takeDirty()).not.toBeNull()
    expect(s.takeDirty()).toBeNull()
    stop()
  })

  it('ignores a second press while one is in progress, and undo while drawing', () => {
    const s = PaintSession.blank(10, 10, 'white')
    s.begin({ x: 0, y: 0 }, input('pencil'))
    expect(s.begin({ x: 5, y: 5 }, input('pencil'))).toEqual({ kind: 'ignored' })
    expect(s.undo()).toBe(false)
    s.end()
  })

  it('loads another picture with a fresh history', () => {
    const s = PaintSession.blank(10, 10, 'white')
    drag(s, 'pencil', [0, 0], [0, 0])
    const other = PaintSession.blank(4, 4, 'transparent')
    s.load(other.image, 'transparent')
    expect(s.width).toBe(4)
    expect(s.canUndo).toBe(false)
  })
})
