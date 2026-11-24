# Phase 5 multiplayer: stabilization report

Starting point: commit `115419c`, tagged `phase5-stabilization-start` (compare with `git diff phase5-stabilization-start`).
Nothing is committed. The audit and the decisions behind each fix are in `.kiro/specs/multiplayer/tasks.md`
("Stabilization").

## Fixed

| # | Severity | Problem | Fix | Regression tests |
|---|---|---|---|---|
| B1 | High | A removed member stayed visible to everyone (and could wave), and their own game went on as if nothing happened; the member list was only reloaded for unknown players. The docs claimed the opposite. | Players reload the member list every 30 s while joined, and the owner's game at once after a removal (`membersChanged`). A player the database no longer lists gets the state "removed": the channel is left, nobody is shown, the status line says "You're no longer in this town." with "Go to my town". A non-member still in presence no longer causes a reload on every presence change. | `src/multiplayer/world-session.membership.test.ts` (6), `src/components/multiplayer/MultiplayerHost.test.tsx`, `tests/multiplayer/invitations.spec.mjs` "the owner removes an online resident" (passes in the stand-in suite, see Results) |
| B2 | Medium | Changing your look while online restarted the live session; reopening the same channel while the old one was still being left could leave the player on "Connecting..." for good (realtime-js reuses a leaving channel, which never joins again). | The host no longer restarts on a new look (others see it at the next member reload). The Supabase adapter waits for a leaving channel of the same topic to close before opening it again (also protects Retry). | `src/cloud/supabase-realtime.test.ts` (3), `MultiplayerHost.test.tsx` |
| B3 | Medium | "Remove <name>" deleted the resident's house, website and drawings in one click. | Asks first ("Remove and delete their house" / "Keep <name>"). | `src/components/multiplayer/worlds-gate.test.tsx`, the browser test above |
| B4 | Low | The status line and notices were drawn over the website and Sketchbook windows. | Hidden while an app or the furniture editor is open, except "Connection lost", "Couldn't join" and "removed". | `MultiplayerHost.test.tsx` |
| B5 | Low | "Copy link" failed silently where there is no clipboard (plain-http addresses). | "Couldn't copy here. Select the link above and copy it." | `worlds-gate.test.tsx` |
| B6 | Low | New names and looks showed only after a reconnect. | Shown at the next member reload (B1). | `world-session.membership.test.ts` |
| P1 | High (Phase 4) | Restoring the saved session forgot it whenever the server refused the access token, e.g. a device clock running behind; for a guest that loses their town for good. | Refresh once first; forget only when the refresh itself is refused (4xx other than 429). Network and server errors keep the session, as before. | `src/cloud/supabase-auth-restore.test.ts` (5; the old rule fails 3 of them) |
| S4 | Low (hardening) | Every `private` function, including `drop_member(world, user)` and `player_context(user, world)` (SECURITY DEFINER, any ids), was executable by signed-in users. Not reachable today (the Data API exposes only `public`). | Migration `supabase/migrations/20261205090000_phase5_private_function_grants.sql` revokes the 9 functions only SECURITY DEFINER code calls. Kept: the 6 used by RLS policies, `house_folder` and `iso` (used by invoker functions), the trigger function. Checked against `pg_policies` and every function body; every app workflow still passes. | `src/cloud/database/multiplayer-schema.test.ts` (exact grant list; direct calls refused; removal still works) |

Every regression test was checked to fail without its fix (removing the fix temporarily, then restoring it).

## Database migration

`20261205090000_phase5_private_function_grants.sql`: `revoke execute` on `private.drop_member`, `player_context`,
`is_world_owner`, `need_user`, `new_invite_code`, `invite_hash`, `normalise_invite`, `max_world_members`, `town_slots`
from `authenticated`, `anon`, `public`. No table, policy or data changes; reversible with the matching `grant`.
Future migrations must not grant all of `private` again (rule added to `.kiro/steering/security.md`).

## Files changed

- Application: `src/multiplayer/world-session.ts`, `src/lib/multiplayer-link.ts`,
  `src/components/multiplayer/MultiplayerHost.tsx`, `src/components/multiplayer/WorldPanel.tsx`,
  `src/components/multiplayer/multiplayer.css`, `src/components/account/account.css`,
  `src/components/account/SessionGate.tsx` (passes "Go to my town"), `src/cloud/supabase-backend.ts`.
