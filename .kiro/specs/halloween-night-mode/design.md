# Halloween Night Mode — Design

## Goals

Turn the existing single day-night curve into a **24-hour clock** with three
named periods, and hang a **Halloween layer** off the `night` period without
touching terrain, houses, props, collision or the player.

Everything stays Phaser-side. React is not involved; no new events on the
`EventBus` are needed.

---

## Architecture

```
src/game/
├── config/
│   ├── GameConfig.ts           (unchanged; depth helpers stay here)
│   └── halloween.ts            NEW — all timings + decor tables
├── systems/
│   ├── game-clock.ts           NEW — pure clock: elapsed → hour/period
│   ├── game-clock.test.ts      NEW
│   ├── day-night.ts            EXTENDED — keyframes in hours, + halloween factor
│   └── day-night.test.ts       EXTENDED
├── maps/
│   ├── halloween-layer.ts      NEW — pumpkins, window glow, bats, moon, stars
│   ├── halloween-layer.test.ts NEW (data/placement only, no renderer)
│   └── town-layout.ts          READ-ONLY (source of free space + placements)
└── scenes/
    ├── BootScene.ts            + load pumpkin sheet
    └── TownScene.ts            + clock, + layer, + dev override wiring
```

### Data flow (per frame)

```
delta ──▶ GameClock.tick(delta) ──▶ { hour, minute, period }
                                        │
                    skyAtHour(hour) ────┤──▶ { tint, night, lamp, halloween }
                                        │
              TownScene.applySky() ─────┼──▶ camera overlay + TownMap.setLampLight()
                                        │
        HalloweenLayer.setNightFactor() ─┴──▶ alpha ramp on every Halloween object
```

The clock is the only stateful piece. `day-night.ts` stays a pure function of
the hour, so the whole lighting curve is testable without a renderer — the
existing approach, extended to hours and with one extra output.

---

## 1. `src/game/config/halloween.ts`

Single source of truth for timing and decor. Shape:

```ts
export const CYCLE_DURATION_MS = 15 * 60 * 1000   // one in-game day

export const PERIODS = {
  day:     { startHour: 6,  endHour: 18 },
  evening: { startHour: 18, endHour: 20 },
  night:   { startHour: 20, endHour: 6 },         // wraps midnight
} as const

export const OCTOBER = {                          // for later seasonal gating
  alwaysOn: true,                                 // ship it on, not date-gated
}

/** Lighting keyframes, in hours. First and last must match. */
export const SKY_KEYFRAMES = [ /* hour, tint, night, lamp, halloween */ ]

/** When Halloween decor fades in/out, in in-game hours. */
export const HALLOWEEN_FADE = { inStartHour: 20, inEndHour: 20.5, outStartHour: 5.5, outEndHour: 6 }
// Fade in 20:00–20:30, fully visible 20:30–05:30, fade out 05:30–06:00,
// completely hidden 06:00–19:59 (day and evening).

/** Pumpkin sheet: 15×14 cells of 16×16; the small block is cols 12–14. */
export const PUMPKIN_SHEET = { key: 'halloween-pumpkins', cell: 16, cols: 15 }

/** Named frames, as (col,row) in the sheet. */
export const PUMPKIN_FRAMES = {
  lanternLitA: { col: 12, row: 5 },
  lanternLitB: { col: 13, row: 5 },
  lanternLitC: { col: 14, row: 5 },
  lanternLitWide: { col: 13, row: 6 },
  plainSmall: { col: 12, row: 0 },
  plainFace: { col: 12, row: 3 },
}

/** Hand-placed pumpkin spots (tile coords), verified against the layout. */
export const PUMPKIN_PLACEMENTS: readonly { frame: keyof typeof PUMPKIN_FRAMES; tileX: number; tileY: number; scale?: number }[] = []

/** Per-house window glow anchors, in tiles relative to the structure. */
export const WINDOW_LAYOUTS: Readonly<Record<string, readonly { x: number; y: number; w: number; h: number }[]>> = {
  // window rectangles in the sprite's own texture pixels, keyed by sprite
}

/** Bats: paths are simple loops, one tween each. */
export const BATS = [ /* { y, durationMs, delayMs, scale } */ ]

export const NIGHT_LIGHT = { lampAlpha: 0.55, pumpkinAlpha: 0.6, windowAlpha: 0.5 }
```

No magic numbers elsewhere: the layer and the scene read from here.

## 2. `src/game/systems/game-clock.ts`

Pure, testable, no Phaser import.

```ts
export interface ClockState { hour: number; minute: number; period: Period }
export class GameClock {
  constructor(startHour = 9, durationMs = CYCLE_DURATION_MS)
  tick(deltaMs: number): ClockState        // wraps at 24h
  setHour(hour: number): ClockState        // dev override
  get state(): ClockState
}
export function periodAt(hour: number): Period
export function parseTimeOverride(search: string): number | undefined   // "?time=21:30" → 21.5
export function parseFrozenOverride(search: string): boolean             // "?timeFrozen=1"
```

- `durationMs` is the cycle length, so a test can run a whole day in a fake
  clock without a renderer.
- `periodAt` wraps: `hour >= 20 || hour < 6` is night.
- The frozen flag makes `tick()` a no-op; the scene still renders.

## 3. `src/game/systems/day-night.ts` (extended, not replaced)

- Keyframes move from cycle positions (0–1) to **hours**, and gain a
  `halloween` component (0 by day, 0 in the evening, 1 in the night, ramped
  by `HALLOWEEN_FADE`).
