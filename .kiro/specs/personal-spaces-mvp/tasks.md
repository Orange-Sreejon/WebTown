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
- [x] **P3-03** (done) `furniture-catalog` label `Notebook` -> `Sketchbook` (D4) and the
      violation text; update the tests that quote it. Keys and roles unchanged.

### Website (independent of Paint)

- [x] **P3-04** Website domain (done): `site-types`, `site-text`, `url-policy`, `contrast`,
      `theme-presets`, `site-validation`, `default-site`, `site-readonly`, `site-repository`
      (contracts only), all under `src/personal-spaces/website/`, pure and independent of Phaser, React,
      IndexedDB and any backend. 297 new tests. Acceptance, all met:
      valid and invalid data; missing required fields; every length boundary (max, max + 1);
      http/javascript/data/other schemes, malformed URLs, credentials, ports, private and IP hosts;
      https with paths, queries and fragments; invalid colours; contrast at both AA thresholds and just
      either side of them; default site complete and valid; presets valid; deep-copy isolation; a
      reader interface with no save; a test that the folder imports nothing outside itself and has no
      ownership logic.
- [x] **P3-05** Site persistence (done): `errors.ts`, `storage/idb.ts` (promise wrapper with open, blocked,
      quota, abort and closed-connection handling), `storage/webtown-db.ts` (database `webtown` v1: `sites` and
      `artworks`), `site-storage/` (shared record rules, in-memory and IndexedDB repositories implementing the
      P3-04 `SiteReader` / `SiteWriter` contracts, `guardSiteWriter`), and `composition.ts` (`createSiteStorage`
      with in-memory fallback, `siteAccessFor`). Validation on save and on load; damaged records are never shown
      and never deleted. `fake-indexeddb` is used by tests only and is absent from `dist/`. Also at P3-05:
      D1 (HTML-looking text is accepted and shown literally) and D2 (explicit https ports 1-65535 allowed).
      197 new tests: one contract suite run against both repositories, wrapper fault injection, guard and access
      tests, a literal-rendering test, and a source scan for HTML-injecting APIs and test-only imports.
- [x] **P3-06** Website window (done): `components/website/` (`SiteRenderer`, `ExternalLink`, `SiteWindow`,
      `site-theme`, `website.css`), `components/apps/WebsiteApp.tsx` wired into `AppHost`, `WindowFrame`
      gained `size="wide"` and `onKeyDown`, `personal-spaces/labels.ts`, `website/site-navigation.ts`,
      `website/site-format.ts`, and `onSiteLoad` in `composition.ts`. Home, About, Projects and Links; in-memory
      back, forward and home; a display-only address `webtown://house-a/about`; Close. Every string is a React text
      node; external links go through the URL policy and open with `rel="noopener noreferrer"`. The window
      receives a `SiteReader` only, in both modes. The owner is told about a recovered record; a visitor is not.
      The window says "Saved on this device only" and never implies anyone else can see it. No editor (P3-07).
      Acceptance, all met: every page, navigation and history, literal-text and injection tests against the real
      renderer, valid and invalid links, visitor read-only (with an import-graph test), default site, recovery
      notice, storage failure and retry, close and restore, keyboard and accessibility basics, 1280x720,
      1920x1080 and 390x844 (49 checks in a real browser), and a clean `dist/`.
- [~] **P3-07** Owner website editor, form-based: **superseded, not built on** (revision 2). Committed by the owner
      in `9837da3` ("before-studio"), so it is preserved in history. Removed from the app in website-studio W-07.

### Website, revision 2: WebTown Site Studio (file-based; design section 16)

Sizes are relative effort (S, M, L). Each task leaves `tsc -b`, `npm test`, `npm run build` and `npm audit` green and
needs approval before the next one starts. **S-01 is a gate: S-02 does not start until the spike results and the
revised design 16.4 to 16.9 have been reviewed.** S-06 must carry the S-01 security suite onto the real host page,
navigation page and builder, and pass it in all three engines.

- [x] **S-00** (S) Decisions and housekeeping (done). SD-1 to SD-12 confirmed and recorded (design 16.0). SD-1: the
      stash was not possible because the work was already committed as `9837da3`; nothing was stashed, reset or moved.
      Steering updated: `security.md` (resident websites: two-layer sandbox, no resident JavaScript, no egress,
      messages, SVG, uploads), `product.md` (Site Studio direction, 3a limits), `coding-standards.md` (`fake-indexeddb`
      and `@playwright/test` as dev dependencies; no code-editor dependency). Requirements WS-09, WS-15, WS-16, WS-21
      revised for SD-4, SD-5 and SD-11. `@playwright/test` 1.65.1 added (dev, exact), browsers installed outside the repo.
- [x] **S-01** (M) **Sandbox spike** (done; **awaiting review**, which gates S-02). `spikes/site-sandbox/` (throwaway,
      not shipped, not in `npm test`; `npm run spike:sandbox`): stand-in app, trusted host and navigation pages,
      prototype builder with four modes, hostile fixtures, a beacon recording HTTP, bare TCP and UDP, and 58 Playwright
      tests per engine. Two consecutive runs: 173 passed, 1 skipped (WebKit has no WebRTC), in Chromium, Firefox and
      WebKit. Findings, revised policy and residual risks: `docs/site-sandbox-findings.md`; design 16.4 to 16.9 revised.
