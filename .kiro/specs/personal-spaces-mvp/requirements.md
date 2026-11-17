# Personal Spaces MVP (Phase 3) - Requirements

Status: **APPROVED.** Decisions D1-D9 are resolved in `design.md` section 1. Work is on branch
`feature/phase-3-personal-spaces`.

## Overview

Phase 3 gives each house two personal objects:

| Object | Furniture entity (unchanged) | Opens |
|---|---|---|
| Computer | type `computer-desk`, role `computer` | The resident's personal website, built from their own files in **WebTown Site Studio** (revision 2) |
| Notebook | type `notebook`, role `notebook` | **WebTown Paint**, a retro drawing application |

Both open as React overlays on top of the running game. Phaser decides when an
object can be used, freezes the player and restores the room on close. React
renders the WebTown windows and Paint. A resident's website is rendered inside a
sandboxed iframe, never in the WebTown document (WS-15). HTML Canvas does the
drawing. Phaser never draws.

### Supersedes

- Phase 2 FR-05 / "Out of scope": "computer website and notebook application
  belong to Phase 3". They are now in scope, as described here.
- Any notion of the notebook as a text-notes application. **The notebook opens
  WebTown Paint only.** There is no second notebook implementation.

### Preserved from earlier specs

- Phase 2: house entry/exit, exact return position, one reusable interior,
  `HouseConfig`, interaction prompts drawn by Phaser.
- Furniture editor: the computer and the notebook are mandatory, are never in
  the add-catalogue, cannot be removed, and the notebook rests on and moves
  with its support. Item ids and catalogue type keys do not change.
- Ownership stand-in: `canEditHouse(houseId)` (`house-a` by default,
  `?owner=<houseId>` in dev only).
- The typed event bus and `editor-bridge.ts` pattern. The editor bridge is not
  modified.

## Honest status of sharing (read this first)

The repository has **no shared backend, no authentication and no server**.
`HouseLayoutStore` is in-memory; the steering files forbid localStorage and any
backend until approved.

Therefore this MVP is split:

- **Phase 3a (this spec, implementable now):** website and drawings are saved
  **in this browser only** (IndexedDB), behind repository interfaces. This is a
  **local demonstration**. Visitors on other devices or browsers will **not**
  see anything. The UI states this wherever content is saved or listed.
- **Phase 3b (gated, needs approval, separate spec):** real public sharing
  through a shared data source with real authentication and server-side
  authorization. Design and security requirements are in `design.md`
  section 8. Nothing in 3a may claim cross-device sharing works.

"Public within the WebTown experience" in 3a means: any visitor in the same
browser can open any house's gallery and website. It is not public sharing.

## Ownership and permissions

| Capability | Owner (`canEditHouse` true) | Visitor |
|---|---|---|
| Open computer / notebook | yes | yes |
| View website, browse pages | yes | yes |
| Edit website content and look | yes | **no** |
| Open the drawing gallery, view, navigate | yes | yes |
| Export / download a drawing as PNG | yes | yes |
| Create, edit, rename, delete drawings | yes | **no** |
| Draw on a canvas | yes | **no** |

Rules:

1. A visitor never receives an editable canvas, a tool, a menu with mutating
   items, or a writable repository. Read-only is enforced by **types and module
   boundaries**, not by hiding buttons (see design section 5).
2. The write-side repository also refuses calls for a house the local player
   does not own. This is defence in depth for developer mistakes.
3. **All of this is client-side and is not real authorization.** Anyone can open
   devtools or change `?owner=` in a dev build. Real authorization exists only
   in Phase 3b, on the server.

## Functional requirements - interaction (Phaser)

### FR-01 Interactable objects
In every house interior the computer and the notebook are interaction targets,
found by their catalogue `role`, never by a hard-coded position. Moving either
in the furniture editor moves its interaction zone. The notebook's zone follows
its supporting table.

