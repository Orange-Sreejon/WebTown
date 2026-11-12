# WebTown Asset Documentation

## Summary

Two asset packs are used in this project. Both were downloaded from itch.io.
Licence details were read from the files included in each download and cross-checked
against the itch.io listing pages.

---

## Asset Pack 1 — TILESET VILLAGE TOP DOWN

| Field       | Value |
|-------------|-------|
| Creator     | PIXELJAD |
| Source      | https://pixeljad.itch.io/villagetopdown |
| Download    | Free (no payment required) |
| Licence     | Custom – see terms below |
| Attribution | Required: credit "Pixeljad" / @pixeljad (Instagram) |

### Licence Terms (from itch.io listing — no bundled licence file)

**Permitted:**
- Use in non-commercial and commercial projects.
- Adapt and/or modify assets to match your project.

**Prohibited:**
- Distribute or sell assets directly, even if modified.
- Claim assets as your own original work.
- Use in crypto / NFT / metaverse-related projects.

> ⚠️ **REDISTRIBUTION FLAG**: No licence file is bundled with this pack.
> Terms were read from the itch.io listing page only. The listing does not
> explicitly address open-source game repositories. Publishing the raw PNG
> files in a public git repository may constitute redistribution. Confirm
> with the creator before making the repository public with these assets
> committed. Consider `.gitignore`-ing the raw asset folder or hosting
> assets separately for public releases.

### File Inventory

All files are in `TILESET VILLAGE TOP DOWN/` (project source copy).
Planned deployment path: `public/assets/tilesets/village-top-down/`

Each tile asset exists in DAY and NIGHT variants.

#### Ground / Terrain Tiles (16×16 px each)

| File                     | Dimensions | Notes |
|--------------------------|-----------|-------|
| GRASS TILE - DAY.png     | 16×16     | Base ground fill |
| GROUND TILE - DAY.png    | 16×16     | Dirt/path fill |
| WATER TILE - DAY.png     | 16×16     | Water fill |
| GRASS DETAIL 1–6 - DAY   | 16×16     | Decorative overlays |
| GROUND DETAIL 1–5 - DAY  | 16×16     | Decorative overlays |
| WATER DETAIL 1–5 - DAY   | 16×16     | Water surface details |
| FENCE 1 - DAY.png        | 16×16     | Fence segment |
| FENCE 2 - DAY.png        | 16×16     | Fence variant |

#### Terrain Sets (multi-tile sheets)

| File                          | Dimensions | Notes |
|-------------------------------|-----------|-------|
| TERRAIN SET 1 - DAY.png       | 48×48     | 3×3 tiles at 16px = road/pavement autotile set |
| TERRAIN SET 2 - DAY.png       | 48×48     | 3×3 tiles at 16px |
| TERRAIN SET 3 - DAY.png       | 48×64     | 3×4 tiles at 16px |
| TERRAIN SET 3 CURVES - DAY.png| 32×32     | 2×2 curve corners |
| TERRAIN SET 4 - DAY.png       | 48×64     | 3×4 tiles at 16px |
| TERRAIN SET 4 CURVES - DAY.png| 32×48     | 2×3 curve corners |
| TERRAIN SET 5 - DAY.png       | 48×48     | 3×3 tiles at 16px |

#### Structures (sprite images, not tileable)

| File                 | Dimensions | Notes |
|----------------------|-----------|-------|
| HOUSE 1 - DAY.png    | 80×112    | House: 5 tiles wide × 7 tiles tall at 16px |
| HOUSE 2 - DAY.png    | 128×112   | Larger house: 8×7 tiles |
| CHURCH - DAY.png     | 128×112   | 8×7 tiles |
| BRIDGE - DAY.png     | 96×48     | 6×3 tiles |
| STAIRS - DAY.png     | 32×64     | 2×4 tiles |
| PIT - DAY.png        | 32×48     | 2×3 tiles |

#### Vegetation

