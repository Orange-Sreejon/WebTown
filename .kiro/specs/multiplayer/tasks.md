# Phase 5: Multiplayer - Tasks

Each milestone leaves `npx tsc -b`, `npm test` and `npm run build` green. No commits without the owner's approval.
Status: all done, uncommitted. The live run (`npm run test:live`) waits for a Supabase test project.

- [x] **MP-00** Audit and spec (this folder).
- [x] **M1** Invitations and membership
  - [x] Migration: `world_invites`, invitation and membership functions, `enter_world`, realtime policies; shim
        gains `realtime.messages` and `realtime.topic()`.
  - [x] PGlite tests (15).
  - [x] Client: `src/cloud/worlds.ts`, active world choice (`personal-spaces/storage/world-choice.ts`), `?invite=`
        screen, town window (members, invitations, leave, switch, join with a code).
  - [x] Component tests on the real database (5); two-browser tests (invalid code, strangers, leaving).
- [x] **M2** Presence
  - [x] `protocol.ts`, `transport.ts`, `world-session.ts`; Supabase adapter in `supabase-backend.ts`;
        `lib/multiplayer-link.ts`.
  - [x] `RemotePlayer`, pooled `RemotePlayers` in town and interior; six looks (BootScene); HUD and notices.
  - [x] Supabase stand-in (`tests/multiplayer/emulator.mjs`) and the two-browser presence test.
- [x] **M3** Movement
  - [x] Throttled sending, sender clock, adaptive render delay without extrapolation, validation (order, speed,
        rate, bounds), presence sequence, reconnect.
  - [x] Unit tests; two-browser test (smoothness per frame, rate at the server, reconnect, house, other world).
- [x] **M4** Interactions
  - [x] Nearby prompt, Q and the Wave button, emotes, bubbles, range checks at both ends, notices.
  - [x] Unit tests; two-browser test.
- [x] **MP-99** Docs (`docs/MULTIPLAYER.md`, TESTING, steering), look picker, full regression, build, audit.
## Stabilization (after the Phase 5 audit; checkpoint tag `phase5-stabilization-start`)

- [x] **B1** (High) A removed member stayed visible to everyone and kept playing: member list reloaded every 30 s and
      at once after a removal; the removed player's game leaves the channel and says so.
- [x] **B2** (Medium) A new look restarted the live session, which could reopen the channel while it was still being
      left and never join: no restart; the Supabase adapter waits for a leaving channel of the same topic.
- [x] **B3** (Medium) "Remove" deleted a resident's house in one click: now asks first.
- [x] **B4** (Low) Status line and notices covered the website and the Sketchbook: hidden there, except when urgent.
- [x] **B5** (Low) A failed "Copy link" said nothing: now says so.
- [x] **B6** (Low) Renames and new looks showed only after a reconnect: shown at the next member reload.
- [x] **P1** (High, Phase 4) Restoring a session forgot a guest when the access token alone was refused: refresh first.
- [x] **S4** (Low, hardening) `private` helpers callable by any signed-in user: migration
      `20261205090000_phase5_private_function_grants.sql`.
- [ ] **P2/P3/P4** Measure on the real test project (Realtime message use, dead-socket detection time, refusal wording).
