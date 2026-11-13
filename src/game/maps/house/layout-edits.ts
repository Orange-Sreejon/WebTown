import { getFurnitureType } from './furniture-catalog'
import {
  cloneItem,
  cloneLayout,
  type GridPlacement,
  type HouseLayout,
  type InteriorTemplate,
  type PlacedItem,
  type Rotation,
} from './house-layout'
import { validateLayout, type Violation } from './layout-rules'

/**
 * The operations an owner's future Edit mode will perform, as pure functions.
 * Each returns a NEW layout and never touches its input, and each is checked
 * against the full rule set before it is allowed, so an invalid house can
 * never be produced. There is deliberately no UI here.
 */

export type EditResult =
  | { ok: true; layout: HouseLayout }
  | { ok: false; violations: Violation[] }

/** Where an item can be put: a grid cell, or on top of a supporting item. */
export type Target =
  | { kind: 'grid'; col: number; row: number }
  | { kind: 'attached'; to: string; dx: number; dy: number }

const fail = (code: Violation['code'], message: string, itemId?: string): EditResult => ({
  ok: false,
  violations: [itemId === undefined ? { code, message } : { code, message, itemId }],
})

/** Accepts the edited layout only if it breaks no rule. */
function accept(template: InteriorTemplate, next: HouseLayout): EditResult {
  const violations = validateLayout(template, next)
  return violations.length === 0 ? { ok: true, layout: next } : { ok: false, violations }
}

/** Ids of the items resting directly on `itemId`. */
export function itemsResting(layout: HouseLayout, itemId: string): PlacedItem[] {
  return layout.items.filter(i => i.at.kind === 'attached' && i.at.to === itemId)
}

/**
 * Moves an item. A grid move snaps to the grid, which drops any nudge the
 * default room used to stay pixel-identical: the first user move is where the
 * item joins the grid. Anything resting on the item travels with it.
 */
export function moveItem(
  template: InteriorTemplate,
  layout: HouseLayout,
  itemId: string,
  target: Target,
): EditResult {
  const index = layout.items.findIndex(i => i.id === itemId)
  if (index < 0) return fail('bad-placement', `There is no item "${itemId}"`)

  const next = cloneLayout(layout)
  const at: PlacedItem['at'] =
    target.kind === 'grid'
      ? ({ kind: 'grid', col: target.col, row: target.row } satisfies GridPlacement)
      : { kind: 'attached', to: target.to, dx: target.dx, dy: target.dy }
  next.items[index] = { ...next.items[index]!, at }

  // Whatever an item rests on must come before it in draw order.
  return accept(template, orderSupportsFirst(next))
}

/**
 * Removes an item, unless it is mandatory (the computer, the notebook) or other
 * items still rest on it. A table has to be emptied first: move its contents
 * to another surface, then remove it.
 */
export function removeItem(
  template: InteriorTemplate,
  layout: HouseLayout,
  itemId: string,
): EditResult {
  const item = layout.items.find(i => i.id === itemId)
  if (!item) return fail('bad-placement', `There is no item "${itemId}"`)

  const type = getFurnitureType(item.type)
  if (type && !type.removable) {
    return fail('missing-mandatory', `${type.label} is required in every house`, itemId)
  }

  const contents = itemsResting(layout, itemId)
  if (contents.length > 0) {
    const names = contents.map(c => getFurnitureType(c.type)?.label ?? c.id).join(', ')
    return fail('bad-support', `Move ${names} off it before removing it`, itemId)
  }

  const next = cloneLayout(layout)
  next.items = next.items.filter(i => i.id !== itemId)
  return accept(template, next)
}

/** Adds a new item. `id` must be unused; see `nextItemId`. */
export function addItem(
  template: InteriorTemplate,
  layout: HouseLayout,
  id: string,
  type: string,
  target: Target,
  rotation: Rotation = 0,
): EditResult {
  if (layout.items.some(i => i.id === id)) return fail('duplicate-id', `"${id}" is already used`, id)

  const next = cloneLayout(layout)
  const at: PlacedItem['at'] =
    target.kind === 'grid'
      ? { kind: 'grid', col: target.col, row: target.row }
      : { kind: 'attached', to: target.to, dx: target.dx, dy: target.dy }
  next.items.push({ id, type, rotation, at })
  return accept(template, orderSupportsFirst(next))
}

/** A fresh id for a type: `chair`, then `chair-2`, `chair-3`, … */
export function nextItemId(layout: HouseLayout, type: string): string {
  const used = new Set(layout.items.map(i => i.id))
  if (!used.has(type)) return type
  for (let n = 2; ; n++) if (!used.has(`${type}-${n}`)) return `${type}-${n}`
}

/** Stable reorder so every support precedes what rests on it. */
function orderSupportsFirst(layout: HouseLayout): HouseLayout {
  const placed = new Set<string>()
  const ordered: PlacedItem[] = []
  const pending = layout.items.map(cloneItem)

  while (pending.length > 0) {
    const before = pending.length
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!
      const ready = item.at.kind === 'grid' || placed.has(item.at.to)
      if (!ready) continue
      ordered.push(item)
      placed.add(item.id)
      pending.splice(i, 1)
      i--
    }
    // A support that does not exist, or a loop: keep the rest as-is for validation to report.
    if (pending.length === before) {
      ordered.push(...pending)
      break
    }
  }
  return { ...layout, items: ordered }
}
