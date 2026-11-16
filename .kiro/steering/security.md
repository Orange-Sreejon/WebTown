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
- Colours: accept only validated `#RRGGBB`. Fonts: fixed allow-list. Lengths and
  counts: capped on write and on read. Strip control characters.
- External links: `https:` only, no credentials, no `localhost` / `.local` /
  `.internal` / IP-literal hosts, length ≤ 2048. Open with `target="_blank"` and
  `rel="noopener noreferrer"`. Invalid stored links render as inert text.
- Internal navigation never touches `window.location`, the hash or history.
- Images: PNG only (magic-byte check), ≤ 2 MB, dimensions ≤ 1024, at most 50 per
  house. Show through object URLs and revoke them on unmount.
- The Paint reference screenshot (`inspiration-art/paint-reference.png`) is a
  local-only development reference: git-ignored, outside `public/`, never committed, never
  in `dist/`. Do not move it under `public/` or `docs/`.
- `fake-indexeddb` is a dev dependency used by tests only; it must not appear in
  `dist/`.

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