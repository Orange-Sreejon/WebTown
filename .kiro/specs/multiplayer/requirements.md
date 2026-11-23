# Phase 5: Multiplayer - Requirements

Source: the Phase 5 brief (shared town, invitations, presence, movement, interactions). Branch
`feature/phase-3-personal-spaces` at `9adb7a1` (Phase 4 committed).

## Audit (what exists)

- **Accounts (Phase 4).** Supabase Auth: every first visit is an anonymous guest (`authenticated` role); a guest
  can link an email. `SessionGate` restores or creates the session, calls `bootstrap_player` and mounts the game
  afresh per identity. `src/cloud/supabase-backend.ts` is the only module that talks to Supabase.
- **Worlds.** `worlds` (owner, `kind` personal/shared, `town`), `world_members` (owner/resident/visitor),
  `houses` (one row per map slot `house-a`..`house-g`, `owner_id` must be a member, one house per member).
  `bootstrap_player` creates the caller's personal world, joins them as owner and gives them `house-a`. Nothing
  can add a second member yet: there is no invitation, join, leave or member list. RLS already scopes every read
  to members (`private.is_world_member`), and profiles are readable by anyone who shares a world.
- **Game.** Phaser 3.90, Arcade physics. `TownScene` (1280 x 1024 px map, 16 px tiles, zoom 2) creates one
  `Player` (traveller sheet, 48 x 64 frames, 3 per row, rows down/left/right/up, scale 0.55, `walk-*`/`idle-*`
  animations, speed 80 px/s, feet-based depth). Entering a house sleeps the town and launches `InteriorScene`
  for that slot (same `Player` class, its own bounds and walls); leaving wakes the town at the saved spot.
  Input is WASD/arrows, E interacts; apps (website, Sketchbook) release the keyboard via `AppSession`.
  Game and React talk through `app-bridge` / `event-bus`; module singletons (`player-identity`,
  `cloud-session`) hand account facts to the game without network imports.
- **Characters.** `public/assets/characters/tiny-cast/traveller.png` (the player); also unused:
  `Cute_Fantasy_Free/Player/Player.png` (32 x 32, a different, smaller style) and
  `Farm RPG FREE 16x16 - Tiny Asset Pack/Character/{Idle,Walk}.png` (32 x 32, another style). `profiles.avatar`
  exists (`villager` default) but nothing reads it.
- **Tests.** Vitest (1467, jsdom), PGlite running every migration under real roles and RLS
  (`src/cloud/database`), Playwright e2e in three engines without a backend, and a live suite
  (`tests/live`, `WEBTOWN_LIVE=1`) that needs a Supabase project. There is no Supabase project and no Docker on
  this machine.

## Requirements

### M1 Invitations and membership
- **R1.1** Every player owns their personal world (Phase 4). All worlds are private: only members can see
  anything in them, and nobody can find a world without an invitation.
- **R1.2** The owner creates invitations: a random code (and a link `/?invite=CODE`) that expires (default 7
  days) and can be revoked. The code is shown once; the database keeps only its hash.
- **R1.3** Anyone signed in (guest or permanent) can preview an invitation (world name, owner, how full) and join.
  Joining is idempotent (no duplicate membership), refused for invalid, expired or revoked codes, and refused
  when the world is full.
- **R1.4** A joining player becomes a `resident` and gets a free house in that world. MVP maximum: **7 members**
  (one per house slot).
- **R1.5** A resident can leave; the owner can remove a resident. Either frees the house and clears what was
  in it, so the next resident starts with an empty house. The owner cannot leave their own world.
- **R1.6** A player switches between their own world and worlds they joined. The choice is remembered on the
  device per account.
- **R1.7** All of this is enforced by the database (RLS and security-definer functions). The client never
  decides membership; world ids from the client are always checked against `auth.uid()`.

### M2 Presence
- **R2.1** Entering the game in a world joins that world's realtime channel. Only members can join it
  (authorised by RLS on `realtime.messages`).
- **R2.2** Other players in the same world appear with their character and their display name, which comes from
  the database (the member list), not from what the client sends.
- **R2.3** Joins and leaves are announced. An unexpected disconnect removes the character (presence leave on
  socket close or timeout). One character per player even with several tabs (the newest session wins).
- **R2.4** Players in different worlds never see each other.

### M3 Movement
- **R3.1** Position, facing, walking/idle and the scene (town or which house) are synchronised.
- **R3.2** At most 10 movement messages a second while moving, one when stopping, none while standing still.
  Nothing about movement is written to PostgreSQL.
- **R3.3** Remote characters are interpolated (rendered slightly in the past), extrapolate briefly over a gap,
  and snap only on a scene change or a long gap.
- **R3.4** Incoming messages are validated: shape, size, sender, sequence (stale and out-of-order are dropped),
  coordinates inside the scene, plausible speed, per-sender rate.
- **R3.5** Reconnecting restores the session without duplicate characters; remote characters that went stale
  are removed.
- **R3.6** Remote characters are seen in the town and inside the same house; the town map, its bounds and the
  local player's collision rules are unchanged.

### M4 Interactions
- **R4.1** Standing near another player shows "Q: Wave to <name>". Q sends a wave to them.
- **R4.2** Emotes (wave, heart, laugh, surprise) show above the sender for everyone in the same scene.
- **R4.3** A wave is checked for range by the sender and by the receiver (with latency slack); out of range it
  is refused with feedback ("Too far away") and ignored by the receiver.
- **R4.4** The receiver sees "<name> waved at you" and can wave back.

### UX, performance, identity
- **R5.1** Visible states: connecting, joining, connected (with player count), reconnecting, connection lost,
  failed to join, world full, invitation invalid or expired. The game never freezes on a network failure.
- **R5.2** No React re-render per movement packet; remote characters live in Phaser; sprites are pooled, not
  recreated per packet; subscriptions are cleaned up on leave, sign-out and world switch.
- **R5.3** Remote characters use the player sprite and the player's chosen appearance (`profiles.avatar`), with
  a safe fallback name.
- **R5.4** Without a backend, WebTown is single-player exactly as before.

## Out of scope
Chat, voice, friends, matchmaking, world discovery, trading, economy, combat, NPC sync, synchronised interiors
(furniture, apps), an authoritative game server, new town design.

## Acceptance
Two real authenticated sessions in two browser contexts join one world through an invitation, see each other
with correct names, walk together with smooth movement, wave, and survive a disconnect and reconnect. Verified in
the e2e suite (see design 9) and, when a Supabase project is available, in `tests/live`.
