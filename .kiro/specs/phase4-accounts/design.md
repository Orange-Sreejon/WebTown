# Phase 4: Accounts, Guest Identity and Persistence - Design

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| C-1 | `@supabase/supabase-js` 2.119.2 (runtime, exact). Config from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; nothing else. Not configured: Phase 3a local mode | The brief names Supabase; the steering deferred the dependency decision to this spec |
| C-2 | A **personal world** per player, created by the database on first start; the player owns slot `house-a`; the other six slots exist unowned | The map has seven fixed slots. A shared global world of seven houses cannot hold more than seven players. Shared worlds later reuse `world_members` and house assignment |
| C-3 | The app keeps using slot IDs (`house-a`) inside the game and UI; the cloud layer maps slot to house UUID from the player context | Houses get stable UUIDs in the database without rewriting the game, the editor and both apps |
| C-4 | All reads and writes go through a few SQL functions (`rpc`), **security invoker** (RLS applies) except `bootstrap_player` (definer, creates world, membership and houses for `auth.uid()` only) | Compare-and-swap and validation in one transaction; a tiny client port (`rpc`, upload, download, remove) that tests can drive against real PostgreSQL |
| C-5 | Binary data (website assets, drawings) in private Storage buckets; metadata in tables. Object paths `{world}/{house}/{uuid}`, never reused: a new version is a new object, swapped in by the save function, the old one removed afterwards | A refused save can never have overwritten bytes; Storage policies check the house in the path |
| C-6 | Revisions: every saveable row has `revision`; saves pass the revision they started from; mismatch raises SQLSTATE `WTCON` (client `ConflictError`) | Stale saves cannot overwrite newer data (brief section 8) |
| C-7 | Guest upgrade: `updateUser({ email })` with `emailRedirectTo`, verify, then `updateUser({ password })`. Email already registered: no merge; choose to stay a guest or log in to that account | Supabase's supported linking; same user ID; never touches the other account |
| C-8 | First visit with no session: automatic guest. After an explicit log out: a start screen (Play as guest / Log in / Create account). The game is unmounted and remounted on every identity change | No silent new guest right after log out; no state of one identity leaks into the next |
| C-9 | RLS tests in Vitest on PGlite 0.5.17 (PostgreSQL 18.7 in WebAssembly, dev dependency) with a small shim for Supabase's `auth` and `storage` schemas and roles. Cloud repositories are tested against the same database through a test backend | No Docker on the development machine; real PostgreSQL, real RLS, multiple users |
| C-10 | Local import: website when the cloud has none (cloud wins otherwise), drawings added; receipts in `local_imports` make it idempotent; a marker in IndexedDB (database v3, store `meta`) records which account received this device's data | Brief section 9; a second account on the same device does not get a copy |

## 2. Schema (`supabase/migrations/`)

```
auth.users (Supabase)
  └─ profiles          id = user id; display_name, avatar, settings jsonb, created_at, updated_at
  └─ worlds            id, name, owner_id, kind ('personal' | 'shared'), town ('webtown-village'), created_at
       └─ world_members  (world_id, user_id) pk, role ('owner' | 'resident' | 'visitor'), joined_at
       └─ houses         id, world_id, slot ('house-a'..), owner_id → (world_id, owner_id) references world_members
            ├─ house_layouts   house_id pk, template_id, schema_version, items jsonb, revision, updated_at, updated_by
            ├─ websites        house_id pk, title, home_page, css, origin jsonb, schema_version, revision, ...
            │    ├─ website_pages   (house_id, name) pk, html, position
            │    └─ website_assets  id, house_id, name, mime_type, byte_size, storage_path unique
            └─ artworks        id, house_id, title, width, height, transparent, byte_size, storage_path, revision, ...
  └─ local_imports     (user_id, source_key) pk, target_id, imported_at
storage.buckets: website-assets, artworks (private, size and MIME limits)
```

Constraints: one personal world per owner (partial unique index); `unique (world_id, slot)`; one house per user per
world (partial unique index); the house owner must be a world member (composite foreign key, `on delete set null
(owner_id)`); lengths, sizes, page and asset name patterns, MIME list and dimension limits as checks; case-insensitive
unique page and asset names. Cascades: deleting a user deletes their profile, worlds (and everything in them),
memberships and receipts; deleting a world deletes its houses and their content.