- Database: `supabase/migrations/20261205090000_phase5_private_function_grants.sql`.
- Tests: the files in the table above.
- Docs: `docs/MULTIPLAYER.md`, `.kiro/specs/multiplayer/design.md`, `.kiro/specs/multiplayer/tasks.md`,
  `.kiro/steering/security.md`, this report.

## Results

| Check | Before (`phase5-stabilization-start`) | After |
|---|---|---|
| Vitest | 1541 passed (91 files) | **1561 passed** (95 files) |
| `npx tsc -b` | clean | clean |
| `npm run build` | ok | ok |
| `npm audit` | 0 vulnerabilities | 0 vulnerabilities |
| Chromium (`tests/e2e`) | 12/12 (end of Phase 5) | **12/12** |
| Firefox | 12/12 | **12/12** |
| WebKit | 11/12 (intermittent "zine") | **11/12**: "a hostile page..." timed out waiting for the website frame (`website-studio.spec.mjs` line 119, the same helper as the earlier intermittent failure); it then passed 2 of 2 on its own. Not touched by these changes. |
| Two-player stand-in tests (`npm run test:multiplayer`: Chromium and Firefox as separate guests, a fresh stand-in with all four migrations) | passed at the end of Phase 5 | **6/6 passed**, one spec per run: invitations 3/3 (3.0 min), presence 1/1 (38 s), movement 1/1 (1.2 min), interactions 1/1 (37 s) |
| Live Supabase tests | not run | **Not run**: no test project configured (`tests/live/show-target.mjs`: no ref; CLI not linked). |

These runs needed the stand-in's ports, which were held by an idle, out-of-date `npm run dev:local` started by another tool
(its stand-in predated the S4 migration); it was stopped with the owner's approval. "the owner removes an online resident"
(in the invitations spec) exercises B1 and B3 end to end: confirmation, the owner stops drawing the resident, the
resident is told "You're no longer in this town." and "Go to my town" opens their own town.

## Not done, and why

- **P2** (Realtime message use with 7 players), **P3** (how long a dead socket stays visible) and **P4** (Supabase's
  real refusal wording): need the real test project. No change was made to the send rate or the retry rule.

## Remaining limits (unchanged, documented in `docs/MULTIPLAYER.md`)

Members are trusted for their own position and can impersonate another session in their world; a modified removed
client can keep listening until its token refresh; rooms (furniture, websites, drawings) are not synchronised; a
dead connection stays visible until Supabase notices; files of a left house stay in Storage; the browser tests are
slow under software WebGL.

## Real multiplayer checklist (separate browsers and separate devices, one Supabase test project)

Use a different browser or a private window per player, and at least one second device (phone or another
computer) on another network if possible. Open the browser console on each and keep it visible.

1. **Join:** A creates an invitation; B (other device) opens the link, sees "Join My WebTown?" with "1 of 7 players",
   joins. Both status lines: "Online · 2 players".
2. **Movement:** each sees the other, with the right name and look; walking in all four directions looks smooth,
   stops where it stopped, never steps back.
3. **Presence:** B reloads: A sees one B the whole time. B closes the tab: A sees "B left" within a few seconds.
   B kills the browser or turns off Wi-Fi without closing: note how long until A sees B go (P3).
4. **Reconnection:** B turns the network off for 10 s, then on: "Reconnecting..." then "Online", one B for A, at the
   right place. Repeat three times.
5. **Invitations:** a revoked link says "This invitation doesn't work"; a made-up code too; an expired one (see
   `tests/live/expired-invite.mjs`) says it has expired.
6. **Removal:** A removes B (after the confirmation). A stops seeing B at once; within 30 s B's status line says
   "You're no longer in this town." and "Go to my town" opens B's own town. B can't open A's town again.
7. **Isolation:** C, in their own town, sees nobody from A's town, and A and B never see C.
8. **Capacity:** with 7 players in A's town, an 8th is told "This town is full."; with 7 walking at once, note
   whether anyone is disconnected and the project's Realtime usage in the dashboard (P2).
9. **Waving:** "Q: Wave to <name>" only when close; Q and the Wave button both work; far apart, Q says "No one is
   close enough to wave to."
10. **Console and leaks:** no repeated errors in any console; after leaving and rejoining the town five times, the
    Realtime inspector (dashboard) shows one connection per open tab.
