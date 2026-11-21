# WebTown Phase 1 — Manual Browser Testing Checklist

Run `npm run dev` and open http://localhost:5173 in Chrome or Firefox.
Append `?debug=1` to the URL to show Arcade physics collision bodies.

---

## Loading

- [ ] Loading screen appears immediately on page load ("WebTown / Loading…")
- [ ] Loading screen disappears and game canvas appears (< 3 seconds locally)
- [ ] No errors in browser DevTools console during or after load

## Rendering

- [ ] Town is visible — green grass fills the entire background
- [ ] A horizontal dirt road runs across roughly the middle of the map
- [ ] A vertical dirt road runs down roughly one-third from the left
- [ ] Road edges have a lighter pavement tile visible along each side
- [ ] At least two houses are visible (one small, one wider)
- [ ] A church building is visible (similar size to House 2)
- [ ] Multiple trees are scattered around the map
- [ ] A water/lake area is visible in the lower-right quadrant
- [ ] Grass detail tiles are scattered around grass areas
- [ ] Pixel art is crisp — no blurring on tiles or character sprite

## Player Character

- [ ] A character sprite is visible at game start
- [ ] The character shows the front-facing standing frame when stationary
- [ ] The character is 2× the base tile size (appears as ~64×96 screen pixels)

## Movement — WASD

- [ ] W key moves the character upward on screen
- [ ] S key moves the character downward
- [ ] A key moves the character left
- [ ] D key moves the character right
- [ ] W + D held together moves diagonally up-right
- [ ] S + A held together moves diagonally down-left
- [ ] Releasing all keys stops the character immediately

## Movement — Arrow Keys

- [ ] ↑ arrow key moves the character upward
- [ ] ↓ arrow key moves the character downward
- [ ] ← arrow key moves the character left
- [ ] → arrow key moves the character right
- [ ] One WASD + one arrow key simultaneously produces combined movement

## Animation

- [ ] Walking down shows the down-facing walk cycle
- [ ] Walking up shows the up-facing walk cycle
- [ ] Walking left shows the left-facing walk cycle
- [ ] Walking right shows the right-facing walk cycle
- [ ] Idle after walking down shows front-facing standing frame
- [ ] Animation does not flicker or stutter during normal movement
- [ ] Walk animation loops smoothly

## Frame-Rate Independence (approximate check)

- [ ] Hold right for ~3 seconds, note distance covered
- [ ] The character appears to move at a consistent speed
- [ ] Diagonal movement covers roughly the same distance per second as straight movement

## Camera

- [ ] Camera follows the player as it moves
- [ ] Walking to the left edge: camera stops showing black/void, player can reach the edge
- [ ] Walking to the right edge: same
- [ ] Walking to the top edge: same
- [ ] Walking to the bottom edge: same

## Collision — Buildings

- [ ] Walking into House 1 from any side stops the player at the wall
- [ ] Walking into House 2 from any side stops the player
- [ ] Walking into the Church from any side stops the player
- [ ] The player can slide along the wall of a building (not get stuck in a corner)

## Collision — Trees

- [ ] Walking into a tree stops the player (at the trunk)
- [ ] The player cannot pass through any tree on the map

## Collision — Map Boundary

- [ ] Walking to the left edge: player stops, cannot go further left
- [ ] Walking to the right edge: player stops, cannot go further right
- [ ] Walking to the top edge: player stops, cannot go further up
- [ ] Walking to the bottom edge: player stops, cannot go further down

## Physics Debug Mode (append `?debug=1` to URL)

- [ ] Coloured rectangles are visible on houses, trees, and water barrier
- [ ] The player's physics body (small rectangle near feet) is visible
- [ ] The body positions visually match the collision behaviour observed above

## Lifecycle

- [ ] Navigating away (new tab) and returning: no duplicate canvas elements in DOM
- [ ] Refreshing the page: game loads cleanly again, no console errors

---

## Known Limitations (Phase 1)

- Trees are drawn at DEPTH_STRUCTURE — the player walks in front of tree trunks but
  behind the full tree sprite is not yet implemented (canopy layering is a Phase 2 task).
