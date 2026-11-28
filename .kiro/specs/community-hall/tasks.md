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
- [x] **CH-05a SiteTarget** - `SiteStudio` takes a `target` (`site-project/site-target.ts`); records keep `houseId`
  as the site key (`community-hall` for the Hall), so no data migration; Hall wording for shared draft and conflicts.
  House path unchanged: full suite 1702 green twice, Studio and code-editor e2e (Chromium) 10/10. Tests:
  `site-target.test.ts` (4), Hall cases in `SiteStudio.test.tsx` (3).
- [x] **CH-05 Website data** - `20261225090000_community_website.sql` (draft CAS by revision number, revisions kept
  30 + 10 published, publish/rollback logged, draft lock, `community-assets` bucket and policies, hints on the Hall
  channel; not applied remotely). Client `src/cloud/community-website.ts` (load draft/published/revision with images,
  `CommunityDraftWriter` for the Studio, publish, list, announcement parser). Tests: 16 on PGlite (13 mutations
  caught). Was: migration `…_community_website.sql`, bucket, functions, PGlite tests.
- [x] **CH-06 Website app** - the kiosk opens the Community Website (`src/components/community-website/`, loaded on
  demand from `MultiplayerHost`; the Studio a further chunk): published / draft / any kept version, "Edit the draft"
  (Site Studio with the Hall target and `CommunityDraftWriter`; refused while locked except moderators), Versions
  list, moderators' "Publish this version" with what changes and a rollback warning and a log note. Hall channel
  (`src/community-website/website-channel.ts`): who is editing (presence), save/publish hints that reload what is
  shown or warn of a newer draft in the Studio. Studio gains a `banner` slot. Tests: unit 6 (diff, channel), window
  on PGlite 6 (7 mutations caught), two-browser `tests/multiplayer/community-website.spec.mjs`; `hall.spec.mjs`
  now opens the kiosk. No migration.
- [x] **CH-07 Moderation UI** - "Moderation" in the canvas and kiosk windows (moderators only):
  `src/components/community-moderation/ModerationPanel.tsx` with the log in words (`src/community-moderation/log-text.ts`,
  "Bring back" for drawings a moderator removed, paging), locks (canvas, draft, optional note) and moderators (the owner
  appoints and removes; moderators see the list). Canvas "Clear area" tool for moderators (drag, confirm with a note).
  Migration `20261228090000_community_lock_hints.sql`: lock changes are announced (`lock`, a hint), so open canvas and
  kiosk windows show a lock at once. Tests: unit 4 + 4 (log text, canvas tools), panel on PGlite 6, session 2, kiosk 1,
  10 mutations caught. Undoing a whole clear at once (not one drawing at a time) is not built.
- [ ] **CH-08 Live verification** - stand-in and real-project two-player runs, docs (`docs/COMMUNITY-HALL.md`).
- [ ] **CH-09 Noticeboard** - later milestone, specified separately.
