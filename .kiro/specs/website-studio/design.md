# WebTown Website HTML/CSS Studio - Design

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| W-1 | Model: **pages (HTML) + one shared `style.css` + assets**, not arbitrary files | Matches R2-R6; no resident JavaScript in 3a, so `.js` files have no use; simpler validation and UI |
| W-2 | Editor: **CodeMirror 6** (`codemirror`, `@codemirror/lang-html`, `@codemirror/lang-css`, plus `state`, `view`, `commands`), MIT, exact versions | R2 asks for highlighting, line numbers, indentation and shortcuts; CodeMirror is modular and far smaller than Monaco or Ace (design 16.11). Imported **only** by the owner's Studio chunk, loaded on demand |
| W-3 | Sandbox: the S-01 design, unchanged except **no `<base>` element** in resident pages, and `#name` links written as `about:srcdoc#name` | S-01's `raw-none` runs (no base) showed the CSP and builder already stop every resource and navigation. A bare `#name` resolves against the host page's address and is blocked; `about:srcdoc#name` jumps within the page in Chromium and Firefox (WebKit blocks it; found in W-09) |
| W-4 | Assets stored as `ArrayBuffer` + MIME type | Structured-clone safe in every browser and in tests; `Blob` is not reliably cloneable in jsdom |
| W-5 | Migration in memory, written on first Save, legacy record kept (SD-9) | Reversible, no silent loss |
| W-6 | Houses with nothing saved show "nothing here yet" rather than a generated site | R1, R10: the owner chooses Blank or Classic |

## 2. Data model (`src/personal-spaces/site-project/types.ts`)

```ts
interface SiteProject {
  schemaVersion: 1
  houseId: string
  title: string                         // website name, 1..60, plain text
  homePage: string                      // name of an existing page
  pages: { name: string; html: string }[]   // 'index.html', 'about.html', ...
  css: string                           // style.css, shared by every page
  assets: { id: string; name: string; mimeType: AssetMime; size: number }[]   // metadata only
  revision: number                      // +1 per save, checked inside the save transaction
  createdAt: string; updatedAt: string
  origin: { kind: 'blank' } | { kind: 'classic' } | { kind: 'migrated'; sourceUpdatedAt: string }
}
interface SiteAssetRecord { id: string; houseId: string; name: string; mimeType: AssetMime; size: number; bytes: ArrayBuffer }
type AssetMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml'
```

Rules (`rules.ts`, pure): page names `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.html$`; asset names
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpe?g|gif|webp|svg)$`; unique ignoring case; limits of R9; assets sniffed by
signature (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`, WebP `RIFF....WEBP`, SVG: UTF-8 text whose
first element is `<svg>`), and the sniffed type must match the extension. `validateProject` returns every problem.

## 3. Storage

IndexedDB `webtown` **version 2**: adds `siteProjects` (key `houseId`) and `siteAssets` (key `id`, index `byHouse`).
The v1 stores (`sites`, `artworks`) and their data are untouched by the upgrade.

`SiteProjectReader.load(houseId) -> { project, assets } | null` (validated; a bad asset is skipped and reported; a bad
project is reported and treated as missing, never deleted). `SiteProjectWriter.save({ project, baseRevision,
putAssets, deleteAssetIds }) -> project` validates, then in **one readwrite transaction over both stores** reads the
stored revision, aborts with `ConflictError` if it differs, writes assets, deletes assets, writes the project with
`revision + 1`. `IdbDatabase.atomic()` provides the multi-store transaction. Memory and IndexedDB implementations share
one contract suite. `guardProjectWriter` refuses anything but `owner` and any other house.

As built: the repositories, `guardProjectWriter` and `resolveWebsite` are in `src/personal-spaces/site-project-storage/`.
`composition.ts` opens the database once, builds the project repository and the legacy site repository (for
migration) on the same connection, and falls back to memory with the existing "Not saved" notice.
`resolveWebsite(houseId)` returns `project` (with any skipped images) | `migrated` (valid legacy record converted in
memory, revision 0) | `damaged` (a stored project that cannot be read, with its revision so the owner can save over
it) | `none` (nothing saved, or a damaged legacy record, which is left untouched). `websiteAccessFor(view, storage)`
gives a visitor `open()` only and the owner `open()` plus a guarded writer.