| File              | Dimensions | Notes |
|-------------------|-----------|-------|
| TREE 1 - DAY.png  | 48×48     | 3×3 tiles |
| TREE 2 - DAY.png  | 48×48     | 3×3 tiles |
| TREE 3 - DAY.png  | 48×48     | 3×3 tiles |

#### Source File

| File                              | Notes |
|-----------------------------------|-------|
| TILESET VILLAGE TOP DOWN.psd      | Photoshop source — not for web deployment |

### Tile Size Determination

All tile-based assets are consistent multiples of **16×16 pixels**. Structures
and terrain sets are 2–8 tiles wide/tall. The base tile unit for this pack is
**16×16 px**. The (THANK YOU).png (400×400) is a creator thank-you card, not
a game asset.

### Transparency

All PNGs confirmed to be pixel art on transparent backgrounds (structural
assets) or opaque fills (ground tiles). No white-matte artefacts observed
in naming conventions — assumed standard PNG alpha.

---

## Asset Pack 2 — Nasha's Tiny Cast: Village Folk v1.0

| Field       | Value |
|-------------|-------|
| Creator     | nanasha (Nasha) |
| Source      | https://nanasha.itch.io/nashas-tiny-cast-village-folk |
| Download    | Free (no payment required) |
| Licence     | Custom – bundled as `LICENSE.txt` |
| Attribution | Not required, but appreciated |

### Licence Terms (from bundled `LICENSE.txt`)

**Permitted:**
- Use in personal and commercial projects (games, apps, videos, printed materials).
- Modify, recolour, crop, combine and scale the assets.
- Use in projects you sell, as long as the assets are part of a larger work.

**Prohibited:**
- Resell, share, sublicense or redistribute assets on their own or as part of
  another asset pack, template, or on any marketplace or free asset site.
- Claim assets as your own original work.
- Use to train machine-learning or AI models.

> ✅ **REDISTRIBUTION STATUS**: Bundled licence explicitly permits commercial
> use and modification. The prohibition is against redistributing the assets
> *as assets* (i.e., selling or sharing the sprite files themselves). Including
> them as compiled/served files in a game application is within the licence
> terms. Publishing raw sprite files in a public git repository remains a grey
> area — the same caution as Pack 1 applies. Consider `.gitignore` for raw
> asset sources; serve compiled/copied assets from `public/` only.

### Character Roster (24 characters)

baker_woman, beekeeper, blacksmith, carpenter, chicken_boy, farmer,
fisherman, flower_girl, grandma, herbalist, innkeeper, little_boy,
little_girl, mayor, milkmaid, miller, orchard_girl, potter,
shepherd_girl, tailor, traveller, village_elder, watchman, woodcutter

### Frame Specification

Each character has **12 PNG frames** (individual, `characters/<name>/`):

```
<name>_<direction>_<frame>.png
  direction: down | left | right | up
  frame:     1 (left step) | 2 (stand) | 3 (right step)
```

- Frame dimensions: **48×64 px** per cell
- Transparent background
- Feet sit 2 px above the bottom edge in the standing frame
- All frames share the same cell size — no per-frame offset needed

### Walk Animation

Play frames **1 → 2 → 3 → 2** in a loop at ~6 FPS for walking.
Show frame **2** alone when standing still.

### Spritesheets

| File                              | Dimensions | Layout |
|-----------------------------------|-----------|--------|
| `$<name>.png` (24 files)          | 144×256   | 3 cols × 4 rows, RPG Maker MV/MZ single-char format. Rows: down, left, right, up |
| `tiny_cast_village_folk_1.png`    | 576×512   | 8 chars × 2 rows (4 across), standard RPG Maker sheet |
| `tiny_cast_village_folk_2.png`    | 576×512   | Same layout |
| `tiny_cast_village_folk_3.png`    | 576×512   | Same layout |

**For Phaser**: Use the individual `$<name>.png` spritesheets. Each is
144×256 with frameWidth=48, frameHeight=64, 3 columns × 4 rows. Row order
is down (0), left (1), right (2), up (3). Frame indices 0–2 = down, 3–5 = left,
6–8 = right, 9–11 = up.

