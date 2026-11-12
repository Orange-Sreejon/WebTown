# Halloween Night Mode — Tasks

One task at a time, in order. Each task is independently verifiable and must
leave the tree green: `npx tsc -b`, `npm test -- --run`, `npm run build`.

---

## T-01 — Timing and decor configuration

**Depends on:** nothing.

**Steps**
1. Create `src/game/config/halloween.ts` with: `CYCLE_DURATION_MS` (15 min),
   `PERIODS`, `SKY_KEYFRAMES` (hours), `HALLOWEEN_FADE`, `PUMPKIN_SHEET`,
   `PUMPKIN_FRAMES`, `PUMPKIN_PLACEMENTS`, `WINDOW_GLOWS`, `BATS`,
   `NIGHT_LIGHT`.
2. Seed `PUMPKIN_PLACEMENTS` and `WINDOW_GLOWS` with placeholder entries
   (empty arrays are fine at this step); they are filled in T-05/T-06.
3. Add a doc comment stating that this file is the only place timings live.

**Acceptance:** file compiles, exports are typed, no magic numbers elsewhere
yet. `npx tsc -b` exits 0.

---

## T-02 — In-game clock

**Depends on:** T-01.

**Steps**
1. Create `src/game/systems/game-clock.ts`: `GameClock` (`tick`, `setHour`,
   `state`, `freeze`), `periodAt(hour)`, `parseTimeOverride(search)`,
   `parseFrozenOverride(search)`.
2. Clock is elapsed-time based (accumulates `delta`), wraps at 24 h, and never
   reads the system clock.
3. Write `game-clock.test.ts`:
   - a full `CYCLE_DURATION_MS` advances exactly 24 h and wraps to the start;
   - `periodAt` returns day for 06:00 and 17:59, evening for 18:00 and 19:59,
     night for 20:00, 23:59, 00:00 and 05:59;
   - `parseTimeOverride('time=21:30')` → 21.5; invalid/missing → undefined;
   - frozen clock ignores `tick`;
   - `setHour` jumps without drifting.

**Acceptance:** new tests pass; no Phaser import in the module.

---

## T-03 — Hour-based lighting curve and Halloween factor

**Depends on:** T-01, T-02.

**Steps**
1. Move `SKY_KEYFRAMES` into `halloween.ts` keyed by **hour**, each with
   `tint`, `night`, `lamp`, `halloween`.
2. `day-night.ts`: add `skyAtHour(hour)`; keep `skyAt(t)` as
   `skyAtHour(t * 24)` so existing callers/tests hold.
3. `halloween` is 0 during day and evening, ramps 0→1 across
   `HALLOWEEN_FADE.inStart..inEnd`, holds 1, and ramps back to 0 before 06:00.
4. Reuse the verified readable night tint; add purple in the deep-night
   keyframe only.
5. Extend `day-night.test.ts`:
   - midnight (0:00) is night, midday is day, 18:30 is evening;
   - tint/night/lamp are continuous: no step larger than a small epsilon
     between consecutive in-game minutes across the whole 24 h;
   - `halloween` is exactly 0 at 12:00 and 18:30, 1 at 22:00 and 02:00, 0 at
     06:00, and monotonic through both fades;
   - night tint channel floor (readability) still holds.

**Acceptance:** all tests pass, including the pre-existing `skyAt` ones.

---

## T-04 — Load the pumpkin sheet

**Depends on:** T-01.

**Steps**
1. `AssetKeys.ts`: add `HALLOWEEN_PUMPKINS: 'halloween-pumpkins'` and its
   `AssetPaths` entry (`assets/halloween%20pumpkins/pumpkins-outline.png`).
2. `BootScene.preload`: `load.spritesheet(..., { frameWidth: 16, frameHeight: 16 })`.
3. Confirm the frame maths with a one-off zoomed screenshot: `frame = row * 15 + col`,
   small block cols 12–14, rows 0–6; lit carved faces on rows 5–6.

**Acceptance:** sheet loads (no loaderror in console), 210 frames registered,
`npx tsc -b` and build pass.

---

## T-05 — Glowing pumpkins

**Depends on:** T-03, T-04.

**Steps**
1. Create `src/game/maps/halloween-layer.ts` with `HalloweenLayer` scaffolding
   (`build`, `setNightFactor`, `destroy`, `built` guard).
2. Add a pure `validatePumpkinPlacements()` helper: every spot is on grass, not
   on a structure, fence, prop tile, pond tile, animal pen, garden or the
   player's start tile; no two spots share a tile.
3. Fill `PUMPKIN_PLACEMENTS` with ~18–24 spots spread across the village
   (yards, gates, the market row, the pond edge, the church path) — not
   clustered in one place.
