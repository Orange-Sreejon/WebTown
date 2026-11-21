import { describe, expect, it } from 'vitest'
import { BLACK, PALETTE, TRANSPARENT, WHITE, parseHex, sameColor, toHex, describeColor, type Rgba } from './color'
import { clientToPixel } from './coords'
import { History } from './history'
import { createBuffer, getPixel, resizeBuffer, setPixel, type PixelBuffer } from './pixel-buffer'
import { discOffsets, drawEllipse, drawMask, drawRectangle, floodFill, linePoints, snapLine, spray, squareBox, strokeSegment } from './raster'

const RED = parseHex('#ff0000')!
const BLUE = parseHex('#0000ff')!

/** The picture as text: `#` where the colour is, `.` elsewhere. */
function picture(b: PixelBuffer, c: Rgba = BLACK): string {
  const rows: string[] = []
  for (let y = 0; y < b.height; y++) {
    let row = ''
    for (let x = 0; x < b.width; x++) row += sameColor(getPixel(b, x, y)!, c) ? '#' : '.'
    rows.push(row)
  }
  return rows.join('\n')
}
const count = (b: PixelBuffer, c: Rgba): number => picture(b, c).split('').filter(ch => ch === '#').length
const white = (w: number, h: number): PixelBuffer => createBuffer(w, h, WHITE)

describe('colours', () => {
  it('has the classic 28-colour box with black, white and the primaries', () => {
    expect(PALETTE).toHaveLength(28)
    const hexes = PALETTE.map(s => toHex(s.color))
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00']) expect(hexes).toContain(hex)
    expect(new Set(hexes).size).toBe(28)
  })

  it('parses and formats hex', () => {
    expect(parseHex('#F80')).toEqual({ r: 255, g: 136, b: 0, a: 255 })
    expect(parseHex('nope')).toBeNull()
    expect(toHex({ r: 1, g: 2, b: 255, a: 255 })).toBe('#0102ff')
    expect(describeColor(RED, 'Red')).toBe('Red, #FF0000')
    expect(describeColor(TRANSPARENT)).toBe('Transparent')
  })
})

describe('pixel buffer', () => {
  it('starts in the fill colour and clips writes', () => {
    const b = white(3, 2)
    expect(getPixel(b, 2, 1)).toEqual(WHITE)
    setPixel(b, -1, 0, BLACK)
    setPixel(b, 3, 0, BLACK)
    setPixel(b, 0, 5, BLACK)
    expect(count(b, BLACK)).toBe(0)
    expect(getPixel(b, 3, 0)).toBeNull()
  })

  it('refuses impossible sizes', () => {
    expect(() => createBuffer(0, 1, WHITE)).toThrow(RangeError)
    expect(() => createBuffer(1281, 1, WHITE)).toThrow(RangeError)
    expect(() => createBuffer(1.5, 1, WHITE)).toThrow(RangeError)
  })

  it('resizes keeping the picture at the top left', () => {
    const b = white(2, 2)
    setPixel(b, 1, 1, BLACK)
    const bigger = resizeBuffer(b, 3, 3, TRANSPARENT)
    expect(getPixel(bigger, 1, 1)).toEqual(BLACK)
    expect(getPixel(bigger, 2, 2)).toEqual(TRANSPARENT)
    expect(getPixel(bigger, 0, 0)).toEqual(WHITE)
    const smaller = resizeBuffer(bigger, 1, 1, WHITE)
    expect(getPixel(smaller, 0, 0)).toEqual(WHITE)
  })
})

