# Sketchbook: WebTown Paint - Requirements

Replaces the Paint items of `.kiro/specs/personal-spaces-mvp/` (FR-20 to FR-43, tasks P3-08 to P3-17) with the
owner's brief "Implement a Functional MS Paint-Style Sketchbook". Where the two differ, this file wins. Visual
reference: `inspiration-art/paint-reference.png` (local-only, git-ignored; design section 12 of the MVP spec).

## Audit (what exists)

- The notebook prop (role `notebook`, label "Sketchbook") has a target zone and the prompt `E: Open Sketchbook`
  (`object-targets.ts`). E opens app `paint` through `AppSession`, which halts the player, hides the prompt, hands the
  keyboard to the page (`setKeyboardCaptured(false)`) and publishes `{ open: 'paint', houseId, mode }`. Close does
  the reverse and starts the re-trigger cooldown. Tested in `app-session`, `keyboard-capture` (with Phaser's real
  keyboard manager) and `interior-gate`.
- React: `AppHost` shows `PlaceholderApp` for `paint`. `WindowFrame` is the shared modal (focus trap, Escape).
- Storage: IndexedDB `webtown` v2 already has store `artworks` (key `id`, index `byHouse`), unused so far.
  `composition.ts` opens the database once and hands out reader-only access to visitors.
- Ownership: decided once in Phaser (`canEditHouse`), passed as `mode`. Client-side only (Phase 3a).

## Requirements

### R1 Opening and closing (integration)
1. At the notebook, `E: Open Sketchbook` appears; E opens the Sketchbook over the room. (Existing; unchanged.)
2. While it is open the player cannot move or interact; no key or pointer input reaches Phaser. Closing restores
   normal play at the same position and facing. (Existing session; must stay true with Paint.)
3. React owns the whole application UI; Phaser is not changed.

### R2 Window and look
1. Classic late-1990s desktop paint program, after the reference: blue title bar with an app icon and
   `<title> - WebTown Paint`, minimise / maximise / close buttons; menu bar **File, Edit, View, Image, Colors, Help**;
   two-column toolbox on the left with a tool-options box under it; canvas area with a grey surround; a two-row colour
   box at the bottom with the foreground / background indicator; a status bar.
2. Grey surfaces, bevelled buttons and borders, the system-style sans font. Original icons drawn for WebTown; no
   Microsoft names, logos, icons or fonts (steering). The title says "WebTown Paint".
3. Opens as a large window sized to the viewport; maximise fills the screen; below 700 px wide it is full-screen and
   still usable. Minimise is drawn but disabled ("Not available").

### R3 Canvas
1. A real raster canvas, **white** by default, **640 x 480** pixels. Optionally transparent (shown on a checkerboard
   that is never part of the image).
2. Image > Attributes sets width and height (1 to 1280 by 1 to 1024) and White / Transparent. Growing fills the new
   area with the canvas base; shrinking crops from the bottom-right. One undo step.
3. Drawing is aliased so the image stays sharp and Fill is exact. The canvas is scaled by CSS (View > Zoom: Fit,
   100%, 200%, 400%); pixels stay crisp (nearest-neighbour) at 100% and above.
4. Pointer position maps to the right pixel at any zoom, window size, scroll and device pixel ratio.

### R4 Tools (each selectable, with a clear pressed state, icon and tooltip)
- **Pencil:** 1-pixel freehand.
- **Brush:** freehand with a round brush, size from the options box (1, 2, 4, 6, 8, 12).
- **Eraser:** freehand, size from the options box (4, 6, 8, 10, 16); restores the canvas base (white, or transparent).
- **Airbrush:** sprays dots while held, sizes 8, 16, 24.
- **Fill:** fills the contiguous area of the clicked colour (4-connected, exact match).
- **Pick colour:** sets the colour from the clicked pixel, then returns to the previous tool.
- **Text:** click to place a text box, type (several lines), commit with a click outside or Ctrl+Enter; Escape
  cancels. Font size from the options box (12, 16, 24, 32, 48). One undo step.
- **Line:** straight line with a rubber-band preview; Shift keeps 0/45/90 degrees. Width 1 to 5.
- **Rectangle** and **Ellipse:** rubber-band preview; Shift makes a square / circle; fill style from the options box:
  outline, outline + fill (fill with the background colour), fill only. Outline width shared with Line.
- Left button uses the foreground colour, right button the background colour (classic). Touch and pen use the
  foreground colour.
- A stroke continues smoothly when the pointer moves fast (samples joined, coalesced events used) and when it leaves
  and re-enters the canvas; nothing is drawn outside the canvas.

### R5 Colours
1. 28-colour classic palette (two rows of 14) including black, white, the primaries and common extras.
2. Left-click sets the foreground, right-click the background; the indicator updates at once. Each swatch has an
   accessible name.
3. Colors > Edit Colors (and double-click on a swatch) picks any custom colour; it replaces that swatch for this session.

### R6 Operations
1. Undo / redo for every drawing action (stroke, shape, fill, text, clear, resize): Edit menu, toolbar buttons and
   Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z). Bounded memory.
2. Image > Clear Image asks for confirmation and is undoable.
3. File > Save (Ctrl+S), Export PNG (downloads exactly the image, transparency kept), New, Open, Rename, Delete.
4. The status bar shows the tool hint, the pointer position, the canvas size, the brush size and the save state.

### R7 Persistence (Phase 3a, this device only)
1. Drawings are stored in IndexedDB (`artworks`) as PNG with title, size and dates, per house. Several drawings
   ("pages") per house, up to 50; the most recently changed one opens when the Sketchbook opens.
2. Work is preserved without asking: saved automatically shortly after each change, on Save, and when the
   Sketchbook is closed. If a save fails, closing asks before discarding. The tab warns before closing with unsaved work.
3. Reopening shows the drawing exactly as left; it survives a page reload.
4. Only the house's owner can create, change or delete its drawings, and only that house's. A visitor sees the house's
   drawings read-only. One house can never read another house's drawing as its own, or overwrite it.
5. If browser storage is unavailable the Sketchbook still works and says "Not saved".
6. Stored data is untrusted: damaged records are skipped and reported, never deleted silently.

### R8 Keyboard and accessibility
1. Escape: cancels the stroke, text box, menu or dialog in progress; otherwise closes the Sketchbook (saving first).
2. Menus, toolbox, palette, dialogs and window buttons work with the keyboard; focus is visible; names and live
   status for screen readers. Drawing itself is pointer-only (documented).
3. Shortcuts: Ctrl+Z, Ctrl+Y (Ctrl+Shift+Z), Ctrl+S, Ctrl+N, Ctrl+O, Ctrl+E (attributes), Ctrl+Shift+N (clear).
   There are no single-letter tool shortcuts: letters typed while Paint is open go to the text box, never to tools.

## Out of scope
Selection tools, curve, polygon, rounded rectangle, magnifier tool (View > Zoom instead), layers, image import,
cross-device sharing (Phase 3b), visitor comments.

## Definition of done
In my house, E on the Sketchbook opens something that feels like old Windows Paint. I can draw with the mouse,
choose colours, use every tool, erase, undo, redo and save, close it, reload the page, and see my drawing again.
Checked in Chromium, Firefox and WebKit with the real game.
