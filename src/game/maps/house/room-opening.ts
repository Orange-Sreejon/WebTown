import type { InteriorDefinition } from '../interior-layout'
import { createDefaultLayout, getTemplate } from './default-interior'
import type { HouseLayout } from './house-layout'
import { validateLayout, type Violation } from './layout-rules'
import { resolveInterior } from './resolve-interior'

/**
 * Which room a visit actually opens.
 *
 * A house must always be enterable: a stored layout that is missing, corrupt
 * or illegal costs the owner their arrangement, never the room. When that
 * happens the standard room opens and `restored` says so, so the player can be
 * told instead of being dropped back into the town with nothing but a console
 * error. Only an unknown TEMPLATE refuses to open, because there is no room to
 * draw at all.
 *
 * Pure: the scene turns the outcome into sprites, and it is tested directly.
 */

export const ROOM_RESTORED_NOTICE =
  'That room could not be opened, so the standard room was used. Your saved furniture has been kept.'

export type RoomOpening =
  | {
      ok: true
      /** The layout that was drawn. Always legal when `violations` is empty. */
      layout: HouseLayout
      definition: InteriorDefinition
      /** What the stored layout broke, for the log. Empty when it was used as saved. */
      violations: Violation[]
      /** True when the room is the standard one rather than the house's own. */
      restored: boolean
    }
  | { ok: false; reason: 'unknown-template' }

/**
 * @param layout        the house's stored layout, if one could be loaded
 * @param storedRecovered the store already had to fall back to the default
 */
export function openRoom(
  houseId: string,
  interiorId: string,
  layout: HouseLayout | undefined,
  storedRecovered = false,
): RoomOpening {
  const template = getTemplate(interiorId)
  if (!template) return { ok: false, reason: 'unknown-template' }

  const stored = layout ?? createDefaultLayout(houseId)
  const violations = validateLayout(template, stored)
  const usable = violations.length === 0 ? stored : createDefaultLayout(houseId)

  return {
    ok: true,
    layout: usable,
    definition: resolveInterior(template, usable),
    violations,
    restored: storedRecovered || layout === undefined || violations.length > 0,
  }
}
