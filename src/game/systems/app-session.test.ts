import { describe, expect, it, vi } from 'vitest'
import { HIDDEN_APP_VIEW } from '../../lib/app-bridge'
import { AppSession, resolveAccessMode, type AppSessionPorts } from './app-session'

function makePorts(): AppSessionPorts & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    haltPlayer: vi.fn(() => void calls.push('halt')),
    hidePrompt: vi.fn(() => void calls.push('hidePrompt')),
    setKeyboardCaptured: vi.fn((captured: boolean) => void calls.push(`captured:${captured}`)),
    publish: vi.fn(view => void calls.push(`publish:${view.open}`)),
    appClosed: vi.fn(() => void calls.push('appClosed')),
  }
}

describe('AppSession', () => {
  it('opens the computer with the website state and the house id', () => {
    const ports = makePorts()
    const session = new AppSession(ports, id => id === 'house-a')
    expect(session.open('website', 'house-a')).toBe(true)
    expect(ports.publish).toHaveBeenCalledWith({ open: 'website', houseId: 'house-a', mode: 'owner' })
    expect(session.openApp).toBe('website')
  })

  it('opens the notebook with the Paint state and the house id', () => {
    const ports = makePorts()
    const session = new AppSession(ports, () => false)
    session.open('paint', 'house-b')
    expect(ports.publish).toHaveBeenCalledWith({ open: 'paint', houseId: 'house-b', mode: 'visitor' })
  })

  it('passes owner mode in the owner house and visitor mode elsewhere', () => {
    const canEdit = (id: string): boolean => id === 'house-a'
    for (const [house, mode] of [['house-a', 'owner'], ['house-b', 'visitor'], ['', 'visitor']] as const) {
      const ports = makePorts()
      new AppSession(ports, canEdit).open('paint', house)
      expect(ports.publish).toHaveBeenCalledWith(expect.objectContaining({ houseId: house, mode }))
    }
  })

  it('freezes the player and hands the keyboard over before React is told', () => {
    const ports = makePorts()
    new AppSession(ports, () => true).open('website', 'house-a')
    expect(ports.calls).toEqual(['halt', 'hidePrompt', 'captured:false', 'publish:website'])
  })

  it('closing gives the keyboard back, hides the app and starts the cooldown', () => {
    const ports = makePorts()
    const session = new AppSession(ports, () => true)
    session.open('paint', 'house-a')
    ports.calls.length = 0

    expect(session.close()).toBe(true)
    expect(ports.calls).toEqual(['captured:true', 'publish:null', 'appClosed'])
    expect(ports.publish).toHaveBeenLastCalledWith(HIDDEN_APP_VIEW)
    expect(session.isOpen).toBe(false)
  })

  it('never opens a second app on top of the first', () => {
    const ports = makePorts()
    const session = new AppSession(ports, () => true)
    expect(session.open('website', 'house-a')).toBe(true)
    expect(session.open('paint', 'house-a')).toBe(false)
    expect(session.open('website', 'house-a')).toBe(false)
    expect(session.openApp).toBe('website')
    expect(ports.publish).toHaveBeenCalledTimes(1)
    expect(ports.setKeyboardCaptured).toHaveBeenCalledTimes(1)
  })

  it('ignores duplicate close commands', () => {
    const ports = makePorts()
    const session = new AppSession(ports, () => true)
    expect(session.close()).toBe(false)
    session.open('website', 'house-a')
    expect(session.close()).toBe(true)
    expect(session.close()).toBe(false)
    expect(ports.setKeyboardCaptured).toHaveBeenCalledTimes(2)
    expect(ports.appClosed).toHaveBeenCalledTimes(1)
  })

  it('survives repeated open and close without drifting', () => {
    const ports = makePorts()
    const session = new AppSession(ports, () => true)
    for (let i = 0; i < 25; i++) {
      expect(session.open(i % 2 ? 'paint' : 'website', 'house-a')).toBe(true)
      expect(session.close()).toBe(true)
    }
    expect(session.isOpen).toBe(false)
    expect(ports.setKeyboardCaptured).toHaveBeenCalledTimes(50)
    const states = (ports.setKeyboardCaptured as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    expect(states.filter(s => s === false)).toHaveLength(25)
    expect(states.filter(s => s === true)).toHaveLength(25)
    expect(states[states.length - 1]).toBe(true)
  })

  it('dispose closes an open app so the keyboard is always returned', () => {
    const ports = makePorts()
    const session = new AppSession(ports, () => true)
    session.open('paint', 'house-a')
    session.dispose()
    expect(ports.setKeyboardCaptured).toHaveBeenLastCalledWith(true)
    expect(ports.publish).toHaveBeenLastCalledWith(HIDDEN_APP_VIEW)
    session.dispose()
    expect(ports.setKeyboardCaptured).toHaveBeenCalledTimes(2)
  })

  it('dispose does nothing when no app is open', () => {
    const ports = makePorts()
    new AppSession(ports, () => true).dispose()
    expect(ports.calls).toEqual([])
  })
})

describe('resolveAccessMode', () => {
  it('fails closed when the permission check throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const mode = resolveAccessMode('house-a', () => {
      throw new Error('boom')
    })
    expect(mode).toBe('visitor')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('fails closed on any answer that is not exactly true', () => {
    const lax = (value: unknown) => (() => value) as unknown as (id: string) => boolean
    expect(resolveAccessMode('house-a', lax('yes'))).toBe('visitor')
    expect(resolveAccessMode('house-a', lax(1))).toBe('visitor')
    expect(resolveAccessMode('house-a', lax(undefined))).toBe('visitor')
    expect(resolveAccessMode('house-a', lax(true))).toBe('owner')
  })

  it('opens as a visitor, not as a crash, when the check throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ports = makePorts()
    const session = new AppSession(ports, () => {
      throw new Error('boom')
    })
    expect(session.open('paint', 'house-a')).toBe(true)
    expect(ports.publish).toHaveBeenCalledWith({ open: 'paint', houseId: 'house-a', mode: 'visitor' })
    error.mockRestore()
  })
})