4. Render each pumpkin bottom-anchored at `depthForFeetY(baseY)` with one
   additive glow (`createLampGlow`-style texture, smaller size) at
   `depth - 0.01`; both start at alpha 0.
5. `setNightFactor(f)` sets `alpha = NIGHT_LIGHT.pumpkinAlpha * f` on pumpkins
   and a warmer, stronger alpha on their glows, and enables the small solid
   footprint at each pumpkin's base once `f >= PUMPKIN_COLLIDER.solidAt`.
6. Tests (`halloween-layer.test.ts`): placement helper rejects an on-fence tile
   and the player's spawn tile, accepts a known grass tile; count and spread
   (pumpkins in ≥3 areas of the map).

**Acceptance:** at `?time=22:00` pumpkins glow and are solid (walk into one);
at `?time=12:00` nothing is visible and nothing is solid (walk through the
same spot).

---

## T-06 — Warm house windows

**Depends on:** T-05.

**Steps**
1. Generate a 24×24 hard-stepped warm window texture once (shared).
2. Fill `WINDOW_GLOWS` with per-structure anchors (`structure` label + `dx`,
   `dy` in tiles) for both houses and the church — verified visually, not
   guessed: zoom the house, note the window tiles.
3. Place each glow above the ground and below/level with its structure depth
   so the window frames stay on top; alpha 0 by day.
4. `setNightFactor` raises them to `NIGHT_LIGHT.windowAlpha * f`.
5. Test: every anchor's `structure` label exists in `STRUCTURES`.

**Acceptance:** at 22:00 windows read as lit from inside; at 12:00 invisible;
no glow bleeding over roofs.

---

## T-07 — Moon, stars and bats

**Depends on:** T-05.

**Steps**
1. Generate a 48×48 moon texture (disc, two or three craters, no blur) and a
   few 1–2 px star dots; place on a `setScrollFactor(0)` layer under the sky
   overlay, repositioned with the camera like the overlay.
2. Generate a 2-frame 11×7 bat texture (original pixel art) and add 2–3 bats
   with `yoyo` tweens on slow, distinct paths; no more than 3 on screen.
3. Moon/stars/bats use the same `setNightFactor` multiplier.
4. `destroy()` stops every tween and destroys the objects; wire it to
   `this.events.once('shutdown', ...)`.
5. Test: bat count ≤ 3; moon/star positions stay inside the viewport for the
   configured camera zoom.

**Acceptance:** 22:00 shows a moon and sparse bats; 12:00 shows none; scene
restart twice produces no duplicates.

---

## T-08 — Scene wiring and dev time override

**Depends on:** T-02, T-03, T-07.

**Steps**
1. `TownScene.create`: build `GameClock` from `parseTimeOverride` /
   `parseFrozenOverride`; create the layer after the map exists.
2. `TownScene.update`: tick the clock (unless frozen), `skyAtHour(hour)`,
   apply tint + `map.setLampLight(sky.lamp)` + `halloween.setNightFactor(sky.halloween)`.
3. Dev-only keys `1`/`2`/`3` → 09:00 / 18:30 / 22:00, gated by
   `import.meta.env.DEV`; remove listeners on shutdown.
4. Keep a single overlay and a single layer; no new scenes.

**Acceptance:** `?time=12:00`, `?time=18:30`, `?time=22:00` each show the right
state; movement, collision, camera and y-sorting behave exactly as before.

---

## T-09 — Documentation

**Depends on:** T-08.

**Steps**
1. `docs/ASSETS.md`: new section for the pumpkin pack — creator Grajo, itch
   source, 240×224 sheet, 15×14 grid, licence text (commercial OK, no resale,
   credit appreciated), redistribution note, plus the generated textures
   (moon/stars/bats/window glow) marked as project-original.
2. Document the daytime/no-decor rule, the period boundaries, the cycle
   duration and the two dev override parameters.
3. Note in `docs/ASSETS.md` that the sheet's large pumpkins are unused because
   they overflow their cells.

**Acceptance:** docs match the implementation (frame numbers, file paths,
periods, overrides).

---

## T-10 — Full verification

**Depends on:** all.

**Steps**
1. `npx tsc -b && npm test -- --run && npm run build`.
2. Screenshots at 12:00, 18:30, 20:05, 22:00, 05:50 — compare against the
   verification checklist in `requirements.md`.
3. Walk the map at 22:00: player visible, collision unchanged, camera smooth.
4. Reload twice: object counts identical.

**Acceptance:** all ten checklist items pass; anything not verified is
reported as such.