**S-02 to S-14 are replaced by `.kiro/specs/website-studio/` (W-01 to W-10, all done; pages + one `style.css` +
images, CodeMirror 6 editor). The items below are kept for the record and are not worked on.**

- [ ] **S-02** (M) Project domain, pure: `site-project/` types (16.2), path rules, type allow-list and content
      signatures, limits, change sets, revision rules, load validation with skip reports. Tests for every rule.
- [ ] **S-03** (M) Templates and migration, pure: Blank, Classic home page (from `SiteContent`), one single-page
      creative template, all original; `siteContentToProject` with escaping and URL policy; tests with hostile
      strings for every field, and every template valid under S-02 rules.
- [ ] **S-04** (L) Document builder, pure (16.4): inert parse, head injection order, removals, reference
      rewriting for HTML attributes, inline styles, `<style>`, CSS files, `@import`; folder index pages; page not
      found; size budget. Tests in jsdom; the resident source is never modified.
- [ ] **S-05** (L) Storage v2 (16.3): database version 2 upgrade (v1 data preserved, tested against a database
      written by the P3-05 code); memory and IndexedDB project repositories under one contract suite;
      transactional save with fault injection; `ConflictError`; quota and limits; Blob round trip; guarded writer;
      `siteProjectAccessFor`; migration resolver (project, else valid `sites` record converted in memory, else
      default).
- [ ] **S-06** (L) Sandbox runtime (16.5 to 16.7): `public/site-host.html` and its script; `SiteFrame` component;
      message guards and rate limit; site-internal navigation; the external-link confirmation bar; unexpected
      navigation handling; WebTown error pages. **Security suite** with fixtures and a request-recording test
      server (needs SD-10), passing in every supported browser.
- [ ] **S-07** (M) Visitor and owner viewing on `SiteFrame`: `WebsiteApp` uses the project reader; WebTown Browser
      chrome with path history, display-only address, page title; migrated and default sites; recovery and
      skipped-file notices; Stop. Retires `SiteRenderer` from the display path.
- [ ] **S-08** (L) Site Studio shell (owner-only lazy chunk, 16.10): full-size window, explorer (read), tabs,
      textarea `CodeEditor`, image viewer, preview on the draft (never written), Save all, unsaved markers, conflict
      prompt, discard confirmations, `beforeunload`, storage meter, narrow-screen tabs, keyboard model.
- [ ] **S-09** (M) File management and uploads: new file and folder (with per-type starters), rename/move, delete
      (folder counts), set start page, picker and drag-and-drop uploads with per-file refusals and budget checks.
- [ ] **S-10** (S) Start from template and first run: template chooser, replace-with-confirmation, the converted
      structured site as the starting draft with a clear "nothing is saved until Save" note, site title.
- [ ] **S-11** (M, optional, gated) **Evaluate** CodeMirror 6 behind the `CodeEditor` interface (bundle size,
      accessibility). No runtime dependency exception is approved (SD-3); adopting it needs a separate decision.
- [ ] **S-12** (S, optional) Developer aids: a panel showing errors reported by the page (as text, rate-limited);
      `webtown.asset(path)` if SD-12 is approved later.
- [ ] **S-13** (S) Retire form-based display code (`SiteRenderer`, `ExternalLink`, `site-theme`, page CSS) and tests;
      keep the migration-only modules; update boundary tests so visitor code cannot import Site Studio, writers,
      storage or the builder's write paths.
- [ ] **S-14** (M) Hardening and verification: accessibility pass, Help text with the 16.9 limits, manual checklist
      at 1280x720, 1920x1080 and 390x844, `docs/TESTING.md`, final security suite run, steering check.

Paint (P3-08 onwards) is independent of this work and can follow or interleave. Both use database `webtown`;
the version-2 upgrade in S-05 already contains the `artworks` store, so P3-11 needs no further version.
**P3-08 to P3-16 are replaced by `.kiro/specs/sketchbook-paint/` (K-01 to K-08, done): white 640 x 480 canvas,
Attributes, text and airbrush, autosave, View and Colors menus. The items below are kept for the record. P3-17's
accessibility pass and manual checklist remain open.**

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
- [ ] Owner can build the website in Site Studio from their own files; owner can draw, save, reopen, rename, delete, export.
- [ ] Visitor can browse the website and gallery, view, navigate, export; cannot mutate
      and has no writable repository in its component tree.
- [ ] Website navigation stays inside the overlay; external links open only after confirmation, in a new tab.
- [ ] Every sandbox security fixture fails in every supported browser (design 16.13).
- [ ] A structured site saved before revision 2 still shows, and its record is unchanged.
- [ ] Export preserves transparency and contains no checkerboard.
- [ ] One stroke / shape / fill / clear = one undo.
- [ ] Pointer mapping correct at three sizes.
- [ ] Reload keeps website and drawings; UI says "Saved on this device only".
- [ ] No claim of cross-device sharing anywhere.
- [ ] Existing behaviour and tests unchanged; tsc, tests, build green.
- [ ] Paint matches the reference screenshot within the MVP tool set.
- [ ] `dist/` has no `fake-indexeddb`; reference screenshot not in `dist/` and not tracked by Git.