- No NPC movement, dialogue or sound. (The day/night cycle and Halloween night
  mode were added after Phase 1 — see `docs/ASSETS.md` for their dev overrides.)
- Water area is decorative — the player is blocked by an invisible barrier at the water edge.

---

# Phase 2 — Houses & Interiors

Needs the interior art in `public/assets/interior/` (not in version control —
see `docs/ASSETS.md`, Asset Pack 7).

## Entrances

- [ ] Walk up to any of the seven houses: a small `E: Enter` label appears just
      above the doorway, not over the door itself
- [ ] Walk away: the prompt disappears; only one prompt is ever visible
- [ ] The church shows no prompt and pressing E there does nothing
- [ ] At night (`?time=22:00`) the prompt is still readable above the dark overlay

## Entering

- [ ] E fades out and into the room; holding E does not bounce straight back out
- [ ] The player appears one tile in front of the door, facing down, with **no**
      prompt showing yet; walking up to the door shows `E: Exit` above it

## Room framing (check at each size; use DevTools device toolbar or resize the window)

- [ ] About 1280×720 canvas: zoom 3, room (with brick border) about 66% of the
      width, nothing clipped. A shorter browser window (tabs/toolbars) drops to
      zoom 2 rather than clipping
- [ ] About 1920×1080 canvas: zoom 4, room about 58% of the width, nothing clipped
- [ ] Pixels stay sharp (no blur or uneven pixel sizes) at both sizes
- [ ] Resizing the window while inside re-fits the room without a reload
- [ ] Brick border on the left, right and bottom; soft shadow under the skirting
      board and along the inner edges of the floor

## The room

- [ ] Floor, back wall, door, two curtained windows, painting and clock are visible
- [ ] Bed, nightstand with lamp, chest, bookshelf, rug, table with books and a
      sketchbook, chair, three plants, and the large computer desk are visible
- [ ] The computer and sketchbook do nothing when approached (Phase 2 only; since Phase 3 they open apps, see the Phase 3a checklist)
- [ ] Back wall, bed, nightstand, chest, bookshelf, plants, table, chair and the
      computer desk all block the player; the room's edges block the player and
      the player never walks onto the brick border
- [ ] The rug can be walked over
- [ ] Walking behind/in front of the table, chair, bed and plants layers correctly
      (feet decide who is in front); items on the table stay above the table
- [ ] The whole floor can be reached; the corridor from the start point to the
      door is always clear

## Leaving

- [ ] At the door, E fades back to the town
- [ ] The player is at exactly the spot they entered from, facing the same way,
      with the camera where it was, and does not drift after returning
- [ ] Holding a movement key through the transition does not make the player slide
- [ ] Pressing E again immediately does nothing; after a moment it re-enters
- [ ] The town clock did not advance while inside, and runs again outside
- [ ] With `?time=22:00&timeFrozen=1` the clock is still frozen after a visit
- [ ] Pumpkins, lamps, window glow and bats behave as before at night

## Robustness

- [ ] Enter and leave ten times: no slowdown, no duplicate prompts
- [ ] Rename `public/assets/interior/` and press E at a door: the screen flashes
      and the player stays in the town, still playable
- [ ] Enter, leave and enter again while holding a movement key: no stuck input

## Art playground

`/interior-test.html` (dev server only) shows the Milestone 0 art comparison.
It is not part of the production build.

# Furniture Editor MVP

Spec: `.kiro/specs/furniture-editor-mvp/`.

> **Changes are lost after a reload.** Layouts are kept in memory only (the
> in-memory `HouseLayoutStore`). Leaving and re-entering a house keeps your
> saved layout for the session; reloading the page resets every house to the
> default room. There is no localStorage, account or backend yet.

Your house is `house-a` (`src/game/config/ownership.ts`). In `npm run dev`,
`?owner=house-c` makes another house yours for testing; production builds
ignore it.

## Ownership

- [ ] In house A an **Edit House** button shows at the top right; walking still works
- [ ] In any other house there is no button and nothing can be edited
- [ ] The button disappears while leaving through the door

## Edit mode

