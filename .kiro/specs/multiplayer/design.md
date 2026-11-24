# Phase 5: Multiplayer - Design

## 1. Decisions

| # | Decision | Why (rejected alternatives) |
|---|----------|-----------------------------|
| D1 | Transport: **Supabase Realtime Broadcast + Presence** on one private channel per world, `world:{uuid}`. | Already in `@supabase/supabase-js` (no new dependency), authenticated with the user's JWT, authorised by RLS. Rejected: `postgres_changes` (a database write per step), a custom WebSocket server (new infrastructure), WebRTC (NAT, signalling). |
| D2 | Channel access by **RLS on `realtime.messages`**: read and write only for members of the world in the topic. | The Supabase way to authorise private channels; the same `world_members` table decides as for everything else. |
| D3 | The world you own is your personal world; **invitations bring others in as residents with a free house**. Max **7 members** = 7 house slots. | Reuses Phase 4 houses and RLS unchanged; a member always has a house, so building, websites and drawings work for them in that world. Rejected: memberless visitors (no house), extra worlds per player (not needed for the MVP). |
| D4 | Invite code: 12 random base-32 characters (60 bits, `XXXX-XXXX-XXXX`), **only its SHA-256 is stored**, default expiry 7 days (1 to 30), revocable, at most 20 open invitations per world. | Unguessable, a database leak exposes no usable code. The owner makes a new one instead of re-reading an old one. |
| D5 | Leaving or being removed **replaces the house row** (its layout, website and drawing rows go with it by cascade) and clears membership. | The next resident starts empty. Storage files of the old house become unreachable (their path names the old house id) but are not deleted; noted as a limitation. |
| D6 | The active world is chosen before the game starts and remembered per account on the device; switching remounts the game (as Phase 4 does per identity). | Every module the game reads (houses, ownership, storage) is built for one world; remounting keeps that true. |
| D7 | Movement: send at most **10 Hz while moving**, one on stop, nothing while idle; **presence** carries the last resting state (re-tracked at most 1 Hz) so newcomers place everyone at once. | Bounded traffic (a full world: 7 x 10 msg/s at worst) and correct initial state without a "who is where" request. |
| D8 | Receivers render remote players **120 ms in the past**, interpolating between snapshots, extrapolating up to 150 ms, snapping on a scene change or a jump over 96 px. | Smooth with 10 Hz input and normal jitter; no rubber-banding. |
| D9 | **Names and appearance come from the member list** (database, RLS), keyed by the user id in presence; presence entries whose user is not a member are ignored. | A client can't show itself under an invented name or smuggle a non-member in. |
| D10 | Appearance: the traveller sprite in **6 recoloured variants** (hat and shirt hue), chosen in the account panel, default derived from the user id. | Consistent art; the other two character packs are a different style and size. More characters are a content question for the owner. |
| D11 | The game sees multiplayer only through `src/lib/multiplayer-link.ts` (no network imports); Supabase realtime is wrapped in `src/cloud/supabase-realtime.ts`; the protocol and session logic in `src/multiplayer/` are pure and depend on a `RealtimeTransport` interface. | Phaser code doesn't know the transport; the logic is unit-testable; a server-authoritative transport can replace it later. |

## 2. Schema (migration `20261201090000_phase5_multiplayer.sql`)

```
world_invites (id uuid pk, world_id fk worlds cascade, code_hash text unique, hint text (last 4),
               created_by uuid, created_at, expires_at, revoked_at null, uses int default 0)
```
RLS on, no table grants: only functions touch it. Max members is `private.max_world_members()` (7).

Functions (all `security definer`, `search_path = ''`, `auth.uid()` only; errors use SQLSTATE `42501` (not
allowed), `22023` (message for the player), and `WTINV` invalid/revoked, `WTEXP` expired, `WTFUL` full):

