/**
 * All asset key strings used with Phaser's loader and texture cache.
 * Keys are defined here once — never use raw string literals elsewhere.
 */
export const AssetKeys = {
  // Character spritesheets
  TRAVELLER: 'traveller',

  // Ground tiles
  GRASS_TILE: 'grass-tile',
  GROUND_TILE: 'ground-tile',
  WATER_TILE: 'water-tile',

  // Grass decorations (all 6)
  GRASS_DETAIL_1: 'grass-detail-1',
  GRASS_DETAIL_2: 'grass-detail-2',
  GRASS_DETAIL_3: 'grass-detail-3',
  GRASS_DETAIL_4: 'grass-detail-4',
  GRASS_DETAIL_5: 'grass-detail-5',
  GRASS_DETAIL_6: 'grass-detail-6',

  // Ground/path decorations (all 5)
  GROUND_DETAIL_1: 'ground-detail-1',
  GROUND_DETAIL_2: 'ground-detail-2',
  GROUND_DETAIL_3: 'ground-detail-3',
  GROUND_DETAIL_4: 'ground-detail-4',
  GROUND_DETAIL_5: 'ground-detail-5',

  // Water decorations (all 5)
  WATER_DETAIL_1: 'water-detail-1',
  WATER_DETAIL_2: 'water-detail-2',
  WATER_DETAIL_3: 'water-detail-3',
  WATER_DETAIL_4: 'water-detail-4',
  WATER_DETAIL_5: 'water-detail-5',

  // Fences
  FENCE_1: 'fence-1',
  FENCE_2: 'fence-2',

  // Structures
  HOUSE_1: 'house-1',
  HOUSE_2: 'house-2',
  CHURCH: 'church',
  BRIDGE: 'bridge',
  STAIRS: 'stairs',
  PIT: 'pit',

  // Trees (all 3 variants)
  TREE_1: 'tree-1',
  TREE_2: 'tree-2',
  TREE_3: 'tree-3',

  // ── Cute Fantasy Free pack (non-commercial licence — see docs/ASSETS.md)
  CUTE_HOUSE: 'cute-house',
  CUTE_BRIDGE: 'cute-bridge',
  OAK_TREE: 'oak-tree',
  /** 7×12 sheet of 16×16 outdoor props (see CuteFrame in maps/cute-props.ts). */
  CUTE_DECOR: 'cute-decor',
  CHICKEN: 'chicken',
  COW: 'cow',
  PIG: 'pig',
  SHEEP: 'sheep',

  // ── Farm RPG 16x16 pack (no licence file shipped — see docs/ASSETS.md)
  /** 5 growth stages, 32×48 frames. */
  MAPLE_TREE: 'maple-tree',
} as const

export type AssetKey = (typeof AssetKeys)[keyof typeof AssetKeys]

