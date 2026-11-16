import type { Rect } from '../../../lib/geometry'
import type { AppId } from '../../../lib/app-bridge'
import { INTERIOR_PROP_REACH_PX, PROMPT_COMPUTER_TEXT, PROMPT_SKETCHBOOK_TEXT } from '../../config/GameConfig'
import type { InteractionTarget } from '../../systems/interaction'
import { pieceBounds, type InteriorDefinition, type PieceRole } from '../interior-layout'

/**
 * The two usable objects in a room: the computer opens the website, the
 * notebook (shown as the Sketchbook) opens WebTown Paint.
 *
 * Targets are found by the furniture `role`, never by id or position, so moving
 * either object in the furniture editor moves its zone with it. The notebook's
 * position already follows its supporting table when the layout is resolved.
 * Pure data: no Phaser.
 */
export interface ObjectTarget extends InteractionTarget {
  app: AppId
  promptText: string
}

const OBJECTS: Record<PieceRole, { app: AppId; promptText: string }> = {
  computer: { app: 'website', promptText: PROMPT_COMPUTER_TEXT },
  notebook: { app: 'paint', promptText: PROMPT_SKETCHBOOK_TEXT },
}

/** Grows a rectangle on every side, then keeps it inside the room. */
function grow(rect: Rect, by: number, room: Rect): Rect {
  const x = Math.max(room.x, rect.x - by)
  const y = Math.max(room.y, rect.y - by)
  const right = Math.min(room.x + room.w, rect.x + rect.w + by)
  const bottom = Math.min(room.y + room.h, rect.y + rect.h + by)
  return { x, y, w: right - x, h: bottom - y }
}

/**
 * One target per piece that has a role, in piece order.
 *
 * The zone is the sprite's box grown by `INTERIOR_PROP_REACH_PX`: the same
 * distance the layout rules use to require that the player can get near the
 * object, so a valid layout never leaves the computer or the notebook unusable.
 */
export function buildObjectTargets(def: InteriorDefinition): ObjectTarget[] {
  const room: Rect = { x: 0, y: 0, w: def.widthPx, h: def.heightPx }
  const targets: ObjectTarget[] = []

  for (const piece of def.pieces) {
    if (!piece.role) continue
    const object = OBJECTS[piece.role]
    const bounds = pieceBounds(piece)
    targets.push({
      id: `${piece.role}:${piece.id}`,
      app: object.app,
      promptText: object.promptText,
      zone: grow(bounds, INTERIOR_PROP_REACH_PX, room),
      // The prompt sits on top of the object, bottom-centre anchored.
      promptX: bounds.x + bounds.w / 2,
      promptY: bounds.y,
    })
  }
  return targets
}