- [ ] Edit House opens a panel on the right; the player stands still and E does not open the door
- [ ] A faint grid covers the room; the doorway and the spot inside it are shaded blue ("keep clear")
- [ ] At 1280×720 the panel does not cover the room; "Changes are kept only until you reload the page" is visible without scrolling
- [ ] "Hide" collapses the panel to Save / Cancel / status; "Show" brings it back

## Select and drag

- [ ] Clicking furniture outlines it in yellow and names it in the panel; bare floor clears it
- [ ] Clicking the sketchbook on the table selects the sketchbook, not the table; the door cannot be selected
- [ ] A click without moving only selects; dragging moves a preview that snaps to the 16px grid
- [ ] A free spot shows green with "This spot is free"; dropping moves the item there
- [ ] Over the bed it shows red with "Overlaps the bed"; dropping puts it back where it was
- [ ] In the doorway: "Blocks the way to the door"; on the spot inside the door: "Blocks the spot inside the door"
- [ ] Dragged outside the room: "Doesn't fit on the floor here"; a picture dragged onto the floor: "Must hang on the back wall"
- [ ] Esc during a drag cancels it
- [ ] Dragging the table carries the sketchbook and the books with it
- [ ] The sketchbook dragged over the floor is red ("Must rest on a table or nightstand"); over the nightstand it is green and lands there

## Add and remove

- [ ] Choosing Stool in the catalogue marks it pressed; a ghost follows the pointer, green or red; clicking a green spot places and selects it
- [ ] Esc, or choosing Stool again, stops placing
- [ ] Adding two stools names them `stool` and `stool-2`
- [ ] The catalogue never offers the computer or the sketchbook
- [ ] Remove (or the Delete key) removes the selected chest
- [ ] With the computer or sketchbook selected, Remove is disabled and says why
- [ ] With the table selected, Remove is disabled ("Move the sketchbook and the books off it first"); after moving both to the nightstand it can be removed

## Save and cancel

- [ ] Save is disabled until something changes
- [ ] Save returns to walking; the new furniture blocks the player and sorts in front/behind correctly
- [ ] If furniture was placed where the player stood, the player appears inside the door after saving
- [ ] Cancel discards every change since Edit House was pressed
- [ ] Leave and re-enter house A: the saved layout is still there; other houses are unchanged
- [ ] Reload the page: house A is back to the default room

## Regression

- [ ] Enter/exit, exact return position, clock pause and Halloween night mode work as before

## Known limitation

At a 1920×1080 window the interior is drawn at 4.5 screen pixels per art
pixel. `Scale.EXPAND` stretches the 1280×720 canvas by 1.5 with CSS, on top of
the interior's ×3 camera zoom, so pixels are slightly uneven at that size. This
predates the editor (see the Phase 2 camera work) and is tracked separately.

# WebTown Phase 3a — Personal Spaces Manual Checklist

Phase 3a is a **local demonstration**: website and drawings are saved in this
browser's IndexedDB only. Other devices and browsers cannot see them.
Client-side owner / visitor restrictions can be bypassed with developer tools.

Sections are added task by task (see `.kiro/specs/personal-spaces-mvp/tasks.md`).
The full checklist is completed in task P3-17.

## Interaction and freeze (P3-02)

Automated in Vitest: object targets, open/close session, key gate, and Phaser's real keyboard
manager (W A S D E arrows Space reach a text field while an app is open).

Manual, in the browser (1280x720), owner house `house-a` and a visitor house `house-b`:

- [ ] Stand at the computer: prompt `E: Use Computer`. At the sketchbook: `E: Open Sketchbook`.
- [ ] E opens a placeholder window over the game; the room stays visible behind it.
- [ ] The title shows Computer or Sketchbook; house and mode are right (owner in `house-a`,
      visitor in `house-b`; `?owner=house-b` swaps them in dev).
- [ ] Hold a movement key while pressing E: the player does not move while open.
- [ ] In the "Typing test" field type `wasd e` and use the arrow keys: all arrive.
- [ ] E, or E held down, while open does not leave the house or open anything else.
- [ ] Esc, the Close button and clicking Close twice quickly all close it once.
- [ ] After closing: same position and facing, prompt back, WASD and arrows move the player,
      the player does not walk by itself, E at the door still exits.
