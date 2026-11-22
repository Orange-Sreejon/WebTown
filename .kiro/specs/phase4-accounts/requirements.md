# Phase 4: Accounts, Guest Identity and Persistence - Requirements

Supersedes the Phase 3b plan in `.kiro/steering/security.md` and `.kiro/specs/personal-spaces-mvp/` (P3B-01 to P3B-04).
Brief: "WebTown Phase 4 - Accounts, Guest Identity & Persistence". Guest first: play at once, secure progress later.

## Audit (what exists, branch `feature/phase-3-personal-spaces` at `2eacdce`)

| Area | Where | Stored today | Lost on |
|---|---|---|---|
| Ownership | `game/config/ownership.ts`: `LOCAL_PLAYER_HOUSE_ID = 'house-a'`, `?owner=` in dev | hard-coded | n/a: not real |
| House assignment | same | hard-coded `house-a` | n/a |
| Houses | `game/config/houses.ts`: seven slots `house-a` .. `house-g` on the town map | code | n/a |
| Furniture | `game/maps/house/house-layout-store.ts`, `InMemoryHouseLayoutStore`; `HouseLayout { houseId, templateId, schemaVersion, items[] }` with per-layout migrations | **memory only** | every reload |
| Website (HTML/CSS) | `site-project-storage/*`, IndexedDB `webtown` v2 `siteProjects` + `siteAssets` | this browser | clearing site data, other devices |
| Legacy structured site | `site-storage/*`, IndexedDB `sites` (read for conversion only) | this browser | same |
| Sketchbook | `artwork-storage/*`, IndexedDB `artworks` (PNG + metadata, 50 per house) | this browser | same |
| Profile, settings | none | none | n/a |
| Access | `AppView.mode` from Phaser's `canEditHouse`; `*AccessFor` hands visitors readers only; `guard*Writer` | client-side only | n/a |

The repository interfaces (`HouseLayoutStore`, `SiteProjectReader/Writer`, `ArtworkReader/Writer`) were written so a
backend could replace IndexedDB without touching the UI. Every save path already has a version check
(`SiteSave.baseRevision`) or can take one.

## Requirements

### A1 Guest first
1. A first visit signs the player in anonymously (Supabase Anonymous Auth) with no screen or form, and the game starts.
2. A guest is an authenticated user with a stable user ID that owns their world, house and creations.
3. A reload restores the existing session; a new anonymous user is created only when there is no session.

### A2 Permanent accounts
1. Sign up, log in and log out with email and password, with validation, loading and error states.
2. Account settings: display name, email (shown), password, log out.
3. A permanent user who logs out and back in sees the same progress.

### A3 Upgrading a guest
1. A guest upgrades by linking an email identity with Supabase's supported flow (`updateUser({ email })`, verify, then set a
   password). The user ID does not change, so nothing has to be moved.
2. Email verification is handled: "check your email" until confirmed, then "choose a password".
3. An email that already has an account is never merged silently: the guest is told, and may keep playing as a guest or
   log in to that account knowing the guest's progress stays with the guest.
4. Guests are told, without nagging, that their progress cannot be recovered if the guest session is lost before upgrading.

### A4 Profile
`profiles`: user ID, display name, avatar key, settings, created and updated times. Separate from `auth.users`. No
authorisation decision reads user metadata.

### A5 Worlds and houses
1. Worlds with ID, name, owner, created time, members with roles, and houses with stable IDs, one per map slot.
2. Each player gets a personal world on first start and owns one house in it (slot `house-a`). Other slots exist and are
   unowned (visitable, empty). The model allows shared worlds later (several members, one house each).
3. One owner per house; at most one house per user per world; assignment is persisted and made only by the database.
4. The game's "can I edit this house" answer comes from the assignment, not from a constant or the URL.

### A6 Persistence
1. Furniture: layout (type, position, rotation, attachment, template, schema version) per house; a reload restores it exactly.
2. Website: title, homepage, `style.css`, pages, assets (bytes in Storage), origin; per house.
3. Sketchbook: drawings (PNG in Storage), title, size, transparency; per house; reopens intact.
4. Profile and settings.
5. Structured tables with explicit ownership; JSONB only for the furniture item list and small flexible fields.

### A7 Security
1. RLS on every table with user or world data. Users edit only their profile; house owners edit only their house's data;
   world members read what their role allows; guests have exactly the protections of permanent users.
2. No client-supplied user ID is trusted; ownership is checked in the database. Storage paths are checked against the
   house the path names.
3. Only the publishable (anon) key ships; no service-role key anywhere in the repository or bundle.
4. RLS is tested with several distinct users, anonymous and permanent, against real PostgreSQL.

### A8 Loading and saving
1. Order: session, user, profile (created if missing), world membership, assigned house, then each feature on demand.
2. Saves are explicit (furniture, website) or debounced (sketchbook); never per pointer move.
3. Every save is compare-and-swap on a revision, in one transaction; a stale save is refused, never applied.
4. Clear save status; network failures keep the work in the editor and say so.

### A9 Local data migration
1. On the first start with an account, the owner's local website and drawings (IndexedDB) are copied into the account.
2. Idempotent: an import receipt per item in the database, so repeats never duplicate; failures retry next start.
3. Conflicts: cloud wins for the website (the local copy is left untouched on the device); drawings are added.
4. Local data is imported into the first account that starts on the device only.

### A10 Guest limits, communicated
A small, persistent "Guest" control; one sentence on what upgrading does; no pop-ups, no blocking.

### A11 Without a backend
If Supabase is not configured, the app runs as in Phase 3a (this device only) and says so. If it is configured but
unreachable at start, the player can retry or play on this device only.

## Out of scope
Multiplayer sync, realtime, chat, visual builder, friends, trading, marketplace, moderation, admin dashboard, OAuth
providers, password reset email (can be added with `resetPasswordForEmail`), avatar artwork.

## Acceptance (brief section 12)
Items 1 to 19 of the brief. Items that need a live Supabase project (anonymous sign-in, session restore, email
verification) are covered by the live suite (`tests/live/`) and run when a project is configured; everything in the
database (schema, RLS, functions, idempotency) is tested against real PostgreSQL (PGlite) in `npm test`.
