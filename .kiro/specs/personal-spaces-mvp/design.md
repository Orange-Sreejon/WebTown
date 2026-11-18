# Personal Spaces MVP (Phase 3) - Design

Status: **APPROVED (D1-D9 resolved). Implementation in progress on `feature/phase-3-personal-spaces`.** Pairs with `requirements.md` and `tasks.md`.

## 1. Decisions (all approved)

> Revision 2 (file-based websites, WebTown Site Studio): decisions **SD-1 to SD-12** are in section 16.0 (reviewed; SD-2 conditional on the S-01 spike).

| # | Decision | Approved outcome | Alternatives considered |
|---|---|---|---|
| D1 | **Persistence for 3a.** | IndexedDB behind repository interfaces, labelled "Saved on this device only". Local demo only. | In-memory only (matches layouts, loses everything on reload). localStorage (rejected: base64 images, 5 MB cap). |
| D2 | **Real sharing (3b).** | Do **not** start. Approve the design in section 8 first, as a separate spec `personal-spaces-sharing`. Supabase (Postgres + Storage + Auth, Row Level Security, no server code) is the **preferred provider: architectural approval only**. Nothing of Supabase, authentication or any backend is implemented in 3a; 3b needs its own spec and review. The `@supabase/supabase-js` runtime-dependency exception is **not** approved yet and is decided in that spec. | Cloudflare Workers + R2 + D1 (you write auth); Firebase; manual "publish" of exported files (no auth, not real sharing). |
| D3 | **Steering changes.** `product.md` (Phase 3 is current; localStorage/IndexedDB allowed for 3a) and `security.md` (user-generated content now exists: URL policy, text-only rendering, no `dangerouslySetInnerHTML` stays). | Approved. Must document the 3a local-only limits and the planned 3b security model. Applied in task P3-00. | Leave steering stale (contradicts the code). |
| D4 | **User-facing name "Sketchbook".** Change only the catalogue `label` of the `notebook` type (and the violation text that quotes it). Type key `notebook`, role `notebook`, ids and layouts unchanged. | Approved. Type key, role and furniture identity are preserved. | Keep "Notebook" as the label. |
| D5 | **One dev dependency: `fake-indexeddb`** (exact pin, `npm audit` first) to test the IndexedDB repository in jsdom. **Dev dependency only; it must not appear in the runtime bundle** (imported only from `*.test.ts`; verified by grepping `dist/` after build). No runtime deps. | Approved. | Test only an in-memory implementation and verify IndexedDB by hand (weaker). |
| D6 | **Paint semantics.** Aliased (no anti-aliasing) pixel drawing in a pure-TS raster engine over an RGBA buffer; eraser makes pixels transparent; filled and outline shape tools are distinct tools (a filled shape has no separate outline); fixed 640x480 logical canvas; undo history memory-bounded. | Approved. | Canvas 2D drawing calls (anti-aliased, fill leaves halos, not unit-testable without a canvas package). Classic filled shape = outline in FG + fill in BG (extra colour logic). |
| D7 | **URL policy:** `https:` only; other schemes rejected; safe external-link handling. | Approved. **Amended at P3-05:** an explicit port from 1 to 65535 is allowed (`https://example.com:8443`). | Also allow `http:` (mixed content, weaker). |
| D8 | **Layouts stay in-memory** in Phase 3 although drawings and websites persist, so a reload resets furniture only. | Approved. Furniture layouts stay in memory and reset on reload. Phase 2 furniture persistence is not modified. | Add IndexedDB layout store now (scope creep). |
| D9 | **Reference screenshot** is the primary visual reference. | Approved. Located at `inspiration-art/paint-reference.png` (464x475), a **local-only development asset**: git-ignored, outside `public/`, never committed, never in `dist/`. See section 12. | Proceed from a general description. |

Standing assumptions: the notebook zone uses the `INTERIOR_PROP_REACH_PX` rule in 4.1; Phase 3a
is **single-device**, which is stated in the UI. Client-side restrictions in 3a can be bypassed
with browser developer tools; this is documented in the steering files and in the README.

## 2. Existing architecture inspected

| Area | Finding | Consequence |
|---|---|---|
| Event bus (`lib/event-bus.ts`) | `EventTarget` wrapper; `GameEventType = 'READY' \| 'ERROR' \| 'EDITOR_STATE' \| 'EDITOR_COMMAND'` | Add `'APP_STATE'` and `'APP_COMMAND'`. Existing names untouched. |
| `lib/editor-bridge.ts` | Pattern: Phaser publishes a JSON view, React sends commands, payloads are `unknown` narrowed by guards | Copy the pattern in a new `app-bridge.ts`. Do not modify the editor bridge. |
| `InteriorScene` | Owns `player`, `prompt`, `lock`, `nearExit`, `isEditing()`; `update()` halts when `lock.isBusy \|\| isEditing()`; E handler guarded by `event.repeat`; teardown removes listeners via `cleanups` | Add an `appOpen` guard next to `isEditing()` and one more E handler path. |
| `findNearbyTarget`, `InteractionTarget` | Pure, already supports many targets, picks nearest | Reuse for computer / notebook zones. |
| `furniture-catalog.ts` | `computer-desk` has `role: 'computer'`; `notebook` has `role: 'notebook'`, `mount: 'surface'`, `removable: false` | Find targets by role from `InteriorDefinition.pieces`. No ids hard-coded. |
| `layout-rules.ts` | Exactly one of each role, and the player must be able to get **near** each (`unreachable` violation) | Every house is guaranteed a standable spot; reuse its "near" distance for the reach. |
| `ownership.ts` | `canEditHouse(houseId)` | Single source for owner vs visitor. Called in Phaser and passed in the view. |
| `GameContainer` | Mounts `<HouseEditorOverlay />` as a sibling of the Phaser div | Mount `<AppHost />` the same way. |
| Persistence | Only `InMemoryHouseLayoutStore`. No backend, no auth, no localStorage anywhere | See sections 7 and 8. |
| Phaser key capture | `addKeys('W,A,S,D')` and `createCursorKeys()` capture keys (default `preventDefault`) | Must be disabled while an app is open, otherwise text fields lose those letters. A Phaser-side change, verified manually and in a scene-level check. |
| Tooling | Vitest + jsdom; React tests use `react-dom/client` + `act`; no Testing Library; no canvas package | Raster engine is pure buffer code so it is testable without a canvas. |
| Steering | "No runtime deps beyond React, ReactDOM, Phaser"; no localStorage / backend; no `dangerouslySetInnerHTML` | Respected; D3 updates stale parts. |

## 3. Module layout

```
src/
  lib/
    app-bridge.ts            APP_STATE / APP_COMMAND types, guards, emit/on helpers   (P3-01)
    event-bus.ts             + 'APP_STATE' | 'APP_COMMAND'
  game/
    maps/house/object-targets.ts   pure: InteriorDefinition -> InteractionTarget[]    (P3-02)
    systems/app-session.ts, interior-gate.ts, keyboard-capture.ts                     (P3-02)
    scenes/InteriorScene.ts  + app guard, E routing, freeze/restore
  personal-spaces/
    errors.ts                        ValidationError, PermissionError, QuotaError,
                                     StorageUnavailableError, StorageBlockedError, StorageError
    access/access-policy.ts          accessModeFor(canEdit)                            (P3-01)
    website/                         pure domain, no storage, no UI                     (P3-04)
      site-types, site-validation, url-policy, contrast, theme-presets, default-site,
      site-text, site-readonly, site-repository (SiteReader / SiteWriter contracts)
    storage/                         IndexedDB, generic                                 (P3-05)
      idb.ts                         promise wrapper: open, get, put, delete, getAll, errors, recovery
      webtown-db.ts                  database `webtown` v1: stores `sites`, `artworks` (+ byHouse index)
    site-storage/                    website repositories                               (P3-05)
      site-record.ts                 shared rules: what may be saved, what a load makes of stored data
      memory-site-repository.ts      fallback and reference implementation
      indexeddb-site-repository.ts
      guarded-site-writer.ts         PermissionError unless the bridge said `owner` for this house
    composition.ts                   the ONE place that builds storage and hands out access
    artwork/ ...                     P3-11 (reuses storage/ and the artworks store)
    paint/                           pure engine, no React, no DOM                      (P3-08..10)
  components/
    apps/    AppHost, WindowFrame, AppErrorBoundary, PlaceholderApp                     (P3-02)
    website/ SiteWindow SiteRenderer SiteEditor ...                                      (P3-06/07)
    paint/ ...  gallery/ ...                                                             (P3-12..15)
```
Dependency rules (enforced by a test that parses imports):

- `components/website/**` and `personal-spaces/website/**` must not import
  `components/paint/**`, `personal-spaces/paint/**`, `personal-spaces/artwork/**`,
  or `components/gallery/**`, and the reverse.
