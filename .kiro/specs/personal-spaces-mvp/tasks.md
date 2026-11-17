# Personal Spaces MVP (Phase 3) - Tasks

One task at a time. Each leaves the tree green: `npx tsc -b`, `npm test`,
`npm run build`. No commits or pushes without approval. **Nothing below starts until
the specs are approved. D1-D9 are approved (see `design.md` section 1).**

## Gate 0 - housekeeping

- [x] **P3-00** Housekeeping (decisions approved; done, tsc/tests/build green, uncommitted)
  - Reference screenshot at `inspiration-art/paint-reference.png`: local-only, git-ignored
    (`/inspiration-art/`), outside `public/`, absent from `dist/`.
  - Update `.kiro/steering/product.md` (Phase 3 current; local persistence allowed for
    3a only) and `.kiro/steering/security.md` (user content rules, URL policy).
  - `npm audit`, then `npm i -D --save-exact fake-indexeddb` (dev only).
  - Add a Phase 3 section stub to `docs/TESTING.md`.

## Phase 3a - local demonstration (no backend)

### Bridge and interaction

- [x] **P3-01** `lib/app-bridge.ts` + event-bus types + `personal-spaces/access`.
      Guards and round-trip tests. Editor bridge untouched.
- [x] **P3-02** Object targets and freeze/restore. (done: tsc, 413 tests, build green; 30/30 browser checks via headless Edge; uncommitted)
  - `game/maps/house/object-targets.ts` with tests (default room, moved table, nearest wins).
  - Confirm the Phaser 3.90 keyboard API names for disabling and restoring capture.
  - `InteriorScene`: `openApp` guard, E routing, prompts, freeze, restore, cleanup;
    `HouseEditorOverlay` hides while an app is open.
  - `AppHost` + `WindowFrame` mounted in `GameContainer` with **placeholder** windows
    (close button, Esc) and an error boundary that sends `close`.
  - Done when: both objects open a placeholder, player frozen, typed WASD/E reach an
    input, close restores position/facing/camera, repeat open/close x20 stays clean,
    furniture editor and exit door unaffected.
- [ ] **P3-03** `furniture-catalog` label `Notebook` -> `Sketchbook` (D4) and the
      violation text; update the tests that quote it. Keys and roles unchanged.

### Website (independent of Paint)

- [ ] **P3-04** Website domain: `site-types`, `site-validation`, `url-policy`,
      `contrast`, `default-site`, with the URL policy table tests.
- [ ] **P3-05** Site persistence: `storage/idb.ts`, memory and IndexedDB site
      repositories, guarded wrapper, shared contract tests, `composition.ts`
      (including fallback and the `persistent` flag).
- [ ] **P3-06** `SiteRenderer`, `SiteWindow`, in-overlay navigation and history,
      late-90s styling, external link handling, visitor mode (reader only).
      Component tests, including `<script>` text rendered literally.
- [ ] **P3-07** `SiteEditor` (owner only): draft, validation messages, contrast check,
      live preview, save / cancel. Tests; visitor tree has no editor.

### Paint engine (pure, no React)

- [ ] **P3-08** `pixel-buffer`, `stamp`, `line`, with clipping and gap tests.
- [ ] **P3-09** `rect`, `ellipse`, `flood-fill` (iterative), eyedropper; tests incl.
      large-area fill and all-edge clipping.
- [ ] **P3-10** `history` (one op = one entry, cap 30, redo clearing), `coords`,
      `palette`, `tools`; tests. Export-from-buffer test (alpha preserved).

### Artwork persistence

- [ ] **P3-11** `artwork-types`, `artwork-validation`, memory and IndexedDB repositories,
      guarded wrapper, contract suite on both, corrupt-row and quota cases.

### Paint UI

- [ ] **P3-12** Paint shell: `PaintApp`, window chrome, `MenuBar`, `Toolbox`, `Palette`,
      `StatusBar`, checkerboard CSS, responsive layout, static (no drawing). Verify
      against the reference screenshot (menus File/Edit/Image/Options/Help).
- [ ] **P3-13** `DrawingSurface`: dual canvas, scale fit, pointer capture, coalesced
      events, preview overlay, commit / cancel, undo / redo wiring, all tools, colour
      picking, right-button colour, custom colour. Component tests with a stubbed
      `getBoundingClientRect`.
- [ ] **P3-14** Documents: New / Open / Save / Rename / Delete / Export PNG, the single
      unsaved-changes guard, `beforeunload`, failure paths (save failure keeps state,
      `NotFoundError` recovery), "Saved on this device only" label, in-memory banner.
- [ ] **P3-15** Gallery (reader only): `GalleryGrid`, `GalleryViewer` (prev / next,
      export, keyboard), empty and decode-failure states; wire the visitor path in
      `AppHost`; owner "Open" dialog reuses the grid.
- [ ] **P3-16** Boundary tests: import-graph rules (website <-> paint independent,
      gallery imports readers only, no `phaser` in components) and the visitor tree
      assertion (no mutating controls, no writer in props).

### Finish

- [ ] **P3-17** Accessibility pass (menubar keys, focus trap and return, labels, live
      regions, contrast), manual verification at 1280x720, 1920x1080 and 390x844,
      touch check, full `docs/TESTING.md` Phase 3 checklist, README note that 3a is
      local only. Final `tsc -b`, `npm test`, `npm run build`.

## Phase 3b - real sharing (GATED; not started)

Starts only after a separate `personal-spaces-sharing` spec is
reviewed. Supabase is the preferred provider (architectural approval only). Planned shape (see `design.md` section 8):

- [ ] **P3B-01** Spec: provider decision, schema, RLS policies, quotas, moderation plan.
- [ ] **P3B-02** Real authentication and house claiming; replace `canEditHouse`.
- [ ] **P3B-03** Remote repositories implementing the existing interfaces; swap in
      `composition.ts`; thumbnails; compare-and-swap on `updated_at`.
- [ ] **P3B-04** Security review, CSP, secrets handling, abuse controls, then a two-device
      verification.

## Acceptance (copied from requirements.md)

- [ ] Computer and notebook interaction, freeze and exact restore.
- [ ] Owner can edit website; owner can draw, save, reopen, rename, delete, export.
- [ ] Visitor can browse the website and gallery, view, navigate, export; cannot mutate
      and has no writable repository in its component tree.
- [ ] Website navigation stays inside the overlay; external links validated, new tab.
- [ ] Export preserves transparency and contains no checkerboard.
- [ ] One stroke / shape / fill / clear = one undo.
- [ ] Pointer mapping correct at three sizes.
- [ ] Reload keeps website and drawings; UI says "Saved on this device only".
- [ ] No claim of cross-device sharing anywhere.
- [ ] Existing behaviour and tests unchanged; tsc, tests, build green.
- [ ] Paint matches the reference screenshot within the MVP tool set.
- [ ] `dist/` has no `fake-indexeddb`; reference screenshot not in `dist/` and not tracked by Git.
