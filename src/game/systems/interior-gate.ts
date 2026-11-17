/** The conditions that stop the player acting inside a house. */
export interface InteriorBusyState {
  /** A door is opening or closing (or the cooldown after an app closed is not over). */
  transitioning: boolean
  /** The furniture editor is in edit mode. */
  editing: boolean
  /** The website or Paint is open. */
  appOpen: boolean
}

/** True when the player must not walk. */
export function isPlayerFrozen(state: InteriorBusyState): boolean {
  return state.transitioning || state.editing || state.appOpen
}

/**
 * True when a fresh press of E may use the door, the computer or the notebook.
 * A key-repeat never counts, and neither does anything while the player is frozen,
 * so E cannot leave the house while an app is open.
 */
export function mayInteract(state: InteriorBusyState, repeat: boolean): boolean {
  return !repeat && !isPlayerFrozen(state)
}
