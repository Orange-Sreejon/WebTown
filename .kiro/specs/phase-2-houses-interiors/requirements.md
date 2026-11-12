# Phase 2 — Houses & Interiors — Requirements

## Overview

Phase 1 delivered a walkable town. Phase 2 lets the player walk up to a house,
press **E**, step inside one reusable walkable room, and walk back out to the
exact spot they left. The room contains a visually distinctive computer and a
notebook, but **neither is interactive yet** — the computer website and the
notebook application belong to Phase 3.

Single-player and fully local. No multiplayer, no backend, no authentication,
no ownership model.

## Decisions taken at architecture review

| # | Decision |
|---|----------|
| 1 | Separate `InteriorScene`. `TownScene` is slept while indoors and woken on exit. The town clock pauses indoors; `GameClock` stays independently controllable so a future world-level clock can keep running. |
| 2 | The `E — Enter House` / `E — Exit` prompt is rendered by Phaser, near the door, and follows the camera. |
| 3 | The outdoor return position is restored **exactly**: x/y, facing and camera state, velocity reset, and validated to be safe and non-colliding. |
| 4 | The large computer sheet is the main computer, prepared to **48px wide** by keying out its ground and area-averaging. Never nearest-neighbour, never 32px. |
| 5 | The 16px kit supplies floors, walls and general furniture; `work.png` supplies the computer, notebook and books where they look consistent. |
| 6 | The church is **not** enterable. |

## Functional requirements

### FR-01 — Enterable houses
Houses `house-a` … `house-g` are enterable. The church and the bridge are not.
Each house is described by a reusable `HouseConfig` that points at a structure
label and an interior id.

### FR-02 — Entrance detection
Each enterable house has an entrance zone in front of its door, derived from the
existing structure layout (`tileX`, `doorOffsetPx`, `hTiles`) — never hard-coded
per house. The zone is as wide as the existing yard gate (3 tiles) so it always
lines up with the gap in the fence. It is entered by the player's **feet**.

### FR-03 — Contextual prompt
While the player's feet are inside an entrance zone a prompt reading
`E — Enter House` is shown near the door. It is hidden when the player leaves
the zone, while a transition is running, and indoors except near the exit.
The prompt is drawn above the time-of-day overlay so it is readable at night.

### FR-04 — Entering
Pressing **E** inside a zone fades the screen out, saves the return state,
sleeps `TownScene`, launches `InteriorScene` and fades in. Holding E or the
browser's key-repeat must not trigger a second transition.

### FR-05 — The interior
One reusable `InteriorDefinition` ("cozy room") with:
floor and walls · entrance/exit door · computer desk with the large computer ·
bookshelf · book and notebook · bed · table and chair · rug · windows with
curtains · plants and decorations.
Every house uses it via configuration; adding a second layout must need only
data.

### FR-06 — Fully walkable, with collision
The player uses the same `Player` entity, movement system and Arcade physics as
the town. Walls and every solid piece of furniture block the player; rugs and
wall decorations do not. Every part of the room that should be reachable is
reachable (verified by test).

### FR-07 — Exit
Near the door the prompt reads `E — Exit`. Pressing E fades out, wakes
`TownScene`, stops `InteriorScene` and fades in.

### FR-08 — Exact return
On exit the player is at the saved outdoor x/y, facing the saved direction,
with zero velocity and the saved camera scroll/zoom. If the saved position
overlaps an obstacle the player is placed at the house's known-walkable
fallback point instead. Leaving must not instantly re-enter the house.

### FR-09 — Clock
The town clock does not advance while the player is indoors and resumes from the
same time on return. A `?timeFrozen=1` override stays frozen after returning.

### FR-10 — Cleanup
Stopping `InteriorScene` leaves no listeners, timers or physics bodies behind.
Entering and leaving repeatedly leaves object counts unchanged.

### FR-11 — Failure is safe
If the interior art cannot be loaded, the player stays in the town and nothing
is broken. Phase 1 must never depend on the interior files being present.

## Non-functional requirements

- Phase 1 and Halloween behaviour are unchanged: movement, collision, camera,
  y-sorting, lamps, day/night, pumpkins, windows, bats.
- Follows the project conventions: strict TypeScript, no `any`, explicit return
  types, asset keys only in `AssetKeys.ts`, magic numbers in config.
- No new runtime dependencies.
- Pure logic (zones, lock, return position, layout validation) has unit tests.

## Out of scope

Computer website · notebook application · house ownership · furniture editor ·
guestbooks · multiplayer · persistence · entering the church · NPCs indoors.

## Asset status — IMPORTANT

`work.png`, `work2.png`, `work3.png` and `work4.png` have **unknown source and
licence**. They are documented as UNVERIFIED in `docs/ASSETS.md`, are excluded
from version control by `.gitignore`, and must not be published or committed
until redistribution permission is confirmed or they are replaced.
