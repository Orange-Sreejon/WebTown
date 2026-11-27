# Community Hall - Tasks

Each milestone leaves `npx tsc -b`, `npm test` and `npm run build` green and the app runnable; no commits without
the owner's approval; each migration reviewed and dry-run before it is applied remotely.

- [x] **CH-00** Audit and spec (this folder). Owner decisions Q1-Q4 recorded in `requirements.md` (church; former members' content kept; members edit the draft; strokes without approval).

- [x] **CH-01 Hall foundation (database only)** - done: migration `20261210090000_community_hall_core.sql`,
  `src/cloud/community.ts`; its 17 tests live in `src/cloud/database/multiplayer-schema.test.ts` (sharing that file's PGlite:
  a separate PGlite made unrelated tests time out intermittently under full-suite load);
  dry run on the test project lists only this migration. **Not yet applied remotely** (waits for the owner).
  - In: migration `…_community_hall_core.sql`: `community_halls` (PK `world_id`), `after insert` trigger on
    `worlds` and backfill; `world_moderators`; `community_moderation_log` (append-only); `private.is_hall_moderator`,
    `private.realtime_hall_member` and the `realtime.messages` policies for `hall:<uuid>`; public functions
    `hall_context`, `grant_moderator`, `revoke_moderator`, `list_moderation_log`. Grants one by one (S4 rule).
  - In: PGlite tests for all of the above with stranger, member, moderator, owner, other world and anon; the grant
    list test extended; `world:<uuid>` channel rules shown unchanged.
  - In: `src/cloud/community.ts` typed, parsed wrappers and their unit tests.
  - Out: any Phaser, React or UI change; canvas and website tables; Storage; Realtime client code.
  - Done when: the migration applies on PGlite and passes `db push --dry-run` on the test project (if one exists),
    every new test passes, the full suite is green.
- [x] **CH-02 Enter the Hall** - done: church door (`COMMUNITY_HALL`, not in `HOUSES`), `InteriorScene` `place: 'hall'`
  (standard room, editing off, welcome line), the computer desk and notebook table as kiosk and easel placeholders
  ("will open here soon"), scene id `hall` in the protocol, closed without an account, `?owner=community-hall`
  refused; also fixed a pre-existing bug that cleared every room notice before it was shown. Tests:
  `src/game/systems/community-hall.test.ts` (8), `tests/multiplayer/hall.spec.mjs`, `tests/e2e/community-hall.spec.mjs`.
  Dedicated kiosk and easel art: later (new roles when the art exists).
- [x] **Test load** - Vitest projects `unit` then `database` (`vitest.config.ts`); the PGlite files are listed in
  `vitest.database-tests.ts`, and `src/test-groups.test.ts` fails if one is missing.
- [x] **CH-03 Canvas data** - migration `20261215090000_community_canvas.sql` (strokes, op log, add/hide/restore/
  clear/lock, viewport and catch-up reads, `{ seq, kind }` announcements as hints), client `src/cloud/canvas.ts`
  (validation, strict parsing), tests `src/cloud/database/canvas-schema.test.ts` (21, mutation-checked) and
  `src/cloud/canvas.test.ts` (7); shim gains `realtime.send`. Not applied remotely.
- [x] **CH-04 Canvas app** - the easel opens the Community Canvas (`src/components/community-canvas/`, loaded on
  demand from `MultiplayerHost`): pen, marker, eraser, move, palette, sizes, zoom, undo/redo, unsaved-close warning.
  `src/community-canvas/`: geometry (RDP, chunks, view), store (consistency rule), previews (validated, capped,
  15 Hz), session (one read at a time, hint-only announcements throttled to 4/s, outbox with backoff and refusal
  rollback). Migration `20261220090000_community_canvas_order.sql` (ops commit in seq order; not applied remotely).
  Stand-in delivers `realtime.send` rows. Tests: unit 31, session on PGlite 11 (mutation-checked), window 10,
  two-browser `tests/multiplayer/canvas.spec.mjs`.
  - [ ] **Still open:** H5 on the real project (does Supabase deliver `realtime.send` on `hall:<uuid>` to
    subscribers?). Needs two signed-in guests in the project; moved to CH-08 unless asked sooner.
- [ ] **CH-05a SiteTarget** - mechanical change from `houseId` to a target in `site-project`, house path unchanged,
  full suite green before anything else.
- [ ] **CH-05 Website data** - migration `…_community_website.sql`, bucket, functions, PGlite tests.
- [ ] **CH-06 Website app** - Studio in Hall mode, draft CAS, kiosk viewer, publish and rollback, editing presence.
- [ ] **CH-07 Moderation UI** - moderators panel, hide/restore, clear region, locks, audit log view.
- [ ] **CH-08 Live verification** - stand-in and real-project two-player runs, docs (`docs/COMMUNITY-HALL.md`).
- [ ] **CH-09 Noticeboard** - later milestone, specified separately.