describe('lines and strokes', () => {
  it('draws Bresenham lines with both ends', () => {
    expect(linePoints({ x: 0, y: 0 }, { x: 3, y: 1 })).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }])
    expect(linePoints({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }])
  })

  it('joins far-apart samples so a fast stroke has no gaps', () => {
    const b = white(20, 3)
    strokeSegment(b, { x: 0, y: 1 }, { x: 19, y: 1 }, 1, BLACK)
    expect(picture(b).split('\n')[1]).toBe('#'.repeat(20))
  })

  it('uses a round brush of the chosen size', () => {
    expect(discOffsets(1)).toHaveLength(1)
    expect(discOffsets(2)).toHaveLength(4)
    const b = white(9, 9)
    strokeSegment(b, { x: 4, y: 4 }, { x: 4, y: 4 }, 6, BLACK)
    const art = picture(b)
    expect(art).toBe([
      '.........',
      '..####...',
      '.######..',
      '.######..',
      '.######..',
      '.######..',
      '..####...',
      '.........',
      '.........',
    ].join('\n'))
    expect(count(b, BLACK)).toBe(32)
  })

  it('clips a line that runs off the canvas and keeps its angle', () => {
    const b = white(4, 4)
    strokeSegment(b, { x: -10, y: -10 }, { x: 10, y: 10 }, 1, BLACK)
    expect(picture(b)).toBe('#...\n.#..\n..#.\n...#')
  })

  it('snaps lines to 0, 45 and 90 degrees with Shift', () => {
    expect(snapLine({ x: 0, y: 0 }, { x: 10, y: 2 })).toEqual({ x: 10, y: 0 })
    expect(snapLine({ x: 0, y: 0 }, { x: 1, y: -9 })).toEqual({ x: 0, y: -9 })
    expect(snapLine({ x: 0, y: 0 }, { x: 8, y: 7 })).toEqual({ x: 8, y: 8 })
    expect(squareBox({ x: 5, y: 5 }, { x: 2, y: 9 })).toEqual({ x: 1, y: 9 })
  })
})

describe('rectangles', () => {
  it('draws an outline inside the box, at the line width', () => {
    const b = white(6, 5)
    drawRectangle(b, { x: 4, y: 3 }, { x: 0, y: 0 }, 'outline', 1, BLACK, RED)
    expect(picture(b)).toBe('#####.\n#...#.\n#...#.\n#####.\n......')
    const thick = white(6, 6)
    drawRectangle(thick, { x: 0, y: 0 }, { x: 5, y: 5 }, 'outline', 2, BLACK, RED)
    expect(picture(thick)).toBe('######\n######\n##..##\n##..##\n######\n######')
  })

  it('fills with the background colour inside the outline, or fills solid', () => {
    const b = white(5, 5)
    drawRectangle(b, { x: 0, y: 0 }, { x: 4, y: 4 }, 'both', 1, BLACK, RED)
    expect(count(b, BLACK)).toBe(16)
    expect(count(b, RED)).toBe(9)
    const solid = white(5, 5)
    drawRectangle(solid, { x: 1, y: 1 }, { x: 3, y: 3 }, 'fill', 1, BLUE, RED)
    expect(count(solid, BLUE)).toBe(9)
    expect(count(solid, RED)).toBe(0)
  })
})

describe('ellipses', () => {
  it('is symmetric and inscribed in the box', () => {
    const b = white(9, 7)
    drawEllipse(b, { x: 0, y: 0 }, { x: 8, y: 6 }, 'fill', 1, BLACK, RED)
    const rows = picture(b).split('\n')
    for (const row of rows) expect(row).toBe([...row].reverse().join(''))
    expect(rows[0]).not.toBe('.........')
    expect(rows[3]).toBe('#########')
    expect(rows).toEqual([...rows].reverse())
  })

  it('draws an outline that a fill cannot leak through, at many sizes', () => {
    for (const [w, h] of [[5, 5], [12, 7], [30, 30], [61, 23], [7, 40], [100, 64]] as const) {
      for (const width of [1, 3]) {
        const b = white(w + 4, h + 4)
        drawEllipse(b, { x: 2, y: 2 }, { x: w + 1, y: h + 1 }, 'outline', width, BLACK, RED)
        floodFill(b, { x: Math.floor((w + 4) / 2), y: Math.floor((h + 4) / 2) }, RED)
        // The corners of the canvas are outside the ellipse: still white.
        expect(getPixel(b, 0, 0), `${w}x${h} width ${width}`).toEqual(WHITE)
        expect(getPixel(b, w + 3, h + 3), `${w}x${h} width ${width}`).toEqual(WHITE)
        expect(count(b, RED), `${w}x${h} width ${width}`).toBeGreaterThan(0)
      }
    }
  })

  it('fills inside the outline with the background colour', () => {
    const b = white(20, 20)
    drawEllipse(b, { x: 0, y: 0 }, { x: 19, y: 19 }, 'both', 1, BLACK, RED)
    expect(getPixel(b, 10, 10)).toEqual(RED)
    expect(getPixel(b, 0, 0)).toEqual(WHITE)
    expect(count(b, BLACK)).toBeGreaterThan(40)
  })
})

