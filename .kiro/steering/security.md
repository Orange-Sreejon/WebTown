# WebTown — Security Steering

## Phase 1 Threat Model

Phase 1 is a fully client-side, single-player, local-only browser game.
There is no server, no authentication, no user data, and no network traffic
beyond static asset loading. The attack surface is minimal.

These rules are written to establish good habits for future phases and to
prevent accidental introduction of risks during development.

## Asset Loading

- All assets are loaded from the same origin (`public/` served by Vite).
- Do not load assets from arbitrary user-supplied URLs.
- Do not use `eval()` or `new Function()` to construct asset paths.
- Asset key constants (in `AssetKeys.ts`) are the only source of asset path strings.

## Dependencies

- Pin all dependencies to exact versions in `package.json`.
- Run `npm audit` before adding any new dependency.
- Do not add dependencies with known high/critical vulnerabilities.
- Do not add packages that phone home or collect telemetry without disclosure.
- Review what a package does before installing — typosquatting is real.

## Build Output

- The Vite build produces only static files. No server-side code is generated.
- Do not include secrets, API keys, or credentials anywhere in the codebase.
- `.env` files must never be committed. Add `.env*` to `.gitignore` now,
  even though no env vars exist yet — it prevents accidental future commits.

## Asset Licence Compliance

- Do not publish the PIXELJAD tileset raw files in a public repository without
  explicit creator permission. See `docs/ASSETS.md` for full licence analysis.
- Do not use any asset to train AI/ML models (prohibited by both asset licences).
- Include required attribution for PIXELJAD assets in any public-facing release.

## Content Security

- This is a game, not a website. There is no user-generated content in Phase 1.
- Do not use `dangerouslySetInnerHTML` in any React component.
- Do not render any external HTML or markdown in the game canvas.

## Future Phase Reminders

When multiplayer and user accounts are added (future phases), the following
will need to be addressed before any public deployment:

- Input sanitisation for all user-supplied content (house names, usernames).
- Authentication token storage strategy (httpOnly cookies vs localStorage).
- WebSocket message validation — never trust client-sent game state.
- Rate limiting on movement/action messages to prevent cheating.
- Content moderation for user-generated house content.

These are out of scope for Phase 1 and must not be implemented now.

## Phase 3a — Personal Spaces (local only)

Phase 3a adds user-authored content (website text, links, drawings) but still has
no server, no accounts and no network traffic. Everything is stored in the
browser's IndexedDB on one device. These rules supersede the Phase 1 line "no
user-generated content".

### Client-side restrictions are not security

- Owner / visitor separation in 3a (`canEditHouse`, reader-only components,
  `Guarded*Repository`) prevents developer mistakes and gives visitors a
  read-only UI. **Anyone can bypass it with browser developer tools**, by editing
  IndexedDB directly, or (in dev builds) with `?owner=<houseId>`.
- Do not describe it as authorization, and do not store anything in 3a that would
  be harmful if a user edited it.
- Do not claim 3a content is shared across devices. It is not.

### User content rules

- Render all user strings as React text. **Never** `dangerouslySetInnerHTML`,
  `innerHTML`, `eval`, `new Function`, or user-supplied CSS or markup.
  Text that looks like HTML is allowed and shown literally as characters; there is no
  rich-text or HTML support, and a test scans the source for HTML-injecting APIs.
- Colours: accept only validated `#RRGGBB`. Fonts: fixed allow-list. Lengths and
  counts: capped on write and on read. Strip control characters.
- External links: `https:` only; an explicit port from 1 to 65535 is allowed; no credentials; no `localhost`,
  `.local` / `.internal` hosts or IP addresses; at most 2048 characters. Open with `target="_blank"` and
  `rel="noopener noreferrer"`. Invalid stored links render as inert text.
- Internal navigation never touches `window.location`, the hash or history.
- Images: PNG only (magic-byte check), ≤ 2 MB, dimensions ≤ 1024, at most 50 per
  house. Show through object URLs and revoke them on unmount.
- The Paint reference screenshot (`inspiration-art/paint-reference.png`) is a
  local-only development reference: git-ignored, outside `public/`, never committed, never
  in `dist/`. Do not move it under `public/` or `docs/`.
- `fake-indexeddb` is a dev dependency used by tests only; it must not appear in
  `dist/`.

## Phase 3a - Resident websites (Site Studio, revision 2)

Resident websites are files written by residents: HTML, CSS, JavaScript, images,
fonts. They are untrusted code. The policy below **passed the S-01 sandbox spike** in Chromium, Firefox and
WebKit (`docs/site-sandbox-findings.md`) and is **awaiting review**; until then it is provisional, and the
spike's verified results take precedence over anything written here.

### Where resident content may run

- **Never in the WebTown document.** No resident HTML, CSS or script is ever
  inserted into WebTown's own DOM, and WebTown's own UI shows resident strings
  (file names, titles) only as React text.
