# Furniture Editor MVP â€” Tasks

One task at a time. Each leaves the tree green: `npx tsc -b`, `npm test`,
`npm run build`. No commits without approval.

- [x] **FE-01** Ownership stand-in (`config/ownership.ts`) and a product steering
      update (furniture editor in scope; one configured house is yours).
- [x] **FE-02** `editor-geometry.ts`: grid and support snapping, hit-testing, with
      tests.
- [x] **FE-03** `violation-text.ts`: plain-language reasons, with tests.
- [x] **FE-04** `EditorSession`: modes, selection, drag, placement, add/remove,
      save/cancel, `view()`; with tests covering every row of the design's test
      table (fake store for save failures).
- [x] **FE-05** `editor-bridge.ts` and the event-bus types: typed commands and
      views, with guard tests.
- [x] **FE-06** React overlay: `HouseEditorOverlay`, `EditHouseButton`,
      `EditorPanel`, `FurnitureCatalogue`, with component tests; mounted in
      `GameContainer`.
- [x] **FE-07** `EditorOverlay` (Phaser) and the `InteriorScene` edit mode: pointer
      and key wiring, rebuild on change, preview tint, return to play,
      relocation to the spawn, cleanup.
- [x] **FE-08** Runtime verification in a browser at 1280Ã—720 and 1920Ã—1080:
      own house editable, visitor read-only, drag, add, remove, save, cancel,
      re-entry shows the saved layout, reload resets. Docs and manual checklist,
      including "changes are lost after a reload". Final tsc, tests and build.

## Acceptance

- [x] Edit House appears only in your own house, only in walkable mode.
- [x] Furniture can be selected, dragged, snapped, added and removed.
      Green/red previews give text reasons.
- [x] The computer and notebook can never be removed. The notebook follows its
      table. A loaded table cannot be removed.
- [x] No save can produce an invalid house. Cancel restores the previous layout
      exactly.
- [x] Other houses, the template and the town are unaffected. Return-position
      restoration and Halloween mode still work.
- [x] The UI and docs state that changes are lost after a reload.
- [x] All Phase 1 and Phase 2 tests pass; production build succeeds.

## Notes from implementation

- FE-04 and FE-05 were done in swapped order: the session's `view()` returns the
  bridge's `EditorView` type.
- `Violation` gained an optional `otherId`, so messages can name the other piece
  ("Overlaps the bed"). The change is additive.
- The reload notice moved next to Save after a 720p screenshot showed it below
  the fold.
- Found during verification, not caused by the editor: at 1920×1080
  `Scale.EXPAND` stretches the 1280×720 canvas ×1.5 with CSS, so the interior
  shows 4.5 screen px per art px. See the known limitation in `docs/TESTING.md`.