- [ ] The Edit House button is hidden while an app is open and back after.
- [ ] In furniture edit mode E opens nothing; Save and Cancel still work.
- [ ] Open and close 20 times: nothing changes; walk out, back in, and repeat once.
- [ ] Move the table in the furniture editor: the Sketchbook prompt follows it.
## Website: HTML/CSS Site Studio (`.kiro/specs/website-studio/`)

Automated in Vitest: the project rules (names, limits, image signatures), the markup check, templates and the
migration of every old field with hostile strings, the page builder (every removal and rewrite), storage v2 (upgrade
keeps v1 data, one transaction per save, conflicts, damaged records, house isolation, fault injection), the host
message guards, `SiteFrame`, the Studio (pages, images, save, conflict, layouts, leaving), CodeMirror in jsdom, and
the import boundaries (visitor code cannot reach the Studio, writers, storage or CodeMirror).

Automated in real browsers: `npm run test:e2e` (Playwright: Chromium, Firefox and WebKit; starts the Vite dev server
on port 5180 and a beacon on 8766). It opens the website window with the same app-bridge message Phaser sends and
checks: an owner builds a grid-based zine from Blank with an uploaded animated GIF, a second page and a phone-width
media query; Save; reload; a visitor sees the same page and can follow links; external links ask first; another
house is untouched; a hostile page (scripts, handlers, refresh, base, forms, frames, `@import`, fonts, `ping`,
prefetch) sends nothing to the beacon and cannot reach WebTown; a visitor never downloads the Studio or CodeMirror.
Playwright's WebKit is not branded Safari; Safari and mobile browsers are untested.

Manual, in a headed browser, owner `house-a`, visitor `house-b` (or `?owner=house-b`):

- [ ] At the computer, E opens "WebTown Browser". With nothing saved: "Nothing here yet" and, for the owner,
      Blank website and Classic personal homepage. A visitor sees only "Nothing here yet".
- [ ] Blank opens the Site Studio: name, status ("Not saved yet"), Save, Split / Code / Preview, Desktop / Phone,
      Refresh, Auto, Start over, Exit; Pages, `style.css` and Images on the left; HTML editor and preview.
- [ ] The editor highlights HTML and CSS, shows line numbers and indents new lines; Tab indents; Escape then Tab
      leaves the editor; Ctrl+Z / Ctrl+Y undo and redo; Ctrl+F searches; Ctrl+S saves.
- [ ] Typing updates the preview about half a second later; with Auto off, only Refresh does.
- [ ] New page (type `about`: it becomes `about.html`), Rename, Set as homepage (star), Delete (asks; the last page
      cannot be deleted). Unsaved pages have a dot.
- [ ] Upload a PNG, a JPEG, an animated GIF, a WebP and an SVG (button and drag and drop): each shows as
      `assets/<name>`; Copy path, Insert (`<img>` in HTML, `url()` in CSS); Delete warns where it is still used.
      A text file renamed `.png`, a file over 5 MB and an unknown type are refused with a reason.
- [ ] A link in the preview to another page switches the Studio to it; `#section` links scroll within the page.
- [ ] Save, Exit, reload the tab, open the computer again: the website is the same. As a visitor it is the same page.
- [ ] An external `https://` link asks "Open it in a new tab?" in WebTown's own bar; Open uses a new tab; Cancel does
      nothing. `javascript:` and `http://` links do nothing.
- [ ] Two tabs: save in one, then in the other: "Saved somewhere else" offers Keep editing, Load the other version
      and Save mine anyway.
- [ ] Close, Escape (outside the editor) or Exit with unsaved changes asks "Leave without saving?"; closing the
      browser tab asks too.
- [ ] Start over offers Blank or Classic and keeps the images.
- [ ] A house with an old (form-based) website shows it converted, with a note; Open Site Studio and Save keep it;
      the old `sites` record in DevTools > IndexedDB is unchanged.
