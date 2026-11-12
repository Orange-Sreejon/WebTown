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

  // ── Halloween pumpkins (Grajo — see docs/ASSETS.md)
  /** 15×14 sheet of 16×16 pumpkins; only the small block cols 12–14 is used. */
  HALLOWEEN_PUMPKINS: 'halloween-pumpkins',

  // ── Pixel Medieval Market Props (16×16 tiles — see docs/ASSETS.md)
  MARKET_LAMP: 'market-lamp',
  MARKET_BENCH: 'market-bench',
  MARKET_WELL: 'market-well',
  MARKET_TABLE: 'market-table',
  MARKET_TENT: 'market-tent',
  MARKET_HAY_BALE: 'market-hay-bale',
  MARKET_SIGN_POST: 'market-sign-post',
  MARKET_SIGN_BREAD: 'market-sign-bread',
  MARKET_SIGN_INN: 'market-sign-inn',
  MARKET_SIGN_POTION: 'market-sign-potion',
  MARKET_BANNER_RED: 'market-banner-red',
  MARKET_BANNER_BLUE: 'market-banner-blue',
  MARKET_STALL_RED: 'market-stall-red',
  MARKET_STALL_GREEN: 'market-stall-green',
  MARKET_STALL_BLUE: 'market-stall-blue',
  MARKET_BARREL: 'market-barrel',
  MARKET_CRATE: 'market-crate',
  MARKET_BASKET_APPLES: 'market-basket-apples',
  MARKET_BASKET_BREAD: 'market-basket-bread',
  MARKET_SACK_GRAIN: 'market-sack-grain',
  MARKET_WHEELBARROW: 'market-wheelbarrow',
  MARKET_CART: 'market-cart',
  MARKET_BUCKET: 'market-bucket',
  MARKET_CHEST: 'market-chest',
  MARKET_PUMPKIN: 'market-pumpkin',
  MARKET_CHEESE: 'market-cheese',
  MARKET_WHEAT: 'market-wheat',
  MARKET_EGG_BASKET: 'market-egg-basket',

  // ── Interior art (Phase 2) — provenance/licence NOT yet confirmed, see
  //    docs/ASSETS.md. Loaded lazily by InteriorScene, never by BootScene, so the
  //    town keeps working if these files are absent.
  /** 288×64: walls, floor, door and desk-top items on a 16px grid (work3.png). */
  INTERIOR_OFFICE_KIT: 'interior-office-kit',
  /** 675×672: loose furniture, 16px-grid aligned, irregular sizes (work4.png). */
  INTERIOR_FURNITURE: 'interior-furniture',
  /** 1774×887: large computers and books on an opaque near-black ground (work.png). */
  INTERIOR_COMPUTERS: 'interior-computers',
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

  [AssetKeys.HALLOWEEN_PUMPKINS]:   '/assets/halloween%20pumpkins/pumpkins-outline.png',

  [AssetKeys.MARKET_LAMP]:          '/assets/tilesets/PNG/16x16/street/lamp_post.png',
  [AssetKeys.MARKET_BENCH]:         '/assets/tilesets/PNG/16x16/street/bench.png',
  [AssetKeys.MARKET_WELL]:          '/assets/tilesets/PNG/16x16/street/well.png',
  [AssetKeys.MARKET_TABLE]:         '/assets/tilesets/PNG/16x16/street/table_market.png',
  [AssetKeys.MARKET_TENT]:          '/assets/tilesets/PNG/16x16/street/tent_merchant.png',
  [AssetKeys.MARKET_HAY_BALE]:      '/assets/tilesets/PNG/16x16/street/hay_bale.png',
  [AssetKeys.MARKET_SIGN_POST]:     '/assets/tilesets/PNG/16x16/street/sign_post.png',
  [AssetKeys.MARKET_SIGN_BREAD]:    '/assets/tilesets/PNG/16x16/street/sign_bread.png',
  [AssetKeys.MARKET_SIGN_INN]:      '/assets/tilesets/PNG/16x16/street/sign_hanging_inn.png',
  [AssetKeys.MARKET_SIGN_POTION]:   '/assets/tilesets/PNG/16x16/street/sign_potion.png',
  [AssetKeys.MARKET_BANNER_RED]:    '/assets/tilesets/PNG/16x16/street/banner_red.png',
  [AssetKeys.MARKET_BANNER_BLUE]:   '/assets/tilesets/PNG/16x16/street/banner_blue.png',
  [AssetKeys.MARKET_STALL_RED]:     '/assets/tilesets/PNG/16x16/stalls/stall_red.png',
  [AssetKeys.MARKET_STALL_GREEN]:   '/assets/tilesets/PNG/16x16/stalls/stall_green.png',
  [AssetKeys.MARKET_STALL_BLUE]:    '/assets/tilesets/PNG/16x16/stalls/stall_blue.png',
  [AssetKeys.MARKET_BARREL]:        '/assets/tilesets/PNG/16x16/containers/barrel.png',
  [AssetKeys.MARKET_CRATE]:         '/assets/tilesets/PNG/16x16/containers/crate.png',
  [AssetKeys.MARKET_BASKET_APPLES]: '/assets/tilesets/PNG/16x16/containers/basket_apples.png',
  [AssetKeys.MARKET_BASKET_BREAD]:  '/assets/tilesets/PNG/16x16/containers/basket_bread.png',
  [AssetKeys.MARKET_SACK_GRAIN]:    '/assets/tilesets/PNG/16x16/containers/sack_grain.png',
  [AssetKeys.MARKET_WHEELBARROW]:   '/assets/tilesets/PNG/16x16/containers/wheelbarrow.png',
  [AssetKeys.MARKET_CART]:          '/assets/tilesets/PNG/16x16/containers/cart.png',
  [AssetKeys.MARKET_BUCKET]:        '/assets/tilesets/PNG/16x16/containers/bucket.png',
  [AssetKeys.MARKET_CHEST]:         '/assets/tilesets/PNG/16x16/containers/chest_small.png',
  [AssetKeys.MARKET_PUMPKIN]:       '/assets/tilesets/PNG/16x16/goods/pumpkin.png',
  [AssetKeys.MARKET_CHEESE]:        '/assets/tilesets/PNG/16x16/goods/cheese.png',
  [AssetKeys.MARKET_WHEAT]:         '/assets/tilesets/PNG/16x16/goods/wheat_bundle.png',
  [AssetKeys.MARKET_EGG_BASKET]:    '/assets/tilesets/PNG/16x16/goods/egg_basket.png',

  [AssetKeys.INTERIOR_OFFICE_KIT]:  '/assets/interior/work3.png',
  [AssetKeys.INTERIOR_FURNITURE]:   '/assets/interior/work4.png',
  [AssetKeys.INTERIOR_COMPUTERS]:   '/assets/interior/work.png',
}

