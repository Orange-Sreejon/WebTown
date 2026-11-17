import { describe, expect, it } from 'vitest'
import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
  formatContrastRatio,
  meetsAA,
  normalizeHexColour,
  parseHexColour,
  relativeLuminance,
  requiredContrast,
} from './contrast'

describe('parseHexColour', () => {
  it('reads six-digit colours in either case', () => {
    expect(parseHexColour('#FF8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHexColour('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHexColour('#000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it.each([
    '', '#', '#FFF', '#FFFF', '#FFFFF', '#FFFFFFF', '#FFFFFFFF', 'FFFFFF', '#GGGGGG', '#12345Z',
    ' #FFFFFF', '#FFFFFF ', 'red', 'rgb(0,0,0)', 'hsl(0,0%,0%)', 'url(x)', '#FFFFFF;', '#ffffff\n',
  ])('rejects %j', input => {
    expect(parseHexColour(input)).toBeNull()
  })

  it.each([null, undefined, 0, 16777215, {}, [], true])('rejects the non-string %j', input => {
    expect(parseHexColour(input)).toBeNull()
  })
})

describe('normalizeHexColour', () => {
  it('upper-cases valid colours and refuses others', () => {
    expect(normalizeHexColour('#a1b2c3')).toBe('#A1B2C3')
    expect(normalizeHexColour('#A1B2C3')).toBe('#A1B2C3')
    expect(normalizeHexColour('#abc')).toBeNull()
    expect(normalizeHexColour(5)).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10)
  })

  it('weights green most and blue least', () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0 })
    const green = relativeLuminance({ r: 0, g: 255, b: 0 })
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 })
    expect(red).toBeCloseTo(0.2126, 4)
    expect(green).toBeCloseTo(0.7152, 4)
    expect(blue).toBeCloseTo(0.0722, 4)
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for identical colours', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6)
    expect(contrastRatio('#336699', '#336699')).toBe(1)
  })

  it('does not depend on which colour is the foreground', () => {
    expect(contrastRatio('#0000EE', '#C0C0C0')).toBe(contrastRatio('#C0C0C0', '#0000EE'))
  })

  it('matches reference values from the WCAG tooling', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.5422, 3)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.4781, 3)
    expect(contrastRatio('#949494', '#FFFFFF')).toBeCloseTo(3.0335, 3)
    expect(contrastRatio('#959595', '#FFFFFF')).toBeCloseTo(2.9953, 3)
    expect(contrastRatio('#0000EE', '#C0C0C0')).toBeCloseTo(5.1652, 3)
  })

  it('returns null for an invalid colour', () => {
    expect(contrastRatio('red', '#FFFFFF')).toBeNull()
    expect(contrastRatio('#FFFFFF', '#FFF')).toBeNull()
  })
})

describe('AA thresholds', () => {
  it('uses 4.5:1 for normal text and 3:1 for large text', () => {
    expect(AA_NORMAL_TEXT).toBe(4.5)
    expect(AA_LARGE_TEXT).toBe(3)
    expect(requiredContrast('normal')).toBe(4.5)
    expect(requiredContrast('large')).toBe(3)
  })

  it('passes normal text just above 4.5:1 and fails it just below', () => {
    expect(meetsAA('#767676', '#FFFFFF', 'normal')).toBe(true) // 4.54
    expect(meetsAA('#777777', '#FFFFFF', 'normal')).toBe(false) // 4.48
  })

  it('passes large text just above 3:1 and fails it just below', () => {
    expect(meetsAA('#949494', '#FFFFFF', 'large')).toBe(true) // 3.03
    expect(meetsAA('#959595', '#FFFFFF', 'large')).toBe(false) // 2.99
  })

  it('accepts at large size what normal size refuses', () => {
    expect(meetsAA('#949494', '#FFFFFF', 'normal')).toBe(false)
    expect(meetsAA('#949494', '#FFFFFF', 'large')).toBe(true)
  })

  it('never passes an invalid colour', () => {
    expect(meetsAA('nope', '#FFFFFF', 'large')).toBe(false)
    expect(meetsAA('#000000', '', 'normal')).toBe(false)
  })
})

describe('formatContrastRatio', () => {
  it('rounds down, so a failing pair is never shown as passing', () => {
    expect(formatContrastRatio(4.4999)).toBe('4.49:1')
    expect(formatContrastRatio(4.5)).toBe('4.50:1')
    expect(formatContrastRatio(21)).toBe('21.00:1')
    expect(formatContrastRatio(2.9953)).toBe('2.99:1')
  })
})