### Planned Player Character

**traveller** — the most versatile/neutral character for a player avatar.

---

## Asset Compatibility

| Concern | Assessment |
|---------|-----------|
| Tile grid | Tileset: 16×16 px grid. Characters: 48×64 px cells. Compatible — characters are 3 tiles wide, ~4 tiles tall. |
| Art style | Both packs are top-down pixel art. The tileset uses a flatter style; characters use a slight chibi perspective. Acceptable for this phase. |
| Scaling | Both must be scaled with **nearest-neighbour** (no antialiasing) to stay crisp. |
| Day/Night | Tileset provides both variants. Phase 1 uses DAY variants only. |
| Transparency | All character frames have transparent backgrounds. ✅ |

---

## Redistribution Risk Summary

| Pack | Risk Level | Reason |
|------|-----------|--------|
| Tileset Village Top Down (PIXELJAD) | 🔴 High | No bundled licence file. Terms from itch.io listing only. No explicit open-source/public-repo clause. |
| Tiny Cast Village Folk (nanasha)    | 🟡 Medium | Bundled licence permits game use. Prohibition is on redistributing *as assets*. Public repo commits are a grey area. |

**Recommendation**: Do not commit raw asset files to a public repository
without explicit creator permission or confirmed open licence. Keep assets
in `.gitignore` for the public remote, or serve them via a CDN/object store
rather than the git repo. For this private development phase, local use is
within both licences.

---

## Attribution (required for PIXELJAD tileset)

If this project is published or publicly demonstrated, the following credit
must be included:

> Tileset art by **Pixeljad** — https://pixeljad.itch.io/villagetopdown
> Character sprites by **nanasha** — https://nanasha.itch.io/nashas-tiny-cast-village-folk (credit appreciated, not required)

---

## Asset Pack 3 — CUTE FANTASY (Free)

| Field       | Value |
|-------------|-------|
| Location    | `public/assets/Cute_Fantasy_Free/` |
| Licence file| `read_me.txt` (bundled) |
| Licence     | **Non-commercial use only.** Modification allowed. Redistribution and resale prohibited, even if modified. |

### Files used in game

| File | Use |
|------|-----|
| `Outdoor decoration/House_1_Wood_Base_Blue.png` (96×128) | Third house type |
| `Outdoor decoration/Bridge_Wood.png` (144×64) | Pond bridge |
| `Outdoor decoration/Oak_Tree.png` (64×80) | Large tree species |
| `Outdoor decoration/Outdoor_Decor_Free.png` (112×192) | 7×12 grid of 16×16 props (signposts, pots, bushes, rocks, logs) — frame indices in `src/game/maps/cute-props.ts` |
| `Animals/{Chicken,Cow,Pig,Sheep}/*.png` (64×64) | 2×2 sheets of 32×32 frames, used in the pasture |

> ⚠️ **Non-commercial only.** This pack cannot be used in a commercial release,
> and the raw files must not be redistributed (including a public git repo).
> If WebTown is ever sold or monetised, these assets must be replaced.

---

## Asset Pack 4 — FARM RPG FREE 16×16 TINY ASSET PACK

| Field       | Value |
|-------------|-------|
| Location    | `public/assets/Farm RPG FREE 16x16 - Tiny Asset Pack/` |
| Licence file| **None bundled** |
| Licence     | **Unverified.** The folder name says "FREE", but no terms are included in the download, so usage rights cannot be confirmed from the files themselves. |

### Files used in game

| File | Use |
|------|-----|
| `Objects/Maple Tree.png` (160×48) | Spritesheet of 5 growth stages, 32×48 each; frame 3 is used as a tree species |

> ⚠️ **Verify before publishing.** Confirm the licence on the download page and
> record it here. Until then, treat it with the same caution as Pack 1.

---

