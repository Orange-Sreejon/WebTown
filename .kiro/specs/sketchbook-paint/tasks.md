# Sketchbook: WebTown Paint - Tasks

Each step leaves `npx tsc -b`, `npm test` and `npm run build` green. No commits without the owner's approval.
Status: all done, uncommitted, awaiting the owner's review.

- [x] **K-01** Spec (this folder).
- [x] **K-02** Engine, pure: pixel buffer, colours and palette, raster operations, history, coordinates, tools; tests.
- [x] **K-03** Paint session (all tools, preview, cancel, text, clear, resize, undo / redo); tests.
- [x] **K-04** Artwork storage: rules, memory and IndexedDB repositories (contract suite), guard, `paintAccessFor`; tests.
- [x] **K-05** Window and pieces: chrome, menus, toolbox, options, colour box, status bar, canvas view, dialogs,
      icons, CSS; browser helpers (codec, text, export).
- [x] **K-06** Sketchbook document: load, autosave, New / Open / Rename / Delete, close flow; visitor viewer;
      `AppHost` switch; component and boundary tests.
- [x] **K-07** Playwright in three engines with the real game (walk, E, freeze, draw, persist, isolation).
- [x] **K-08** Docs (steering, TESTING, MVP tasks), final tsc, tests, build, audit.
