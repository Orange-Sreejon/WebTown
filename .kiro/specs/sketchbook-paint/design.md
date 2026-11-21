# Sketchbook: WebTown Paint - Design

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| P-1 | Title `<title> - WebTown Paint`, original SVG icons, no Microsoft names or artwork | Steering (`product.md`, MVP FR-20): the look is evoked, not copied |
| P-2 | Pure TypeScript raster engine on an RGBA `PixelBuffer`; the `<canvas>` only presents it | Exact, testable in Vitest (jsdom has no canvas), aliased output, exact Fill |
| P-3 | One display canvas. A shape preview is drawn into a scratch copy of the image, so the preview is exactly what is committed | No overlay canvas to keep in sync |
| P-4 | White 640 x 480 by default; Image > Attributes resizes (1..1280 x 1..1024) and chooses White / Transparent | Brief R3; the "base" is what Eraser, Clear and new area use |
| P-5 | Drawings stored in the existing `artworks` store of `webtown` v2 as PNG bytes (`ArrayBuffer`) plus metadata; several per house (limit 50); the most recently changed one opens | The store and its `byHouse` index already exist; `ArrayBuffer` is cloneable everywhere (decision W-4) |
| P-6 | Autosave 1.5 s after the last change, on Save, on New / Open, and on close; last write wins between tabs | "Preserve work when closing" without a question; a drawing is one record, so there is nothing to merge |
| P-7 | PNG encode / decode in the browser (`canvas.toBlob`, `createImageBitmap` with `premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`), behind an injectable `PngCodec` | No dependency; tests inject a codec |
| P-8 | Text is rasterised with canvas 2D, then thresholded to solid pixels in the foreground colour | Matches the aliased image; one undo step |
| P-9 | Visitors get a read-only Sketchbook viewer of the house's drawings; the owner's Paint window is a lazy chunk with the only writer | Same owner / visitor model as the website (MVP 5.2) |
| P-10 | Airbrush is included (classic tool, small); selection, curve, polygon and rounded rectangle are not | Brief lists the required tools; out-of-scope list in requirements |

## 2. Modules

```
src/personal-spaces/paint/            pure, no DOM, no React
  pixel-buffer.ts   PixelBuffer, create, clone, get/set (clipped), resize, equals
  color.ts          Rgba, hex parse/format, PALETTE (28, named), base colours
  raster.ts         disc stamp, stroke segment, line (Shift snap), rectangle and ellipse (outline / both / fill),
                    flood fill (scanline, explicit stack), spray, text mask blit
  history.ts        undo / redo of whole-image snapshots, bounded by count (30) and bytes (96 MB)
  coords.ts         clientToPixel(clientX, clientY, rect, width, height)
  tools.ts          ToolId, labels, hints, option lists (sizes, widths, fill styles)
  paint-session.ts  the open image: pointer down / move / up / cancel per tool, preview, pick, text, clear,
                    resize, undo, redo, change counter and dirty rectangle
src/personal-spaces/artwork-storage/
  types.ts, rules.ts (title, size, PNG signature + IHDR check, limits), memory and IndexedDB repositories
  (one contract suite), guarded writer
src/personal-spaces/composition.ts    adds `artworks` to the storage and `paintAccessFor(view, storage)`
src/components/paint/
  PaintApp.tsx            opens storage, decides by `mode`: owner -> lazy OwnerPaintWindow, visitor -> SketchbookViewer
  OwnerPaintWindow.tsx    window chrome + layout + dialogs; wires the pieces below
  useSketchbook.ts        current drawing (id, title), load, autosave, New / Open / Delete / Rename, save state
  MenuBar.tsx             File Edit View Image Colors Help; mouse and keyboard
  Toolbox.tsx, ToolOptions.tsx, icons.tsx
  CanvasView.tsx          the canvas, zoom, pointer handling, presenter, text box
  ColorBox.tsx, StatusBar.tsx, PaintDialogs.tsx (attributes, open, rename, confirm, edit colours, about)
  SketchbookViewer.tsx    visitor: list, view, previous / next, export
  png-codec.ts, text-raster.ts, export.ts   the only DOM-bound helpers
  paint.css
```

## 3. Engine

- `PixelBuffer { width, height, data: Uint8ClampedArray }`, straight RGBA. Every write goes through one clipped
  `setPixel`, so nothing is drawn outside the canvas whatever the pointer does.
- Strokes: each new pointer sample is joined to the previous one with Bresenham, stamping a disc (pencil: one pixel).
  Coalesced pointer events are used when the browser has them.