- `skyAtHour(hour)` is the new primary export; `skyAt(t)` becomes a thin
  wrapper (`skyAtHour(t * 24 + 6)`, i.e. cycle position 0 is 06:00 dawn) so the
  existing tests and any callers keep working.
- Night tint stays the light-blue value already tuned for visibility; the
  Halloween flavour comes from the extra purple in the deep-night keyframe
  rather than a second overlay, so there is still exactly one multiply pass.

## 4. `src/game/maps/halloween-layer.ts`

One class, created once by `TownScene`, that owns every Halloween object.

```ts
export class HalloweenLayer {
  constructor(scene: Phaser.Scene, map: TownMap)
  build(): void                 // idempotent: no-op if already built
  setNightFactor(f: number): void   // single call per frame from the scene
  destroy(): void               // tweens, timers, listeners, objects
}
```

- **Pumpkins** — `scene.add.image(...)` at hand-placed tiles, bottom-anchored,
  depth `depthForFeetY(baseY)` so they sort against the player exactly like
  lamps; plus one small additive glow sprite per pumpkin at
  `depthForFeetY(baseY) - 0.01`. Placement is validated in `town-layout` terms
  (grass only, no structure/fence/pond/prop tile) by a pure helper
  `validatePumpkinPlacements(...)` that the test can call.
- **Window glow** — a generated 16×16 texture of **hard** alpha steps (no
  gradient blur), stretched over each window pane listed in `WINDOW_LAYOUTS`,
  drawn just above its building so the pane reads as lit from inside. The pane
  rectangles are measured from the sprites themselves (both Pixeljad houses,
  the Cute Fantasy house and the church).
- **Bats** — two or three `image`s using one generated 2-frame texture
  (drawn in code: original pixel art, ~11×7 px per frame), animated with an
  alternating `yoyo` tween, each on a slow looping path. Tween-based, so there
  is no per-frame movement code.
- **Moon and stars** — one generated 48×48 texture (moon disc with a few
  craters) plus a handful of 1–2 px star dots, all on a `setScrollFactor(0)`
  layer below the sky overlay's depth minus one, so the tint colours them
  correctly. Position is derived from `cam` size on resize, exactly like the
  sky overlay.
- Everything starts at alpha 0 and is driven by one multiplier:
  `alpha = baseAlpha * nightFactor`. `setNightFactor` is a loop over three
  small arrays — no allocation, no per-frame object churn.

### Duplicate-protection

`build()` returns early when `this.built` is true, `TownScene` only builds in
`create()`, and `destroy()` is wired to `this.events.once('shutdown', ...)` so
a scene restart tears the layer down before a new one is created.

## 5. `TownScene` wiring

```ts
// create()
const params = new URLSearchParams(window.location.search)
this.clock = new GameClock(parseTimeOverride(params.toString()) ?? 9)
this.frozen = parseFrozenOverride(params.toString())
this.halloween = new HalloweenLayer(this, this.map)
this.halloween.build()

// update()
if (!this.frozen) this.clock.tick(delta)
const sky = skyAtHour(this.clock.state.hour)
this.applySky(sky)
this.halloween.setNightFactor(sky.halloween)
```

`applySky` keeps its current job (overlay tint + `map.setLampLight`) and adds
the Halloween factor pass-through. Dev keys are registered only when
`import.meta.env.DEV`, and removed on shutdown with the rest.

## 6. BootScene

```ts
this.load.spritesheet(AssetKeys.HALLOWEEN_PUMPKINS, AssetPaths[HALLOWEEN_PUMPKINS], {
  frameWidth: 16, frameHeight: 16,
})
```

The 15×14 grid means `frame index = row * 15 + col`; the small block in
cols 12–14 fits its cells exactly, so no manual rect registration is needed.
Only that block is used — the big pumpkins overflow their cells and would need
cropping, which is not worth it for decoration.

Path: `public/assets/halloween%20pumpkins/pumpkins-outline.png` (the outline
variant reads better against the dark night tint).

---

## Assets

### Reused (already in the project, no new download)

| Asset | Use |
|---|---|
| `halloween pumpkins/pumpkins-outline.png` (240×224, Grajo) | Carved pumpkins. Licence (bundled `readme.txt`): commercial + non-commercial use, modification allowed, **no resale of the assets**; credit appreciated. |
| Pixel Medieval Market lamps | Street lighting / lanterns at night (already implemented) |
| Cute Fantasy houses, church | Window glow anchors |

### Generated in code (no external asset, nothing to licence)

- Lamp-style soft light textures: already generated (reused for pumpkins).
- Window glow: 24×24 hard-stepped warm texture.
- Bat: 2-frame 11×7 px sprite.
- Moon: 48×48 px disc with craters; stars: 1–2 px dots.

### Proposed, requires approval

Nothing is required. If you want stronger spooky props (tombstones, cobwebs,
hanging lanterns, a scarecrow), they would have to come from another licensed
pack — I will not add or download one without your say.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Night too dark to play | Night tint is capped at the already-verified readable level; a unit test asserts a minimum luma floor. Pumpkins add *light*, not darkness. |
| Glow looks blurry / not pixel art | Hard-stepped alpha textures; no `postFX` blur; `roundPixels` untouched. |
| Duplicate objects on scene restart | `built` guard + `shutdown` cleanup + a test for idempotence of the placement tables. |
| Performance | Fixed object count (~20 pumpkins, ≤3 bats, 1 moon texture), one alpha loop per frame, tween-driven motion. |
| Interfering with Phase 1 | No edits to terrain, structures, trees, props, collision or player; the layer only reads the layout. |