## 4. Rendering (one path for preview and visitors)

`toRenderable(project, assets)` -> `{ pages, css, assets: name -> data URL }`.
`buildSitePage(renderable, pageName, appOrigin)` (pure, `DOMParser`, never runs anything):
1. missing page -> WebTown "page not found" document;
2. remove `script iframe frame frameset object embed applet portal fencedframe base`, `meta refresh/set-cookie`,
   `link rel` preload/prefetch/prerender/preconnect/dns-prefetch/modulepreload/manifest, and every `on*`, `nonce`,
   `ping`, `target`, `formtarget`, `formaction`, `action`, `srcdoc` attribute; unwrap `<noscript>`;
3. links: `#frag` becomes `about:srcdoc#frag`; a site page -> `<origin>/site-nav.html#k=page&p=...`; a policy-approved `https:` link ->
   `...#k=external&u=...`; anything else loses `href`;
4. assets in `src`, `srcset`, `poster`, `background`, inline styles, `<style>`, `style.css` (`url()`, `@import`) -> data
   URLs; other references removed;
5. `<link rel=stylesheet href="style.css">` becomes the shared stylesheet; if the page has none, it is appended to
   `<head>` so `style.css` applies to every page exactly once;
6. first in `<head>`: `<meta charset>`, the resident CSP (S-01 policy with `base-uri 'none'`);
7. keep the source's doctype (none means quirks mode, as the author wrote it); report the page `<title>` as text.

This module is the only shipped code that serialises HTML (`outerHTML` of an inert parsed document); the source-safety
test names that single exception.

`public/site-host.html` and `public/site-nav.html` are the S-01 host and navigation pages (static, nonce bootstrap,
frame-src narrowed to the navigation page). `SiteFrame` (React) mounts the host frame, checks every message's
`source`, origin and schema, rate-limits, renders pages, and shows the external-link confirmation bar in WebTown's
chrome.

## 5. User interface

- `WebsiteApp` (app host): opens storage, resolves the website, decides by the bridge's `mode`.
  Visitor -> `SiteViewer` (reader data only). Owner -> lazy `OwnerWebsiteWindow` -> `SiteViewer` + **Open Site Studio**
  -> `SiteStudio`.
- `SiteViewer`: WebTown Browser chrome (Back, Forward, Home, display-only address `webtown://house-a/about.html`, page
  title, status) around `SiteFrame`. Internal links push history.
- `SiteStudio` (full-size window):
  - toolbar: website name (editable), current page, save status, **Save**, layout (Split / Code / Preview),
    viewport (Desktop / Phone), **Refresh**, Auto, Template menu (**Start over**), **Exit**;
  - left: **Pages** (list with homepage star and unsaved dots; New, Rename, Delete, Set as homepage) and **Assets**
    (Upload, drop zone, thumbnails, Copy path, Insert, Delete), plus storage use against 50 MB;
  - main: editor tabs for the current page's HTML and `style.css`, the Markup check under the editor, preview on the
    right;
  - in-window dialogs for names and confirmations; `beforeunload` while dirty.
- The Studio state is a pure reducer (`studio-state.ts`): draft project, new and removed assets, current page and tab,
  dirty tracking against the saved project.

## 6. Security tests

- Vitest: builder removal and rewriting rules for every attack in S-01's fixture list; boundaries (visitor files never
  import the Studio, writers or storage; every `sandbox` attribute in shipped code is exactly `allow-scripts`; the
  builder is the only `outerHTML` user).
- Playwright against the real app in Chromium, Firefox and WebKit: hostile pages saved through the Studio never run
  script, never reach a recording beacon, never read the parent; plus the definition-of-done journey.

## 7. Removed

`SiteRenderer`, `ExternalLink`, `site-theme`, `SiteBrowser`, `SiteWindow`, the page CSS, the form editor
(`components/website-editor/`), `site-edit.ts`, `site-navigation.ts`. The legacy domain (`website/site-types` and
validation, defaults, presets, contrast) stays for migration. All removed code is in Git history (`9837da3`).
