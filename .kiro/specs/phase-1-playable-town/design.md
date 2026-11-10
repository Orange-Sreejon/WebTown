# Phase 1 Design — Playable Single-Player Town

## Architecture Overview

```
Browser
└── React App (DOM)
    ├── <ErrorBoundary>       catches runtime errors, shows fallback UI
    ├── <LoadingScreen>       shown while Phaser BootScene loads assets
    └── <GameContainer>       mounts the Phaser canvas, owns game lifecycle
        └── Phaser.Game
            ├── BootScene     preloads all assets, emits READY event
            └── TownScene     game loop — map, player, physics, camera
```

React and Phaser communicate exclusively through a tiny `EventBus`
(`src/lib/event-bus.ts`) — a plain `EventTarget` wrapper. React listens
for `READY` and `ERROR` events to toggle the loading screen. No React
state holds Phaser objects.

---

## Scene Design

### BootScene

Responsibilities:
- Call `this.load.*` for every asset used in TownScene.
- Emit `EventBus.emit('READY')` from `create()` after all assets are loaded.
- Emit `EventBus.emit('ERROR', message)` if a file fails (`this.load.on('loaderror', …)`).
- Start TownScene on completion.

No game objects are created in BootScene.

### TownScene

Responsibilities:
- Build the town map (ground, roads, structures, vegetation).
- Instantiate the Player entity.
- Configure Arcade physics world bounds.
- Set up camera follow.
- Run the game loop via `update(time, delta)`.

---

## Map Design

### Coordinate System

- Tile size: **16×16 px** (1× scale).
- Map size: **80×64 tiles** = 1280×1024 px at 1× scale, 2560×2048 px at 2×.
- Origin: top-left (0, 0).
- All placement coordinates are in **tile units** in the map data, converted
  to pixel positions by multiplying by `TILE_SIZE`.

### Layer Order (back to front, Phaser depth)

| Depth | Layer | Contents |
|-------|-------|----------|
| 0 | Ground | Grass tile, ground tile fill |
| 1 | Roads | Terrain sets (paths, roads) |
| 2 | Decoration | Grass/ground detail tiles |
| 3 | Structures | Houses, church, bridge (lower depth = drawn first, behind player) |
| 4 | Player | Player sprite |
| 5 | Tree tops | Upper portions of trees (drawn in front of player for depth effect) |

> Note: "depth" here means Phaser `setDepth()` values, not tilemap layers.
> The map is composed of individual `Phaser.GameObjects.Image` instances,
> not a tilemap. Each sprite gets an explicit depth value.

### Town Layout (tile coordinates)

The map is 60 tiles wide × 50 tiles tall.

```
 0        10        20        30        40        50        60
 ┌──────────────────────────────────────────────────────────┐  0
 │  GRASS                        GRASS                      │
 │        [TREE][TREE]                   [TREE]             │  5
 │                                                          │
 │   ┌──────────┐    ═══ ROAD (H) ════════════════          │  10
 │   │ HOUSE 1  │                                           │
 │   └──────────┘    ┌───────────────────┐                  │  15
 │                   │     HOUSE 2       │                  │
 │  ║                └───────────────────┘                  │  20
 │  ║ ROAD (V)                                              │
 │  ║               [TREE][TREE]          [TREE][TREE]      │  25
 │                                                          │
 │        ┌──────────────────┐                              │  30
 │        │     CHURCH       │                              │
 │        └──────────────────┘                              │  35
 │                           ~~~ WATER ~~~                  │
 │  [TREE]           ~~~ WATER TILE FILL ~~~                │  40
 │                                                          │
 │  GRASS         GRASS           GRASS                     │  45
 └──────────────────────────────────────────────────────────┘  50
```

Exact tile placements are defined in `src/game/maps/town-layout.ts`.

**Road layout:**
- Horizontal road: row 12, full width (using TERRAIN SET 1 / GROUND TILE).
- Vertical road: column 8, full height (using TERRAIN SET 1 / GROUND TILE).
- Pavement borders: 1-tile-wide edging using GROUND DETAIL tiles on road sides.

**Structure placements (tile coordinates, top-left corner):**

| Structure | Asset | Tile Position (col, row) | Pixel size |
|-----------|-------|--------------------------|-----------|
| House 1   | HOUSE 1 - DAY.png | (3, 8)   | 80×112 → 5×7 tiles |
| House 2   | HOUSE 2 - DAY.png | (20, 14) | 128×112 → 8×7 tiles |
| Church    | CHURCH - DAY.png  | (10, 29) | 128×112 → 8×7 tiles |

**Tree placements (tile coordinates, top-left of 48×48 sprite):**

| Asset     | Tile Positions |
|-----------|---------------|
| TREE 1    | (12, 3), (28, 3), (45, 22) |
| TREE 2    | (15, 3), (32, 22) |
| TREE 3    | (3, 38) |

**Water fill:**
- Rows 36–42, columns 28–55: WATER TILE - DAY.png repeated as a grid.
- Water detail tiles scattered within (WATER DETAIL 1–3) at depth 2.

