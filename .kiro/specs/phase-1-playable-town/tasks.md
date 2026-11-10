# Phase 1 Tasks — Playable Single-Player Town

Each task is self-contained and can be implemented and verified independently.
Tasks are ordered by dependency — complete them in sequence unless otherwise noted.

---

## T-01 — Project Scaffolding

**Goal:** Initialise the Vite + React + TypeScript project with correct config.

**Steps:**
1. Run `npm create vite@latest . -- --template react-ts` in the workspace root
   (or create `package.json`, `vite.config.ts`, `tsconfig.json` manually).
2. Install runtime dependencies (exact versions):
   - `react`, `react-dom`
   - `phaser`
3. Install dev dependencies (exact versions):
   - `vite`, `@vitejs/plugin-react`
   - `typescript`
   - `vitest`, `@vitest/ui`, `jsdom`
   - `@types/react`, `@types/react-dom`
4. Configure `tsconfig.json`: `strict: true`, `moduleResolution: bundler`,
   `jsx: react-jsx`.
5. Configure `vite.config.ts`: include `@vitejs/plugin-react` and Vitest
   test config (`environment: 'jsdom'`).
6. Create folder structure under `src/` as defined in architecture steering.
7. Create `.gitignore`: node_modules, dist, .env*, coverage.
8. Verify `npm run dev` starts without errors and `npm run test -- --run`
   passes (even with zero test files).

**Acceptance:** `npm run dev` shows Vite default page. `npm test -- --run` exits 0.

---

## T-02 — Copy Assets to Public

**Goal:** Place asset files at the expected public paths.

**Steps:**
1. Create `public/assets/tilesets/village-top-down/`.
2. Copy all DAY variant PNGs from `TILESET VILLAGE TOP DOWN/` into it.
   (Night variants are not used in Phase 1 but may be copied for completeness.)
3. Create `public/assets/characters/tiny-cast/`.
4. Copy only the spritesheet files needed for Phase 1:
   - `$traveller.png` (player character)
   - Optionally all `$<name>.png` spritesheets for future NPCs.
5. Do NOT copy the `.psd` source file or the multi-character sheets
   (`tiny_cast_village_folk_1–3.png`) unless needed.
6. Verify files are accessible at `/assets/tilesets/village-top-down/GRASS TILE - DAY.png`
   and `/assets/characters/tiny-cast/$traveller.png` from the Vite dev server.

**Note on spaces in filenames:** PIXELJAD files have spaces in their names.
Phaser's loader handles URL-encoded paths, but rename files to use hyphens
(`grass-tile-day.png`) during copy to avoid URL encoding issues. Update
`AssetKeys.ts` to match.

**Acceptance:** All referenced assets return HTTP 200 from Vite dev server.

---

## T-03 — Game Constants and Asset Keys

**Goal:** Define all constants and asset key strings in one place.

**Files to create:**
- `src/game/config/GameConfig.ts` — all numeric constants (see design doc).
- `src/game/config/AssetKeys.ts` — all asset key string constants.
- `src/game/config/phaser-config.ts` — the `Phaser.Types.Core.GameConfig` object
  (no `parent` yet — that is added in T-06).

**Acceptance:** Files exist, TypeScript compiles with no errors.

---

## T-04 — Event Bus

**Goal:** Implement the React↔Phaser communication bridge.

**File:** `src/lib/event-bus.ts`

Implement `emit`, `on`, `off` as designed. Keep it under 30 lines.

**File:** `src/lib/event-bus.test.ts`

Write tests:
- Handler is called when event is emitted.
- `off` prevents handler from being called after removal.
- Two handlers on the same event both fire.

**Acceptance:** `npm test -- --run` passes all event bus tests.

---

## T-05 — Movement System

**Goal:** Implement the pure movement calculation function and its tests.

**File:** `src/game/systems/movement.ts`

```typescript
export interface InputState {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

export interface Velocity {
  vx: number
  vy: number
}

export type Direction = 'up' | 'down' | 'left' | 'right'

export function computeVelocity(input: InputState, speed: number): Velocity
export function inputToDirection(input: InputState, fallback: Direction): Direction
```

`computeVelocity` rules:
- Opposite axes cancel.
- Diagonal input is normalised to maintain constant speed.
- Returns `{ vx: 0, vy: 0 }` for no input or speed ≤ 0.

`inputToDirection` rules:
- Returns the primary direction of the current input.
- If no input, returns `fallback` (the last known direction).
- Priority if diagonal: down > up > right > left (RPG convention).

**File:** `src/game/systems/movement.test.ts`

