import { useSyncExternalStore } from 'react'

/** A value that changes often (the pointer position), read only by the component that shows it. */
export interface ValueStore<T> {
  get(): T
  set(value: T): void
  subscribe(listener: () => void): () => void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const l of [...listeners]) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export interface StatusBarProps {
  hint: string
  pointer: ValueStore<string>
  size: string
  toolSize: string
  saveState: string
}

/** Hint | pointer position | canvas size | tool size | where the drawing is saved. */
export function StatusBar({ hint, pointer, size, toolSize, saveState }: StatusBarProps): React.ReactElement {
  const at = useSyncExternalStore(pointer.subscribe, pointer.get, pointer.get)
  return (
    <div className="pt-status">
      <span className="pt-pane pt-pane--hint">{hint}</span>
      <span className="pt-pane pt-pane--small" aria-label="Pointer position">{at}</span>
      <span className="pt-pane pt-pane--small" aria-label="Canvas size">{size}</span>
      <span className="pt-pane pt-pane--small" aria-label="Tool size">{toolSize}</span>
      <span className="pt-pane pt-pane--save" role="status" aria-live="polite">{saveState}</span>
    </div>
  )
}
