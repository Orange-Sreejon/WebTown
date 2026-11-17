# Personal Spaces MVP (Phase 3) - Design

Status: **APPROVED (D1-D9 resolved). Implementation in progress on `feature/phase-3-personal-spaces`.** Pairs with `requirements.md` and `tasks.md`.

## 1. Decisions (all approved)

| # | Decision | Approved outcome | Alternatives considered |
|---|---|---|---|
| D1 | **Persistence for 3a.** | IndexedDB behind repository interfaces, labelled "Saved on this device only". Local demo only. | In-memory only (matches layouts, loses everything on reload). localStorage (rejected: base64 images, 5 MB cap). |
| D2 | **Real sharing (3b).** | Do **not** start. Approve the design in section 8 first, as a separate spec `personal-spaces-sharing`. Supabase (Postgres + Storage + Auth, Row Level Security, no server code) is the **preferred provider: architectural approval only**. Nothing of Supabase, authentication or any backend is implemented in 3a; 3b needs its own spec and review. The `@supabase/supabase-js` runtime-dependency exception is **not** approved yet and is decided in that spec. | Cloudflare Workers + R2 + D1 (you write auth); Firebase; manual "publish" of exported files (no auth, not real sharing). |
| D3 | **Steering changes.** `product.md` (Phase 3 is current; localStorage/IndexedDB allowed for 3a) and `security.md` (user-generated content now exists: URL policy, text-only rendering, no `dangerouslySetInnerHTML` stays). | Approved. Must document the 3a local-only limits and the planned 3b security model. Applied in task P3-00. | Leave steering stale (contradicts the code). |
| D4 | **User-facing name "Sketchbook".** Change only the catalogue `label` of the `notebook` type (and the violation text that quotes it). Type key `notebook`, role `notebook`, ids and layouts unchanged. | Approved. Type key, role and furniture identity are preserved. | Keep "Notebook" as the label. |
| D5 | **One dev dependency: `fake-indexeddb`** (exact pin, `npm audit` first) to test the IndexedDB repository in jsdom. **Dev dependency only; it must not appear in the runtime bundle** (imported only from `*.test.ts`; verified by grepping `dist/` after build). No runtime deps. | Approved. | Test only an in-memory implementation and verify IndexedDB by hand (weaker). |
| D6 | **Paint semantics.** Aliased (no anti-aliasing) pixel drawing in a pure-TS raster engine over an RGBA buffer; eraser makes pixels transparent; filled and outline shape tools are distinct tools (a filled shape has no separate outline); fixed 640x480 logical canvas; undo history memory-bounded. | Approved. | Canvas 2D drawing calls (anti-aliased, fill leaves halos, not unit-testable without a canvas package). Classic filled shape = outline in FG + fill in BG (extra colour logic). |
| D7 | **URL policy:** `https:` only; other schemes rejected; safe external-link handling. | Approved. | Also allow `http:` (mixed content, weaker). |
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
    app-bridge.ts            APP_STATE / APP_COMMAND types, guards, emit/on helpers
    event-bus.ts             + 'APP_STATE' | 'APP_COMMAND'
  game/
    config/GameConfig.ts     + reach distance, interact cooldown reuse, paint limits NOT here
    maps/house/object-targets.ts   pure: InteriorDefinition -> InteractionTarget[] (computer, notebook)
    scenes/InteriorScene.ts  + app guard, E handling, freeze/restore, bridge wiring
  personal-spaces/
    access/access-policy.ts          AccessMode = 'owner' | 'visitor'; modeFor(houseId)
    artwork/
      artwork-types.ts               Artwork, ArtworkSummary, input types, limits
      artwork-repository.ts          ArtworkReader, ArtworkWriter, ArtworkRepository (interfaces)
      artwork-validation.ts          title, size, dimension, PNG signature checks
      indexeddb-artwork-repository.ts
      memory-artwork-repository.ts   test double and fallback
      guarded-artwork-repository.ts  wraps a repo; rejects writes for non-owned houses
    website/
      site-types.ts                  SiteContent, SiteTheme, limits
      site-validation.ts             normalise / validate content
      url-policy.ts                  validateExternalUrl (pure)
      contrast.ts                    WCAG ratio (pure)
      default-site.ts
      site-repository.ts             SiteReader, SiteWriter, SiteRepository
      indexeddb-site-repository.ts, memory-site-repository.ts
    storage/idb.ts                   tiny promise wrapper over indexedDB (open, get, put, delete, getAll)
    paint/                           pure engine, no React, no DOM
      pixel-buffer.ts  stamp.ts  line.ts  rect.ts  ellipse.ts  flood-fill.ts
      history.ts  coords.ts  palette.ts  tools.ts  png.ts (canvas <-> blob helpers, DOM-bound)
    composition.ts                   the ONE place that builds repositories (swap point for 3b)
  components/
    apps/AppHost.tsx                 listens to APP_STATE, renders the right app, sends close
    apps/WindowFrame.tsx             shared bevelled window + title bar + focus trap (presentation only)
    website/  SiteWindow.tsx SiteRenderer.tsx SiteEditor.tsx site-styles.ts
    paint/    PaintApp.tsx MenuBar.tsx Toolbox.tsx Palette.tsx StatusBar.tsx
              DrawingSurface.tsx SaveDialog.tsx OpenDialog.tsx ConfirmDialog.tsx
    gallery/  GalleryViewer.tsx (reader only)  GalleryGrid.tsx (reader only)
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

## 6. Website

### 6.1 Data model

```ts
interface SiteContent {
  schemaVersion: 1
  houseId: string
  updatedAt: string                 // ISO 8601
  title: string                     // <= 60
  tagline: string                   // <= 120
  home: { welcome: string }         // <= 2000, plain text, \n\n = paragraph
  about: { body: string }           // <= 4000
  projects: Project[]               // <= 12
  links: LinkItem[]                 // <= 20
  theme: SiteTheme
}
interface Project { id: string; title: string; description: string; url: string | null } // title<=60, desc<=500
interface LinkItem { id: string; label: string; url: string }                            // label<=60
interface SiteTheme {
  preset: 'classic-grey' | 'starfield' | 'pastel' | 'forest' | 'custom'
  background: string                // #RRGGBB
  text: string                      // #RRGGBB
  link: string                      // #RRGGBB
  font: 'serif' | 'sans' | 'mono'   // maps to fixed font stacks in code
  underConstruction: boolean
}
```

Stored in `sites` keyed by `houseId`. IDs inside lists are generated (UUID).
All free text is control-character-stripped and length-capped on write **and** on
read.

### 6.2 Rendering
`SiteRenderer({ content, section, onNavigate })` is pure presentation. Text goes in
as React text nodes; paragraphs split on blank lines. Colours are applied through
CSS custom properties from validated `#RRGGBB` values only; fonts through a fixed map.
Backgrounds are CSS patterns, no image files. Layout uses a header, left `<nav>`,
`<main>`, `<footer>`.

### 6.3 URL policy (`validateExternalUrl`)
Accept only if: `new URL(input)` parses; `protocol === 'https:'`; no
`username` / `password`; length <= 2048; hostname not `localhost`, not ending in
`.local` / `.internal`, not an IPv4/IPv6 literal. Return the normalised
`href` and the `hostname` (punycode form as given by the URL API, so look-alike
domains are visible). Reject everything else with a reason string. Applied on edit
(save is blocked), on load (invalid stored links render inert), and in the renderer
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