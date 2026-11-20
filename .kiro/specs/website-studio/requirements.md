# WebTown Website HTML/CSS Studio - Requirements

Status: **in implementation** on `feature/phase-3-personal-spaces`. Supersedes the form-based website editor (P3-07)
and refines `personal-spaces-mvp` design section 16 for this phase. The visual drag-and-drop builder is a later phase
and is out of scope.

Inspiration: Neocities (write your own files, see them live, keep fixing your home up) and the GeoCities archive (no
two pages alike). WebTown supplies the browser chrome; everything inside the page belongs to the resident.

## Audit of what this replaces

| Area | Before (P3-04 to P3-07) | Limitation |
|---|---|---|
| Data | `SiteContent`: title, name, tagline, welcome, about, projects, links, a theme of 5 colours, 3 fonts, 4 patterns | The structure is the data model |
| Rendering | `SiteRenderer` (React) draws a fixed banner, side menu and four sections | No resident HTML or CSS is possible |
| Editing | A form over those fields | Residents fill fields; they cannot build anything |
| Storage | IndexedDB `webtown` v1 store `sites` | One record shape per house |

Kept: the app bridge and ownership (`mode` from Phaser), the IndexedDB wrapper and fallback, the guarded-writer
pattern, the URL policy, the S-01 sandbox design, and the old records (read only, for migration).

## Requirements

### R1 Open the website
At the computer, E opens the WebTown Browser showing the house's website. The owner also gets **Open Site Studio**.
A house with no website shows a WebTown "nothing here yet" page; the owner's button reads **Build your website**.

### R2 HTML editing
A real code editor for each page's HTML: syntax highlighting, line numbers, auto-indent, bracket matching, undo and
redo, search, Tab to indent (Escape then Tab leaves the editor), Ctrl/Cmd+S to save. The whole document is the
resident's: any structure, including no `<head>`, quirks mode, tables, frames of text, anything HTML allows.
Malformed markup never breaks anything: the page renders as browsers render it, and a **Markup check** lists likely
mistakes (unclosed or mismatched tags) with line numbers. It warns; it never blocks saving.

### R3 CSS editing
One shared stylesheet, `style.css`, edited in the same editor with CSS highlighting. Every CSS feature the browser
supports is allowed: selectors, classes, IDs, flexbox, grid, positioning, box model, borders, colours, typography,
backgrounds, transforms, animations, transitions, media queries. `style.css` applies to every page (also when a page
links it itself; it is never applied twice). A brace check warns about unbalanced `{ }`.

### R4 Live preview
Beside the editor, the page as visitors will see it, rendered by the **same sandbox and builder** as the visitor
view. It updates 600 ms after typing stops (Auto, on by default) and on **Refresh**. Layouts: **Split**, **Code**,
**Preview**. Viewports: **Desktop** and **Phone** (375 px). Links between pages work in the preview and open that page
in the editor. Nothing a page contains can crash or reach the WebTown app.

### R5 Pages
Create, rename, delete and switch pages; each page's HTML is separate. Names are `name.html` (letters, digits, `-`,
`_`, `.`; 1-64 characters before `.html`; unique ignoring case). One page is the **homepage** (star). The homepage
cannot be deleted; choose another first. Delete asks for confirmation naming the page. Renaming does not rewrite
links in other pages (the Markup check and the preview show broken links). Up to 100 pages.

### R6 Assets
Upload images (PNG, JPEG, GIF including animated, WebP, SVG) by button or drag and drop. Each upload is checked by its
**content** (file signature; SVG must be an SVG document) as well as its name; refusals name the file and the reason.
Assets have predictable paths: `assets/<file name>` (for example `assets/my-banner.gif`). The panel shows each asset
with a thumbnail, size and path, and offers **Copy path**, **Insert into page** (an `<img>` at the cursor) and
**Delete** (with confirmation, warning if pages still use it). Assets are shared by all pages. SVG is only ever shown
as an image, never as a document, so it cannot run script.

### R7 Save and persistence
**Save** writes the whole website (pages, stylesheet, homepage, title, assets added and removed) in **one IndexedDB
transaction**, checking that no other tab saved in between (otherwise: keep the draft and offer Reload or Save
anyway). Status: "Unsaved changes" (and a dot on changed pages), "Saving...", "Saved on this device only". A failed
save keeps the draft and says why. Closing with unsaved changes asks first; the browser tab warns too. Reopening shows
exactly what was saved. Houses are isolated: a save can only write the house the window was opened for.

### R8 Website settings
Website name (1-60 characters, plain text, shown by WebTown in the toolbar and the window title) and homepage.

### R9 Limits (approved SD-7)
Page or stylesheet: 1 MB of text each. Asset: 5 MB. Whole website: 50 MB and 500 files. Shown before they are hit;
nothing is silently cut, resized or recompressed.

### R10 Starting points
A website starts as **Blank** (one `index.html` with a minimal valid document and an empty `style.css`) or **Classic
homepage** (an original, nostalgic, multi-page starter). Both are ordinary files from then on. **Start over** from
either asks first.

### R11 Migration of existing websites
A house with a valid saved structured website (P3-05/P3-07) is shown, converted in memory, as an HTML/CSS website:
title, name, tagline, home, about, projects, links, theme colours, font, pattern and the under-construction banner are
all carried into `index.html`, `about.html`, `projects.html`, `links.html` and `style.css`, with every text escaped
(so old `<script>` text stays text) and only policy-approved links kept as links. Nothing is written until the owner's
first Save, and the original record is **never modified or deleted**, so the change is reversible. A damaged record
is reported to the owner, kept, and not converted.

### R12 Security (S-01 verified design)
- Resident HTML and CSS render only inside the two-layer sandbox (`site-host.html` in
  `<iframe sandbox="allow-scripts">`, the page in a nested `<iframe sandbox="allow-scripts" srcdoc>`); never in the
  WebTown document, never with `allow-same-origin`, never via `dangerouslySetInnerHTML`.
- **No resident JavaScript runs**: scripts, event-handler attributes, `javascript:` URLs and nonce attributes are
  removed, and the page's own policy is `script-src 'none'`.
- No network: the page can use only its own files (as `data:` URLs); external images, fonts, styles, frames, objects,
  forms, refresh and prefetch are removed or blocked; the frame cannot navigate anywhere but WebTown's navigation page.
- No access to WebTown's DOM, React, Phaser, storage, cookies or bridge. Messages are source-checked, schema-checked
  and rate-limited.
- External `https:` links open in a new tab only after the player confirms in WebTown's chrome.
- Owner/visitor separation stays client-side (bypassable with developer tools); the sandbox protects players from
  pages regardless of who wrote them.

### R13 Accessibility
Labelled controls, visible focus, keyboard operation of every action, status announcements, a titled preview frame,
in-window confirmations that start on the safe choice.

### R14 No regressions
Town, interiors, furniture editor, house entry and exit, Sketchbook placeholder, day/night and the Phaser/React
lifecycle behave as before.

## Out of scope
Visual builder, blocks or sections, AI generation, resident JavaScript, collaboration, marketplace, hosting, network
resources for pages, folders of pages, multiple stylesheets, redesigning the town or furniture editor.

## Definition of done
1. Open the editor. 2. Write HTML. 3. Write CSS. 4. Start from Blank. 5. See changes live. 6. Create pages.
7. Navigate between them. 8. Upload and use images and GIFs. 9. Save. 10. Leave. 11. Reopen and continue.
12. Visit as a visitor and see the saved result. Verified with a website that shares nothing with the old template.
