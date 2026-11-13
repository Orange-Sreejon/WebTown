# Furniture Editor MVP — Design

## Shape of the solution

```
 React (DOM overlay)                    event bus (src/lib)                Phaser (canvas)
 ───────────────────                    ───────────────────                ───────────────
 <HouseEditorOverlay>                                                      InteriorScene
   reads EditorView snapshots   ◀── EDITOR_STATE (EditorView) ───────────    owns EditorSession (pure)
   Edit / Save / Cancel /       ─── EDITOR_COMMAND (EditorCommand) ──────▶   + EditorOverlay (grid, outlines,
   Remove / catalogue buttons                                                  preview tint) + pointer input
```

- `EditorSession` is the single source of truth. It is a plain TypeScript class
  with no Phaser and no React.
- `InteriorScene` creates a session when the room opens. It feeds it pointer
  input and React's commands, and redraws when the session reports a change.
- React only renders the latest `EditorView` snapshot and sends commands.

## New files

| File | Kind | Role |
|---|---|---|
| `src/game/config/ownership.ts` | config | `LOCAL_PLAYER_HOUSE_ID` and `canEditHouse(houseId)` (ownership stand-in) |
| `src/game/maps/house/editor-geometry.ts` | pure | Pointer → snapped `Target`, hit-testing, support detection |
| `src/game/maps/house/editor-session.ts` | pure | `EditorSession`: modes, selection, drag, placement, add/remove, save/cancel |
| `src/game/maps/house/violation-text.ts` | pure | Violation → short, plain-language sentence |
| `src/lib/editor-bridge.ts` | lib | Typed `EditorView` / `EditorCommand`, plus emit/on/off over the existing bus |
| `src/game/entities/EditorOverlay.ts` | Phaser | Grid lines, keep-clear zones, selection outline, footprint and preview tint |
| `src/components/house-editor/HouseEditorOverlay.tsx` | React | Root overlay; subscribes to `EDITOR_STATE` and cleans up on unmount |
| `src/components/house-editor/EditHouseButton.tsx` | React | The Edit House button |
| `src/components/house-editor/EditorPanel.tsx` | React | Save / Cancel, selection, Remove, messages, reload notice |
| `src/components/house-editor/FurnitureCatalogue.tsx` | React | Addable types with CSS-sprite thumbnails |
| tests | — | Next to each pure module and component |

## Changed files

| File | Change |
|---|---|
| `src/lib/event-bus.ts` | Add `EDITOR_STATE`, `EDITOR_COMMAND` to `GameEventType`; API unchanged |
| `src/game/scenes/InteriorScene.ts` | Edit mode: build an `EditorSession`, wire pointer and keys, rebuild pieces and colliders on change, block movement and exit while editing |
| `src/components/GameContainer.tsx` | Render `<HouseEditorOverlay />` above the canvas |
| `docs/TESTING.md` | Manual editor checklist, and the "lost on reload" note |
| `.kiro/steering/product.md` | Move "Furniture editor" from out-of-scope to current scope; record the ownership stand-in |

Nothing in the town, Halloween layer, return-position, or the house modules'
existing behaviour changes. `layout-edits.ts` and `layout-rules.ts` are reused
as they are.

## EditorSession (pure)

```ts
type EditorMode = 'play' | 'edit'
type Gesture =
  | { kind: 'idle' }
  | { kind: 'dragging'; itemId: string; grab: Point; target: Target; valid: boolean }
  | { kind: 'placing'; type: string; target: Target | null; valid: boolean }

class EditorSession {
  constructor(template, committed: HouseLayout, store: HouseLayoutStore, canEdit: boolean)
  // read
  readonly mode; readonly draft: HouseLayout; readonly selectedId; readonly gesture
  readonly dirty; readonly saving; readonly lastProblem: string | null
  view(): EditorView                         // the snapshot React renders
  // lifecycle
  beginEdit(): void                          // only if canEdit; draft = clone(committed)
  save(): Promise<SaveResult>                // store.save(draft); commit or keep draft + error
  cancel(): void                             // draft = clone(committed); mode = play
  // pointer, in room pixels
  pointerDown(p: Point): void                // select topmost hit, arm drag; or place
  pointerMove(p: Point): void                // past 3px threshold → dragging; re-snap; re-validate on change
  pointerUp(p: Point): void                  // valid → moveItem into draft; invalid → revert
  escape(): void                             // cancel drag or placement
  // panel
  startPlacing(type: string): void           // toggles off if the same type
  removeSelected(): void
  subscribe(listener: () => void): () => void
}
```