describe('fill', () => {
  it('fills exactly the 4-connected area and stops at a diagonal wall', () => {
    const b = white(5, 5)
    for (let i = 0; i < 5; i++) setPixel(b, i, 4 - i, BLACK)
    expect(floodFill(b, { x: 0, y: 0 }, RED)).toBe(true)
    expect(picture(b, RED)).toBe('####.\n###..\n##...\n#....\n.....')
  })

  it('does nothing when the colour is already there, or outside', () => {
    const b = white(3, 3)
    expect(floodFill(b, { x: 1, y: 1 }, WHITE)).toBe(false)
    expect(floodFill(b, { x: 9, y: 9 }, RED)).toBe(false)
  })

  it('fills a large canvas without recursion', () => {
    const b = createBuffer(1280, 1024, WHITE)
    expect(floodFill(b, { x: 0, y: 0 }, RED)).toBe(true)
    expect(getPixel(b, 1279, 1023)).toEqual(RED)
  })
})

describe('airbrush and text', () => {
  it('sprays dots inside its disc', () => {
    let seed = 1
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    const b = white(41, 41)
    spray(b, { x: 20, y: 20 }, 16, BLACK, random, 200)
    const dots = count(b, BLACK)
    expect(dots).toBeGreaterThan(50)
    for (let y = 0; y < 41; y++) for (let x = 0; x < 41; x++) {
      if (sameColor(getPixel(b, x, y)!, BLACK)) expect(Math.hypot(x - 20, y - 20)).toBeLessThanOrEqual(9)
    }
  })

  it('draws a one-bit mask', () => {
    const b = white(4, 3)
    drawMask(b, { width: 2, height: 2, bits: new Uint8Array([1, 0, 0, 1]) }, 1, 1, BLACK)
    expect(picture(b)).toBe('....\n.#..\n..#.')
  })
})

describe('coordinates', () => {
  it('maps the pointer to the pixel at any display size', () => {
    const rect = { left: 100, top: 50, width: 1280, height: 960 } // 640x480 shown at 200%
    expect(clientToPixel(100, 50, rect, 640, 480)).toEqual({ x: 0, y: 0, inside: true })
    expect(clientToPixel(101.9, 51.9, rect, 640, 480)).toEqual({ x: 0, y: 0, inside: true })
    expect(clientToPixel(102, 52, rect, 640, 480)).toEqual({ x: 1, y: 1, inside: true })
    expect(clientToPixel(1379.9, 1009.9, rect, 640, 480)).toEqual({ x: 639, y: 479, inside: true })
    expect(clientToPixel(1380, 1010, rect, 640, 480).inside).toBe(false)
    const half = { left: 0, top: 0, width: 320, height: 240 } // 50%
    expect(clientToPixel(160, 120, half, 640, 480)).toEqual({ x: 320, y: 240, inside: true })
    expect(clientToPixel(-5, 3, half, 640, 480)).toEqual({ x: -10, y: 6, inside: false })
  })
})

describe('history', () => {
  const state = (n: number) => ({ image: createBuffer(1, 1, { r: n, g: 0, b: 0, a: 255 }), base: 'white' as const })

  it('undoes and redoes, and a new action clears redo', () => {
    const h = new History()
    h.push(state(1))
    const back = h.undo(state(2))!
    expect(back.image.data[0]).toBe(1)
    expect(h.redo(back)!.image.data[0]).toBe(2)
    h.undo(state(2))
    h.push(state(3))
    expect(h.canRedo).toBe(false)
  })

  it('keeps at most the step limit and the memory budget', () => {
    const h = new History(3, 1_000_000)
    for (let i = 0; i < 10; i++) h.push(state(i))
    expect(h.undoDepth).toBe(3)
    const small = new History(30, 10)
    for (let i = 0; i < 10; i++) small.push(state(i))
    expect(small.undoDepth).toBe(2)
  })
})
