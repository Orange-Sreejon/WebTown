import { getFurnitureType } from './furniture-catalog'
import type { HouseLayout } from './house-layout'
import type { Violation } from './layout-rules'

/**
 * Plain-language reasons for the editor. The rules' own messages name item
 * ids for developers; these name things the way a player sees them, in a few
 * words, so a red preview always comes with a reason the player can act on.
 */

/** "the bed", "the computer desk"; an unknown id falls back to "something". */
export function itemName(layout: HouseLayout, itemId: string | undefined): string {
  if (itemId === 'door') return 'the door'
  const item = itemId === undefined ? undefined : layout.items.find(i => i.id === itemId)
  const label = item ? getFurnitureType(item.type)?.label : undefined
  return label ? `the ${label.toLowerCase()}` : 'something'
}

/** One violation as a short sentence, from the point of view of `focusId` (the item being moved). */
export function describeViolation(v: Violation, layout: HouseLayout, focusId?: string): string {
  const other = v.itemId === focusId ? v.otherId : v.itemId
  const focus = layout.items.find(i => i.id === (focusId ?? v.itemId))
  const mount = focus ? getFurnitureType(focus.type)?.mount : undefined

  switch (v.code) {
    case 'overlap':
      return `Overlaps ${itemName(layout, other)}`
    case 'wall-clash':
      return `Overlaps ${itemName(layout, other)} on the wall`
    case 'out-of-bounds':
      return mount === 'wall' ? 'Must hang on the back wall' : "Doesn't fit on the floor here"
    case 'blocks-exit':
      return 'Blocks the way to the door'
    case 'blocks-spawn':
      return 'Blocks the spot inside the door'
    case 'unreachable':
      if (v.itemId === undefined) return 'Would block the way to the door'
      return `Would block the way to ${itemName(layout, v.itemId)}`
    case 'bad-support':
    case 'bad-placement':
      return mount === 'surface' ? 'Must rest on a table or nightstand' : "Can't stand on other furniture"
    case 'missing-mandatory':
      return 'Every house needs one computer and one notebook'
    case 'bad-rotation':
      return "Can't face that way"
    case 'not-on-grid':
      return 'Must sit on the grid'
    case 'duplicate-id':
      return 'That name is already taken'
    case 'unknown-type':
      return "That furniture doesn't exist"
  }
}

/**
 * The one reason to show for a refused edit: a violation about the item being
 * moved wins over one about the room in general, because it is the one the
 * player can fix by moving that item.
 */
export function primaryReason(
  violations: readonly Violation[],
  layout: HouseLayout,
  focusId?: string,
): string | null {
  if (violations.length === 0) return null
  const about = (v: Violation): boolean => v.itemId === focusId || v.otherId === focusId
  const first = (focusId ? violations.find(about) : undefined) ?? violations[0]!
  return describeViolation(first, layout, focusId)
}