- `components/gallery/**` may import `artwork-repository` **types** `ArtworkReader`
  only, never `ArtworkWriter` / `ArtworkRepository` / any implementation.
- Nothing under `components/` or `personal-spaces/` imports `phaser` or `game/**`.
  `game/**` imports only `lib/app-bridge` and `personal-spaces/access` (pure).

`WindowFrame` is presentation only and is shared; it carries no data access.

## 4. Phaser <-> React bridge

```ts
// lib/app-bridge.ts
export type AppId = 'website' | 'paint'
export type AccessMode = 'owner' | 'visitor'

/** Phaser -> React. */
export interface AppView {
  open: AppId | null
  houseId: string
  mode: AccessMode        // from canEditHouse(houseId) at open time
}

/** React -> Phaser. */
export type AppCommand = { type: 'close' }
```

Only `close` goes React -> Phaser; React never asks Phaser to do anything else.
Guards `isAppView` / `isAppCommand` follow `editor-bridge.ts`. `AppHost` renders
nothing when `open === null`. `HIDDEN_APP_VIEW` is published on scene teardown.

React shows Paint (owner) or the viewer (visitor) from `mode`; it does not call
`canEditHouse` itself, so the rule has one source. The write repository is *also*
guarded (section 5.3).

### 4.1 Interaction targets (pure, tested)

`object-targets.ts`:

```ts
export interface ObjectTarget extends InteractionTarget {
  app: AppId                // 'computer' role -> 'website', 'notebook' role -> 'paint'
  promptText: string
}
buildObjectTargets(def: InteriorDefinition): ObjectTarget[]
```

For each piece with `role`, take its sprite box (`pieceBounds`, the box the layout rule
uses), grow it by `INTERIOR_PROP_REACH_PX` (reused; no new constant) on every side, and clip to
the room. `promptX/Y` is the piece's top centre. The notebook is an attached item, so its resolved `x/bottom` already
follows its table. Targets are rebuilt whenever `InteriorScene` rebuilds its
definition (after editor save / cancel), next to `rebuildColliders`.

A target's zone may overlap the solid of the supporting furniture; the player stands
beside it, never inside. Because the solid blocks, the grown rect always reaches
walkable floor. If `OBJECT_REACH_PX` is too small to reach floor for some layout, the
`unreachable` rule has already refused that layout.

### 4.2 Scene state machine

```
play --E on object--> app-open --close--> play
play --Edit House--> edit        (apps unavailable)
edit  --Save/Cancel--> play
```

`InteriorScene` additions:

- `private openApp: AppId | null`; `isBlocked()` = `lock.isBusy || isEditing() || openApp !== null`.
- `update()`: if blocked -> `player.halt()`, hide prompt (unchanged style).
  Otherwise find the nearest of `[exit, ...objectTargets]` and set `nearTarget`.
- E handler: ignore if `event.repeat`, blocked, or no target; then branch on target
  kind: exit -> `leave()` (existing), object -> `openAppFor(target)`.
- Opening (`AppSession.open`, pure of Phaser, in `game/systems/app-session.ts`): halt the player,
  hide the prompt, hand the keyboard to the page (`setKeyboardCaptured(kb, false)`:
  `resetKeys()`, `enabled = false`, `disableGlobalCapture()`, `resetKeys()`), then publish
  `{ open, houseId, mode }`. Mode comes from `resolveAccessMode`, which **fails closed**
  (visitor) if the permission check throws or answers anything but `true`. Opening takes the
  existing `TransitionLock`, so everything else (exit, editor commands) is blocked by the
  same flag as during a door transition.
- `closeApp`: `openApp = null`; `keyboard.enabled = true`; `enableGlobalCapture()`;
  `keyboard.resetKeys()`; `lock.release(now)` so the closing key does not reopen;
  `emitAppState(HIDDEN_APP_VIEW)`.
- Teardown: if an app is open, emit hidden state and restore capture. The command
  subscription is in `cleanups`.
- Edit House button: `EditorView` is untouched; `HouseEditorOverlay` additionally
  subscribes to `APP_STATE` and hides while `open !== null`. (A tiny additive change.)
  The `enter-edit` command is ignored by the scene while an app is open.

Scene preservation: the scene is never paused or switched. Objects, colliders, camera
and player are untouched, so restoration is "undo the freeze".

