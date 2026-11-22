/**
 * Which house slot the signed-in player owns, as the database assigned it (Phase 4). Set by the app before the
 * game starts and cleared when the identity changes; read by the game's `canEditHouse`. Holds no storage or
 * network code, so the game can import it without depending on either.
 *
 * `null` (the default) means "no account": the game falls back to the Phase 3a local rule.
 */
export interface PlayerHouse {
  /** The slot of the house the player owns, or null if they own none in this world. */
  ownedSlot: string | null
}

let current: PlayerHouse | null = null

export function setPlayerHouse(house: PlayerHouse | null): void {
  current = house ? { ownedSlot: house.ownedSlot } : null
}

export function playerHouse(): PlayerHouse | null {
  return current ? { ownedSlot: current.ownedSlot } : null
}
