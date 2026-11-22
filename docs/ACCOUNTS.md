# WebTown accounts (Phase 4): setting up Supabase

WebTown runs on this device only until it is given a Supabase project. With one, every player is signed in at
once as a guest, gets their own world and house in the database, and can later add an email to keep their
progress. Spec: `.kiro/specs/phase4-accounts/`.

## 1. A project

Create a Supabase project (use a separate **test** project for `npm run test:live`). Then, in the dashboard:

| Where | Setting | Why |
|---|---|---|
| Authentication > Sign In / Providers | **Allow anonymous sign-ins**: on | Guests |
| Authentication > Sign In / Providers | **Allow manual linking**: on | A guest links an email to their own user |
| Authentication > Sign In / Providers > Email | **Confirm email**: on (off only in the test project) | Guests confirm the email they link |
| Authentication > URL Configuration | **Site URL** and **Redirect URLs**: where WebTown is served (e.g. `http://localhost:5173`, your production URL) | Confirmation links bring players back |
| Authentication > Attack Protection | CAPTCHA or Turnstile, recommended before going public | Anonymous sign-ins can be abused to fill the database |

`supabase/config.toml` holds the same settings for a local stack.

## 2. The schema

Apply `supabase/migrations/*.sql` in file-name order, either with the CLI:

```
npx supabase link --project-ref <ref>
npx supabase db push
```

or by pasting each file, in order, into the dashboard's SQL editor. Never change the schema in the dashboard by hand;
add a migration file instead.

The migrations create the tables, every RLS policy, the functions the app calls and the two private Storage
buckets (`website-assets`, `artworks`). They are tested against real PostgreSQL in `npm test`
(`src/cloud/database/schema.test.ts`, on PGlite with a shim of Supabase's `auth` and `storage` schemas).

## 3. The app

Copy `.env.example` to `.env.local` and set:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the **publishable** key. The secret (service role) key must never be in a `VITE_` variable, in the
repository or in the bundle; WebTown refuses to start with one.

## 4. Checking it

- `npm test`: schema, RLS (several users, guests and permanent), functions, cloud repositories, local import,
  session and account UI.
- `npm run test:live` (`WEBTOWN_LIVE=1`, `WEBTOWN_LIVE_SUPABASE_URL`, `WEBTOWN_LIVE_SUPABASE_KEY`; test project with
  "Confirm email" off): guest start, reload keeps the same guest and town, furniture and drawings persist, upgrade
  keeps the user id, log out and back in, an email already registered is not merged, and one player's token
  cannot read or change another's house.

## What lives where

| Data | Table | Binary |
|---|---|---|
| Profile and settings | `profiles` | |
| World, members, houses and who owns which | `worlds`, `world_members`, `houses` | |
| Furniture | `house_layouts` (item list as JSONB, revision) | |
| Website | `websites`, `website_pages`, `website_assets` | `website-assets/{world}/{house}/{asset}` |
| Sketchbook | `artworks` | `artworks/{world}/{house}/{file}.png` |
| Device data already copied | `local_imports` | |

## Housekeeping

Guests who never come back stay in `auth.users`. Supabase has no automatic cleanup; to remove guests older than 30
days (and, by cascade, everything they own), run as an administrator:

```sql
delete from auth.users where is_anonymous is true and created_at < now() - interval '30 days';
```

Storage files of deleted users are not removed by that cascade; delete their folders from the two buckets too.
