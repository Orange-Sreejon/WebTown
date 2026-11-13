# Furniture Editor MVP — Requirements

## Overview

Every house starts as an independent copy of the default room (see
`src/game/maps/house/`). This feature adds the first user-facing editor so the
owner of a house can rearrange it: select, drag, add and remove furniture on a
grid, see whether a placement is allowed before committing it, and save or
cancel the whole edit.

Still single-player and fully local. Layouts live in the in-memory
`HouseLayoutStore`: **every change is lost when the page is reloaded.** That is
intentional until accounts and a backend exist, and the UI must say so.

## Existing building blocks (reused, not rewritten)

| Module | Provides |
|---|---|
| `furniture-catalog.ts` | Types, sprites, footprints, `removable`, `rotations`, `mount`, `supports` |
| `house-layout.ts` | `HouseLayout`, `PlacedItem`, grid / attached placement, `cloneLayout` |
| `layout-rules.ts` | `validateLayout` (13 violation codes), `reachableFeet` |
| `layout-edits.ts` | `moveItem`, `addItem`, `removeItem`, `nextItemId`, `itemsResting` — pure, validated |
| `house-layout-store.ts` | Async `HouseLayoutStore`, in-memory implementation that validates on save |
| `resolve-interior.ts` | Layout → `InteriorDefinition` (the only grid → pixel conversion) |
| `InteriorScene.ts` | Renders the room, owns the player, collisions and exit |

## Ownership stand-in

There is no ownership model yet. Until accounts exist, **one house is "yours"**,
set by configuration. Every other house is visited read-only. The editor is
offered only in your house.

## Functional requirements

### FR-01 — Edit House button
In the player's own house, an **Edit House** button is shown over the game while
the player is in normal walkable mode. It is not shown in any other house, in
the town, or during a door transition.

### FR-02 — Edit mode
Pressing Edit House enters edit mode:
- The player stops and cannot move. The E exit is disabled.
- A faint 16 px grid is drawn over the floor and the back wall.
- The exit zone and the arrival spot are marked as "keep clear".
- A furniture panel opens with the catalogue, the selection controls, and
  Save / Cancel.
- A notice states that changes last only until the page is reloaded.

### FR-03 — Selecting
Clicking a piece of furniture selects it and outlines it. Clicking where several
overlap selects the one drawn on top, so the notebook can be picked off its
table. Clicking empty floor clears the selection. The door, walls and floor
cannot be selected. The panel shows the selected item's name and what can be
done with it.

### FR-04 — Dragging and grid snapping
Dragging a selected item moves a preview of it. A press without movement (under
3 screen pixels) only selects.
- The preview keeps the point where it was grabbed under the pointer.
- **Floor and wall items** snap their anchor (left edge and bottom edge) to the
  16 px grid.
- **Resting items** (notebook, lamp, books) snap to a 4 px step on top of a
  supporting item (table or nightstand). They are only valid over a support.
- An item still carrying a default-room nudge loses it on its first move and
  joins the grid (existing `moveItem` behaviour).

### FR-05 — Valid and invalid previews
While dragging or placing:
- **Valid:** the preview is tinted green, and its collision footprint is
  outlined green.
- **Invalid:** both are tinted red. The panel states the first reason in plain
  words, for example "Blocks the way to the door" or "Overlaps the bed".

Validity is the full `validateLayout` result for the layout as it would be after
the drop, recomputed only when the snapped position changes.

### FR-06 — Dropping
Dropping on a valid position applies the move to the draft. Dropping on an
invalid position changes nothing: the item returns to where it was and the
reason stays visible. `Esc` during a drag cancels it the same way.

### FR-07 — Supporting furniture
- Moving a table or nightstand moves everything resting on it.
- The notebook can be moved from one support to another, but never onto the
  floor or a wall.
- A support cannot be removed while anything rests on it. The panel names what
  must be moved off first.