Why JSONB for `house_layouts.items`: the game validates a layout as a whole (`layout-rules.ts`), items reference each
other (`attached` to a support) and are never queried one by one. The array is size-checked.

Considered and not used: a separate `house_ownership` table (one owner per house is a column; history is not needed);
a `sketchbooks` table (one per house, so `artworks.house_id` is enough).

## 3. Security

- Helper functions in schema `private` (not exposed by the API), security definer, `search_path = ''`:
  `is_world_member(world)`, `world_role(world)`, `owns_house(house)`, `can_view_house(house)`, `path_house(path)`.
- Policies (all `to authenticated`; `anon` gets nothing):
  - `profiles`: select own or a co-member's; update own (columns `display_name`, `avatar`, `settings` only).
  - `worlds`, `world_members`, `houses`: select if member; no client writes (the bootstrap function does them);
    world owner may rename.
  - `house_layouts`, `websites`, `website_pages`, `website_assets`, `artworks`: select if `can_view_house`; insert,
    update, delete if `owns_house`.
  - `local_imports`: own rows only.
  - `storage.objects` in the two buckets: select if `can_view_house(path house)`; insert and delete if `owns_house`;
    the path's world must be the house's world.
- Anonymous users use the `authenticated` role, so every rule above applies to them equally; nothing is granted to
  `anon`. The `is_anonymous` claim is not needed for any rule today.

## 4. Functions

| Function | Kind | Does |
|---|---|---|
| `bootstrap_player(display_name)` | definer | Profile if missing; personal world, owner membership, all slots, owner assigned to `house-a`; idempotent and safe in two tabs; returns profile, world, houses |
| `get_house_layout(house)` / `save_house_layout(house, base, template, version, items)` | invoker | CAS on `revision` |
| `get_website(house)` / `save_website(house, base, site, assets, deleted)` | invoker | Validates pages, homepage, totals; asset objects must exist in the house's folder; returns removed paths; optional import key |
| `list_artworks(house)` / `save_artwork(...)` / `delete_artwork(house, id)` | invoker | 50 per house (advisory lock), CAS on `revision`, swaps `storage_path` and returns the old one; optional import key |
| `imported_keys(keys)` | invoker | Which import keys this user already has |
| `update_profile(display_name, avatar, settings)` | invoker | Validated profile change |

## 5. Client

```
src/cloud/
  config.ts             env reading and validation
  backend.ts            CloudBackend port: rpc, upload, download, remove; error mapping
  supabase-backend.ts   the port and the auth port on supabase-js (the only files importing it)
  auth.ts               AuthPort and the session controller (start, guest, sign up, log in, upgrade, password, log out)
  player.ts             bootstrap result, PlayerContext, slot → house id
  cloud-layouts.ts      HouseLayoutStore on the backend
  cloud-websites.ts     SiteProjectRepository on the backend
  cloud-artworks.ts     ArtworkRepository on the backend
  local-import.ts       one-time copy of this device's data
src/components/account/  SessionGate (startup), StartScreen, AccountButton, AccountPanel
```

- `game/config/ownership.ts` asks the player context first; the URL override stays for local mode in dev only.
- `houseLayouts` becomes a facade over a swappable store (memory in local mode, cloud in cloud mode).
- `composition.ts` builds cloud or local repositories from the mode; labels come with the storage ("Saved to your
  account" / "Saved to this guest account" / "Saved on this device only").

## 6. Startup

1. Configured? No: local mode. Yes: restore session; none and not just logged out: sign in anonymously.
2. `bootstrap_player`; set the player context.
3. Local import (owner, once, non-blocking for errors: reported, retried next start).
4. Mount the game. Failure at 1 or 2: "Could not reach WebTown" with Try again and Play on this device only.

## 7. Tests

- `supabase/tests/*.test.ts` (Vitest, node, PGlite): migrations apply on the shim; RLS for owner, a second permanent
  user, an anonymous user, a non-member and the `anon` role; every function: idempotency, CAS, validation, limits,
  path checks, cascades.
- `src/cloud/*.test.ts`: auth controller with a fake auth port; cloud repositories against PGlite through a test backend
  (RPC as the signed-in user, Storage as RLS-checked rows); local import idempotency; session gate and account UI.
- `tests/live/` (Playwright): guest start, reload restores, upgrade, log out and in, two users; runs only when
  `WEBTOWN_LIVE=1` and the Supabase variables are set.