**Player start position:** tile (5, 20) — on the vertical road, clear of all structures.

---

## Player Entity Design

**File:** `src/game/entities/Player.ts`

### Sprite

- Texture key: `AssetKeys.TRAVELLER` → spritesheet `$traveller.png`
- Frame config: `{ frameWidth: 48, frameHeight: 64 }`
- Display scale: inherited from scene zoom (Phaser zoom 2).
- Depth: 4

### Physics Body

The physics body is smaller than the sprite to give a "feet on ground" feel
and prevent the player's torso triggering wall collisions:

```
Sprite:  48×64 px
Body:    28×18 px
Offset:  x = 10 (centred), y = 42 (near feet)
```

This means the collision box covers only the lower legs/feet area —
standard for top-down RPG characters.

### Animations

Defined in `BootScene.create()` or a dedicated `createAnimations()` helper:

| Key           | Frames     | Frame rate | Repeat |
|---------------|-----------|-----------|--------|
| `walk-down`   | 0, 1, 2, 1 | 6         | -1     |
| `walk-left`   | 3, 4, 5, 4 | 6         | -1     |
| `walk-right`  | 6, 7, 8, 7 | 6         | -1     |
| `walk-up`     | 9, 10, 11, 10 | 6      | -1     |
| `idle-down`   | 1          | 1         | 0      |
| `idle-left`   | 4          | 1         | 0      |
| `idle-right`  | 7          | 1         | 0      |
| `idle-up`     | 10         | 1         | 0      |

Frame index is row × 3 + column in the 3×4 spritesheet:
- Row 0 = down (frames 0–2), Row 1 = left (3–5), Row 2 = right (6–8), Row 3 = up (9–11).

Walk cycle: 1→2→3→2 from README = frame indices offset 0→1→2→1 within each row.

### Movement System

**File:** `src/game/systems/movement.ts`

```typescript
// Pure function — no Phaser dependency, fully testable
function computeVelocity(
  input: InputState,
  speed: number
): { vx: number; vy: number }
```

- `InputState` = `{ up: boolean, down: boolean, left: boolean, right: boolean }`
- If more than one axis is active, normalise the vector: `v / √2 × speed`
- Returns `{ vx: 0, vy: 0 }` when no keys pressed
- The Player entity applies the returned velocity to its physics body

**Direction tracking:** the last non-zero input direction is remembered for
the idle animation. Direction is one of `'up' | 'down' | 'left' | 'right'`.

---

## Collision Design

### Obstacle Static Group

A `Phaser.Physics.Arcade.StaticGroup` holds invisible rectangle bodies for
all solid obstacles. The group is created in TownScene.

**File:** `src/game/maps/collision-objects.ts`

Exports a function:
```typescript
function createCollisionObjects(
  scene: Phaser.Scene,
  physics: Phaser.Physics.Arcade.ArcadePhysics
): Phaser.Physics.Arcade.StaticGroup
```

Each obstacle is added as a `Phaser.Physics.Arcade.Image` (invisible, 1×1 alpha)
with its body resized to cover the obstacle footprint, or as a plain rectangle
using `physics.add.staticGroup()` with rectangle members.

**Obstacle footprints (in pixels at 1× scale):**

| Obstacle  | x   | y   | w   | h   | Notes |
|-----------|-----|-----|-----|-----|-------|
| House 1   | 48  | 128 | 80  | 96  | Full sprite minus roof overhang top row |
| House 2   | 320 | 224 | 128 | 96  | Full sprite minus roof |
| Church    | 160 | 464 | 128 | 96  | Full sprite minus roof |
| Tree 1 (12,3) | 198 | 60 | 20 | 16 | Trunk only |
| Tree 1 (28,3) | 454 | 60 | 20 | 16 | Trunk only |
| Tree 2 (15,3) | 246 | 60 | 20 | 16 | |
| — etc. for all trees — | | | | | |
| Water edge | 448 | 576 | 112 | 4  | Invisible barrier at water edge |

> Exact pixel values are computed from tile coordinates × 16 in the
> implementation. The table here is for design reference.

### World Bounds

```typescript
physics.world.setBounds(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
player.body.setCollideWorldBounds(true)
```

MAP_WIDTH_PX = 80 × 16 = 1280
MAP_HEIGHT_PX = 64 × 16 = 1024

---

## Camera Design

```typescript
cameras.main.startFollow(player, true, 1, 1)
cameras.main.setBounds(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX)
cameras.main.setZoom(DISPLAY_SCALE) // 2
cameras.main.roundPixels = true
```

The viewport at 2× zoom shows (gameWidth/2) × (gameHeight/2) tiles.
Default canvas size: 960×640 px → shows 30×20 tiles at 2×.

---

## Phaser Game Config

**File:** `src/game/config/phaser-config.ts`

```typescript
{
  type: Phaser.AUTO,
  pixelArt: true,         // antialias: false, roundPixels: true
  backgroundColor: '#2d5a1b',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 640,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },  // overridden to true when ?debug=1 in URL
  },
  scene: [BootScene, TownScene],
}
```