### FR-02 Zones and prompts
- The zone is the object's sprite box grown by `INTERIOR_PROP_REACH_PX` (the same
  distance the layout rules already require the player to be able to reach, so a valid
  layout never leaves an object unusable); the player's **feet** must be inside it.
- Prompts: `E: Use Computer` and `E: Open Sketchbook` (same style as `E: Exit`), drawn by
  Phaser using the existing prompt entity, above the time-of-day overlay.
- If the exit and an object are both in range, the nearest zone centre wins
  (`findNearbyTarget`). The layout rules already keep both objects reachable.

### FR-03 Opening
Pressing a fresh E (not a key repeat) inside a zone, while not in edit mode and
not transitioning, opens the app. No scene change, no page navigation, no reload.
The same key press must not also trigger the exit door.

### FR-04 Freeze
While an app is open: the player halts and ignores input, the prompt is hidden,
the Edit House button is hidden, and the exit E is disabled.
The Phaser keyboard plugin and its global key capture are disabled so that
W, A, S, D, arrows and E reach React text inputs normally.

### FR-05 Restore
On close the player is in the same position, facing and state; the room, colliders
and furniture are unchanged; keys are reset (a key held while the overlay was open
does not count as pressed); key capture is re-enabled; an interact cooldown stops
the closing key press from reopening the app. Closing by button, by Esc, and by
the `close` command all take the same path.

### FR-06 Edit-mode exclusion
The apps cannot be opened during furniture edit mode or a door transition.
The furniture editor cannot be entered while an app is open.

### FR-07 Cleanup
Entering, using and leaving a house repeatedly leaves no extra listeners, timers
or object counts (extends Phase 2 FR-10). Unmounting `GameContainer` while an app
is open closes it cleanly.

## Functional requirements - computer / personal website (WebTown Site Studio)

**Revision 2 (proposed, awaiting review).** The website is no longer a form over fixed sections. A resident's
website is a set of files they write themselves, in the spirit of Neocities, with the variety of the old personal
home pages in the GeoCities archive. These requirements **supersede FR-10 to FR-18** (kept at the end of this file,
marked superseded). Decisions still open are SD-1 to SD-12 in `design.md` section 16.0.

### WS-01 A website is a set of files
A house's website is a project of files and folders: HTML pages, CSS stylesheets, JavaScript files, images
(including animated GIFs), fonts and other supported assets. There is no fixed page structure, no mandatory theme
and no required section. The resident controls structure, layout, typography, colours, backgrounds, navigation,
animation and behaviour.

### WS-02 Pages and the start page
One HTML file is the start page (`index.html` by default; the owner can choose another HTML file). Any number of
other pages can exist, in folders, and link to each other with ordinary relative links (`about.html`,
`art/gallery.html`, `../index.html`, `#section`).

### WS-03 Supported files and limits
Only an allow-list of file types is accepted (design 16.2, decision SD-7). Text files must be valid UTF-8. Binary
files are checked by their content (magic bytes), not only their name; a mismatch is refused with a reason. Limits
on file size, file count, total size, path length and folder depth are enforced on upload and on save, and shown to
the owner before they are hit. Nothing is silently truncated, resized or recompressed.