- [ ] Damage the `siteProjects` record in DevTools: the owner is told it can't be read and is offered a fresh start;
      the visitor sees "This website can't be shown right now"; nothing is deleted until the owner saves.
- [ ] In a private window with storage blocked: "Not saved: changes will be lost when you close this tab."
- [ ] Check at 1280x720, 1920x1080 and 390x844: the window fits; the Studio stacks its panels when narrow.
- [ ] After closing, the player is where they were and WASD, E and the door work.
## Sketchbook: WebTown Paint (`.kiro/specs/sketchbook-paint/`)

Automated in Vitest: every drawing operation pixel by pixel (strokes without gaps, brush discs, clipping, rectangles
and ellipses in all fill styles, an ellipse outline that Fill cannot leak through, flood fill on 1280 x 1024,
airbrush, text masks), Shift snapping, pointer-to-pixel at several zooms, history limits, the paint session for every
tool (preview, cancel, undo / redo, resize), artwork storage (contract on memory and IndexedDB, 50-drawing limit,
house isolation, damaged records, full disk), the guard and visitor access, the Paint window with a test codec
(tools, options, palette, menus by mouse and keyboard, dialogs, autosave, close and save failure, New / Open / Rename /
Delete, export, Escape), the visitor's viewer and the import boundary.

Automated in real browsers (`npm run test:e2e`, Chromium, Firefox and WebKit), with the real game: enter house-a, stand
at the notebook, see `E: Open Sketchbook`, press E; held movement keys do not move the player and Phaser's keyboard
is off; draw with every tool and check pixels; colours, sizes, undo / redo, clear, 200% and a small window; Export
PNG; close (player in place, can walk); reopen; reload; as another house's owner the drawing is view only, that
house starts blank, and house-a's drawing is unchanged.

Manual, in a headed browser (1280x720, 1920x1080, 390x844):

- [ ] At the notebook, E opens "Untitled - WebTown Paint" over the room: blue title bar, File Edit View Image Colors
      Help, the toolbox on the left with its options box, the colour box and the status bar.
- [ ] Each tool draws as its tooltip says; the pressed tool is obvious; the status bar shows the pointer position and
      the size; right-click on a swatch sets the background colour and right-drag draws with it.
- [ ] Fast scribbles have no gaps; a stroke that leaves the canvas and comes back continues; nothing is drawn outside.
- [ ] Shift makes straight lines, squares and circles; Fill fills exactly the enclosed area.
- [ ] Text: click, type several lines, click outside to place it; Escape cancels the box only.
- [ ] Image > Attributes: 320 x 200 transparent shows the checkerboard; Eraser makes transparency; Undo restores.
- [ ] View > Zoom 200% and 400% keep the pixels crisp and the pointer exact; Zoom to Fit fits a small window.
- [ ] Wait two seconds after drawing: the status bar says "Saved on this device only". Close and reopen, and reload
      the page: the drawing is still there.
- [ ] File > New keeps the old drawing (File > Open shows both); Rename changes the title bar; Delete asks first.
- [ ] Export PNG downloads the picture at its real size; a transparent canvas stays transparent in the file.
- [ ] Escape mid-stroke cancels the stroke; Escape otherwise closes (after saving); menus close with Escape alone.
- [ ] As a visitor (`?owner=house-b` in house-a), the Sketchbook is view only: Previous / Next, Export, nothing to edit.
- [ ] With storage blocked (private window), the status bar says the drawing is kept until the tab closes.
- [ ] After closing, the player is where they were and WASD, E and the door work.
## Persistence and limits (P3-05, P3-11, P3-14)

Automated (Vitest, fake-indexeddb): drawings per house with the 50 limit, website projects and images saved in one transaction, reload persistence,
independence between houses, damaged records and images, full disk, blocked upgrade, closed connection, revision
conflicts, owner guard, visitor access without a writer, and the version 1 to 2 upgrade keeping old data.

Manual, in a real browser:

- [ ] Save a website, reload the page: it is still there, and the window says "Saved on this device only".
- [ ] Open the same page in a different browser or device: your website is not there (3a is local).
- [ ] A website name of `<script>alert(1)</script>` shows as text in WebTown's window.
## Regression