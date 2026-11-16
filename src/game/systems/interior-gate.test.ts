import { describe, expect, it } from 'vitest'
import { isPlayerFrozen, mayInteract, type InteriorBusyState } from './interior-gate'

const FREE: InteriorBusyState = { transitioning: false, editing: false, appOpen: false }

describe('interior gate', () => {
  it('lets a free player walk and use things', () => {
    expect(isPlayerFrozen(FREE)).toBe(false)
    expect(mayInteract(FREE, false)).toBe(true)
  })

  it('ignores a key repeat', () => {
    expect(mayInteract(FREE, true)).toBe(false)
  })

  it.each(['transitioning', 'editing', 'appOpen'] as const)('freezes the player while %s', key => {
    const state = { ...FREE, [key]: true }
    expect(isPlayerFrozen(state)).toBe(true)
    expect(mayInteract(state, false)).toBe(false)
  })

  it('cannot use the exit door while an app is open', () => {
    expect(mayInteract({ ...FREE, appOpen: true }, false)).toBe(false)
  })
})