## Asset Pack 5 — PIXEL MEDIEVAL MARKET PROPS (16×16)

| Field       | Value |
|-------------|-------|
| Location    | `public/assets/tilesets/PNG/16x16/` (plus `spritesheet.png` at the pack root) |
| Licence file| `public/assets/tilesets/LICENSE.txt` (bundled) |
| Licence     | Free for use in projects, **no resale or redistribution of the pack itself**. |

62 single-tile 16×16 props grouped into `street/`, `stalls/`, `containers/`,
`goods/` and `trade/`. Every file is exactly 16×16 px, so each prop occupies
one map tile — no frame maths needed (unlike the Cute Fantasy decor sheet).

### Files used in game

28 of the 62, loaded as plain images in `BootScene` (see
`MARKET_IMAGE_KEYS` in `src/game/config/AssetKeys.ts`). Only the shops and
street furniture are placed — **no produce is scattered on the grass**, because
each stall sprite already has its goods drawn on it:

| Category | Props | Where they go |
|----------|-------|---------------|
| Stalls | `stall_red`, `stall_green`, `stall_blue` | Three separate shops, spread across the village: main road east of the crossroads, the north street, the pond approach |
| Street | `tent_merchant`, `table_market`, `cart`, `well`, `bench`, `bucket`, `lamp_post`, `sign_post`, `sign_bread`, `hay_bale` | Merchant's tent out in the east park, the well by the north junction, benches at the pond, lamps spaced along the main roads, signposts at the crossroads |
| Containers | `barrel`, `crate`, `wheelbarrow` | One or two beside each stall, wheelbarrow and hay by the pasture |
| Goods | `basket_apples`, `basket_bread`, `sack_grain`, `pumpkin`, `cheese`, `egg_basket`, `wheat_bundle` | Loaded but **not placed** — kept available if a sold-goods prop is ever wanted |

### World scale

The pack draws a whole stall inside one 16×16 cell, so at 1× its props read as
toys next to the 5–8 tile houses. `PROP_SCALE` in
`src/game/maps/town-layout.ts` scales them up, but only the stalls take the
statement size — they are what should read as a shop from across the street:

| Group | Scale | Size |
|-------|-------|------|
| Market stalls (red, green, blue) | 2.5× | 40 px (2½ tiles) |
| Well, tent, hay bale, lamp post, market table | 2× | 32 px (2 tiles) |
| Cart, bench, barrel, crate, wheelbarrow, signposts, bucket | 1.5× | 24 px (1½ tiles) |

Sprites are bottom-anchored so they stand on the ground, and placement checks
every tile their scaled sprite covers.

**Street lamps are the exception.** A lamp keeps its full brightness (no dark
tint) and carries a light instead: a very wide, very soft additive falloff
(`createLampGlow` in `src/game/maps/ambient.ts`) that fades to nothing across
four tiles, so the grass around the post simply brightens with no disc or ring
visible. It starts at zero alpha — the lamps only come up as the day-night
cycle darkens (see `src/game/systems/day-night.ts`, a 15-minute day). Each lamp
is also solid, but only by a thin 10 px box at the base of the post
(`collision-objects.ts`), so you bump into the pole and still walk around it
inside its tile. Lamp posts and the player are **y-sorted** by the point where
they meet the ground (`depthForFeetY` in `GameConfig.ts`): walk behind a post
and it draws over you, walk in front and it passes behind you.

The rest of the set gets a light warm wash so it sits with the Pixeljad tileset
rather than reading as a separate pack. Each prop is tinted with `0xe8e1d4` in
`TownMap` — a near-white multiply, only about a 10% drop in luma, so the
stalls stay bright and readable — and a soft elliptical shadow is drawn under it
so it pools on the grass instead of floating on it.

> Note: a colour-matrix effect (the way the Cute Fantasy houses are
t> harmonised) is deliberately **not** used for these props. With a `preFX`
> pipeline active Phaser bypasses `setTint`, so the two cannot be combined —
> the tint alone is what darkens them.