| Function | Who | What |
|---|---|---|
| `create_world_invite(p_world, p_days)` | world owner | new code, returns `{id, code, hint, expiresAt}` |
| `list_world_invites(p_world)` | owner | open and past invitations, without codes |
| `revoke_world_invite(p_invite)` | owner | sets `revoked_at` |
| `preview_world_invite(p_code)` | anyone signed in | `{world, owner name, members, max, alreadyMember}` or WTINV/WTEXP |
| `join_world(p_code)` | anyone signed in | locks the world row, refuses full, adds membership and a free house, counts the use; already a member: returns the world unchanged |
| `leave_world(p_world)` | resident | membership and house reset (D5) |
| `remove_world_member(p_world, p_user)` | owner | same, for another member |
| `list_my_worlds()` | caller | the worlds they belong to, with role and member count |
| `list_world_members(p_world)` | member | `{userId, displayName, avatar, role, slot}` |
| `enter_world(p_world)` | member | the same answer as `bootstrap_player`, for that world |

`bootstrap_player` is unchanged (it still makes sure the personal world exists).

Realtime (`realtime.messages`, exists in every Supabase project):
```
select: extension in ('broadcast','presence') and private.realtime_world_member(realtime.topic())
insert: the same
```
`private.realtime_world_member(topic)` accepts only `world:` + a UUID and checks membership.

## 3. Networking architecture

```
Phaser (TownScene, InteriorScene)
  RemotePlayers (pool of RemotePlayer sprites)        ── reads ──┐
  Player state each frame ── publishLocal() ──┐                  │
                                              v                  │
src/lib/multiplayer-link.ts   (MultiplayerLink interface, set/clear by the app; no network)
                                              ^
src/multiplayer/world-session.ts  (status machine, roster, throttle, validation, interpolation buffers, emotes)
  protocol.ts (typed messages + validators)   interpolation.ts   rate-limit.ts
                                              ^
RealtimeTransport (interface)  <- src/cloud/supabase-realtime.ts (supabase-js channel, private, presence key)
```

React (`MultiplayerHud`) subscribes to **status and roster changes only** (join/leave/name), never to positions.

### Messages (broadcast events, JSON, at most 512 bytes after validation)

| Event | Payload | Notes |
|---|---|---|
| `mv` | `{v:1, s, q, x, y, f, w, sc}` | s: sender session id, q: sequence, x/y: feet (px, 1 decimal), f: `u/d/l/r`, w: walking 0/1, sc: `town` or `house:<slot>` |
| `em` | `{v:1, s, q, e, to?}` | e: `wave/heart/laugh/surprise`; `to`: target session (wave) |

Presence meta (key = session id): `{v:1, s, u, x, y, f, sc}`; `u` is the user id. Presence is re-tracked on
stop, scene change, and at most once a second.

### Receiving
1. Shape check (types, ranges, lengths); unknown events ignored.
2. The sender session must be in presence and its user a member (D9); otherwise held up to 2 s for presence
   to arrive, then dropped.
3. Per-sender token bucket: 20 messages/s, burst 30; above it, dropped and counted.
4. `q` must be greater than the last accepted (stale or reordered dropped; a smaller `q` after a presence rejoin
   resets the counter).
5. Coordinates must be inside the scene's bounds (town 1280 x 1024; a house at most 1024 x 1024).
6. Speed: a move implying more than 3 x the walk speed in the same scene is dropped unless 2 s have passed
   since the last accepted one (then it resyncs as a snap).

### Connection states
`idle -> connecting -> joined` ; `joined -> reconnecting` (channel error, timeout, socket closed) with backoff
1, 2, 4, 8, 15 s; after 60 s of failure, `lost` (with a Retry button); `failed` when the server refuses the
channel (not a member). The game keeps running in all states; remote players fade out when they go stale.

### Stale presence
Supabase removes presence on socket close. Locally, a remote player that sent nothing (move or presence) for 30 s
while marked walking stops walking, and one whose presence leaves is removed at once. Several sessions of one
user: only the session with the newest presence `joinedAt` is shown.

## 4. Data flow

