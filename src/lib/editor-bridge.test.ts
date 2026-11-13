import { describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_EDITOR_VIEW,
  emitEditorCommand,
  emitEditorState,
  isEditorCommand,
  isEditorView,
  onEditorCommand,
  onEditorState,
  type EditorView,
} from './editor-bridge'
import { emit } from './event-bus'

const view: EditorView = { ...HIDDEN_EDITOR_VIEW, houseId: 'house-a', canEdit: true }

describe('editor bridge', () => {
  it('delivers views to subscribers until they unsubscribe', () => {
    const handler = vi.fn()
    const stop = onEditorState(handler)
    emitEditorState(view)
    expect(handler).toHaveBeenCalledWith(view)
    stop()
    emitEditorState(view)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('delivers commands to subscribers until they unsubscribe', () => {
    const handler = vi.fn()
    const stop = onEditorCommand(handler)
    emitEditorCommand({ type: 'save' })
    emitEditorCommand({ type: 'start-placing', furnitureType: 'stool' })
    expect(handler.mock.calls).toEqual([
      [{ type: 'save' }],
      [{ type: 'start-placing', furnitureType: 'stool' }],
    ])
    stop()
    emitEditorCommand({ type: 'cancel' })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('ignores malformed payloads sent on the raw bus', () => {
    const viewHandler = vi.fn()
    const commandHandler = vi.fn()
    const stopView = onEditorState(viewHandler)
    const stopCommand = onEditorCommand(commandHandler)
    emit('EDITOR_STATE', { houseId: 3 })
    emit('EDITOR_STATE', 'nope')
    emit('EDITOR_COMMAND', { type: 'explode' })
    emit('EDITOR_COMMAND', { type: 'start-placing' })
    emit('EDITOR_COMMAND', null)
    expect(viewHandler).not.toHaveBeenCalled()
    expect(commandHandler).not.toHaveBeenCalled()
    stopView()
    stopCommand()
  })

  it('narrows payloads with guards', () => {
    expect(isEditorView(HIDDEN_EDITOR_VIEW)).toBe(true)
    expect(isEditorView({ ...HIDDEN_EDITOR_VIEW, mode: 'fly' })).toBe(false)
    expect(isEditorCommand({ type: 'escape' })).toBe(true)
    expect(isEditorCommand({ type: 'start-placing', furnitureType: 'chair' })).toBe(true)
    expect(isEditorCommand({ type: 'start-placing', furnitureType: 7 })).toBe(false)
  })
})
