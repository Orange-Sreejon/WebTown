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

## Phase 3a - Resident websites (HTML/CSS Site Studio)

Resident websites are files written by residents: HTML pages, one shared stylesheet (`style.css`) and images
(PNG, JPEG, GIF, WebP, SVG). They are untrusted code. The policy below **passed the S-01 sandbox spike** in Chromium,
Firefox and WebKit (`docs/site-sandbox-findings.md`) and is **implemented** (`.kiro/specs/website-studio/`);
`npm run test:e2e` checks it in the real app in all three engines. It still awaits the owner's review, and the
measured results take precedence over anything written here.

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

- There are no `.js` files. Script a resident writes into a page stays in their HTML source (WebTown never
  changes their code) but **is removed before the page is shown and never runs**: no inline scripts, external
  scripts, event-handler attributes or `javascript:` URLs.
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
- Uploads: allow-listed image types only (no fonts or other files in 3a), checked by content signature, cleaned
  names (`assets/<name>`), and the approved limits (1 MB per page or stylesheet, 5 MB per image, 50 MB and 500
  files per site). Images reach the page only as `data:` URLs built by WebTown.
- Links within a page (`#name`) are written as `about:srcdoc#name`. They jump within the page in Chromium and
  Firefox; WebKit blocks them as a navigation and the page is put back. No request is made either way.
- The page builder (`site-project/builder.ts`) is the only shipped code that serialises HTML, and only from an
  inert `DOMParser` document into the sandbox. Preview and visitors use the same builder.
## Phase 4 - Accounts and the database (implemented; `.kiro/specs/phase4-accounts/`)

Supabase Auth, PostgreSQL with Row Level Security, and Storage. When a project is configured
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`), the database is the authority; without one, the Phase 3a
rules above still apply (this device only, client-side restrictions).

### Identity

- Every player is an authenticated Supabase user. A first visit signs in anonymously (a **guest**); guests use the
  `authenticated` role and get exactly the protections of permanent users. Nothing is granted to `anon`.
- A guest upgrades by linking an email to the same user (`updateUser({ email })`, confirm, then a password), so the
  user id and everything it owns stay. An email that already has an account is **never merged**; the guest is told.
- Never trust client-provided user ids or user metadata for any decision. Ownership comes from `auth.uid()` and the
  `houses.owner_id` assignment, made only by `bootstrap_player` (security definer, for `auth.uid()` only).

### Rules the database enforces (tested in `src/cloud/database/schema.test.ts`)

- RLS on every table with user or world data. Members read their world; only a house's owner writes its layout,
  website, pages, assets and drawings; users change only their own profile (columns `display_name`, `avatar`,
  `settings`). Worlds, memberships and house assignment cannot be written by clients at all.
- Storage: two private buckets with size and MIME limits; paths are `{world}/{house}/{file}` and the policies check
  that the house is in that world and that the caller owns it (write) or is a member (read). Files are never
  overwritten; a new version is a new file.
- Every save is compare-and-swap on a `revision` inside one transaction (SQLSTATE `WTCON` on conflict); a stale save
  is refused, never applied. Website saves check pages, homepage, totals and that every asset was uploaded into the
  house's own folder.
- Database functions are `security invoker` (RLS applies) except `bootstrap_player`; all have `search_path = ''`
  and are executable by `authenticated` only. Helpers live in schema `private`, not exposed by the API.
- `authenticated` may execute a `private` helper only if an RLS policy or a security-invoker function needs it
  (migration `20261205090000_phase5_private_function_grants.sql`). Never `grant execute on all functions in schema
  private`; grant each new helper on its own, and extend the grant-list test in
  `src/cloud/database/multiplayer-schema.test.ts`.
- Any change to these rules is a new migration in `supabase/migrations/` plus a test that tries to break it.
  Never edit the schema in the dashboard.

### Secrets

- Only the publishable key ships. The secret / service-role key is never in the repository, a `VITE_` variable, the
  bundle or logs; `readCloudConfig` refuses one and `source-safety.test.ts` scans for it. `.env*` stays ignored.
- `@supabase/supabase-js` is imported only by `src/cloud/supabase-backend.ts` and loaded only when configured.

### Not done yet (before any public launch)

- Abuse controls: CAPTCHA or Turnstile on sign-ins (anonymous sign-ins can be scripted), rate and quota limits per
  user, cleanup of abandoned guests and their Storage files.
- Server-side content checks beyond types and sizes: image signatures are checked by the client only (the bucket
  checks the declared MIME type), and website HTML is only sanitised when shown (in the sandbox).
- A Content-Security-Policy for WebTown itself, moderation and reporting, and deleting one's own account from the UI.