/** Asset URL paths relative to the Vite public/ directory. */
export const AssetPaths: Record<AssetKey, string> = {
  [AssetKeys.TRAVELLER]: '/assets/characters/tiny-cast/traveller.png',

  [AssetKeys.GRASS_TILE]:  '/assets/tilesets/village-top-down/grass-tile-day.png',
  [AssetKeys.GROUND_TILE]: '/assets/tilesets/village-top-down/ground-tile-day.png',
  [AssetKeys.WATER_TILE]:  '/assets/tilesets/village-top-down/water-tile-day.png',

  [AssetKeys.GRASS_DETAIL_1]: '/assets/tilesets/village-top-down/grass-detail-1-day.png',
  [AssetKeys.GRASS_DETAIL_2]: '/assets/tilesets/village-top-down/grass-detail-2-day.png',
  [AssetKeys.GRASS_DETAIL_3]: '/assets/tilesets/village-top-down/grass-detail-3-day.png',
  [AssetKeys.GRASS_DETAIL_4]: '/assets/tilesets/village-top-down/grass-detail-4-day.png',
  [AssetKeys.GRASS_DETAIL_5]: '/assets/tilesets/village-top-down/grass-detail-5-day.png',
  [AssetKeys.GRASS_DETAIL_6]: '/assets/tilesets/village-top-down/grass-detail-6-day.png',

  [AssetKeys.GROUND_DETAIL_1]: '/assets/tilesets/village-top-down/ground-detail-1-day.png',
  [AssetKeys.GROUND_DETAIL_2]: '/assets/tilesets/village-top-down/ground-detail-2-day.png',
  [AssetKeys.GROUND_DETAIL_3]: '/assets/tilesets/village-top-down/ground-detail-3-day.png',
  [AssetKeys.GROUND_DETAIL_4]: '/assets/tilesets/village-top-down/ground-detail-4-day.png',
  [AssetKeys.GROUND_DETAIL_5]: '/assets/tilesets/village-top-down/ground-detail-5-day.png',

  [AssetKeys.WATER_DETAIL_1]: '/assets/tilesets/village-top-down/water-detail-1-day.png',
  [AssetKeys.WATER_DETAIL_2]: '/assets/tilesets/village-top-down/water-detail-2-day.png',
  [AssetKeys.WATER_DETAIL_3]: '/assets/tilesets/village-top-down/water-detail-3-day.png',
  [AssetKeys.WATER_DETAIL_4]: '/assets/tilesets/village-top-down/water-detail-4-day.png',
  [AssetKeys.WATER_DETAIL_5]: '/assets/tilesets/village-top-down/water-detail-5-day.png',

  [AssetKeys.FENCE_1]: '/assets/tilesets/village-top-down/fence-1-day.png',
  [AssetKeys.FENCE_2]: '/assets/tilesets/village-top-down/fence-2-day.png',

  [AssetKeys.HOUSE_1]: '/assets/tilesets/village-top-down/house-1-day.png',
  [AssetKeys.HOUSE_2]: '/assets/tilesets/village-top-down/house-2-day.png',
  [AssetKeys.CHURCH]:  '/assets/tilesets/village-top-down/church-day.png',
  [AssetKeys.BRIDGE]:  '/assets/tilesets/village-top-down/bridge-day.png',
  [AssetKeys.STAIRS]:  '/assets/tilesets/village-top-down/stairs-day.png',
  [AssetKeys.PIT]:     '/assets/tilesets/village-top-down/pit-day.png',

  [AssetKeys.TREE_1]: '/assets/tilesets/village-top-down/tree-1-day.png',
  [AssetKeys.TREE_2]: '/assets/tilesets/village-top-down/tree-2-day.png',
  [AssetKeys.TREE_3]: '/assets/tilesets/village-top-down/tree-3-day.png',

  // Folder and file names here contain spaces, so they are percent-encoded.
  [AssetKeys.CUTE_HOUSE]:  '/assets/Cute_Fantasy_Free/Outdoor%20decoration/House_1_Wood_Base_Blue.png',
  [AssetKeys.CUTE_BRIDGE]: '/assets/Cute_Fantasy_Free/Outdoor%20decoration/Bridge_Wood.png',
  [AssetKeys.OAK_TREE]:    '/assets/Cute_Fantasy_Free/Outdoor%20decoration/Oak_Tree.png',
  [AssetKeys.CUTE_DECOR]:  '/assets/Cute_Fantasy_Free/Outdoor%20decoration/Outdoor_Decor_Free.png',
  [AssetKeys.CHICKEN]:     '/assets/Cute_Fantasy_Free/Animals/Chicken/Chicken.png',
  [AssetKeys.COW]:         '/assets/Cute_Fantasy_Free/Animals/Cow/Cow.png',
  [AssetKeys.PIG]:         '/assets/Cute_Fantasy_Free/Animals/Pig/Pig.png',
  [AssetKeys.SHEEP]:       '/assets/Cute_Fantasy_Free/Animals/Sheep/Sheep.png',

  [AssetKeys.MAPLE_TREE]:  '/assets/Farm%20RPG%20FREE%2016x16%20-%20Tiny%20Asset%20Pack/Objects/Maple%20Tree.png',
}