/**
 * Images from the market pack that are loaded as plain 16×16 textures (every
 * prop in that pack is exactly one tile).
 */
export const MARKET_IMAGE_KEYS: readonly AssetKey[] = [
  AssetKeys.MARKET_LAMP,
  AssetKeys.MARKET_BENCH,
  AssetKeys.MARKET_WELL,
  AssetKeys.MARKET_TABLE,
  AssetKeys.MARKET_TENT,
  AssetKeys.MARKET_HAY_BALE,
  AssetKeys.MARKET_SIGN_POST,
  AssetKeys.MARKET_SIGN_BREAD,
  AssetKeys.MARKET_SIGN_INN,
  AssetKeys.MARKET_SIGN_POTION,
  AssetKeys.MARKET_BANNER_RED,
  AssetKeys.MARKET_BANNER_BLUE,
  AssetKeys.MARKET_STALL_RED,
  AssetKeys.MARKET_STALL_GREEN,
  AssetKeys.MARKET_STALL_BLUE,
  AssetKeys.MARKET_BARREL,
  AssetKeys.MARKET_CRATE,
  AssetKeys.MARKET_BASKET_APPLES,
  AssetKeys.MARKET_BASKET_BREAD,
  AssetKeys.MARKET_SACK_GRAIN,
  AssetKeys.MARKET_WHEELBARROW,
  AssetKeys.MARKET_CART,
  AssetKeys.MARKET_BUCKET,
  AssetKeys.MARKET_CHEST,
  AssetKeys.MARKET_PUMPKIN,
  AssetKeys.MARKET_CHEESE,
  AssetKeys.MARKET_WHEAT,
  AssetKeys.MARKET_EGG_BASKET,
]
