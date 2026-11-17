import { describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_APP_VIEW,
  emitAppCommand,
  emitAppState,
  isAppCommand,
  isAppView,
  onAppCommand,
  onAppState,
  type AppView,
} from './app-bridge'
import { emit } from './event-bus'

const view: AppView = { open: 'paint', houseId: 'house-a', mode: 'owner' }

describe('app bridge', () => {
  it('delivers views to subscribers until they unsubscribe', () => {
    const handler = vi.fn()
    const stop = onAppState(handler)
    emitAppState(view)
    emitAppState(HIDDEN_APP_VIEW)
    expect(handler.mock.calls).toEqual([[view], [HIDDEN_APP_VIEW]])
    stop()
    emitAppState(view)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('delivers commands to subscribers until they unsubscribe', () => {
    const handler = vi.fn()
    const stop = onAppCommand(handler)
    emitAppCommand({ type: 'close' })
    expect(handler).toHaveBeenCalledWith({ type: 'close' })
    stop()
    emitAppCommand({ type: 'close' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed payloads sent on the raw bus', () => {
    const viewHandler = vi.fn()
    const commandHandler = vi.fn()
    const stopView = onAppState(viewHandler)
    const stopCommand = onAppCommand(commandHandler)
    emit('APP_STATE', { open: 'browser', houseId: 'house-a', mode: 'owner' })
    emit('APP_STATE', { open: 'paint', houseId: 7, mode: 'owner' })
    emit('APP_STATE', { open: 'paint', houseId: 'house-a', mode: 'admin' })
    emit('APP_STATE', 'nope')
    emit('APP_COMMAND', { type: 'save' })
    emit('APP_COMMAND', { type: 'open', app: 'paint' })
    emit('APP_COMMAND', null)
    expect(viewHandler).not.toHaveBeenCalled()
    expect(commandHandler).not.toHaveBeenCalled()
    stopView()
    stopCommand()
  })

  it('does not mix with the editor channels', () => {
    const handler = vi.fn()
    const stop = onAppState(handler)
    emit('EDITOR_STATE', view)
    emit('EDITOR_COMMAND', { type: 'close' })
    expect(handler).not.toHaveBeenCalled()
    stop()
  })

  it('narrows payloads with guards', () => {
    expect(isAppView(HIDDEN_APP_VIEW)).toBe(true)
    expect(isAppView({ ...view, open: 'website', mode: 'visitor' })).toBe(true)
    expect(isAppView({ ...view, open: undefined })).toBe(false)
    expect(isAppView(null)).toBe(false)
    expect(isAppCommand({ type: 'close' })).toBe(true)
    expect(isAppCommand({ type: 'closed' })).toBe(false)
    expect(isAppCommand(undefined)).toBe(false)
  })

  it('shows nothing and grants no editing in the hidden view', () => {
    expect(HIDDEN_APP_VIEW.open).toBeNull()
    expect(HIDDEN_APP_VIEW.mode).toBe('visitor')
  })
})
