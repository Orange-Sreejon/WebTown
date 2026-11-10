/**
 * Minimal typed event bus for React ↔ Phaser communication.
 * Wraps the native EventTarget API — no external library needed.
 */

export type GameEventType = 'READY' | 'ERROR'

const bus = new EventTarget()

export function emit(event: GameEventType, detail?: unknown): void {
  bus.dispatchEvent(new CustomEvent(event, { detail }))
}

export function on(
  event: GameEventType,
  handler: (e: CustomEvent<unknown>) => void,
): void {
  bus.addEventListener(event, handler as EventListener)
}

export function off(
  event: GameEventType,
  handler: (e: CustomEvent<unknown>) => void,
): void {
  bus.removeEventListener(event, handler as EventListener)
}
