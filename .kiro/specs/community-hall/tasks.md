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
- [ ] **Test load** - before CH-03 adds more database tests: run PGlite tests as their own, less parallel Vitest group
  instead of packing them into one file.
- [ ] **CH-03 Canvas data** - migration `…_community_canvas.sql`, stroke encoding, functions, PGlite tests.
- [ ] **CH-04 Canvas app** - React canvas (pan, zoom, tools, chunk loader, undo/redo), `hall-session` on
  `hall:<uuid>` (previews, op catch-up), H5 verified on the test project; two-browser tests.
- [ ] **CH-05a SiteTarget** - mechanical change from `houseId` to a target in `site-project`, house path unchanged,
  full suite green before anything else.
- [ ] **CH-05 Website data** - migration `…_community_website.sql`, bucket, functions, PGlite tests.
- [ ] **CH-06 Website app** - Studio in Hall mode, draft CAS, kiosk viewer, publish and rollback, editing presence.
- [ ] **CH-07 Moderation UI** - moderators panel, hide/restore, clear region, locks, audit log view.
- [ ] **CH-08 Live verification** - stand-in and real-project two-player runs, docs (`docs/COMMUNITY-HALL.md`).
- [ ] **CH-09 Noticeboard** - later milestone, specified separately.
