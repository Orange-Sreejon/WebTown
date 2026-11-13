import type { Point, Rect } from '../../../lib/geometry'
import { INTERIOR_WALL_FILL_GAP_PX, TILE_SIZE } from '../../config/GameConfig'
import type { InteriorDefinition, InteriorPiece } from '../interior-layout'
import { getFurnitureType, type FurnitureType } from './furniture-catalog'
import type { HouseLayout, InteriorTemplate, PlacedItem } from './house-layout'

/**
 * Turns a template plus one house's layout into the `InteriorDefinition` the
 * scene draws and collides with. This is the only place grid coordinates
 * become pixels, so placement rules and rendering cannot drift apart.
 */

/** Pixel position of an item's anchor: its left edge (x) and bottom edge (y). */
export function itemAnchor(layout: HouseLayout, item: PlacedItem, depth = 0): Point {
  if (depth > layout.items.length) throw new Error(`Item "${item.id}" is attached in a loop`)

  const at = item.at
  if (at.kind === 'grid') {
    return {
      x: at.col * TILE_SIZE + (at.nudge?.x ?? 0),
      y: at.row * TILE_SIZE + (at.nudge?.y ?? 0),
    }
  }

  const support = layout.items.find(other => other.id === at.to)
  if (!support) throw new Error(`Item "${item.id}" rests on unknown item "${at.to}"`)
  const base = itemAnchor(layout, support, depth + 1)
  return { x: base.x + at.dx, y: base.y + at.dy }
}

/**
 * The collision rectangle of an item at an anchor, or undefined when it does
 * not block the player. A piece whose top sits within a few pixels of the back
 * wall (but not on it) is extended up to the wall, so the player cannot wedge
 * into the sliver behind it.
 */
export function solidRect(type: FurnitureType, anchor: Point, wallHeightPx: number): Rect | undefined {
  if (!type.solid) return undefined
  const top = anchor.y + type.solid.dy
  const rect: Rect = { x: anchor.x + type.solid.dx, y: top, w: type.solid.w, h: type.solid.h }

  const gap = top - wallHeightPx
  if (gap > 0 && gap < INTERIOR_WALL_FILL_GAP_PX) {
    rect.y = wallHeightPx
    rect.h += gap
  }
  return rect
}

/** Items resting on a support sort just above it, so they draw on top of it. */
function restingSortBottom(supportBottom: number): number {
  return Math.round((supportBottom + 0.2) * 10) / 10
}

/** The runtime definition of one house's room. Throws on an unknown type or support. */
export function resolveInterior(template: InteriorTemplate, layout: HouseLayout): InteriorDefinition {
  const pieces: InteriorPiece[] = [
    {
      id: 'door',
      sprite: { sheet: 'kit', name: 'door' },
      x: template.doorX,
      bottom: template.wallHeightPx,
      layer: 'decor',
    },
  ]

  for (const item of layout.items) {
    const type = getFurnitureType(item.type)
    if (!type) throw new Error(`Item "${item.id}" has unknown furniture type "${item.type}"`)

    const anchor = itemAnchor(layout, item)
    const piece: InteriorPiece = {
      id: item.id,
      sprite: type.sprite,
      x: anchor.x,
      bottom: anchor.y,
      layer: type.layer,
    }

    const solid = solidRect(type, anchor, template.wallHeightPx)
    if (solid) piece.solid = solid
    if (type.role) piece.role = type.role
    if (item.at.kind === 'attached') {
      const supportId = item.at.to
      const support = layout.items.find(other => other.id === supportId)!
      piece.sortBottom = restingSortBottom(itemAnchor(layout, support).y)
    }
    pieces.push(piece)
  }

  return {
    id: template.id,
    widthPx: template.widthPx,
    heightPx: template.heightPx,
    wallHeightPx: template.wallHeightPx,
    style: template.style,
    spawn: template.spawn,
    exit: template.exit,
    pieces,
  }
}
