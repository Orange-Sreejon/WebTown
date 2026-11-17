import { describe, expect, it } from 'vitest'
import { accessModeFor } from './access-policy'

describe('access policy', () => {
  it('maps the editing decision to a mode', () => {
    expect(accessModeFor(true)).toBe('owner')
    expect(accessModeFor(false)).toBe('visitor')
  })
})