- Rectangle: bands of the outline width inside the drag box; filled spans. Ellipse: pixel-centre test against the
  ellipse inscribed in the box; the outline is the ring between it and the ellipse inset by the width. Both outlines
  are 8-connected, so a 4-connected Fill cannot leak through them.
- Fill: scanline 4-connected, exact RGBA, explicit stack; filling with the same colour does nothing (no undo step).
- Spray: uniform random points in a disc, from an injected random source (seeded in tests), on every move and every
  30 ms while held.
- Session: pointer down takes the undo snapshot and starts the tool. Shapes redraw a scratch copy of the snapshot on
  every move. Pointer up commits and records one history entry, but only if pixels changed. Cancel (Escape,
  `pointercancel`, lost capture, window blur) restores the snapshot and records nothing.
- History stores full snapshots (with size and base, so resize is undoable). It holds at most 30 entries and
  96 MB, dropping the oldest first.

## 4. Canvas view

- The canvas has width x height pixels; CSS sets the displayed size from the zoom: Auto (100%, or smaller to fit),
  100%, 200%, 400%. `image-rendering: pixelated` at 100% and above. The canvas area scrolls when larger.
- Transparent pixels show a CSS checkerboard behind the canvas, never drawn into it.
- `clientToPixel` floors `(client - rect.left) * width / rect.width` with the rectangle read on every event, so zoom,
  window size, scroll and device pixel ratio cannot skew it.
- Pointer capture on down; right button uses the background colour; the context menu and touch scrolling are disabled
  on the canvas only; one pointer at a time.
- The presenter keeps an `ImageData` over the session's view buffer and puts only the dirty rectangle each animation frame.

## 5. Storage

```ts
interface ArtworkRecord {
  schemaVersion: 1; id: string; houseId: string; title: string        // 1..60
  width: number; height: number; transparent: boolean
  png: ArrayBuffer; byteSize: number                                  // <= 5 MB, PNG signature, IHDR = width x height
  createdAt: string; updatedAt: string
}
```
`ArtworkReader.list(houseId) -> { items: summaries newest first, skipped }`; `get(houseId, id)` returns null for another
house's record. `ArtworkWriter.save(input)` creates (limit 50 per house) or updates in one transaction, refusing
with `PermissionError` an id that belongs to another house. `delete(houseId, id)` behaves the same way.
`guardArtworkWriter` refuses anything but exactly `owner` and any other house (client-side only).
`paintAccessFor(view, storage)`: a visitor gets a reader only; the owner also gets a guarded writer.

## 6. Interface

- **Window:** own classic chrome inside `WindowFrame` (new options: icon, maximise, `closeOnEscape: false`).
  Close, Escape and File > Exit all run one `requestClose`: cancel what is in progress, save if needed, then close.
  If the save fails: "Your drawing could not be saved" with Try again / Close without saving / Cancel.
- **Menus:** File (New, Open..., Save, Rename..., Export PNG..., Delete drawing..., Exit); Edit (Undo, Redo);
  View (Tool Box, Color Box, Status Bar, Zoom); Image (Attributes..., Clear Image); Colors (Edit Colors...);
  Help (About WebTown Paint). Keyboard: Enter / Space / ArrowDown open; arrows move; Escape closes.
- **Toolbox:** two columns in classic order: Airbrush, Fill; Pick colour, Text; Pencil, Brush; Eraser, Line;
  Rectangle, Ellipse. The options box below shows the current tool's sizes, widths, fill styles or font sizes.
  Undo and Redo buttons sit under it.
- **Colour box:** a foreground / background indicator and 2 x 14 swatches. Left click sets the foreground,
  right click the background, double click edits the swatch.
- **Status bar:** hint | `x, y` | `w x h` | size | save state ("Saved on this device only", "Saving...",
  "Not saved", "Save failed").

## 7. Tests

- Vitest: every engine function (pixels asserted), history limits, coordinates at several scales, the session per
  tool, artwork rules and the repository contract (memory and IndexedDB, isolation, limits, damaged records),
  guard and access, the components with an injected codec (toolbox, options, palette, menus, dialogs, autosave,
  close flow, keyboard) and the visitor boundary.
- Playwright, Chromium, Firefox and WebKit, real game: enter house-a, walk to the notebook, see the prompt, press E;
  movement keys do not move the player while open; draw with every tool and check pixels; colours, sizes, undo, redo,
  clear, zoom and resize with correct coordinates; export a PNG; close and reopen; reload; house-b is untouched;
  close and walk again.
