import { describe, it, expect } from 'vitest'
import { PLACEHOLDER_ROOM, placeholderPieceColour } from './placeholder-room'
import type { SpriteRef } from '../interior-layout'

function piece(
  name: string,
  layer: 'flat' | 'decor' | 'sorted' = 'sorted',
  sheet: SpriteRef['sheet'] = 'furniture',
  role?: 'computer' | 'notebook',
): { role?: 'computer' | 'notebook'; layer: 'flat' | 'decor' | 'sorted'; sprite: SpriteRef } {
  return { role, layer, sprite: { sheet, name } }
}

describe('placeholder room', () => {
  it('uses distinct shell colours', () => {
    const colours = Object.values(PLACEHOLDER_ROOM)
    expect(new Set(colours).size).toBe(colours.length)

    for (const colour of colours) {
      expect(colour).toBeGreaterThanOrEqual(0)
      expect(colour).toBeLessThanOrEqual(0xffffff)
    }
  })

  it('makes the computer and the notebook recognisable', () => {
    const computer = placeholderPieceColour(piece('computerDesk', 'sorted', 'prepared', 'computer'))
    const notebook = placeholderPieceColour(piece('notebook', 'sorted', 'prepared', 'notebook'))
    const plain = placeholderPieceColour(piece('chair'))

    expect(computer).not.toBe(plain)
    expect(notebook).not.toBe(plain)
    expect(computer).not.toBe(notebook)
  })

  it('separates rugs, plants, doors and windows from plain furniture', () => {
    const colours = [
      placeholderPieceColour(piece('rugOrange', 'flat')),
      placeholderPieceColour(piece('plantGreen')),
      placeholderPieceColour(piece('door', 'decor', 'kit')),
      placeholderPieceColour(piece('windowBlue', 'decor')),
      placeholderPieceColour(piece('chair')),
    ]

    expect(new Set(colours).size).toBe(colours.length)
  })
})