1. Sign-in (Phase 4) -> `bootstrap_player`.
2. `?invite=CODE` present -> preview -> the player confirms -> `join_world` -> the world becomes the active one.
3. Active world = remembered choice if still a member, else the personal world -> `enter_world` -> the
   `PlayerContext` of that world (houses, owned slot) -> game mounted.
4. `list_world_members` -> roster names; the world session joins `world:{id}` and tracks presence.
5. Each frame the scene calls `link.publishLocal({x, y, f, walking, scene})`; the session throttles and sends.
6. Each frame `RemotePlayers.update(now)` asks the link for interpolated remote states in the current scene.
7. On presence join of an unknown user, the member list is refreshed once (rate-limited).

## 5. Interactions
Greet range 48 px (feet to feet) for the sender; the receiver accepts up to 48 + 32 px of slack measured on
the sender's last known position. Emote cooldown 1 s per sender (client), also covered by the rate limit.
Bubbles: Phaser text above the head for 2.5 s; one at a time per character.

## 6. Security and limitations
- Realtime channels are private, authorised by RLS with the user's JWT. Cross-world traffic is impossible by
  topic and by policy.
- Client broadcasts are **not authoritative**: a member of a world can send any position for themselves, or
  pretend to be another session of that world. They cannot affect persistent data, other worlds or names. A
  server-authoritative transport (e.g. an Edge Function relay that stamps the sender) can replace
  `RealtimeTransport` later without changing the game.
- Removing a member stops their database access at once; their open realtime connection keeps receiving until
  it rejoins or its token is refreshed (Supabase checks channel RLS at join and on token refresh). Players reload
  the member list every 30 s while joined (the owner at once after a removal), so a removed member disappears for
  everyone within that time, and the removed player's own game leaves the channel (stabilization B1; the first
  version reloaded only for unknown players, so a removed member stayed visible).
- No service-role key in the browser (Phase 4 `readCloudConfig` refuses one).

## 7. UX
- Status pill (top left): Connecting... / In <world> · N players / Reconnecting... / Connection lost (Retry) /
  Couldn't join this world.
- Toasts: "<name> joined", "<name> left", "<name> waved at you".
- World panel (from the account panel): world name, members (remove, for the owner), invitations (create,
  copy link, revoke), switch world, leave.
- Join screen for `?invite=`: world, owner, "N of 7 players"; Join / Not now; errors: invalid, expired, full.

## 7a. Appearance
`avatar` values `traveller-0` .. `traveller-5`; anything else (including the Phase 4 default `villager`) maps to
a variant derived from the user id. Variants are generated at boot by shifting the hue of the hat and shirt
pixels of the traveller sheet, so all six share the existing animations and frame layout.

## 8. Performance
One channel per world; outbound <= 10 msg/s; inbound handled in a plain object map; sprites pooled (hidden, not
destroyed, when someone leaves a scene); one React update per roster change.

## 9. Testing
- **PGlite (Vitest):** every function and policy with several users: create, preview, join, idempotent join,
  invalid, expired, revoked, full (8th member), leave, remove, house reset, non-member refused, cross-world
  isolation, `realtime.messages` read/write only for members.
- **Unit:** protocol validators (malformed, oversized, out of bounds), throttle, interpolation, rate limit,
  world session with an in-memory transport (two sessions, joins, leaves, reconnect, stale, duplicates, emotes,
  range).
- **Two real sessions in real browsers (Playwright, two browser contexts):** a local **Supabase emulator**
  for tests only (`tests/multiplayer/`): GoTrue anonymous sign-in with HS256 JWTs, PostgREST RPC and the Realtime
  WebSocket protocol (Phoenix v2, broadcast and presence), all on PGlite running the real migrations. Channel
  joins are authorised by running the real `realtime.messages` policies as the user. The app under test is the
  production client (supabase-js) with only `VITE_SUPABASE_URL` pointing at the emulator. This is not Supabase;
  the same flows run against a real project in `tests/live` when one is configured.
- **Regression:** the full Vitest and e2e suites (single-player, editor, websites, Sketchbook).
