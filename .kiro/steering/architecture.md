# WebTown — Architecture Steering

## Stack

| Layer        | Technology | Rationale |
|-------------|-----------|-----------|
| Build tool  | Vite      | Fast HMR, ES module native, minimal config |
| UI          | React 18  | Handles loading screens, HUD, error boundaries |
| Language    | TypeScript (strict) | Type safety across game and UI code |
| Game engine | Phaser 3  | Mature, well-documented 2D game framework |
| Testing     | Vitest    | Same config as Vite, fast unit tests |

## Separation of Concerns

React owns the DOM. Phaser owns a single `<canvas>` element.
They must not share state directly — use a lightweight event bridge if needed.

```
React                    Phaser
─────────────────────    ────────────────────────
<App />                  Game instance
  <LoadingScreen />        → BootScene (asset loading)
  <GameContainer />        → TownScene (game loop)
  <ErrorBoundary />
```

The Phaser game instance is created inside a React `useEffect` and destroyed
in its cleanup function. This is the only correct pattern — do not create the
Phaser game outside a component lifecycle.

## Source Layout

```
src/
  app/              React entry, root component
  components/       React UI components (loading, error, HUD)
  game/
    scenes/         Phaser Scene subclasses (BootScene, TownScene)
    entities/       Player, NPC — Phaser GameObjects
    systems/        Movement, collision, camera — pure logic modules
    maps/           Map data, object placement, collision masks
    config/         Phaser game config, asset keys, constants
  lib/              Shared utilities (event bus, math helpers)
```

## Public Assets

```
public/
  assets/
    tilesets/
      village-top-down/   PNG tiles from TILESET VILLAGE TOP DOWN
    characters/
      tiny-cast/          Character spritesheets from tiny_cast_village_folk_v1.0
```

Assets are served statically by Vite. Never import image files through the
bundler — reference them by URL path string so Phaser can load them.

## Phaser Physics

Use **Phaser.Physics.Arcade** for Phase 1.

- It is fast, deterministic, and simple.
- Collision uses axis-aligned bounding boxes (AABB), which is correct for
  top-down tile-based movement.
- Do not use Matter.js for Phase 1 — it is overkill for simple AABB collision.

## Tile Size

The base tile unit is **16×16 pixels**. All map coordinates use tile units.
Display at **2× scale** (Phaser zoom 2) to reach 32×32 logical pixels on screen —
this is the standard readable size for this tileset. Use `roundPixels: true`
to prevent subpixel blurring.

## Movement

Movement is velocity-based, not position-delta, to be frame-rate independent.
Player speed is defined in pixels per second (at 1× scale). Phaser Arcade
physics integrates velocity × delta automatically.

Diagonal movement speed must be normalized to avoid faster diagonal movement:
normalize the velocity vector before multiplying by speed.

## Camera

Phaser `camera.startFollow(player)` with `roundPixels: true`.
Bounds set to the full map dimensions to prevent showing outside the map.

## Collision

Buildings, trees and obstacles use a collision layer or static group.
Player physics body is smaller than the sprite (centered, reduced height)
to give a natural "feet on ground" feel.

Collision rectangles for buildings are defined programmatically in the map
module — not via Tiled. Tiled is not used in Phase 1.

## Pixel Art Rendering

- Phaser config: `pixelArt: true` (sets `antialias: false`, `roundPixels: true`)
- CSS on the canvas element: `image-rendering: pixelated`
- Scale mode: `Phaser.Scale.FIT` with `autoCenter: CENTER_BOTH`

## No Tiled in Phase 1

The map is built programmatically from individual tile sprites and placed
static images. This avoids a Tiled export/import pipeline and an extra
file format dependency. The map module is the single source of truth for
layout. Tiled may be introduced in a later phase if map complexity warrants it.
