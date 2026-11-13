import type { CatalogueEntryView, CatalogueThumbnail } from '../../../lib/editor-bridge'
import { AssetKeys, AssetPaths } from '../../config/AssetKeys'
import type { SpriteRef } from '../interior-layout'
import {
  FURNITURE,
  FURNITURE_SIZE,
  OFFICE_KIT,
  OFFICE_KIT_SIZE,
  type SheetSize,
  type SliceRect,
} from '../interior-slices'
import { FURNITURE_CATALOG } from './furniture-catalog'

/**
 * What the editor's catalogue offers, as plain data for React. Thumbnails are
 * a rectangle of a same-origin sheet URL, so the UI can draw them with CSS
 * without importing images through the bundler or touching Phaser.
 */

const SHEETS: Record<'kit' | 'furniture', { url: string; size: SheetSize; slices: Record<string, SliceRect> }> = {
  kit: { url: AssetPaths[AssetKeys.INTERIOR_OFFICE_KIT], size: OFFICE_KIT_SIZE, slices: OFFICE_KIT },
  furniture: { url: AssetPaths[AssetKeys.INTERIOR_FURNITURE], size: FURNITURE_SIZE, slices: FURNITURE },
}

/**
 * The thumbnail for a sprite, or null when there is no clean one: prepared
 * sprites are cut from a sheet with an opaque ground and only become clean
 * after runtime keying.
 */
export function thumbnailFor(sprite: SpriteRef): CatalogueThumbnail | null {
  if (sprite.sheet === 'prepared') return null
  const sheet = SHEETS[sprite.sheet]
  const slice = sheet.slices[sprite.name]
  if (!slice) return null
  return { url: sheet.url, ...slice, sheetW: sheet.size.w, sheetH: sheet.size.h }
}

/**
 * Every type an owner may add. Mandatory types (the computer and the notebook)
 * are left out: each must exist exactly once, so adding another is never valid.
 */
export function catalogueEntries(): CatalogueEntryView[] {
  return Object.entries(FURNITURE_CATALOG)
    .filter(([, type]) => type.removable)
    .map(([id, type]) => ({ type: id, label: type.label, thumbnail: thumbnailFor(type.sprite) }))
}

/** True when `type` may be added from the catalogue. */
export function isAddable(type: string): boolean {
  return FURNITURE_CATALOG[type]?.removable === true
}