### WS-04 Paths
Paths are relative, use `/` between folders, and allow letters, digits, `.`, `_` and `-` in each name. `..`, empty
names, leading `/`, `\`, control characters and names differing only by case are refused. Every file has a stable
id, so a rename does not change its identity.

### WS-05 Site Studio
The owner opens **WebTown Site Studio** from their computer: a full-size retro desktop-style window with
- a **file explorer** on the left (folders, files, sizes, the start page marked, unsaved files marked),
- a **source editor** in the middle with tabs for open files (images open in a viewer),
- a **live preview** on the right, rendered exactly as visitors see it,
- actions: New file, New folder, Upload, Rename, Delete, Set as start page, Save all, Refresh preview,
  Start from template,
- a status line with "Saved on this device only", storage used, and the number of unsaved files.
Below 1000 px wide the three panes become tabs (Files, Code, Preview).

### WS-06 Editing source
The owner edits the real text of HTML, CSS and JavaScript files. The editor offers line numbers, Tab to indent, undo
and redo per file, and keyboard save (Ctrl/Cmd+S). Syntax highlighting depends on decision SD-3. WebTown never
rewrites what the owner typed when saving it; transformation happens only when a page is rendered (design 16.4).

### WS-07 File management
New file and New folder (with a starting template per type), Rename and Move (by renaming the path), Delete (with a
confirmation that names the file; deleting a folder lists how many files go with it). Deleting or renaming the start
page requires choosing a new one. Links inside pages are **not** rewritten automatically after a rename; the preview
shows a "page not found" page for broken links.

### WS-08 Uploads
Upload by file picker and by drag-and-drop onto the explorer. Each file is checked (type, content, size, total
budget, name) before it joins the draft; refusals say which file and why. Uploads are part of the draft until Save.

### WS-09 Live preview
The preview shows the current draft (unsaved changes included) without writing anything to storage. It refreshes
automatically shortly after typing stops (decision SD-11) and on demand. JavaScript runs in the preview. The page
shown follows the open HTML file, and links inside the preview move between draft pages.

### WS-10 Save
Save writes all changes (edits, new, renamed, deleted and uploaded files, start page) in **one transaction**: all or
nothing. If the site was changed by another tab since it was opened, Save stops and offers to reload or to save over
it. A failed save keeps the whole draft and says why (full disk, blocked, too large). Closing Site Studio or the
browser tab with unsaved changes asks first.

### WS-11 Starter templates
"Start from template" offers at least: **Blank** (a minimal `index.html`), **Classic home page** (multi-page, the
former structured site), and one single-page creative template. Templates are starting points only: once created,
every file is the owner's to change or delete. Template art and code are original to WebTown (nothing is copied
from the GeoCities archive). Starting from a template over an existing site asks first.

### WS-12 Visitors browse the website
Visitors open the computer and see the resident's site inside the WebTown Browser window. The browser chrome (title
bar, Back, Forward, Home, display-only address `webtown://house-a/art/gallery.html`, status line) belongs to WebTown;
everything inside the page area belongs to the resident. Visitors cannot edit and receive no write capability.

### WS-13 Navigation inside a site
Relative links between the site's own pages work in both the preview and the visitor view. Back, Forward and Home
use WebTown's own history of visited pages. A link to a missing page shows a WebTown "page not found" page with a way
back. Navigation never changes the address or history of the WebTown tab.

### WS-14 Links to other websites
A link to an external `https:` address that passes the URL policy does not open directly. WebTown shows a bar outside
the page, "This page wants to open example.com. Open in a new tab / Cancel", and opens it only when the player
chooses, with `noopener noreferrer`. Other schemes do nothing and are reported in the status line.

### WS-15 Sandbox (mandatory)
Resident HTML, CSS and JavaScript **never execute in the WebTown application document**. Every page is rendered inside
a sandboxed iframe with an opaque origin and a restrictive Content Security Policy (design 16.5 and 16.6), so that a
page:
- cannot read or change the WebTown DOM, Phaser, React state, the event bus or bridge commands;
- cannot read WebTown storage, IndexedDB, cookies, caches or service workers;
- cannot navigate the WebTown tab, open popups, show alert/confirm/prompt dialogs, submit forms, start downloads,
  go full screen, or use camera, microphone, location or similar device features;
- cannot load anything from the network: images, fonts, styles, scripts, frames and requests are limited to the
  site's own files, which WebTown supplies;
- can talk to WebTown only by `postMessage`, and WebTown treats every such message as an untrusted request from a
  closed list (navigate within the site, open an external link after confirmation, report the page title).
The sandbox is never weakened to make a feature work. Its residual limits are documented (design 16.9).