### FR-08 — Adding furniture
- The catalogue lists the types an owner may add, with a picture and a name.
- Choosing one starts placement: a ghost follows the pointer with the same
  snapping and green/red preview. Clicking a valid spot places it and selects
  the new item.
- `Esc`, or choosing the same entry again, cancels placement.
- The computer and the notebook are not offered, because each must exist
  exactly once.
- New ids follow `nextItemId` (`stool`, `stool-2`, …).

### FR-09 — Removing furniture
- The selected item can be removed with the Remove button or the `Delete` key.
- Remove is disabled, with the reason shown, for the computer and the notebook
  ("Every house needs a computer"), and for a support that still holds items.

### FR-10 — Rotation
No catalogue sprite supports rotation, so no rotate control is shown. A rotate
control appears only for a type that lists more than one rotation. Unsupported
rotations are rejected by `validateLayout`.

### FR-11 — Save (transactional)
- Save writes the whole draft with one `HouseLayoutStore.save` call. The store
  validates before storing, so either the whole draft is stored or nothing is.
- While saving, the panel's controls are disabled.
- On success the room is rebuilt from the saved layout and the player returns
  to walkable mode.
- On failure the draft and edit mode remain, and the error is shown.
- Save is disabled when nothing has changed.

### FR-12 — Cancel
Cancel discards the draft, rebuilds the room from the layout as it was when edit
mode began, and returns to walkable mode. The store is never touched.

### FR-13 — Back to walkable mode
- After Save or Cancel, colliders, depth sorting, the exit prompt and E work
  exactly as before editing.
- If furniture was placed where the player stands, the player is moved to the
  arrival spot, which the rules keep clear.

### FR-14 — Persistence scope
- Saved layouts persist only for the current session (in memory). Leaving and
  re-entering the house shows the saved layout.
- Reloading the page restores every house to the default.
- No localStorage, authentication or backend.

### FR-15 — Isolation
Editing your house never changes any other house, the default template, or the
layout object any other code holds.

## Rules enforced (all by existing `layout-rules.ts`, never re-implemented in the UI)

- The computer and the notebook cannot be deleted. Exactly one of each exists.
- The notebook rests on, and moves with, its supporting furniture.
- A support cannot be removed while it holds items.
- Solid furniture never overlaps.
- Everything stays inside the room: floor items on the floor, wall items on the
  back wall.
- The exit corridor and the arrival spot stay clear. The door, the computer and
  the notebook stay reachable.
- No rotation the sprite does not support.

## Non-functional requirements

- **NFR-01, separation:**
  - React owns the editor UI (button, panel, catalogue, notices).
  - Phaser owns rendering, the grid, previews and pointer input on the canvas.
  - They communicate only through the event bus in `src/lib/`. React never
    touches the Phaser game object, and Phaser objects never enter React state.
- **NFR-02, one source of truth:** editing state lives in one pure, Phaser-free
  `EditorSession` that is fully unit-tested. The scene and the React UI only
  reflect it.
- **NFR-03, no new dependencies:** React component tests use `react-dom/client`
  and React's `act` under the existing jsdom environment.
- **NFR-04, accessibility:**
  - All controls are real `<button>` elements, reachable by keyboard, with
    visible focus.
  - Selected catalogue entries use `aria-pressed`.
  - Placement and validity messages are announced through an `aria-live` region.
  - Validity is never conveyed by colour alone: there is always a text reason.
- **NFR-05, performance:** validation runs once per snapped-position change, not
  per pointer event.
- **NFR-06, preserve:** Phase 1, Phase 2, Halloween night mode, house entry and
  exit, and exact return-position restoration are unchanged. Visitors' houses
  behave exactly as today.
- **NFR-07, cleanup:** every listener the editor adds (bus, pointer, keyboard,
  resize) is removed on scene shutdown and on React unmount.

## Out of scope

Websites, notebook application, multiplayer, authentication, Supabase or any
backend, localStorage, trading or property features, undo/redo, multi-select,
rotation art.