The rest of the pack (trade items, cloth rolls, fish, wine, extra signs) is
unused for now — it is all the same 16×16 grid, so adding one is a single
entry in `AssetKeys` and one line in `PLACED_PROPS` in
`src/game/maps/town-layout.ts`.

> ⚠️ The licence prohibits redistributing the pack *as an asset pack*. Serving
the files to the game from `public/` is normal use; the same public-repository
caution as the packs above applies.

---

## Asset Pack 6 — HALLOWEEN PUMPKINS (Grajo)

| Field       | Value |
|-------------|-------|
| Location    | `public/assets/halloween pumpkins/` |
| Creator     | Grajo |
| Source      | https://grajopx.itch.io (itch: `grajopx`) |
| Licence file| `public/assets/halloween pumpkins/readme.txt` (bundled) |
| Licence     | Commercial **and** non-commercial use; modification allowed; **resale of the assets prohibited**. Credit appreciated but not required. |

### Files used in game

| File | Dimensions | Use |
|------|-----------|-----|
| `pumpkins-outline.png` | 240×224 | 15×14 sheet of 16×16 cells. Only the small-pumpkin block (cols 12–14, rows 0–6) is used — the sheet's large pumpkins overflow their 16×16 cells and would need manual cropping |

Loaded once in `BootScene` as a 16×16 spritesheet (`AssetKeys.HALLOWEEN_PUMPKINS`),
so `frame = row × 15 + column`. The frames used are listed in `PUMPKIN_FRAMES`
(`src/game/config/halloween.ts`). The pack's `pumpkins-no-outline.png`,
`.aseprite` source and the rest of the sheet are unused.

### Redistribution

The licence allows use and modification in commercial and non-commercial
projects, but **not reselling the assets**. Committing the PNG to a public
repository publishes the raw asset, which is the same caution as Packs 1–5:
confirm with the creator before making the repository public with the asset
folder included, or keep the raw folder out of version control. Serving the
file from `public/` to the game is normal use.

---

## Generated Halloween textures (project-original)

No external asset is used for the rest of Halloween Night Mode. These are
drawn in code (`src/game/maps/halloween-layer.ts`) with hard-edged pixel steps,
so nothing needs a licence:

| Texture | Size | Use |
|---------|------|-----|
| `halloween-moon` | 48×48 | Moon disc with craters, fixed screen-space layer |
| `halloween-star` | 5×5 | Star dot |
| `halloween-bat` | 2 × 11×7 | Two-frame bat silhouette, tween-driven flight |
| `halloween-window-glow` | 18×18 | Hard-stepped warm window light |
| `ambient-lamp-glow` (reused) | 64×64 | Pumpkin light pool; shared with the street lamps |

---

## Halloween Night Mode — timings and developer overrides

All timings live in `src/game/config/halloween.ts`:

- **Cycle:** one in-game day is 15 real minutes (`CYCLE_DURATION_MS`), as before.
- **Periods:** day 06:00–17:59, evening 18:00–19:59, night 20:00–05:59.
- **Halloween visibility:** fade in 20:00–20:30, fully visible 20:30–05:30,
fade out 05:30–06:00, **completely hidden 06:00–19:59** (day and evening).
  The town clock starts at 09:00 and never reads the system clock.

Developer-only time controls (no settings UI, no HUD):

| Control | Effect |
|---------|--------|
| `?time=HH:MM` | Start at that in-game time, e.g. `?time=22:00` |
| `?timeFrozen=1` | Hold that time still (combine with `?time=`) |
| `1` / `2` / `3` | Dev builds only: jump to 09:00 / 18:30 / 22:00 |

---

## Path encoding note

The two packs above contain folder and file names with spaces. They are
percent-encoded in `src/game/config/AssetKeys.ts` (e.g. `Outdoor%20decoration`),
and the on-disk folder names are case-sensitive (`Cute_Fantasy_Free`), which
matters when deploying to a case-sensitive server.