Keyboard API confirmed against Phaser 3.90 (types in `node_modules/phaser/types`, source of
`KeyboardManager` / `KeyboardPlugin`, and docs.phaser.io): `disableGlobalCapture()` sets the
**game-global** `manager.preventDefault = false` ("temporarily disable event capturing if you
swap to a DOM element"); `enabled = false` stops the plugin processing keys. Held keys do not get their
key-up while disabled, so `resetKeys()` runs on both open and close. `createCursorKeys()` also
captures Space and Shift, which would otherwise break typing spaces. The capture state is restored
on close and in scene teardown, because the plugin instance outlives the scene.

## 5. Ownership and read-only enforcement

### 5.1 One decision point
`AccessMode` is computed once in Phaser (`canEditHouse(houseId)`), published in
`AppView`, and passed down as a prop. `owner` / `visitor` is never recomputed in
leaf components.

### 5.2 Type- and module-level read-only
Repository interfaces are split:

```ts
interface ArtworkReader {
  list(houseId: string): Promise<ArtworkSummary[]>
  get(houseId: string, id: string): Promise<Artwork | null>
}
interface ArtworkWriter {
  create(input: NewArtwork): Promise<Artwork>
  updateImage(id: string, image: Blob, ...): Promise<Artwork>
  rename(id: string, title: string): Promise<Artwork>
  remove(id: string): Promise<void>
}
interface ArtworkRepository extends ArtworkReader, ArtworkWriter {}
```

`AppHost` builds the tree as:

```
mode === 'owner'   -> <PaintApp repository={ArtworkRepository} />   (can open the owner's gallery too)
mode === 'visitor' -> <GalleryViewer reader={ArtworkReader} />       (no Writer anywhere in its props or imports)
```

For a visitor, `AppHost` does not even call `composition.writer()`. The gallery and
viewer components are the same ones the owner uses for browsing, and they only take
`ArtworkReader`, so a component compiled for both cannot mutate. Mutating UI
(New, Save, Rename, Delete, tools) exists only under `components/paint/`, which is
never imported on the visitor path. The import-graph test (section 10) asserts it.
The same split applies to `SiteReader` / `SiteWriter`: `SiteRenderer` takes content
only; `SiteEditor` takes a `SiteWriter` and is rendered only in owner mode.

### 5.3 Defence in depth, and its limits
`GuardedArtworkRepository` and `GuardedSiteRepository` wrap the implementation and
throw `PermissionError` when `canEditHouse(houseId)` is false (and when the target
record's `houseId` differs from the argument). This catches developer mistakes. It is
client code: **any user can bypass it**. Real enforcement is server-side Row Level
Security in 3b. No spec text or UI string may suggest otherwise.

## 6. Website (structured model; superseded as the product direction by section 16, kept for migration)

### 6.1 Data model (implemented in P3-04, `src/personal-spaces/website/`)

```ts
interface SiteContent {
  schemaVersion: 1
  houseId: string                   // /^[a-z0-9-]{1,40}$/, same slug rule as ownership.ts
  updatedAt: string                 // ISO 8601 UTC, e.g. 2026-11-16T12:00:00.000Z
  title: string                     // required, 1..60
  profile: { displayName: string;   // required, 1..40
             tagline: string }      // 0..120
  home: { welcome: string }         // required, 1..2000, plain text, blank line = paragraph
  about: { body: string }           // 0..4000
  projects: SiteProject[]           // <= 12
  links: SiteLink[]                 // <= 20
  theme: SiteTheme
}
interface SiteProject { id: string; title: string; description: string; url: string | null }
                                    // title 1..60, description 0..500, url https or null
interface SiteLink { id: string; label: string; url: string }   // label 1..60, url https required
interface SiteTheme {
  preset: 'classic-grey' | 'starfield' | 'pastel' | 'forest' | 'custom'
  background: string; text: string; link: string            // #RRGGBB, stored upper case
  headerBackground: string; headerText: string              // the banner behind the title
  font: 'serif' | 'sans' | 'mono'                            // maps to fixed stacks in code
  pattern: 'plain' | 'dots' | 'grid' | 'stars'               // CSS background, no images
  underConstruction: boolean
}
```

Pages are the closed set `home | about | projects | links` (`SITE_PAGES`). Entry ids match
`/^[a-z0-9][a-z0-9-]{0,39}$/` and are unique within their list (`nextEntryId` makes them).
Limits count characters (code points) after cleaning.

**Plain text, shown literally (decision at P3-05).** No field holds markup, CSS or script, and text that looks
like HTML (`<script>alert(1)</script>`) is **accepted and kept exactly as typed**. It is never interpreted:
every string is rendered as a React text node, `dangerouslySetInnerHTML` and the other HTML-injecting APIs are
never used (a test scans the source), and there is no rich-text or HTML support. Only control and invisible
direction characters are stripped, and line breaks in single-line fields become spaces.
**Contrast (WCAG 2.x AA).** Body text and link colour against the background need **4.5:1**. The banner
title, which is large text, needs **3:1** against the banner colour. The check applies to every
theme, `custom` or preset. Ratios are shown rounded down. All four presets are tested to pass.

**Validation API.** `validateSite(unknown)` returns `{ ok: true, value }` (a fresh, cleaned copy built only
from known fields) or `{ ok: false, errors: { path, message }[] }` listing **every** problem with a
readable sentence. It never mutates its input.

**Read-only data.** `SiteReader.load()` returns `ReadonlySiteContent` (deep-readonly type) and the
repository contracts are split into `SiteReader` and `SiteWriter` in `site-repository.ts`. A visitor is
given a reader only. `toReadonlySite` makes a frozen deep copy. This is client-side and bypassable with
developer tools; ownership stays in `access-policy.ts` (the domain has no ownership logic, and a test
checks it).

Stored in `sites` keyed by `houseId` (P3-05). Defaults are generated by `createDefaultSite(houseId,
updatedAt)`, are complete and valid, and are not stored.
### 6.2 Rendering
`SiteRenderer({ content, section, onNavigate })` is pure presentation. Text goes in
as React text nodes; paragraphs split on blank lines. Colours are applied through
CSS custom properties from validated `#RRGGBB` values only; fonts through a fixed map.
Backgrounds are CSS patterns, no image files. Layout uses a header, left `<nav>`,
`<main>`, `<footer>`.

### 6.3 URL policy (`validateExternalUrl`, implemented in P3-04)
The address is parsed with the platform `URL` class, never matched by prefix. Accepted only if:
the text has no whitespace, control characters or backslashes (the parser would silently delete tabs
and line breaks); it is at most 2048 characters; it parses; `protocol === 'https:'`; there is no user
name or password; any explicit **port is from 1 to 65535** (443 normalises away; port 0 is refused); and the host is a
public name: not `localhost` or a private suffix (`.localhost .local .internal .lan .localdomain`),
not an IPv4 address in any spelling (the parser normalises decimal, hex and octal forms, so they are
caught), not an IPv6 literal, at least two labels, and a real top-level domain. Paths, queries and
fragments are allowed. The result carries the normalised `href` (what is stored) and the `hostname`
(punycode for non-ASCII names, so look-alikes are visible) or a sentence saying what is wrong.
Applied on edit (save is blocked), on load (invalid stored links render inert), and in the renderer
(defence in depth). Anchors use `target="_blank" rel="noopener noreferrer"`.
### 6.4 Navigation
`useSiteNavigation()` holds `{ stack, index }` in React state; sections are a closed
union. The address bar text is derived (`webtown://<houseId>/<section>`). No router, no
`history.pushState`.

### 6.5 Owner editing
`SiteEditor` holds a draft copy, validates with the same functions the repository
uses, shows field-level errors and the contrast ratio, previews through the same
`SiteRenderer`, and saves with one `SiteWriter.save`. Cancel drops the draft.

## 7. Paint and persistence (3a)

### 7.1 Raster engine
`PixelBuffer { width, height, data: Uint8ClampedArray }` (RGBA, straight alpha).
All tools are pure functions that write into a buffer and report a dirty rect.

- Pencil/brush: line between successive samples (Bresenham), stamping a filled disc
  (precomputed masks per size) at each step.
- Eraser: same with `rgba = 0,0,0,0`, replacing pixels.
- Line: Bresenham with the stamp. Rectangle / ellipse: midpoint algorithms; outline
  uses the stamp, filled draws spans. Ellipse is inscribed in the drag box.
- Fill: scanline 4-connected flood fill with an explicit stack (no recursion),
  exact RGBA equality; filling with the same colour is a no-op.
- Eyedropper: reads a pixel.
- Clipping: every write is bounds-checked in one place.

`png.ts` is the only DOM-bound file: buffer <-> `ImageData` <-> canvas <-> `Blob`.
Import of a PNG blob into a buffer uses `createImageBitmap` and an offscreen canvas;
export uses `canvas.toBlob('image/png')` on the **bitmap** canvas.

### 7.2 Canvas stack
```
<div class="canvas-area">                      scrolls if too small
  <div class="checker" style=CSS gradient>     fixed 4:3, CSS-sized, aria-hidden
    <canvas bitmap  640x480>                   committed pixels (transparent where empty)
    <canvas overlay 640x480>                   rubber-band preview, pointer target
```
The checkerboard is a CSS background on the wrapper. It is not in either canvas, so
export reads only the bitmap canvas. Sizing: `scale = min(areaW / 640, areaH / 480)`;
CSS size = `640*scale x 480*scale`; `image-rendering: pixelated` when `scale >= 1`.
A `ResizeObserver` updates the scale. DPR does not change the logical size.

### 7.3 Coordinates (`coords.ts`)
```ts
clientToPixel(ev, rect, w, h): { x: number; y: number; inside: boolean }
// x = floor((clientX - rect.left) * w / rect.width), no clamping; inside = 0<=x<w && 0<=y<h
```
Rect is read per event (never cached), so resize and scroll are always right.
Coordinates outside the bitmap are passed to the tools unclamped for lines and shapes
(so a line keeps its angle) and clipped by the buffer write path.

### 7.4 Pointer handling
`pointerdown` (buttons 0 or 2, or touch/pen): `setPointerCapture`, `preventDefault`,
snapshot the buffer for undo, begin tool. `pointermove`: use
`getCoalescedEvents()` if present. `pointerup`: commit (shape/line) and push the
snapshot to history; `pointercancel` / `lostpointercapture` / Esc / window blur:
restore snapshot, no history entry. `touch-action: none` and `contextmenu`
`preventDefault` on the overlay only. Only one active pointer at a time (a second
pointer is ignored).

### 7.5 History
`History` holds up to 30 `Uint8ClampedArray` snapshots (`before` images) in
`undo` and `redo` stacks. A completed operation pushes the pre-operation snapshot
and clears `redo`. Undo swaps the current buffer with the top of `undo` and pushes
the current to `redo`. Memory is bounded: 30 x 640 x 480 x 4 = 36.9 MB worst case;
it is released on New / Open / close.

### 7.6 Artwork data model

```ts
interface Artwork {
  schemaVersion: 1
  id: string              // UUID, stable
  houseId: string         // owning house
  ownerId: string | null  // null in 3a (no accounts); set from auth in 3b
  title: string           // 1..60 trimmed
  width: number           // 1..1024 (MVP always 640)
  height: number          // 1..1024 (MVP always 480)
  mimeType: 'image/png'
  image: Blob             // PNG, <= 2 MB
  createdAt: string       // ISO
  updatedAt: string       // ISO
}
type ArtworkSummary = Omit<Artwork, 'image'> & { byteSize: number }
```
Store: object store `artworks`, keyPath `id`, index `byHouse` on `houseId`.
`list` reads via the index and returns summaries sorted by `updatedAt` desc; images
are loaded lazily with `get` and shown through object URLs that are revoked on unmount.
Validation (`artwork-validation.ts`) checks title, dimensions, `image.size`, `type`,
and the 8-byte PNG signature on write; on read it verifies `schemaVersion` and field
types, skipping bad rows.

IDB wrapper (`storage/idb.ts`): `openDatabase` with `onupgradeneeded` creating stores,
`onblocked` / `onversionchange` handling (close the connection), every request wrapped in a
Promise, transactions awaited via `complete`. Open failure -> composition returns the
in-memory repositories plus a `persistent: false` flag that the UI shows as a banner.

### 7.7 Unsaved state
`PaintApp` owns `{ drawingId | null, title, dirty }`. `dirty` is set on any history
push and cleared on successful save. A single `guardUnsaved(action)` helper runs
New / Open / Close / delete-current. `beforeunload` is attached only while dirty.

### 7.8 Windows, menus, layout (from the reference screenshot)
Menus: **File** (New, Open..., Save, Rename..., Export PNG, Delete, Close),
**Edit** (Undo, Redo), **Image** (Clear Image), **Options** (Edit Colours...), **Help** (About WebTown Paint). The reference also has **View**; its classic items (zoom, tool box / colour box toggles) are out of scope, so the menu is omitted rather than shown empty.
The reference toolbox is two columns of 8 slots with a tool-options box beneath. WebTown Paint
fills it with the MVP tools in this order: Eraser, Fill; Eyedropper, (empty); Pencil, Brush;
Line, (empty); Rectangle, Filled rectangle; Ellipse, Filled ellipse, then the options box
(brush sizes). The reference slots for free-form select, select, zoom, airbrush, text, curve,
polygon and rounded rectangle are out of scope; the grid is two columns by the number of rows
actually needed, never with dead buttons. The palette is two rows of 14 with a
foreground / background indicator at its left, plus a custom-colour swatch. The status bar has
three panes (hint, pointer coordinate, canvas size) plus the save state. The canvas area has
scrollbars only when the canvas cannot fit at 1x; otherwise it is scaled to fit. Window chrome uses CSS bevel borders and plain text glyphs for the window buttons;
no Microsoft artwork, icons or fonts.
Responsive: >= 700 px wide shows the framed window; < 700 px makes it full-screen,
the toolbox moves to a top strip, canvas area scrolls.

## 8. Cross-device sharing (Phase 3b proposal, needs approval)

### 8.1 What is missing today
A shared data store, identities for house owners, and server-side checks. Browser
storage (localStorage, IndexedDB) lives on one device and one browser profile.
Without a shared store nothing a visitor on another device can fetch exists.
Without real authentication `canEditHouse` is a constant, so any shared write path
would let anyone overwrite `house-a`.

### 8.2 Smallest reasonable architecture
**Supabase** (managed Postgres + Storage + Auth), because it supplies all three
missing pieces without us writing or hosting server code:

- **Auth:** Supabase Auth (email magic link, or an OAuth provider). Reads are anonymous.
- **Tables:**
  - `houses(id text pk, owner_id uuid references auth.users, title text)`: claims a house.
  - `artworks(id uuid pk, house_id text references houses, owner_id uuid, title text,
    width int, height int, byte_size int, storage_path text, created_at, updated_at)`.
  - `site_content(house_id text pk references houses, owner_id uuid, content jsonb, updated_at)`.
- **Storage:** bucket `artworks` (public read); object path `{house_id}/{artwork_id}.png`.
- **Row Level Security:**
  - `select`: allowed for everyone on `houses`, `artworks`, `site_content`.
  - `insert / update / delete`: only where `auth.uid() = owner_id` **and** the row's
    house is owned by that user (`exists (select 1 from houses ...)`).
  - Storage policies: write / delete only if the path's first segment is a house the
    user owns.
- **Server-side validation:** DB `check` constraints (title length, width/height <= 1024,
  `byte_size <= 2 MB`), a trigger limiting 50 artworks per house, Storage bucket
  `file_size_limit` and `allowed_mime_types = image/png`. `content` validated by a
  JSON-schema `check` or an edge function.
- **Client:** `SupabaseArtworkRepository` / `SupabaseSiteRepository` implement the same
  interfaces. `composition.ts` swaps them in. Access mode comes from the authenticated
  session and `houses.owner_id`, replacing `ownership.ts`. Reads for non-owners use the
  public anon key only.
- **Dependency:** `@supabase/supabase-js` violates the "no runtime dependencies beyond
  React, ReactDOM, Phaser" rule; either approve that exception or call the REST API
  with `fetch` (no dependency, more code).

### 8.3 Security and ownership requirements for 3b
Never trust client-sent `houseId` / `ownerId` (RLS derives from `auth.uid()`);
claiming a house is a server operation with a uniqueness constraint; keys in env
(`.env*` stays ignored), only the anon key ships to the browser, never the service
role key; PNG magic-byte and size check server-side; per-user rate and quota limits;
no direct HTML rendering of any field; CSP limiting `img-src` / `connect-src` to the
project origin; public content means **moderation and abuse reporting are required
before public launch**, which are outside this MVP; GDPR-style delete of user data;
`updated_at` compare-and-swap to avoid silent overwrite between devices.

### 8.4 Local demonstration versus real sharing

| | 3a (this spec) | 3b |
|---|---|---|
| Data location | This browser's IndexedDB | Shared database and object storage |
| Visitor on another device sees it | **No** | Yes |
| Authorization | Client-side stand-in | Server-side, RLS |
| Safe to expose publicly | No (nothing shared, nothing to protect) | Only with auth, quotas and moderation |
| How to demo "visitor" | `?owner=house-b` (dev), draw in house-b, reload without it, visit house-b in the same browser | Two accounts, two devices |

## 9. Failure handling design

- Every repository method returns a rejected Promise with a typed error:
  `ValidationError`, `PermissionError`, `NotFoundError`, `QuotaError`,
  `StorageUnavailableError`. UI maps each to one sentence; the stack goes to the console.
- Save pipeline: validate -> `toBlob` -> repository write -> mark clean. A failure at
  any step leaves `dirty = true` and the canvas untouched. A save in flight disables
  menu items and shows "Saving...".
- `NotFoundError` on save of an existing id: offer "Save as a new drawing".
- Fallback repositories expose `persistent: false`; `AppHost` shows the banner.
- `AppHost` is wrapped in an error boundary that closes the app (sends `close`) if a
  component throws, so the player is never stuck frozen.
- Freeze safety: only the `close` command (or scene teardown) clears `openApp`, so
  the player is frozen exactly as long as an app is on screen. The error boundary
  above guarantees `close` stays reachable if a component throws. React handles Esc
  inside the app and sends `close` from one place.

## 10. Test strategy

| Layer | Tests (Vitest, jsdom, no new runtime deps) |
|---|---|
| `object-targets` | Targets exist for computer and notebook in the default room and after a moved table; none in a room without roles; zones reach floor; exit-vs-object nearest wins |
| `app-bridge` | Guards accept / reject malformed payloads; emit / on round trip; unsubscribe |
| Interior scene logic | Extract the guard logic (`isBlocked`, open / close transitions) into a small pure state object and test: E ignored on repeat, in edit mode, while busy, while open; close releases cooldown |
| Raster engine | Pencil / brush stamp shapes per size, line gaps (no gaps for steep and shallow), rectangle / ellipse boundaries and fills, clipping at all four edges, fill exactness (transparent region, bordered region, no-op same colour, huge region without recursion), eyedropper, eraser to alpha 0 |
| History | One op = one entry, undo / redo order, redo cleared by new op, cap of 30, cancel records nothing |
| Coordinates | Corner mapping at three CSS sizes, DPR independence, outside detection, scrolled containers |
| Artwork validation | Title trim / length / control chars, dimensions, size cap, PNG signature, schema version |
| Repositories | Same contract suite run against memory and IndexedDB (`fake-indexeddb`, D5): create, list sorted, get, rename keeps id and `createdAt`, update bumps `updatedAt`, remove, house isolation, quota, not found, corrupt row skipped; guarded wrapper throws for non-owned house |
| Site | Validation caps, URL policy table (https ok; http, javascript, data, blob, file, credentials, localhost, IPs, overlong rejected), contrast ratio, default content, renderer escapes `<script>` text (renders literally), invalid links inert |
| Components (react-dom/client + `act`) | AppHost renders nothing / website / paint / viewer by view; visitor tree contains none of: Save, Rename, Delete, New, tool buttons, canvas with pointer handlers; owner tree contains them; menu keyboard navigation; dialogs trap and return focus; unsaved guard branches; close emits `close` |
| Export | Using the pure buffer: exported PNG data has alpha 0 where untouched and equals the buffer; checkerboard CSS class is never on a canvas (DOM assertion) |
| Boundary (architecture) | Import-graph test: website <-> paint/artwork independent; gallery imports only `ArtworkReader`; `components/` never import `phaser` or `game/` |
| Regression | Full existing suite; `tsc -b`; `build` |
| Manual (add to `docs/TESTING.md`) | 1280x720 and 1920x1080 and a 390-wide viewport; keys W/A/S/D/E typed into a title field; player frozen and restored (position, facing, camera); open / close x20 without leaks; touch drawing; right-button colour; PNG opens with transparency in an image viewer; reload persistence; `?owner=house-b` demo; furniture editor still saves and cancels; day / night unaffected |

## 11. Implementation order

See `tasks.md`. Each task leaves `npx tsc -b`, `npm test` and `npm run build` green,
and commits only with permission.

## 12. Reference screenshot (local-only development asset) and steering flags

- Location: `inspiration-art/paint-reference.png` at the project root, **outside `public/`**,
  so Vite never copies it into `dist/`. (An earlier path under `public/assets/` was a mistake
  and was removed.)
- It is a screenshot of Microsoft's UI. `/inspiration-art/` is listed in `.gitignore`, so the
  file is never committed or pushed and is not distributed through the public repository. It is
  not stored under `docs/` for the same reason.
- It is a design reference only. No code, CSS, icon or text is copied from it; WebTown Paint
  uses original artwork and its own name. Each developer keeps their own local copy.
- Note: eight older files in `inspiration-art/` (`art-*.jpg`, `town-*`) were already tracked
  before this rule. Ignoring a folder does not untrack them, so they are unchanged. Whether to
  untrack them is a separate decision.
- Phase 3a limits and the 3b security model are recorded in `product.md` and `security.md`
  (task P3-00) so they cannot drift from this document.

## 13. Website storage (implemented in P3-05)

- **One database:** IndexedDB `webtown` v1 with stores `sites` (key `houseId`) and `artworks` (key `id`, index
  `byHouse`). Both exist from v1 so P3-11 needs no schema change. A website is stored as the validated
  `SiteContent` object itself.
- **Untrusted on the way in and out.** `save` runs `validateSite`, stamps `updatedAt` from the clock and
  validates again; `load` validates whatever is stored. A record that is damaged, from another schema version,
  or filed under the wrong house is **never shown and never deleted**: the default site is returned, an
  `onLoad` report says `recovered` with the reasons, and the record stays until the owner saves over it.
- **Failure mapping (`idb.ts`):** no IndexedDB, or a refusal to open (private browsing) ->
  `StorageUnavailableError`; an upgrade blocked by another tab -> wait, then `StorageBlockedError` after a
  timeout (a connection that arrives late is closed, not leaked); full disk -> `QuotaError`; other aborted
  transactions -> `StorageError`; data from a newer version -> `StorageUnavailableError`. A connection the
  browser closed, or that another tab asked us to drop, is reopened on the next call (one retry only).
- **Fallback:** `createSiteStorage` falls back to the in-memory repository when the database cannot be opened and
  returns `persistent: false` with the notice "Not saved: changes will be lost when you close this tab."
- **Access:** `siteAccessFor(view, repository)` takes the bridge's `{ houseId, mode }`. A visitor gets
  `{ mode: 'visitor', reader }`, where `reader` is a plain object with only `load`, so no writer exists in its
  tree. An owner also gets a writer wrapped by `guardSiteWriter`, which refuses (`PermissionError`) anything but
  exactly `owner`, and any site whose `houseId` differs from the one the window was opened for. There is no
  second ownership system. **All of this is client-side and can be bypassed with browser developer tools or by
  editing IndexedDB directly. It is not authorisation.**
- **Phase 3b swap point:** a Supabase adapter implements `SiteReader` and `SiteWriter` and is chosen in
  `createSiteStorage`. No component changes.
- **Known limitations:** two tabs saving the same house: last write wins (no compare-and-swap in 3a); data is
  per browser profile and origin; clearing site data deletes it; there is no export or backup of a website.
## 14. The website window (implemented in P3-06; chrome kept, page area replaced by section 16)

- **Pieces.** `AppHost` -> `WebsiteApp` (connects storage and the bridge's mode) -> `SiteWindow` (browser
  chrome, history, loading, errors, notices) -> `SiteRenderer` (the page). `SiteRenderer` is given data and says
  which page was asked for; it loads and saves nothing. `ExternalLink` is the only place an anchor is made.
- **Window.** A `WindowFrame` with `size="wide"`: `min(1040px, 96vw)` by `min(720px, 92vh)`. Inside: a toolbar
  (Back, Forward, Home, and a read-only address field `webtown://house-a/about`), the page in a scrolling viewport,
  and a status line. Close is the frame's Close button or Escape. Alt+Left and Alt+Right go back and forward.
  Below 720 px the navigation moves above the page.
- **Navigation.** `site-navigation.ts` keeps `{ entries, index }` in memory, limited to the four page ids and 50
  entries, with the forward trail dropped on a new page. It never touches `window.location`, the hash or the
  browser history, and the page navigation uses buttons, not anchors. After moving to a page, focus goes to the
  page and a polite live region says "About page".
- **Safe text.** Every user string is a React text node. Blank lines make paragraphs; single line breaks are kept
  with CSS `white-space: pre-line`. Colours and the font reach the page only as CSS custom properties built from a
  re-validated `#RRGGBB` and a three-way font choice; anything else falls back to a default.
- **Links.** `ExternalLink` re-checks the address with `validateExternalUrl`. A valid link is an anchor with
  `target="_blank"` and `rel="noopener noreferrer"`, showing its host (with port) and "opens in a new tab". An
  invalid one is plain text followed by "(link unavailable)".
- **Visitor boundary.** `SiteWindow` takes a `SiteReader` and no more. `components/website/` may import only React, its
  own files, `WindowFrame`, the read-only website modules, `errors` and `labels`; from `site-repository` only the name
  `SiteReader`. It never names a writer, a repository, storage, composition or ownership. `WebsiteApp` passes
  `access.reader` and nothing else in both modes. `visitor-boundary.test.ts` enforces this. When the editor is built
  (P3-07), it is a separate component that is given a writer, only for an owner, and this test is extended then.
- **What is said about storage.** Owner: "Saved on this device only." Visitor: "This website is stored on this device only.
  Visitors on other devices can't see it." With no browser storage: "Not saved: changes will be lost when you close this
  tab." (owner) and "Browser storage is unavailable, so this website is shown from memory only." (visitor). A test
  fails if any of these claims sharing, publishing or visibility elsewhere.
- **Recovery.** `onSiteLoad` (in `composition.ts`) forwards each load's report. `WebsiteApp` keeps the latest report for
  the house and gives the owner (only) a notice with up to three reasons. There is nothing to press: the record is
  replaced only by a later save.
- **Failure.** A failed load shows the reason in words (full disk, blocked, unavailable) with "Try again"; unknown errors
  show a generic sentence and the detail goes to the console. Back, Forward and Home are disabled until there is a page.
  Closing always works, including while loading or after an error.

## 15. The owner's website editor (P3-07, form-based; NOT kept, see section 16.0 SD-1)

- **Pieces.** `WebsiteApp` -> (owner only, `React.lazy`) `OwnerWebsiteWindow` -> `SiteBrowser` with an
  "Edit this website" button, or `SiteEditor` while editing. `SiteBrowser` is the browser body that the visitor's
  `SiteWindow` also uses, so viewing is the same code for everyone. `SiteEditor` holds no writer and no storage:
  it is given a draft and reports changes. Only `OwnerWebsiteWindow` calls `writer.save`.
- **No new fields.** The form covers exactly `SiteContent`: title, display name, tagline, welcome, about,
  projects (title, description, optional link), links (name, address), and the theme (preset, five colours, font,
  pattern, under-construction). Pure edit rules are in `site-edit.ts`: `startDraft`, `isDirty` (ignores
  `updatedAt`), add/remove/move entries with the existing `nextEntryId` and limits, `applyPreset` (keeps the
  under-construction switch), `setLook` (becomes `custom` unless it matches a preset exactly), `contrastRows`.
- **Draft.** Editing starts from a deep copy of the loaded site. Nothing is written until Save; the preview reads the
  draft in memory. Save runs `validateSite` on the whole draft; if it fails, nothing is written, every problem is
  listed (each a button that moves to its field) and focus goes to the list. A successful save writes the validated
  value through the guarded `SiteWriter`, leaves the editor, and the browser **loads the site again from storage**,
  so the page shows what was stored. A failed write keeps the whole draft and shows the reason in words.
- **Discarding.** Cancel, the Close button and Escape ask "Discard your changes?" when the draft is dirty; the safe
  answer, "Keep editing", is focused and Escape picks it. The question is an in-window `alertdialog` (not the
  browser's `confirm`), with the rest of the window `inert`. `beforeunload` warns while the draft is dirty.
- **Preview.** `previewOf(draft)` is the cleaned value `validateSite` would store when the draft is valid, otherwise
  the draft as it stands. It is drawn by `SiteRenderer`, so the preview and the visitor page are identical for the
  same content (tested by comparing markup). The preview follows the section being edited, can be switched by hand,
  and is `inert`, so links in it cannot be followed. The page layout uses a container query, so it lays out by the
  preview's own width.
- **Usability.** Problems appear next to a field after it is left, or after Save; each starts "Problem:" so colour
  is never the only signal. Fields show "n of max characters"; there is no `maxLength`, so pasted text is never
  cut, only counted and refused. The colour table shows each pair's ratio, what AA needs (4.5:1, 4.5:1, 3:1 for
  the large banner title) and the result in words, and matches what blocks a save.
- **Layout.** Above 1000 px the form and the preview sit side by side; below, one shows at a time with an
  Edit / Preview switch. The form, the preview and the page scroll inside the window.
- **Boundary.** `editor-boundary.test.ts`: nothing but `WebsiteApp` imports the editor folder, and only through
  `lazy(() => import(...))`; the editor imports no storage, composition, ownership, bridge or game code; `.save(` occurs
  once, in `OwnerWebsiteWindow`; the preview uses `SiteRenderer` and the folder draws no page markup of its own.
  `visitor-boundary.test.ts`: exactly one `writer=` in `WebsiteApp`, inside the `access.mode === 'owner'` branch;
  the visitor's `SiteWindow` gets `access.reader` and `isOwner={false}`. A real-browser check confirms the editor
  chunk is never requested for a visitor. All of this is client-side and bypassable with developer tools.

## 16. WebTown Site Studio: file-based websites (revision 2; decisions reviewed; S-01 done, awaiting review)

This section replaces the form-based website of sections 6, 14 and 15 as the product direction. Nothing here is
implemented. Sections 6, 13, 14 and 15 describe what exists today (P3-04 to P3-07); 16.1 says what of that is kept.

Inspiration: Neocities (in-browser editing of your own files, upload by drag and drop, sites as homes people keep
fixing up) and the restored GeoCities gallery (handmade pages, very different layouts, tiled backgrounds, animated
GIFs, odd navigation, personal art). WebTown supplies the browser chrome; the page belongs to the resident.

### 16.0 Decisions (reviewed; SD-2 conditional on S-01)

| # | Decision as confirmed |
|---|---|
| SD-1 | Preserve the P3-07 form editor. **As found at S-00:** it was already committed by the owner as `9837da3` ("before-studio", which also holds the revision-2 specs), so there was nothing to stash and HEAD is `9837da3`, not `8799bc2`. The work is preserved in that commit; no stash, reset or branch change was made. How to take it out of the product later (a revert commit, or leaving it until S-13) is an open question for the owner. |
| SD-2 | Two-layer sandbox: trusted static host page in a sandboxed iframe, resident page in a second sandboxed frame created by the host. Never `allow-same-origin`. **Conditional on S-01 passing in Chromium, Firefox and WebKit.** |
| SD-3 | Dependency-free `textarea` editor. CodeMirror 6 may be *evaluated* later; **no runtime dependency exception is approved**. |
| SD-4 | **Changed:** in Phase 3a resident JavaScript is editable and stored but **never executes**, in the preview or for visitors: no inline scripts, external scripts, event-handler attributes or `javascript:` URLs. Only WebTown's trusted bootstrap runs, under a narrow nonce. |
| SD-5 | No external network requests from resident content. The claim must rest on observed traffic (S-01 beacon), accounting for self-navigation, meta refresh, forms, anchors and WebRTC, not on a CSP directive existing. |
| SD-6 | External links only after explicit confirmation in trusted WebTown chrome; resident content cannot open popups or navigate the top-level page. |
| SD-7 | Approved file types and limits: 1 MB text, 5 MB binary, 50 MB and 500 files per site. Content (not just extension) is checked, paths are sanitised, **SVG is rendered only as an image resource**. |
| SD-8 | Save all files and metadata in one IndexedDB transaction; revisions are checked **inside** that transaction; the draft is kept on conflict. |
| SD-9 | Migrate structured sites in memory; write the project only on the owner's first Save; keep the legacy record untouched. |
| SD-10 | Playwright as a dev dependency, testing Chromium, Firefox and WebKit. Playwright's WebKit build is **not identical to branded Safari**; results for it are WebKit-engine results. |
| SD-11 | Preview refreshes 600 ms after typing stops, with an Auto toggle and a manual Preview action. |
| SD-12 | No resident-script conveniences: no filesystem, network, storage or WebTown-internal APIs. (With SD-4, no resident script runs at all in 3a.) |
### 16.1 What happens to the existing code

| Module (phase) | Fate |
|---|---|
| App bridge, access policy, object targets, freeze/restore (P3-01..03) | **Kept unchanged** |
| `errors.ts`, `storage/idb.ts`, fault injection, composition pattern, guarded writer pattern, `labels.ts` (P3-05/06) | **Kept**, extended |
| `webtown-db.ts` | **Extended**: database version 1 -> 2 adds stores; v1 stores untouched |
| `url-policy.ts` (P3-04) | **Kept**: decides which external links the confirmation bar may open |
| `SiteBrowser` chrome, `site-navigation.ts`, `WindowFrame`, `AppHost`, `WebsiteApp` (P3-06) | **Adapted**: history of page paths instead of four section ids; page area becomes `SiteFrame` |
| `SiteContent` types, validation, `site-text`, `default-site`, `theme-presets`, `contrast`, site repositories (P3-04/05) | **Migration-only**: read old records and feed the Classic template generator. Not used for new sites |
| `SiteRenderer`, `ExternalLink`, `site-theme`, `website.css` page styles (P3-06) | **Retired** from display once `SiteFrame` replaces them (S-13); their literal-text tests move to the generator |
| P3-07 form editor (committed in `9837da3`) | **Not built on** (SD-1); still live in the app until it is taken out (S-13 or an earlier revert, owner's choice) |

### 16.2 Data model

```ts
/** One resident's website. Stored per house. */
interface SiteProjectMeta {
  schemaVersion: 1
  houseId: string                        // same slug rule as today
  entryPath: string                      // the start page, an existing .html/.htm file; 'index.html' by default
  title: string                          // 1..60, plain text, shown by WebTown (window title), never as HTML
  folders: string[]                      // explicit folders, so empty folders survive
  revision: number                       // +1 on every save; compared before writing (other tabs)
  createdAt: string; updatedAt: string   // ISO 8601 UTC
  origin:                                // where the site started, for support and migration
    | { kind: 'blank' }
    | { kind: 'template'; templateId: string }
    | { kind: 'migrated'; fromStore: 'sites'; sourceUpdatedAt: string }
  fileCount: number; totalBytes: number  // kept in step with the files on every save
}

/** One file. Identity is the id; the path can change. */
interface SiteFileRecord {
  id: string                             // UUID
  houseId: string
  path: string                           // normalised: 'art/gallery.html'
  pathKey: string                        // lower-cased path, unique per house
  mimeType: string                       // from the allow-list (SD-7)
  kind: 'text' | 'binary'
  text?: string                          // text kinds, UTF-8
  data?: Blob                            // binary kinds
  size: number                           // bytes
  updatedAt: string
}

/** What a reader returns: everything needed to render. Read-only. */
interface SiteSnapshot { meta: Readonly<SiteProjectMeta>; files: readonly Readonly<SiteFileRecord>[] }

/** What a save writes, all at once. */
interface SiteChangeSet {
  houseId: string
  baseRevision: number                   // the revision the draft started from
  meta: Pick<SiteProjectMeta, 'entryPath' | 'title' | 'folders'>
  upserts: SiteFileRecord[]              // new and changed files (a rename is an upsert with a new path)
  deletes: string[]                      // file ids
}
```

Rules, all pure and tested (`personal-spaces/site-project/`):
- **Paths** (WS-04): segments `[A-Za-z0-9._-]{1,64}`, no `.`/`..` segments, no leading or trailing `/`, depth <= 8,
  length <= 200, unique by `pathKey`, a file and a folder cannot share a path.
- **Types** (SD-7): MIME from the extension, then checked: text must decode as UTF-8 (`TextDecoder` fatal); binary
  must start with the format's signature (PNG, GIF87a/89a, JPEG, WebP RIFF, AVIF `ftyp`, BMP, ICO, WOFF/WOFF2,
  TTF/OTF, MP3 frame/ID3, Ogg, WAV RIFF). Mismatch: refused with a reason. No re-encoding.
- **Limits** checked per file and against the whole project after the change set is applied.
- **Load** validates every record. A bad record is skipped and reported (`SiteLoadReport.skipped`), never deleted.

### 16.3 Storage (IndexedDB, Phase 3a)

- Database `webtown` **version 2**. `onupgradeneeded` with `oldVersion < 2` adds `siteProjects` (key `houseId`) and
  `siteFiles` (key `id`, index `byHouse` on `houseId`, unique index `byHousePath` on `[houseId, pathKey]`). The v1
  stores `sites` and `artworks` and their data are untouched (tested with a v1 database created by the P3-05 code).
- **Save** is one `readwrite` transaction over `siteProjects` and `siteFiles`: read the stored meta, refuse with
  `ConflictError` if `revision !== baseRevision`, apply deletes and upserts, write the new meta with `revision + 1`.
  Any failure aborts the whole transaction (WS-10).
- **Blobs** are stored directly (supported by IndexedDB in current browsers). S-05 confirms `fake-indexeddb` handles
  them in tests; if not, tests use `ArrayBuffer` and the browser code is verified in the real-browser suite.
- **Quota**: limits from SD-7 are enforced before writing; `navigator.storage.estimate()` is shown where available;
  `QuotaExceededError` is already mapped to `QuotaError`. `navigator.storage.persist()` is not requested in 3a.
- **Repositories**: `SiteProjectReader { load(houseId): Promise<SiteSnapshot | null> }` and
  `SiteProjectWriter { save(changes: SiteChangeSet): Promise<SiteSnapshot> }`, in-memory and IndexedDB versions run
  through one contract suite, a guarded writer that refuses any `houseId` other than the window's, and
  `siteProjectAccessFor(view, repository)` in `composition.ts` (visitor: reader only; owner: reader and guarded writer).
  A Phase 3b remote adapter implements the same two interfaces.

**Migration (SD-9).** When a house is opened:
1. A project exists -> use it.
2. Otherwise a **valid** `sites` record exists -> build the Classic template project from it in memory
   (`siteContentToProject`, pure). Visitors and the owner see that. Nothing is written.
3. Otherwise a **damaged** `sites` record exists -> owner told (existing recovery notice), record kept; visitors see
   the default site.
4. Otherwise -> the Classic template built from the default structured site (the same houses keep the same
   welcome page they show today). Not stored.
The owner's first Save writes the project with `origin: migrated` (or `template`). The `sites` record is left as it
is in this phase; removing it would be a separate, approved task.

The generator escapes every text field for HTML (`&`, `<`, `>`, `"`, `'`), turns blank-line paragraphs into
`<p>`, includes external links only when `validateExternalUrl` passes (otherwise as text), and maps the theme to CSS
from validated `#RRGGBB` values and the fixed font stacks. `<script>alert(1)</script>` saved as a title in P3-05
appears as text in the generated page (tested), so migration cannot turn old text into running code.

### 16.4 Rendering a page (pure document builder) - revised after S-01

`buildPage(snapshot, path, appOrigin) -> { html, bytes } | PageError`, in the WebTown app, pure and tested in jsdom.
It never runs anything. The S-01 prototype (`spikes/site-sandbox/www/builder.js`) shows the approach; S-04 writes the
real one with full tests.
1. Find the page (`index.html` for a folder); missing -> WebTown's "page not found" document.
2. Parse with `DOMParser` (inert: no scripts run, nothing loads); serialise back after changes. This module is the
   only place in WebTown allowed to serialise HTML, and only from an inert document (the source-scan test gets a
   single, named exception).
3. **Remove** (SD-4, SD-5): `script`, `iframe`, `frame`, `frameset`, `object`, `embed`, `applet`, `portal`,
   `fencedframe`, `base`; `<meta http-equiv>` `refresh` and `set-cookie`; `<link rel>` `preload`, `prefetch`,
   `prerender`, `preconnect`, `dns-prefetch`, `modulepreload`, `manifest`; every `on*`, `nonce`, `ping`, `target`,
   `formtarget`, `formaction`, `action` and `srcdoc` attribute. `<noscript>` is unwrapped (its content is what a page
   without script means to show).
4. **Insert**, as the first children of `<head>`: `<meta charset="utf-8">`, the resident CSP `<meta>` (16.6), and
   `<base href="webtown-site:/<path>">`. No WebTown script is inserted into resident pages.
5. **Links** (`<a>`, `<area>`, SVG `<a>`): `#fragment` stays; a link that resolves to an `.html`/`.htm` path in the
   site becomes `<app origin>/site-nav.html#k=page&p=<path#frag>`; an `https:` link that passes the URL policy becomes
   `.../site-nav.html#k=external&u=<url>`; anything else loses its `href` (`aria-disabled="true"`).
6. **Assets**: references to the site's own files in `src`, `srcset`, `poster`, `background`, `<link rel=stylesheet|icon>`,
   inline `style`, `<style>`, and inside CSS files (`url()`, `@import`, resolved relative to the CSS file) become `data:`
   URLs. Other references are removed (they would be blocked anyway). **SVG files are only ever used as image
   resources** (`data:image/svg+xml` in `<img>`/CSS), where they cannot run script or load anything.
7. **Budgets**: page HTML is bounded by the 1 MB text-file limit (SD-7), which S-01 showed keeps WebTown usable; the
   rendered `srcdoc` including base64 assets is capped at 25 MB, refused with an error page naming the largest files.

The resident's source is never changed by this; only the rendered copy is.

### 16.5 Sandbox architecture (SD-2) - verified by S-01

```
WebTown app document (React, Phaser, storage, event bus)            origin: WebTown
 └─ WebTown Browser window (React): title, Back/Forward/Home, address, status, link confirmation bar, Stop
     └─ <iframe sandbox="allow-scripts" src="/site-host.html"       opaque origin #1 (trusted host page)
                referrerpolicy="no-referrer" allow="(every feature 'none')" title="...">
         └─ <iframe sandbox="allow-scripts" srcdoc="(built page)"    opaque origin #2 (resident page)
               inherits the host page's CSP + the page's own CSP <meta>; no script runs here
               a rewritten link loads /site-nav.html (trusted) into this same frame
```

Verified in Chromium, Firefox and WebKit (`docs/site-sandbox-findings.md`):
- both frames are opaque (`self.origin === 'null'`); the resident frame cannot read WebTown's DOM, storage or cookies,
  navigate the tab, or open popups or dialogs;
- a `srcdoc` frame inherits the host page's policy, and WebTown's own (stricter) policy is **not** inherited, so the
  app can adopt any CSP it likes later;
- the host page's `frame-src`, narrowed at start-up to WebTown's navigation page, blocks every navigation of the
  resident frame (by link, form, refresh or script) to any other URL **before a request is sent**.

`allow-scripts` on the resident frame exists **only** so WebTown's navigation page can run when a link loads it.
Resident scripts are blocked by the resident CSP and removed by the builder. Never `allow-same-origin` (source test).
If `site-host.html` is opened directly it does nothing. In production it should also be served with
`Content-Security-Policy: sandbox allow-scripts` (a hosting header; recorded for deployment).

### 16.6 Policies (verified by S-01)

Host page, static `<meta>`:
```
default-src 'none'; script-src 'nonce-<host nonce>'; style-src 'unsafe-inline' data:; img-src data:; font-src data:;
media-src data:; connect-src 'none'; frame-src 'self'; child-src 'none'; worker-src 'none'; object-src 'none';
manifest-src 'none'; form-action 'none'; base-uri webtown-site:
```
then the host bootstrap adds `frame-src <app origin>/site-nav.html` (a later policy can only narrow).

Resident page, inserted by the builder:
```
default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data:; font-src data:;
media-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none';
manifest-src 'none'; form-action 'none'; base-uri webtown-site:
```

Navigation page, static `<meta>`: `default-src 'none'; script-src 'nonce-<nav nonce>'; base-uri 'none'; form-action 'none'`.

- **Nonces** are build-time constants in static files, so they are **not secret**. S-01 showed that with only the
  inherited host policy a resident script carrying the host nonce runs. That is why the resident page's own
  `script-src 'none'` and the builder's removal of scripts and `nonce` attributes are both mandatory; S-01 showed
  each one alone stops every script variant tested.
- `'unsafe-inline'` remains only in `style-src`: residents' CSS is the content and cannot execute code.
- No network scheme appears in any resident-reachable directive.

### 16.7 Message protocol (verified by S-01)

No resident script runs, so the resident page cannot post messages. Navigation works without it: a rewritten link
loads WebTown's navigation page into the resident frame, and that page posts `{ t: 'nav', kind, value }` to the host.
WebTown still treats it as an **untrusted request**, because it cannot tell it apart from the resident window.

| Layer | Accepts | Checks |
|---|---|---|
| Host from app | `{ t: 'render', html }` only | `event.source === window.parent`; size <= 40 MB |
| Host from resident frame | `{ t: 'nav', kind: 'page' or 'external', value }` | `event.source === frame.contentWindow`; string, 1-2048 chars; 10 per second; anything else is reported, not acted on |
| App from host | `ready`, `loaded`, `rendered`, `nav`, `rate-limited`, `unexpected-nav`, `rejected`, `loop-detected` | `event.source === hostFrame.contentWindow`; `event.origin === 'null'`; 30 per second; closed schema |

The app then validates content: a page request must name a page in the current snapshot (otherwise "page not
found"); an external request must pass `validateExternalUrl` and only shows the confirmation bar, which opens the
link with `noopener,noreferrer` only when the player chooses. After an external request the host restores the page,
at most three times per render (stops a page that loops). No handler forwards anything to the event bus (source test).
S-01 verified sibling-frame forgery, resident forgery, a 200-message flood (10 delivered), and the restore bound.

### 16.8 Threat model (after S-01)

| Threat | Control | Evidence |
|---|---|---|
| Page reads or changes WebTown's DOM, React, Phaser | Opaque origin, two frames deep | S-01: SecurityError in all engines |
| Page reads WebTown storage, cookies, IndexedDB | Opaque origin | S-01: SecurityError; canaries unchanged |
| Page runs JavaScript | Resident `script-src 'none'` + builder stripping (+ inherited host nonce policy) | S-01: 9 script fixtures, none ran, including nonce guesses |
| Page sends bridge commands | Bus not on `window`; closed message lists; source checks | S-01: forged messages from sibling and resident had no effect |
| Page navigates the WebTown tab, opens popups, dialogs, forms, downloads | Sandbox without those flags | S-01: no navigation, popup or dialog; no form request |
| Page loads remote resources or tracks viewers | Inherited host CSP + resident CSP (`data:` only) + builder | S-01 beacon: no request for 15 static fixtures in any mode |
| Page navigates its own frame elsewhere (exfiltration) | Host `frame-src` narrowed to the navigation page | S-01 beacon: no request, by link, form, refresh or script |
| Page loads WebTown's own pages into its frame | Same narrowing | S-01: no request at WebTown's server |
| WebRTC | Unreachable without script | S-01: **escapes CSP in Chromium if script runs** |
| Page freezes WebTown | No script; 1 MB page limit; Stop | S-01: within limits usable (worst about 2 s delay in Chromium for a heavy animated page); Stop always recovers; a script loop would freeze every engine |
| Page fakes WebTown UI | WebTown chrome is outside the frame | By construction |
| Migration turns old text into code | Generator escapes every field | S-03 tests |

### 16.9 Known limits (to state in Help and steering)

- **Resident JavaScript cannot run in Phase 3a.** Two S-01 results make this a security requirement, not a missing
  feature: WebRTC sends traffic despite CSP (Chromium), and a script loop freezes WebTown in every engine tested.
  Any future JavaScript mode needs its own spike and, before public use, a separate site origin (Phase 3b).
- **A heavy animated page within limits** can delay WebTown by up to about 2 seconds in Chromium while it loads;
  Stop and Close always recover.
- **`preconnect` and `dns-prefetch` were not measurable** (no engine preconnected to the beacon even unrestricted).
  They are removed by the builder and cannot be added without script.
- **Coverage**: Chromium, Firefox and Playwright's WebKit build, headless on Windows. Branded Safari and mobile
  browsers are untested; Playwright's WebKit is not Safari.
- **Not authorisation**: Phase 3a ownership checks remain client-side and can be bypassed with developer tools.
- **What sites cannot do** (WS-16): run JavaScript, use storage or the network, embed other sites, open popups or
  alerts, submit forms.

### 16.10 Site Studio interface

A `WindowFrame` size `full` (the viewport less a small margin) titled "WebTown Site Studio - house-a", opened from the
owner's WebTown Browser by "Open Site Studio" (replacing P3-07's "Edit this website").

```
┌ WebTown Site Studio - House A ───────────────────────────────────────────── [x] ┐
│ File  Edit  View  Help                                                          │
│ [New file] [New folder] [Upload] [Rename] [Delete] │ [Save all]  ● 2 unsaved      │
├───────────────┬──────────────────────────────────┬──────────────────────────────┤
│ EXPLORER      │ index.html ● │ style.css │ cat.gif│ Preview: [index.html v] [⟳] [Auto]│
│ ▾ /           │  1 <!doctype html>               │ ┌──────────────────────────┐ │
│   index.html★ │  2 <html>                        │ │ (sandboxed page, same as │ │
│   style.css   │  3 <head>                        │ │  visitors see it)        │ │
│ ▾ art/        │  4   <link rel=stylesheet ...>   │ │                          │ │
│   gallery.html│ ...                              │ └──────────────────────────┘ │
│   cat.gif     │                                  │ [Stop]                       │
├───────────────┴──────────────────────────────────┴──────────────────────────────┤
│ Saved on this device only · 3.2 MB of 50 MB · revision 14                        │
└──────────────────────────────────────────────────────────────────────────────────┘
```
- Explorer: a `role="tree"` with folders, files, sizes, start page star, unsaved dot; drop target for uploads.
- Editor: tabs; text files open in the `CodeEditor` (SD-3); images open in a viewer showing size, dimensions and the
  path to copy into HTML; fonts and audio show details and a player.
- Preview: `SiteFrame` on the **draft** snapshot (memory only), page picker, Preview (manual), Auto (SD-11, 600 ms), Stop. Resident JavaScript does not run (SD-4); `.js` files open in the editor and are saved.
- File menu also: Set as start page, Start from template..., Site title...; View: Open in WebTown Browser.
- Narrow screens (< 1000 px): Files / Code / Preview tabs.
- Unsaved guard (Close, Escape outside the editor, tab close), the in-window confirmation from P3-07's design, and
  the revision conflict prompt. Escape inside the code editor does not close the window.
- The style is WebTown's grey desktop chrome. Nothing about it is imposed on the resident's pages.

### 16.11 Code editor (SD-3)

| Option | Licence | Size (npm unpacked, approximate) | Fit |
|---|---|---|---|
| `textarea` (no dependency) | - | 0 | Works everywhere, accessible, no highlighting |
| CodeMirror 6 (`@codemirror/*`) | MIT | modular; view package about 1.3 MB unpacked, HTML/CSS/JS language packs tens of KB each; **bundle size to be measured in S-01** | Highlighting, brackets, search, good accessibility; tree-shakable |
| Monaco | MIT | about 100 MB unpacked, needs web workers | Too large for an owner-only feature |
| Ace | BSD-3 | about 58 MB of builds | Large, older design |

Plan (SD-3 as confirmed): a `CodeEditor` interface (`value`, `onChange`, `language`, `readOnly`, focus and undo per
file) with a **textarea** implementation (S-08). CodeMirror 6 may be *evaluated* behind the same interface later
(S-11), but **no runtime dependency exception is approved**; anything adopted would load only in the owner's chunk.

### 16.12 Permissions and boundaries

- `WebsiteApp` gets `siteProjectAccessFor(view, repository)`; a visitor gets `{ mode: 'visitor', reader }`.
- Site Studio is a `React.lazy` chunk imported only in the owner branch, the only place a `SiteProjectWriter` is
  passed. Source tests (as today) fail if anything else imports Site Studio or a writer, or if `SiteFrame`, the
  builder or the host page import storage, composition, ownership, bridge or game code.
- `SiteFrame` is shared by the preview and the visitor view, so both render identically for the same snapshot.
- All of this remains client-side and bypassable; the sandbox is what protects players from page code.

### 16.13 Testing strategy

- **Unit (Vitest, jsdom):** paths, types and signatures, limits; change sets and revisions; the builder (CSP meta,
  base and script come first; every reference kind rewritten; `<base>`, refresh and prefetch removed; resident source
  unchanged; size budget); navigation resolution (`../`, folders, `#`, query, missing); message guards and rate limit;
  migration generator with hostile strings and every field; templates valid against the rules.
- **Storage (fake-indexeddb):** v1 -> v2 upgrade with existing `sites` and `artworks` rows preserved; one contract
  suite for memory and IndexedDB; transactional save (fault injection mid-transaction leaves the old state); revision
  conflict; quota; damaged records skipped and kept; Blob round trip.
- **Components:** Site Studio file operations, tabs, dirty markers, save, conflict, confirmations, uploads with
  refusals, narrow layout, keyboard tree; visitor tree has no writer; preview never writes.
- **Real-browser security suite (SD-10)**, Playwright in Chromium, Firefox and WebKit. S-01 built the first version
  (`spikes/site-sandbox/`, 58 tests per engine, a recording beacon for HTTP, TCP and UDP, positive controls); S-06 moves
  it onto the real host page, navigation page and builder. Fixture sites each try one attack:
  read `parent`/`top` document, `frameElement`; post forged bridge-shaped messages; `localStorage`, `sessionStorage`,
  `indexedDB`, `document.cookie`, `caches`, service worker registration; `fetch`/XHR/WebSocket/EventSource/`sendBeacon`
  to WebTown and to an external test server; external `<img>`, CSS `url()`, `@import`, web font; `top.location`,
  `window.open`, `target=_top/_blank` links, form submit, `alert`/`confirm`/`prompt`, `print`, full screen, pointer
  lock, downloads, clipboard, geolocation; adding a looser `<meta>` CSP or removing WebTown's; navigating the host
  frame; self-navigation to external and to `webtown-site:` URLs (detected and replaced; record whether the request
  was sent); an infinite loop (record whether WebTown stays responsive, per browser); key presses inside the frame do
  not move the player. A local test server records any request that arrives, so "no request" is proven.
- **Boundaries:** source tests that every `sandbox` attribute is exactly `allow-scripts`, no `srcdoc` or `src` is set
  from user input outside the builder and host page, the host page contains no `eval`/`Function`/`innerHTML`, and no
  message handler reaches the event bus.
- **Manual:** checklist in `docs/TESTING.md` (headed browser, real typing, uploads, keyboard, screen reader).

### 16.14 Phase 3b implications (not designed here)

Resident files move to object storage behind the same reader and writer interfaces; pages are served from a separate
registrable domain with HTTP CSP and `sandbox` headers; the server re-validates paths, types, signatures and limits;
quotas per account; moderation and abuse reporting before any public launch; disclosure of the navigation and WebRTC
limits of 16.9 to visitors.