Minimum test cases:
1. No input → `(0, 0)`
2. Up only → `(0, -speed)`
3. Down only → `(0, speed)`
4. Left only → `(-speed, 0)`
5. Right only → `(speed, 0)`
6. Up + Down → `(0, 0)` (cancel)
7. Left + Right → `(0, 0)` (cancel)
8. Up + Right → magnitude equals speed (normalised diagonal)
9. Down + Left → magnitude equals speed (normalised diagonal)
10. All four → `(0, 0)`
11. Speed = 0 → `(0, 0)`
12. `inputToDirection` with no input returns fallback
13. `inputToDirection` with down pressed returns `'down'`

**Acceptance:** All 13+ tests pass with `npm test -- --run`.

---

## T-06 — React Shell (App, ErrorBoundary, LoadingScreen, GameContainer stub)

**Goal:** Set up the React component tree without a working Phaser game yet.

**Files:**
- `src/app/App.tsx` — root component, renders `<ErrorBoundary><GameContainer /></ErrorBoundary>`
- `src/components/ErrorBoundary.tsx` — class component, catches errors, shows message
- `src/components/LoadingScreen.tsx` — "Loading WebTown…" centred text
- `src/components/GameContainer.tsx` — stub: renders a `<div ref={containerRef}>` and
  `<LoadingScreen>` for now; Phaser wired in T-08.
- `src/main.tsx` — React entry, `createRoot(document.getElementById('root')!).render(<App />)`
- `index.html` — Vite entry with `<div id="root">` and correct title "WebTown"

**CSS** (`src/app/app.css` or inline):
- `body { margin: 0; background: #000; }`
- `canvas { image-rendering: pixelated; }`

**Acceptance:** `npm run dev` shows the loading screen in the browser. No console errors.

---

## T-07 — BootScene

**Goal:** Implement the Phaser BootScene that loads all assets and signals readiness.

**File:** `src/game/scenes/BootScene.ts`

- `preload()`: Load all assets using keys from `AssetKeys`. Use `this.load.image()`
  for tile images and `this.load.spritesheet()` for character sheets.
- `preload()`: Register `this.load.on('loaderror', ...)` to emit `EventBus.emit('ERROR', ...)`.
- `create()`: Define all character animations (walk-down, walk-left, etc. — see design doc).
- `create()`: Emit `EventBus.emit('READY')` then `this.scene.start('TownScene')`.

Asset load calls for required Phase 1 assets (at minimum):
```
grass-tile-day.png, ground-tile-day.png, water-tile-day.png,
house-1-day.png, house-2-day.png, church-day.png,
tree-1-day.png, tree-2-day.png, tree-3-day.png,
fence-1-day.png, terrain-1-day.png,
ground-detail-1-day.png (and any others used in map),
water-detail-1-day.png,
$traveller.png (spritesheet, frameWidth: 48, frameHeight: 64)
```

**Acceptance:** BootScene preloads without errors in browser console. READY event fires.

---

## T-08 — Wire Phaser into GameContainer

**Goal:** Create the Phaser game instance inside the React component lifecycle.

**Update** `src/components/GameContainer.tsx`:
- Import `createPhaserGame` from `src/game/create-game.ts`.
- In `useEffect`: create game, store ref, listen to EventBus for READY/ERROR.
- Cleanup: `game.destroy(true)`, remove EventBus listeners.
- State: `loading: boolean`, `error: string | null`.
- Render `<LoadingScreen>` while `loading`, error message if `error`, otherwise nothing
  (the canvas is managed by Phaser inside the container div).

**New file** `src/game/create-game.ts`:
- Exports `createPhaserGame(parent: HTMLElement): Phaser.Game`.
- Assembles config from `phaser-config.ts`, adds `parent`.
- This is the only place `new Phaser.Game(...)` is called.

**Acceptance:** Game initialises, BootScene runs, READY event hides loading screen.
No console errors. Phaser canvas visible in browser.

---

## T-09 — Town Map

**Goal:** Build the town map (ground, roads, structures, water, vegetation).

**File:** `src/game/maps/TownMap.ts`

Class `TownMap` created in `TownScene.create()`:
- Constructor: `(scene: Phaser.Scene)`
- `build()` method: places all tile images and structure sprites.

**File:** `src/game/maps/town-layout.ts`

Exports the layout data: ground fill function, road tile positions,
structure placements (from design doc), tree positions, water fill area.

Implementation steps:
1. Fill entire map with `grass-tile-day` at depth 0 (loop over all tiles).
2. Fill road rows/columns with `ground-tile-day` at depth 1.
3. Place ground detail decorations scattered at depth 2.
4. Place house, church sprites at their tile positions, depth 3.
5. Place tree bases at depth 3, tree top portions at depth 5.
6. Fill water area with `water-tile-day` at depth 1, water details at depth 2.

**Acceptance:** Town renders in browser with visible ground, roads, houses and trees.

---

## T-10 — Collision Objects

