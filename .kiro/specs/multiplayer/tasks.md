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