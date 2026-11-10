import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emit, on, off } from './event-bus'

describe('event-bus', () => {
  beforeEach(() => {
    // Each test gets fresh handler state — handlers are registered/removed per test
  })

  it('calls a registered handler when the event is emitted', () => {
    const handler = vi.fn()
    on('READY', handler)
    emit('READY')
    expect(handler).toHaveBeenCalledTimes(1)
    off('READY', handler)
  })

  it('passes detail through to the handler', () => {
    const handler = vi.fn()
    on('ERROR', handler)
    emit('ERROR', 'asset load failed')
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'asset load failed' }),
    )
    off('ERROR', handler)
  })

  it('does not call a handler after off() is called', () => {
    const handler = vi.fn()
    on('READY', handler)
    off('READY', handler)
    emit('READY')
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls multiple handlers registered on the same event', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    on('READY', h1)
    on('READY', h2)
    emit('READY')
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
    off('READY', h1)
    off('READY', h2)
  })

  it('only removes the specific handler, not all handlers', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    on('READY', h1)
    on('READY', h2)
    off('READY', h1)
    emit('READY')
    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledTimes(1)
    off('READY', h2)
  })

  it('handles READY and ERROR as independent events', () => {
    const readyHandler = vi.fn()
    const errorHandler = vi.fn()
    on('READY', readyHandler)
    on('ERROR', errorHandler)
    emit('READY')
    expect(readyHandler).toHaveBeenCalledTimes(1)
    expect(errorHandler).not.toHaveBeenCalled()
    off('READY', readyHandler)
    off('ERROR', errorHandler)
  })
})
