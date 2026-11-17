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
## Website (P3-06, P3-07)

Automated: every page, navigation and history, literal text and injection, external links, visitor read-only,
recovered and failed loads, closing, accessibility basics, and the import-graph boundary. A real-browser script also
checked 1280x720, 1920x1080 and 390x844 (window fits, no sideways scroll, navigation moves above the page when narrow).

Manual, in a headed browser (the website editor arrives in P3-07, so saved content is made through the console or
the editor later):

- [ ] At the computer in `house-a`, E opens "WebTown Browser" over the room; the player does not move.
- [ ] The page looks like a late-1990s home page: banner, side menu, framed boxes, "Under construction" strip.
- [ ] Home, About, Projects and Links each show their content; Back, Forward and Home work; the address changes
      (`webtown://house-a/about`) and cannot be typed into. Alt+Left and Alt+Right go back and forward.
- [ ] The browser's own address bar and Back button are untouched by moving around the site.
- [ ] Tab reaches every button in a sensible order and stays inside the window; focus is clearly visible; after
      choosing a page, focus is on the page. With a screen reader the window is announced as "WebTown Browser" and the
      page change is announced.
- [ ] A link to another site opens in a new tab and shows its host; the original tab is not changed.
- [ ] `?owner=house-b` (dev) makes `house-a` a visitor's view: same website, the "stored on this device only, visitors
      on other devices can't see it" line, and no way to edit.
- [ ] Esc and the Close button return to the room at the same spot, facing the same way; WASD, E and the door work again.
- [ ] Open and close it twenty times; then enter and leave the house.
- [ ] The furniture editor, the Sketchbook placeholder and the day/night cycle behave as before.
### Website editor (P3-07)

Automated: every field, live preview identical to the visitor page, draft isolation, save and reload through
IndexedDB, cancel and close confirmation, validation messages, contrast table, invalid addresses, save failures
keeping the draft, and the owner/visitor import boundaries. A real-browser script also checked 1280x720, 1920x1080 and
390x844, real typing, Enter to save, the discard question, and that a visitor never loads the editor code.

Manual, in a headed browser, in `house-a`:

- [ ] "Edit this website" opens the editor beside a live preview; typing changes the preview at once.
- [ ] Each section (page, home, about, projects, links, look) saves and shows after Save, and after a page reload.
- [ ] Add, move and remove projects and links; Add stops at 12 projects and 20 links and says why.
- [ ] Pick each theme; change a colour (text box and the colour picker) and see "Custom colours" and the contrast table update.
- [ ] Make text unreadable (light grey on white): the table says "Fails AA" and Save refuses with the numbers.
- [ ] A `javascript:` or `http://` link is refused with a reason; `https://example.com:8443/` is accepted.
- [ ] Paste far more than 60 characters into the title: nothing is cut off; the counter says "too long"; Save refuses.
- [ ] Cancel, Close and Escape with changes ask "Discard your changes?"; Keep editing keeps them.
- [ ] With DevTools set to offline storage / a full disk, Save shows the reason and the draft stays.
- [ ] Tab through the whole editor; focus is always visible; a screen reader reads labels, counts and problems.
- [ ] At a narrow width, Edit / Preview switches between the form and the page.
- [ ] As a visitor (`?owner=house-b`), there is no Edit button; the Network panel shows no `OwnerWebsiteWindow` chunk.
- [ ] After closing, the player is where they were and WASD, E and the door work.

## WebTown Paint (P3-12 to P3-15)
## Persistence and limits (P3-05, P3-11, P3-14)

Automated (Vitest, fake-indexeddb): website save, load, update, reload persistence, independence between houses,
invalid and damaged records, full disk, blocked upgrade, closed connection, owner guard, visitor reader.

Manual, in a real browser (once the website window exists, P3-06/07):

- [ ] Save a website, reload the page: it is still there, and the window says "Saved on this device only".
- [ ] Open the same page in a different browser or device: the default site shows, not yours (3a is local).
- [ ] In DevTools > Application > IndexedDB, edit a record to nonsense, reload: the default site shows and the owner is told.
- [ ] In a private window (storage blocked), the window says "Not saved" and editing still works until the tab closes.
- [ ] Open two WebTown tabs and save in both: the later save wins; no error.
- [ ] A title of `<script>alert(1)</script>` shows as text, and a link to `http://`, `javascript:` or `https://localhost` is refused.
- [ ] A link to `https://example.com:8443/` is accepted and opens in a new tab.
## Regression