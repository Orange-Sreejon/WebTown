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