---

## React Component Design

### `<App />`  (`src/app/App.tsx`)
Root component. Renders `<ErrorBoundary>` wrapping `<GameContainer>`.

### `<GameContainer />`  (`src/components/GameContainer.tsx`)
- `useRef` for the div that Phaser mounts into.
- `useEffect` creates the Phaser game on mount, destroys on unmount.
- Listens to `EventBus` for `READY` and `ERROR` events.
- Conditionally renders `<LoadingScreen>` until `READY` fires.
- Passes `parent` div ref to Phaser config.

### `<LoadingScreen />`  (`src/components/LoadingScreen.tsx`)
- Simple centred div with "Loading WebTown…" text.
- Styled to cover the game area (same dimensions as canvas).

### `<ErrorBoundary />`  (`src/components/ErrorBoundary.tsx`)
- Class component (required by React error boundary API).
- Catches render/lifecycle errors.
- Displays a plain error message with the error text.

---

## Event Bus

**File:** `src/lib/event-bus.ts`

```typescript
type GameEvent = 'READY' | 'ERROR'

const bus = new EventTarget()

export function emit(event: GameEvent, detail?: unknown): void
export function on(event: GameEvent, handler: (e: CustomEvent) => void): void
export function off(event: GameEvent, handler: (e: CustomEvent) => void): void
```

Thin wrapper over native `EventTarget`. No external library needed.

---

## Asset Key Constants

**File:** `src/game/config/AssetKeys.ts`

```typescript
export const AssetKeys = {
  TRAVELLER:    'traveller',
  GRASS_TILE:   'grass-tile',
  GROUND_TILE:  'ground-tile',
  WATER_TILE:   'water-tile',
  HOUSE_1:      'house-1',
  HOUSE_2:      'house-2',
  CHURCH:       'church',
  TREE_1:       'tree-1',
  TREE_2:       'tree-2',
  TREE_3:       'tree-3',
  FENCE_1:      'fence-1',
  TERRAIN_1:    'terrain-1',
  TERRAIN_2:    'terrain-2',
  // … all used assets
} as const

export type AssetKey = typeof AssetKeys[keyof typeof AssetKeys]
```

---

## Game Constants

**File:** `src/game/config/GameConfig.ts`

```typescript
export const TILE_SIZE      = 16        // px at 1× scale
export const DISPLAY_SCALE  = 2         // Phaser zoom
export const MAP_TILES_W    = 80
export const MAP_TILES_H    = 64
export const MAP_WIDTH_PX   = MAP_TILES_W * TILE_SIZE   // 1280
export const MAP_HEIGHT_PX  = MAP_TILES_H * TILE_SIZE   // 1024
export const PLAYER_SPEED   = 80        // px/s at 1× scale
export const PLAYER_BODY_W  = 28
export const PLAYER_BODY_H  = 18
export const PLAYER_BODY_OFFSET_X = 10
export const PLAYER_BODY_OFFSET_Y = 42
export const WALK_FRAME_RATE = 6        // fps
```

---

## Testing Strategy

### Unit Tests (Vitest)

**`src/game/systems/movement.test.ts`**
- No keys → velocity `(0, 0)`
- Single key → correct axis, full speed
- Two opposite keys → velocity `(0, 0)` (cancel out)
- Diagonal keys → velocity magnitude equals `speed` (normalised)
- All four keys → velocity `(0, 0)`
- Speed = 0 edge case → velocity `(0, 0)`
- Negative speed → returns zero (guard)

**`src/game/systems/movement.test.ts` — direction tracking**
- Last horizontal key released → direction updates correctly
- Direction on diagonal input → last pressed wins (or defined priority)

**`src/game/maps/collision-objects.test.ts`**
- Footprint rectangles for each obstacle are within map bounds
- No two obstacle footprints overlap (sanity check)

**`src/lib/event-bus.test.ts`**
- `emit` triggers registered handlers
- `off` stops handler from firing
- Multiple handlers on same event all fire

### Manual Browser Checklist

See `docs/TESTING.md` (created during implementation tasks).

---

## Open Decisions Requiring Approval

1. **Map size**: 60×50 tiles proposed. Is this large enough? Increase to 80×60?
2. **Player character**: `traveller` proposed as default. Any preference?
3. **Road style**: TERRAIN SET 1 proposed for roads. Confirm visual is acceptable
   after implementation — may need to swap to GROUND TILE fill with detail edges.
4. **Water barrier**: The water area uses an invisible physics barrier. Alternatively
   the water tiles themselves can be collision objects. Preference?
5. **Debug mode**: `arcade: { debug: false }` by default. Add a `?debug=1` URL
   param to enable physics debug rendering during development?
6. **Canvas size**: 800×600 proposed. Should this be wider (e.g. 960×640)?
7. **Asset gitignore**: Should raw asset source folders be added to `.gitignore`
   before any public push, given the licence ambiguity identified in `docs/ASSETS.md`?
