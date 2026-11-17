import type { AccessMode } from '../../lib/app-bridge'

/**
 * Maps the editing decision to the mode the apps run in.
 *
 * Pure on purpose: this module must not import anything from `game/`. Phaser
 * calls `canEditHouse(houseId)` and passes the boolean in, so the ownership rule
 * keeps one source.
 *
 * Phase 3a: this is a client-side stand-in that browser developer tools can
 * bypass. It is not authorization. Real enforcement is server-side (Phase 3b).
 */
export function accessModeFor(canEdit: boolean): AccessMode {
  return canEdit ? 'owner' : 'visitor'
}