Notes:
- `committed` is never mutated. Every change goes through `layout-edits.ts`,
  which returns a new validated layout or a list of violations.
- **Save is transactional:**
  - The draft goes to `store.save` in one call. The in-memory store validates
    and stores a deep copy, or throws.
  - The session commits only after the promise resolves.
  - A second save while one is pending is ignored.
- **Cancel:** the session cannot touch the store, so there is nothing to undo
  there.
- The drag threshold is 3 *screen* pixels. The scene converts it to room pixels
  using the camera zoom before calling the session.
- `view()` returns plain JSON, the only thing that crosses into React:
  `{ mode, canEdit, houseId, dirty, saving, selected: { id, label, canRemove,
  removeBlockedReason } | null, placingType, preview: { valid, message } | null,
  error, catalogue: [{ type, label, sprite, disabledReason }] }`.

## editor-geometry (pure)

- `snapGrid(anchor)`: `col = round(x / 16)`, `row = round(y / 16)`. The anchor
  is the sprite's left and bottom edge, which matches `resolve-interior`.
- `snapOnSupport(anchor, supportPiece)`: snaps `dx`/`dy` to a 4 px step relative
  to the support's anchor. Returns null when the anchor is not over the
  support's top surface.
- `targetFor(type, pointer, grab, def)`: chooses grid or support from the type's
  `mount`.
  - Floor and wall items always get a grid target. Out-of-range positions
    become red through `validateLayout`; they are never clamped, so the user
    sees why.
  - Resting items get the support under the pointer, or null (red: "Must rest
    on a table").
- `hitTest(def, point)`: the topmost piece whose sprite bounds contain the
  point, by the same `pieceDepth` the scene draws with. The door is excluded.

## Scene integration (InteriorScene)

- **On create:**
  - Build the session from the template and the house's layout. `canEdit`
    comes from `canEditHouse(houseId)`.
  - Emit the first `EDITOR_STATE`, so React can show or hide the button.
  - Subscribe to `EDITOR_COMMAND`.
- **On mode change to `edit`:**
  - `player.halt()`, and skip `player.update` and the exit check in `update()`.
  - Hide the exit prompt and show the `EditorOverlay`.
  - Enable pointer input on the canvas.
- **On draft change:**
  - Destroy and recreate the piece images from `resolveInterior(template,
    draft)`, about 20 sprites, so it is cheap.
  - Colliders are not rebuilt while editing, since the player cannot move.
- **During a gesture:**
  - The dragged or ghost sprite follows the snapped target, tinted green or red
    at 0.85 alpha.
  - The footprint (`solidRect`) is outlined in the same colour.
  - Supported items move with the dragged support in the preview too.
- **On return to `play`** (after save or cancel):
  - Rebuild pieces and the static collider group from the committed layout.
  - If the player's body now overlaps a solid, `placeFeet` at the spawn.
  - Re-enable movement and the exit.
- **Keys while editing:** `Esc` cancels the current gesture, and `Delete` or
  `Backspace` removes the selected item. WASD, the arrows and E are ignored.
- **On shutdown:** remove the bus, pointer, key and resize listeners. Emit a
  final `EDITOR_STATE` with `mode: 'play', canEdit: false` so React hides
  everything. Any unsaved draft is discarded and the store is untouched.

## React overlay

```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │                                                         [ ✎ Edit House ]   │  play mode, own house only
 │            ┌──────────── room (zoom 3) ────────────┐                       │
 │            │                                       │                       │
 └────────────────────────────────────────────────────────────────────────────┘

 edit mode (panel docked right, 200px; at 1280×720 the room spans x 220–1060,
 so the panel at x 1080–1280 does not cover it)
 ┌──────────────────────────────────────────────────────────┬─────────────────┐
 │            ┌──────────── room ─────────────┐             │ EDIT HOUSE      │
 │            │  grid, keep-clear zones,      │             │ [Save] [Cancel] │
 │            │  green/red preview            │             │ Selected: Chest │
 │            │                               │             │ [Remove]        │
 │            └───────────────────────────────┘             │ ⚠ Overlaps bed  │ ← aria-live
 │                                                          │ Add furniture   │
 │                                                          │ [🪑 Chair] ...  │
 │                                                          │ Changes are kept│
 │                                                          │ until you reload│
 └──────────────────────────────────────────────────────────┴─────────────────┘
```

- **Styling:** inline style objects, matching `GameContainer`. Monospace,
  dark-wood palette (`#2b1d14` / `#fff4d6`, as the in-game prompt uses).
  Pixel-crisp thumbnails.
- **Thumbnails:** a CSS background on the sheet URL from `AssetPaths`, using
  the slice rectangle from `interior-slices.ts`, scaled ×2 with
  `image-rendering: pixelated`. Prepared sprites (the book stack) use the
  source rectangle scaled down. No image is imported through the bundler.
- **Narrow windows:** below about 1100 px the panel overlaps the room. It gets a
  collapse toggle, so it can be tucked away while dragging.

## Event payloads

```ts
type EditorCommand =
  | { type: 'enter-edit' } | { type: 'save' } | { type: 'cancel' }
  | { type: 'remove-selected' } | { type: 'start-placing'; furnitureType: string }
  | { type: 'escape' }
```

Payloads are plain data. `editor-bridge.ts` narrows `CustomEvent.detail` with
type guards, so no `any` crosses the boundary.

## Testing strategy

| Requirement | Test | Where |
|---|---|---|
| Selection, topmost hit | Click on the notebook picks the notebook, not the table; empty floor deselects; the door is unselectable | `editor-session.test.ts`, `editor-geometry.test.ts` |
| Dragging | Threshold; grab offset kept; table drag carries the notebook and books | session |
| Grid snapping | Anchors round to 16 px; resting items to 4 px on the support; nudge dropped on first move | geometry, session |
| Invalid placement | Overlap, out of room, blocks exit, blocks spawn, notebook on floor → red with reason; drop reverts; draft unchanged | session |
| Add / remove | Catalogue excludes the computer and notebook; placement with ghost; ids numbered; remove of optional items | session |
| Mandatory | Remove disabled with reason for the computer and notebook; `Delete` key no-op | session, panel |
| Supporting | Remove the table blocked while loaded; allowed after relocation | session |
| Save / cancel | Save stores in one call, commits only on success; a failing store keeps the draft and error; double save ignored; cancel never touches the store | session (with a fake store) |
| House isolation | Save house A; B, C and the template are unchanged; the session never mutates its input | session + store |
| Exit corridor | Any drop that blocks the door, the spawn, or reach to the computer/notebook is red | session |
| React | Button only when `canEdit && mode === 'play'`; commands emitted; Remove disabled with text; Save disabled when clean or saving; reload notice present | component tests (jsdom, `act`) |

The Phaser glue (`InteriorScene`, `EditorOverlay`) is not unit-tested, per the
coding standards. It gets a manual browser checklist in `docs/TESTING.md`, plus
a headless smoke run that drives real pointer events. The smoke-run harness is
temporary and not committed.

## Risks and decisions

- **Ownership:** a configured "your house" is a placeholder. When accounts
  arrive, `canEditHouse` becomes a real permission check and nothing else
  changes.
- **Furniture placed where the player stands:** the player is moved to the
  spawn on leaving edit mode. The rules keep the spawn clear, so this always
  succeeds.
- **Validation cost:** a full flood fill (about 14k cells) per snapped-position
  change is a few milliseconds. It is never run per pointer event.
