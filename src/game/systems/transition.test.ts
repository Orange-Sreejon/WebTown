import { describe, expect, it } from 'vitest'
import { TransitionLock } from './transition'

describe('TransitionLock', () => {
  it('lets the first attempt through and rejects a second while busy', () => {
    const lock = new TransitionLock(400)
    expect(lock.tryBegin(0)).toBe(true)
    expect(lock.isBusy).toBe(true)
    expect(lock.tryBegin(1)).toBe(false)
    expect(lock.tryBegin(10_000)).toBe(false)
  })

  it('stays closed for the cooldown after release, then reopens', () => {
    const lock = new TransitionLock(400)
    lock.tryBegin(0)
    lock.release(1000)

    expect(lock.isBusy).toBe(false)
    expect(lock.tryBegin(1000)).toBe(false)
    expect(lock.tryBegin(1399)).toBe(false)
    expect(lock.tryBegin(1400)).toBe(true)
  })

  it('can be reset without a cooldown', () => {
    const lock = new TransitionLock(400)
    lock.tryBegin(0)
    lock.reset()
    expect(lock.isBusy).toBe(false)
    expect(lock.tryBegin(0)).toBe(true)
  })

  it('does not start a cooldown when it was never used', () => {
    const lock = new TransitionLock(400)
    expect(lock.tryBegin(0)).toBe(true)
  })
})
