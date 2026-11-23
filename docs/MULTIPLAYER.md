# WebTown multiplayer (Phase 5)

Several players share one town: an owner invites people, they join with a link, and everyone in the world sees
everyone else walk around, in the town and inside the same house, and can wave. Design and decisions:
`.kiro/specs/multiplayer/`.

## How it works

- **Worlds and invitations** are in the database (`supabase/migrations/20261201090000_phase5_multiplayer.sql`).
  Every player owns their personal world (Phase 4). The owner creates an invitation in the town window
  ("Town: ..." button, bottom left): a code like `K7QF-M2XD-9HTR` and a link `/?invite=CODE`. Only a hash of the
  code is stored; the code is shown once. Invitations expire after 7 days and can be revoked.
- **Joining** makes you a resident with the first free house. A world holds **7 players** (one per house). Joining
  twice changes nothing. A resident can leave (their house there is emptied); the owner can remove residents.
  "Your towns" switches between your own town and towns you joined; the choice is remembered on the device.
- **Live state** goes over Supabase Realtime, one private channel per world (`world:<id>`), never through the
  database tables. Only members can use a world's channel: the policies on `realtime.messages` check membership
  with the player's own login.
  - Presence says who is connected and where they stand (re-sent at most once a second while walking).
  - Movement is broadcast at most 10 times a second while walking, once when stopping, and not at all when
    standing.
  - Waves and emotes are broadcast too.
- **Drawing other players**: positions are drawn a little in the past (about 170 ms, more for a slow sender), between
  received positions, so they walk smoothly and never step back. Names and looks come from the member list in the
  database, not from what a client sends.
- **Waving**: stand next to someone (within 48 px) and press **Q**, or use the Wave button (bottom right). The heart,
  laugh and surprise buttons show an emote above you for everyone.
- **Looks**: six colours of the traveller, chosen in the account window ("Your look"); until chosen, one is
  picked from the player's id.
- Without a Supabase project configured, WebTown is single-player exactly as before.

## Setting up a Supabase project

Everything in `docs/ACCOUNTS.md`, then:

1. Apply the new migration (`supabase db push`, or paste it into the SQL editor after the Phase 4 ones).
2. **Realtime** must be enabled for the project (it is by default). WebTown uses private channels only. In
   Project Settings > Realtime you can turn off "Allow public access" so that public channels can't be used at all.
3. Nothing else: no Edge Function, no server, no extra key. The browser still only has the publishable key.

## Testing

- `npm test`: the schema (PGlite), the protocol, the session (two or three sessions over an in-memory realtime hub)
  and the town window.
- `npm run test:multiplayer`: **two real players in two different browsers** (Chromium and Firefox, separate
  storage) running the production app and supabase-js against a local Supabase stand-in
  (`tests/multiplayer/emulator.mjs`). The stand-in runs the real migrations and policies on PGlite and speaks Auth,
  RPC and the Realtime WebSocket protocol, but it is not Supabase. It needs no Docker and no account. The tests
  take minutes, because each page renders the game in software WebGL.
- `npm run test:live` with `WEBTOWN_LIVE=1`: the same two-player flow against a real Supabase test project
  (`tests/live/multiplayer.spec.mjs`), including a stranger being refused by the channel policy.

## Limits (MVP)

- **Clients are trusted for their own position.** A member of a world can send any position or emote for
  themselves, or impersonate another session in that world. They can't do this in other worlds, can't change names
  or looks, and can't touch saved data. The `RealtimeTransport` interface lets a server-checked relay replace this
  later.
- **Removing a member** stops their database access at once. Their open live connection keeps receiving until it
  reconnects or their token is refreshed (Supabase checks channel policies when joining). Everyone else stops
  showing them at once.
- **Inside a house** everyone sees everyone, but the room itself is not synchronised. Furniture changes, websites and
  drawings show on the next visit.
- **Files are left behind:** when a resident leaves, their old house's files in Storage (website images, drawings)
  can no longer be reached, but they are not deleted.
- **No new player art yet:** the six looks are recolours. `public/assets/WaterNPCs.zip` was not used; its licence
  is unknown (see docs/ASSETS.md).
