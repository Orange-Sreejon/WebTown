# Phase 2 — Houses & Interiors — Design

## Scene flow

```
 TownScene (running)                         InteriorScene
 ───────────────────                         ─────────────
 feet in entrance zone  → prompt "E — Enter House"
 E (not a key repeat, lock free)
   save TownReturnState
   fade out
   launch(InteriorScene, {houseId, interiorId}) ─▶ preload (lazy, optional art)
   sleep()   ── clock frozen, keys reset           create: build room, player,
                                                   colliders, prompt; fade in
                                                   feet in exit zone → "E — Exit"
                                                   E → fade out
 wake(data) ◀────────────────────────────────────  wake('TownScene'), stop()
   resolve return position (validate)
   restore player / camera, velocity 0
   clock resumes, fade in, cooldown
```

`TownScene` keeps its map, player, physics world, tweens and Halloween layer
untouched while asleep. `InteriorScene` is **stopped** (not slept) on exit, so
it is rebuilt from data on each entry and fully cleaned up by Phaser's shutdown.

## New and changed files

| File | Role |
|------|------|
| `config/SceneKeys.ts` | Scene key constants for new code |
| `config/houses.ts` | `HouseConfig[]` — which structures are enterable, and their interior |
| `systems/interaction.ts` | Pure: `Entrance`, `buildEntrances`, `findNearbyTarget` |
| `systems/transition.ts` | Pure: `TransitionLock` (busy flag + cooldown) |
| `systems/return-position.ts` | Pure: `TownReturnState`, `playerBodyRect`, `resolveReturnFeet` |
| `maps/interior-layout.ts` | Data: `InteriorDefinition` + pure collision/validation helpers |
| `maps/interior-slices.ts` | Sprite rectangles per sheet (+ prepared computer sprites) |
| `maps/interior-textures.ts` | Registers slices and prepares the computer sprites in a scene |
| `maps/collision-objects.ts` | Extract `addStaticRects` so both scenes share it |
| `entities/Player.ts` | `placeFeet`, `facing`, `setFacing`, `halt` |
| `entities/InteractionPrompt.ts` | World-anchored Phaser prompt |
| `scenes/InteriorScene.ts` | The room |
| `scenes/TownScene.ts` | Prompt, E key, sleep/wake, clock pause, restore |
| `create-game.ts` | Registers `InteriorScene` (not auto-started) |

## Key data structures

```ts
interface HouseConfig   { id; structureLabel; interiorId; title }
interface Entrance      { houseId; interiorId; zone: Rect; promptX; promptY; fallbackFeet: Point }
interface TownReturnState {
  houseId; feetX; feetY; facing: Direction
  cameraScrollX; cameraScrollY; cameraZoom
}
interface InteriorDefinition {
  id; widthPx; heightPx; wallHeightPx
  spawn: { feetX; feetY; facing }
  exit: { zone: Rect; promptX; promptY }
  pieces: InteriorPiece[]        // sprite ref, x, bottom, layer, optional solid Rect, optional role
}
```

## Geometry

- **Entrance zone** — door centre `x = tileX·16 + doorOffsetPx`, building bottom
  `y = (tileY + hTiles)·16`. Zone = `x ± 24`, `y … y + 32` (feet). ±24 is the yard
  gate width, so the zone and the fence gap line up.
- **Player feet** — the body is bottom-aligned to the sprite, so feet =
  `(body.center.x, body.bottom)`. Body rect = 15.4 × 8.8 px (28×16 at 0.55).
- **Fallback return point** — `(doorX, bottom + 14)`, directly in front of the
  door; a test proves it does not overlap any town collider.

## Transition safety

- `TransitionLock.tryBegin(now)` returns false while a transition is running or
  during the cooldown after one, so mashing E cannot double-fire.
- The key handler ignores `KeyboardEvent.repeat`, which also stops the E that
  opened a door from immediately closing it in the new scene.
- While the lock is busy the town player is halted, so the position that was
  saved is the position that is restored.
- Both scenes reset keys on leaving, so no direction stays "held".

## Clock

`TownScene` freezes `GameClock` on the `sleep` event and unfreezes on `wake`
unless `?timeFrozen=1` set it. `GameClock` itself is unchanged and does not know
about scenes, so a future world clock can be ticked from elsewhere.

## Interior rendering

Pieces are placed bottom-left anchored and y-sorted with `depthForFeetY`, the
same function the town uses, so the existing `Player` sorts against furniture
with no changes. Layers: floor 0 · wall 1 · flat (rug) 2 · wall decor 3 ·
sorted 4–4.9. The room is fitted with an integer camera zoom and centred; if the
window is smaller than the room the camera follows the player.

Collision rects come from `InteriorDefinition` (wall block + each piece's
`solid`). Items against the back wall extend their solid up to the wall so the
player cannot squeeze behind them.

## Trade-offs

- **Stop vs sleep for the interior.** Stop: rebuilt each entry (cheap, tiny
  room), guaranteed clean. Sleep would keep stale state for no benefit.
- **Lazy-loaded art.** The interior images load in `InteriorScene.preload`, not
  in `BootScene`. A missing or removed file then cannot break the town (FR-11),
  which matters while the licence is unresolved.
- **Hand-set footprints vs alpha-measured.** Furniture footprints are explicit
  rectangles: deterministic, testable without a canvas, and they can include the
  gap to the wall.
- **Prepared computer sprites** are generated at runtime from the original sheet
  (no derived asset committed), so replacing the source later needs no pipeline.