- Only inside the **two-layer sandbox**: WebTown's static host page
  (`site-host.html`) in `<iframe sandbox="allow-scripts">`, and the resident page
  in a nested `<iframe sandbox="allow-scripts" srcdoc>` created by the host page.
- **Never add `allow-same-origin`** to either frame. With `allow-scripts` it would
  let a frame remove its own sandbox. Also never grant `allow-top-navigation*`,
  `allow-popups*`, `allow-forms`, `allow-modals`, `allow-downloads`,
  `allow-pointer-lock` or `allow-presentation`. Both frames deny every
  permissions-policy feature and use `referrerpolicy="no-referrer"`.

### No resident JavaScript in Phase 3a

- Resident `.js` files are stored and editable but **do not execute**: no inline
  scripts, external scripts, event-handler attributes or `javascript:` URLs.
- Enforced three ways: the resident page's own CSP has `script-src 'none'`; the
  inherited host policy allows only the host's nonce; and the page builder
  removes scripts, `on*` attributes, `nonce` attributes and script URLs.
- Only WebTown's trusted bootstrap (host page, navigation page) runs, with a
  **narrow nonce**. That nonce sits in a static file, so it is **not a secret**:
  resident pages must never be able to rely on it, which is why the resident
  page's own `script-src 'none'` and the builder's stripping are both required.

### No network egress from resident pages

- The resident policy allows images, styles, fonts and media only as `data:`;
  `connect-src`, `frame-src`, `object-src`, `worker-src` and `form-action` are
  `'none'`. The host page's `frame-src` is narrowed to WebTown's navigation page,
  which also blocks the resident frame from navigating itself elsewhere.
- **Do not claim "no requests" because a directive exists.** Every egress claim
  must be backed by the spike's request-recording beacon (HTTP, raw TCP and UDP)
  in all three engines. Self-navigation, meta refresh, forms, anchors, `ping`,
  prefetch links and WebRTC are tested explicitly; see the findings for what is
  covered by the platform and what depends on the page builder.

### What S-01 measured (Chromium, Firefox, Playwright WebKit; see the findings)

- Verified: both frames opaque; no access to WebTown's DOM, storage or cookies; no top navigation, popups,
  dialogs or form submission; CSP inherited from the host into the resident `srcdoc` and **not** from the app;
  no request reached the beacon from any static or click route, nor from the frame navigating itself (the host's
  narrowed `frame-src` blocks it before a request is sent).
- **Why no resident JavaScript is a security rule, not a missing feature:** a script in the sandboxed frame sent
  WebRTC (STUN) datagrams despite `connect-src 'none'` in Chromium, and a script loop froze WebTown in all three
  engines. Do not enable resident JavaScript without a new spike and, before public use, a separate site origin.
- Not measurable with the spike's beacon: `preconnect`/`dns-prefetch` (no engine preconnected even unrestricted)
  and Firefox WebRTC (its control showed no UDP). The builder removes the former; without script, neither applies.
- Playwright's WebKit is not branded Safari; Safari and mobile browsers are untested.
### Messages, links and SVG

- Every `message` handler checks `event.source` against the one window it
  expects, validates a closed schema, rate-limits, and never forwards anything to
  the event bus or the bridge.
- External links open only from WebTown's own chrome after the player confirms,
  with `noopener noreferrer`, and only if the URL policy passes.
- SVG files are rendered only as image resources (`<img>`, CSS), never as
  documents.
- Uploads: allow-listed types, checked by content signature, sanitised paths, and
  the approved limits (1 MB text, 5 MB binary, 50 MB and 500 files per site).
## Phase 3b — planned security model (not implemented)

Needs its own spec and review before any code. Supabase is the preferred provider
(architectural approval only; the `@supabase/supabase-js` runtime-dependency
exception is decided in that spec).

- **Authentication:** real accounts (Supabase Auth). Reads are anonymous.
  `canEditHouse` is replaced by "session user owns this house".
- **Authorization:** Row Level Security derives ownership from `auth.uid()`.
  Insert / update / delete only on rows whose house the user owns; Storage
  policies check the path's house segment. The client never supplies `ownerId`.
- **Claiming a house** is a server-side operation with a uniqueness constraint.
- **Server-side validation:** check constraints (lengths, dimensions, byte size),
  50-per-house limit, bucket size and MIME limits, PNG signature check,
  JSON-schema check of website content.
- **Secrets:** only the anon key ships to the browser. The service-role key is
  never in the repo, bundle or logs. `.env*` stays ignored.
- **Abuse:** per-user rate and quota limits, a Content-Security-Policy limiting
  `img-src` and `connect-src`, and a moderation and reporting plan **before any
  public launch**. Support deletion of a user's data.
- **Concurrency:** compare-and-swap on `updated_at` so one device cannot silently
  overwrite another.