**Goal:** Add physics collision for all solid obstacles and map bounds.

**File:** `src/game/maps/collision-objects.ts`

- Implements `createCollisionObjects(scene, physics)` returning `StaticGroup`.
- Adds rectangle bodies for all structures and tree trunks (see design doc).
- Enables `player.body.setCollideWorldBounds(true)`.
- Calls `physics.add.collider(player, obstacleGroup)` in TownScene.

**File:** `src/game/maps/collision-objects.test.ts`

Tests (pure, no Phaser):
- Each obstacle footprint is within `[0, MAP_WIDTH_PX] × [0, MAP_HEIGHT_PX]`.
- House 1, House 2, Church footprints do not overlap.
- Tree footprints are within map bounds.

**Acceptance:** Player stops at house walls, trees, and map edges in browser.

---

## T-11 — Player Entity

**Goal:** Implement the Player class using the movement system and animations.

**File:** `src/game/entities/Player.ts`

Class `Player` extends `Phaser.Physics.Arcade.Sprite`:
- Constructor: creates sprite at start position, sets body size/offset (from GameConfig).
- `update(cursors, wasd)`: calls `computeVelocity`, applies to body, selects animation,
  tracks last direction for idle.
- Input: `Phaser.Types.Input.Keyboard.CursorKeys` and a WASD key map.

In `TownScene.create()`:
- Create cursor keys: `this.input.keyboard!.createCursorKeys()`.
- Create WASD keys: `this.input.keyboard!.addKeys('W,A,S,D')`.
- Instantiate `Player`.
- Add physics collider between player and obstacle group.

**Acceptance:** Player moves in all 8 directions, animates correctly,
faces the right direction when idle.

---

## T-12 — Camera

**Goal:** Configure camera follow and bounds.

In `TownScene.create()` after player is created:
```typescript
this.cameras.main.startFollow(player, true, 1, 1)
this.cameras.main.setBounds(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
this.cameras.main.setZoom(DISPLAY_SCALE)
this.cameras.main.roundPixels = true
```

**Acceptance:** Camera follows player. Camera stops at map edges.
Player can walk to the map boundary; camera stops before showing void.

---

## T-13 — Integration Smoke Test

**Goal:** Verify all systems work together end-to-end.

Walk through the manual testing checklist in `docs/TESTING.md`:
1. Game loads without console errors.
2. Loading screen appears then disappears.
3. Town is visible with ground, roads, houses, trees.
4. Player spawns at start position.
5. WASD moves player in all directions with correct animation.
6. Arrow keys move player in all directions.
7. Diagonal movement speed equals straight movement speed (timed over 3 seconds).
8. Player cannot walk through House 1.
9. Player cannot walk through House 2.
10. Player cannot walk through Church.
11. Player cannot walk through any tree.
12. Player cannot walk outside the map boundary (all four edges).
13. Camera follows player.
14. Camera stops at all four map edges.
15. Pixel art is crisp (no blurring on sprites or tiles).
16. Closing and reopening the game tab does not leave duplicate canvases.

Fix any failures before marking this task done.

**File to create:** `docs/TESTING.md` — the manual checklist in a sharable format.

---

## T-14 — Run All Tests

**Goal:** Confirm all automated tests pass clean.

```
npm test -- --run
```

Expected: all tests in `movement.test.ts`, `event-bus.test.ts`,
`collision-objects.test.ts` pass. Zero failures. Zero skipped.

Fix any test failures before proceeding.

---

## T-15 — Final Housekeeping

**Goal:** Clean up before review.

1. Remove any `console.log` debug statements left from development.
2. Confirm `arcade: { debug: false }` in phaser config (not true).
3. Confirm `.gitignore` includes `node_modules`, `dist`, `.env*`, `coverage`.
4. Confirm `.gitattributes` is unmodified.
5. Confirm `docs/ASSETS.md` is accurate and up to date.
6. Run `npm run build` and confirm it succeeds with no TypeScript errors.
7. Run `npm test -- --run` one final time — all pass.

**Acceptance:** `npm run build` exits 0. `npm test -- --run` exits 0.
No debug artefacts in source.

---

## Dependency Summary

| Task | Depends On |
|------|-----------|
| T-01 | — |
| T-02 | T-01 |
| T-03 | T-01 |
| T-04 | T-01 |
| T-05 | T-01 |
| T-06 | T-01, T-04 |
| T-07 | T-03, T-04 |
| T-08 | T-06, T-07 |
| T-09 | T-07, T-03 |
| T-10 | T-09, T-05 |
| T-11 | T-05, T-10 |
| T-12 | T-11 |
| T-13 | T-08–T-12 |
| T-14 | T-04–T-10 |
| T-15 | T-13, T-14 |

T-04 and T-05 can be developed in parallel after T-01.