### WS-16 What site code can and cannot do in Phase 3a
Can: any HTML and CSS, animations, transitions, canvas, SVG, audio from the site's files, JavaScript that changes the
page and responds to the player. Cannot (documented to the owner in Site Studio's Help): use browser storage, load
external images/fonts/scripts or embed other sites, call the network, open popups or alerts, submit forms, use
workers, import JavaScript modules from other files, or fetch the site's own files from JavaScript (decision SD-12).

### WS-17 Existing structured websites are migrated, not lost
A house that has a valid structured website from P3-05/P3-07 keeps it. Until the owner saves a project, visitors and
the owner see it converted, in memory, to the Classic template files. Opening Site Studio starts from that converted
version with a note that nothing is saved until Save. The original structured record is **never modified or
deleted** by this phase. A damaged structured record is not converted; the owner is told, and it is kept.

### WS-18 Ownership
Unchanged rule: the app bridge's `mode` decides. Owners get read and write capability; visitors get read capability
only. Site Studio and any writer are never imported, created or passed into a visitor's component tree. Phase 3a
checks are client-side and can be bypassed with developer tools; the sandbox, by contrast, protects the player from
the page whoever wrote it.

### WS-19 Storage and quota
Websites persist in IndexedDB on this device only. Site Studio shows the site's size against its limit and, where the
browser reports it, the space left. A save that would exceed a limit or the browser quota is refused with the reason,
and the draft is kept.

### WS-20 Accessibility
Site Studio: every control is a labelled button or field; the explorer is a keyboard tree (arrows, Enter, F2 to
rename, Delete); focus is always visible; Tab inside the code editor indents and Escape then Tab leaves the editor
(explained in Help); status and errors are announced. The page frame has a title naming the site and page. WebTown
cannot make a resident's page accessible; templates are written to be accessible examples.

### WS-21 Failure and recovery

| Case | Behaviour |
|---|---|
| A page or asset referenced by a page is missing | Missing assets render as missing (broken image); missing pages show "page not found" |
| A page is too large to render (design 16.4 budget) | WebTown error page in the frame naming the size; Site Studio shows which files are largest |
| A page tries to navigate the frame elsewhere | WebTown replaces the frame with a notice and reloads the last good page (design 16.9: the request may already have left) |
| A page floods WebTown with messages | Messages over the rate limit are dropped and the status line says so |
| A page's script runs forever | Close and Stop remain available where the browser isolates the frame; otherwise a documented limit (16.9) |
| A stored file record is damaged | That file is skipped and listed for the owner; nothing is deleted |
| The project changed in another tab | Save stops with Reload / Save anyway |
| Save fails (quota, blocked, abort) | Draft kept, reason shown, Retry |
| Upload refused | The file and the reason are named; other files in the same upload continue |
| IndexedDB unavailable | In-memory project, "Not saved" notice (as P3-05) |

### WS-22 Independence
The website renderer and Site Studio do not import WebTown Paint, the artwork modules or Phaser, and vice versa.
## Functional requirements - WebTown Paint

### FR-20 Window and visual language
Recreate the *general* classic desktop-paint look, original artwork only, no
Microsoft names, logos, icons or fonts:
grey application background with bevelled controls, blue title bar with title
`<drawing title> - WebTown Paint` and minimise / maximise / close controls, a
menu bar, a left toolbox (two columns of tool buttons with a tool-options box
under it), a central canvas area, a colour palette along the bottom with
foreground / background indicator, a status bar.
The canvas sits on a **CSS** checkerboard that shows transparency. The checkerboard
is never drawn into the bitmap and is never part of the exported PNG.
**The reference screenshot is `inspiration-art/paint-reference.png` (local-only, git-ignored development reference; never committed or shipped; design.md section 12).** Menus are File, Edit, Image, Options, Help (View is omitted: its items are out of scope).

Window controls: Close closes Paint (with the unsaved-changes prompt).
Maximise toggles fill-screen. There is nothing to minimise to, so the minimise
button is drawn for the look but is disabled (`aria-disabled`, tooltip "Not
available"). The reference shows all three buttons, so all three are drawn.

### FR-21 Responsive layout
The window scales to the viewport (margin on large screens, full-screen below
700 px width). The canvas keeps its aspect ratio (4:3), is centred, and is scaled
by CSS to fit the area. At or above 1x the browser uses nearest-neighbour
(`image-rendering: pixelated`) so pixels stay crisp; below 1x it uses default
smoothing. If the area is smaller than the minimum canvas size it scrolls.

### FR-22 Canvas
Fixed logical size **640 x 480** for the MVP (stored with every drawing as
`width` and `height`; the data model supports others). New drawings start fully
transparent.

### FR-23 Tools (MVP)
Pencil (1 px), Brush (adjustable size), Eraser (adjustable size, makes pixels
**transparent**), Fill bucket, Line, Rectangle (outline), Filled rectangle,
Ellipse (outline), Filled ellipse, Eyedropper, and **Clear canvas** (a command in
the menu, not a tool). No selection, text, curve, polygon, spray, zoom or layers.

Semantics:
- Left button draws with the foreground colour, right button with the background
  colour. Touch and pen use the foreground colour.
- Outline shapes use the current line width. Filled shapes are filled with the
  drawing colour and have no separate outline. (Simplification; see D6.)
- Drawing is **aliased** (no anti-aliasing) so Fill is exact and output is crisp.
- Fill uses exact RGBA match of the clicked pixel, 4-connected, on the bitmap.
- Eyedropper sets the colour from the clicked pixel. A transparent pixel is
  reported as "transparent" and does not change the colour. After picking, the
  previous tool is re-selected (classic behaviour).

### FR-24 Colours
Classic 28-colour palette, plus a custom colour via a native colour input
(opaque RGB). Left-click a swatch sets foreground, right-click sets background.
Each swatch has an accessible name (for example "Red, #FF0000").

### FR-25 Brush sizes
Brush and eraser: 1, 2, 4, 6, 8, 12 px (config). Line and outline shapes use the
same width control. Pencil is always 1 px.

### FR-26 Pointer input
Pointer Events (`pointerdown / move / up / cancel`) with pointer capture, so
mouse, pen and touch work. The browser's touch scrolling and context menu are
disabled on the canvas only. The pointer-to-bitmap conversion uses the canvas's
current bounding box and scale and floors to a pixel, so it is correct at any
CSS size. Events outside the bitmap are clipped: nothing is ever drawn outside the
canvas bounds. A stroke that leaves and re-enters the canvas continues.
Coalesced events are used where available and consecutive samples are joined by a
line so fast strokes have no gaps.

### FR-27 Undo / redo
One completed stroke, shape, fill or clear is **one** undo step. Shapes show a
rubber-band preview on a separate overlay canvas and are committed on
pointer-up. `pointercancel` or Esc during a stroke reverts that stroke and records
nothing. Undo and redo are bounded (30 steps, config), cleared on New / Open, and
available through the menu, buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Y (Ctrl+Shift+Z).

### FR-28 Documents
- **New:** blank transparent drawing. If there are unsaved changes, ask Save /
  Discard / Cancel first.
- **Save:** creates a drawing on first save (asks for a title, default
  "Untitled"), otherwise updates it.
- **Open:** a gallery dialog lists this house's drawings (thumbnail, title, date);
  choosing one opens it.
- **Rename:** edits the title (1-60 characters after trimming).
- **Delete:** deletes the open or selected drawing after a confirmation naming it.
- **Export PNG:** downloads the bitmap exactly as drawn, transparency preserved,
  filename `<slug-of-title>.png`.
- Closing, New and Open all share one unsaved-changes guard. The tab-level
  `beforeunload` warning is shown while a drawing is dirty.
- Limits (config): 50 drawings per house, 2 MB per stored image.

### FR-29 Status bar
Shows the hint for the hovered tool/menu item, the pointer coordinate in bitmap
pixels while over the canvas, the canvas size, and the save state
("Saved on this device only", "Unsaved changes", "Save failed").

### FR-30 Keyboard
Menus, toolbox, palette, dialogs and window controls are operable by keyboard.
Shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+N, Ctrl+O, Esc (cancel stroke, else close
dialog / menu, else request close). Drawing itself is pointer-only (documented).

## Functional requirements - drawing gallery (visitors and owner)

### FR-40 Gallery
Any player can open the notebook and see the house's saved drawings as a grid.
The owner additionally gets Paint (a way to create and edit). A visitor gets the
**read-only viewer** and nothing else.

### FR-41 Viewer
Shows one drawing at a fit-to-window size on the checkerboard, with title,
dimensions, date, Previous / Next (wrapping, disabled for one drawing), a
position indicator ("3 of 12"), Export PNG and Close. Esc closes. Left / Right
arrows navigate.

### FR-42 Empty and error states
No drawings: "No drawings yet." (owner also sees "Start a new drawing"). A drawing
whose image cannot be decoded shows a placeholder with its title; the owner may
delete it.

### FR-43 Read-only guarantee
The viewer module, the gallery module used in visitor mode, and everything they
import can only reference `ArtworkReader`. No mutation function is importable
there (design 5.2). A test fails the build if that changes.

## Persistence requirements (Phase 3a)

### FR-50 Repository abstraction
UI code depends on `ArtworkReader` / `ArtworkRepository` and
`SiteReader` / `SiteRepository` interfaces only. Swapping the storage provider in
Phase 3b changes one composition file.

### FR-51 Local storage
IndexedDB database `webtown` (version 1) with object stores `artworks` and
`sites`. Image data is stored as a PNG `Blob`, not base64 and not in localStorage.
If IndexedDB is unavailable (private mode, blocked, quota), the app falls back to
an in-memory repository, shows a persistent banner "Not saved: changes will be lost
when you close this tab", and never silently loses data.

### FR-52 Honest labels
Every place that shows saved content in 3a carries the text "Saved on this device
only". No UI string, doc or comment may imply other devices can see the content.

### FR-53 Identity
Every drawing has a stable id (UUID), a `houseId`, `title`, `width`, `height`,
`createdAt`, `updatedAt`, `schemaVersion`, and the image. Ids never change on
rename or edit. Ids are not derived from titles.

### FR-54 Furniture layouts unchanged
This phase does not change `HouseLayoutStore` (still in-memory). Note: after a
reload drawings and website survive while the furniture layout resets. This
inconsistency is known and documented (D8).

## Failure and recovery

| Case | Required behaviour |
|---|---|
| IndexedDB unavailable or blocked | In-memory fallback, banner, nothing crashes |
| Save fails (quota, transaction abort) | Canvas and dirty state kept, error in status bar and dialog, Retry available |
| Delete fails | Drawing remains listed, error shown |
| Stored image fails to decode | Placeholder tile, can be deleted (owner), viewer shows message |
| Record deleted elsewhere (second tab) while open | Next save re-creates it as a new drawing after telling the user; no silent overwrite |
| Corrupt or unknown `schemaVersion` | Record skipped from the list with a console warning; never rewritten |
| Invalid website data on load | Fall back to default content, owner told, bad data not overwritten until they save |
| Export fails (`toBlob` returns null) | Error message, no empty file |
| Closing with unsaved drawing | Save / Discard / Cancel |
| Pointer cancelled, window blur or Esc mid-stroke | Stroke reverted, no history entry |
| Viewport resize mid-stroke | Mapping recomputed per event; stroke continues correctly |
| Phaser scene torn down while app open | React closes the app; no orphan listeners |
| `crypto.randomUUID` missing | Fallback id generator with the same format |

## Accessibility

- Real `<button>`, `<a>`, `<input>`, `<dialog>`-style semantics. Visible focus on
  every control. Windows are `role="dialog"` with `aria-modal` and a labelled title;
  focus moves in on open, is trapped, and returns to the game container on close.
- Menu bar follows the menubar pattern (arrow keys, Esc, Home / End).
- Toolbox is a `radiogroup`; palette swatches have colour names; selected state is
  exposed with `aria-checked` / `aria-pressed`, never by colour alone.
- The drawing canvas is `role="img"` with a label ("Drawing canvas, 640 by 480").
  Pointer-only drawing is a documented limitation; viewing, titling, saving,
  exporting and gallery browsing are fully keyboard operable.
- Status and error messages use `aria-live="polite"` / `role="alert"`.
- Text contrast of UI chrome >= 4.5:1; the website editor enforces it for user
  colours.
- External links announce "opens in a new tab".
- Gallery images have `alt` = title. Decorative checkerboard and banners are
  `aria-hidden`.
- `prefers-reduced-motion`: no animation exists in the MVP; nothing to suppress.

## Non-functional requirements

- **NFR-01 Separation:** Phaser <-> React only through typed bridge events. React
  never touches a Phaser object; no Phaser object enters React state.
- **NFR-02 No Phaser drawing:** Paint tools are not implemented in Phaser.
- **NFR-03 Independence:** website, Paint and artwork modules do not import each
  other (test enforced). Both depend only on `access` and their own repositories.
- **NFR-04 Dependencies:** no new runtime dependency unless an exception is approved (decision SD-3 asks about a
  code editor for Site Studio, owner-only and loaded on demand). IndexedDB is wrapped by hand.
  One dev dependency (`fake-indexeddb`, D5) is approved. It is dev-only and must not appear in the runtime bundle.
- **NFR-05 Security:** the WebTown application never interprets user content: no `dangerouslySetInnerHTML`, no
  `eval`, no user HTML or script in the WebTown document, and user strings shown by WebTown's own UI (file names,
  page titles, messages) are React text. Resident websites run only inside the sandbox of WS-15. Validation at
  every repository boundary and on read. See `.kiro/steering/security.md` (updated in task S-00).
- **NFR-06 Performance:** a 640x480 stroke stays within a frame budget: only the
  dirty rectangle is re-uploaded; undo snapshots are bounded (30 x 1.2 MB).
- **NFR-07 Code conventions:** strict TypeScript, no `any`, explicit return types,
  magic numbers in config, kebab-case modules, co-located tests.
- **NFR-08 No regression:** town movement and collisions, house entry and exit,
  furniture placement, Save / Cancel, owner / read-only rules, event bridge,
  day/night, and Phaser/React lifecycle behave as before.

## Out of scope

Multiplayer, voice, guestbooks, comments, likes, feeds, web rings, site gallery, layers, animation (in Paint),
selection tools, text tool, zoom, image import (in Paint), advanced drawing tools, a drag-and-drop visual website
builder, server-side code, external network access from sites, embedding other websites, property ownership, world
building, moderation tooling, real accounts and publishing (Phase 3b prerequisites, not delivered here).

Revision 2 moves **user-authored HTML, CSS and JavaScript into scope**, only inside the sandbox of WS-15.

## Acceptance criteria

1. In any house, standing at the computer shows `E - Use Computer`; E opens the
   website overlay; the player cannot move; typing in an input works; closing
   restores position, facing and room exactly.
2. The same holds for the notebook with `E - Open Sketchbook` and WebTown Paint
   (owner) or the read-only gallery (visitor).
3. In `house-a` the owner can build the site in Site Studio (create, edit, upload, rename, delete files, save) and
   draw, save, reopen, rename, delete and export drawings. In `house-b` none of those controls exist and no writable
   repository is reachable from the component tree.
4. Website navigation never changes the WebTown tab's URL or history; an external link opens a new tab only after
   the player confirms, with `noopener noreferrer`; other schemes do nothing.
4a. Every security fixture in design 16.13 fails to reach WebTown's DOM, storage, cookies, bridge, network, top
   navigation, popups and forms, in every supported browser, and the parent stays usable.
4b. A structured website saved before revision 2 is still shown after the upgrade and its original record is
   unchanged.
5. The exported PNG of a half-drawn canvas has fully transparent pixels where
   nothing was drawn and no checkerboard.
6. One stroke, shape, fill, or clear equals one undo step; redo restores it.
7. Clicking at the canvas's four corners at three CSS sizes produces pixels
   (0,0), (639,0), (0,479), (639,479).
8. Reloading the page keeps website and drawings (IndexedDB) while the furniture
   layout resets, and the UI says "Saved on this device only".
9. Visitor-mode components cannot reach a write function through imports or
   props (tested). Someone using devtools can still bypass this; Phase 3a is not
   real authorization and the docs say so.
10. All existing tests pass; `npx tsc -b`, `npm test`, `npm run build` are green.
11. No UI text, doc or code comment claims cross-device sharing in 3a.
12. Paint matches the reference screenshot in layout and visual language, within the MVP
    tool set.
13. `dist/` contains no `fake-indexeddb` code.
14. Steering files document the 3a local-only limits, that client-side restrictions can be
    bypassed with developer tools, and the planned 3b security model.

## Appendix - superseded form-based website requirements (FR-10 to FR-18)

Superseded by WS-01 to WS-22 (revision 2). Kept for history and because the migration in WS-17 reads data
that was created under these rules.

### FR-10 Window
A browser-like window overlays the game: title bar, back / forward / home buttons,
a **display-only** address bar (`webtown://house-a/about`), a content area, a
status line. It is not a real browser: there is no typing into the address bar.

### FR-11 Sections
Home, About, Projects, Links. Navigation stays inside the overlay, using in-memory
state. It must not change `window.location`, the hash or the history stack, and
must not disturb the `?owner=` parameter. Back / forward move through in-overlay
history.

### FR-12 Look and feel
Late-1990s / early-2000s personal page: header banner, left navigation column,
tiled or patterned background, bordered content boxes, visible hyperlinks, a
footer with "last updated". No SaaS dashboard styling. Built from CSS only. No
copied logos, no external images, no external fonts. No fake visitor counter.

### FR-13 Content (owner customisable)
Per house: site title, display name, tagline, home welcome text, about text, a list of
projects (title, description, optional link), a list of links (label, URL). Plain text only.
Paragraphs are separated by blank lines. No HTML, markdown, scripts or styles from the user;
text that looks like HTML (`<script>alert(1)</script>`) is accepted and shown literally, as characters, never
interpreted. Required: title, display name and welcome text. Limits are in design 6.1.

### FR-14 Appearance (owner customisable, bounded)
Theme preset (four, plus custom), background, text, link, banner and banner-text colours,
font family from a fixed allow-list of three stacks, a background pattern from a fixed list,
and an optional decorative "under construction" banner. Text and links must meet 4.5:1
against the background and the large banner title 3:1 (WCAG AA); the editor shows the ratio
and refuses to save below it.

### FR-15 Owner editing
In the owner's house an **Edit page** button switches the content area to a form
with live preview and Save / Cancel. Save is one validated write; Cancel discards.
Visitors see no such control and receive no writable repository.
Implemented in P3-07 (design section 15): the control is labelled "Edit this website"; Cancel and Close ask
before discarding a dirty draft.

### FR-16 External links
A link is rendered as a real anchor only if it passes the URL policy (design
section 6.3): `https:` only (an explicit port from 1 to 65535 is allowed), no credentials, bounded length, no
localhost / private / IP-literal hosts. Valid links open with `target="_blank"` and
`rel="noopener noreferrer"`, and show the host name beside the label. Invalid
links are rendered as inert text and are rejected when the owner tries to save.
Internal navigation is never an anchor to another page.

### FR-17 Defaults
A house with no saved site shows a generated default ("Welcome to House A") with
placeholder text, so every house has something to browse. Defaults are not stored.

### FR-18 Independence
The website renderer (`SiteRenderer`) takes data and a mode and has no import of
anything under the Paint or artwork modules, and vice versa (enforced by a test).
