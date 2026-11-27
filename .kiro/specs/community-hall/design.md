# Community Hall - Design (CH-00)

## 1. Decisions

| # | Decision | Why (rejected alternatives) |
|---|---|---|
| H1 | **Hall id = world id.** `community_halls.world_id` is the primary key. | One Hall per world becomes a primary-key fact; every community row carries `world_id`, so isolation is one predicate. Rejected: a separate uuid plus a unique index (more joins, same guarantee). |
| H2 | Halls are created by an **`after insert` trigger on `worlds`** and **backfilled** in the migration. | Every world, past and future, has exactly one, without changing `bootstrap_player`. Rejected: lazy creation on first visit (races, a function that writes on read). |
| H3 | **Moderators**: `world_moderators` rows, plus the owner implicitly (`private.is_hall_moderator`). Only the owner grants or revokes. | The owner can never be locked out; a moderator is always a member (FK to `world_members`, cascade on removal). |
| H4 | **A second private channel per world, `hall:<uuid>`**, for Hall content only, authorised by a new `private.realtime_hall_member`. | The brief forbids reusing the movement channel; a different topic also avoids supabase-js channel reuse. Rejected: a channel per feature (more sockets' worth of joins, same rule). |
| H5 | **Committed canvas operations are announced by the database** (`realtime.send` from the canvas functions, as `{ seq, kind }` on `hall:<uuid>`); clients broadcast only *in-progress* stroke previews. | Members may also broadcast on `hall:<uuid>` (the CH-01 send policy allows it, and Realtime checks a channel at join, not per message), so an announcement is **only a hint**: clients read what changed with `canvas_ops_since`, whose content and authorship come from the database. A forged hint costs one catch-up call. If `realtime.send` fails or is unavailable the change is still stored (best effort, tested); clients also catch up on (re)join. Verify delivery on the test project (CH-04). |
| H6 | **Canvas = vector strokes with a `box` bounding box and a GiST index**, loaded by viewport. | Built into PostgreSQL (no PostGIS); verified on PGlite. Rejected: tiles of pixels (heavy, lossy), PostGIS (extension, overkill). |
| H7 | **Website = one shared draft with compare-and-swap + immutable revisions + a published pointer.** | Fits the existing `save_website` CAS and the Studio's conflict UI; publishing and rollback become pointer moves. Rejected: live co-editing (CRDT dependency; out of scope). |
| H8 | **Reuse the Studio and the sandbox through a `SiteTarget` abstraction** (house or hall), not a copy. | One editor, one sanitiser, one security review. |
| H9 | The Hall interior is the existing `InteriorScene` given a **place** (house or hall), with the editor off in the Hall. | Avoids a second 700-line scene; the house path is unchanged. Rejected: a new `HallScene` (duplicated movement, walls, doors, prompts, remotes). |
| H10 | **No new runtime dependency.** Stroke smoothing (quadratic curves), point simplification (Ramer-Douglas-Peucker) and the spatial index are small pure modules. | Constraint R6.2. |

## 2. Architecture and dependencies

```
                      Phaser                                         React
 TownScene --door(church)--> InteriorScene{place: hall}      AppHost
                               objects: kiosk, easel  --AppView{open:'community-website'|'community-canvas'}-->
                               RemotePlayers(scene 'hall')        CommunityWebsiteApp   CommunityCanvasApp
                                      |                                 |                      |
                     lib/multiplayer-link (unchanged API)      community/site-target     community/canvas/*
                                      |                         (Studio, SiteFrame reuse)  (store, renderer,
              multiplayer/world-session (world:<uuid>)                  |                 viewport loader)
                                      |                                 |                      |
                                      |                     cloud/community-repository  community/hall-session
                                      |                        (RPC, typed, parsed)      (hall:<uuid>, previews,
                                      |                                 |                 op catch-up)
                                      +------------- RealtimeTransport (existing adapter) -------------+
                                                                        |
                                           Supabase: RPC + RLS + realtime.messages policies + triggers
```

Rules: Phaser never imports `cloud/` or `community/`; React never imports Phaser. `community/` is pure logic over
`CloudBackend` and `RealtimeTransport`, testable with PGlite and `MemoryHub` as today.

## 3. Schema (proposed; one migration per milestone, see 6)

```sql
-- CH-01
community_halls (
  world_id uuid primary key references worlds on delete cascade,
  name text not null default 'Community Hall' check (char_length(btrim(name)) between 1 and 60),
  canvas_locked boolean not null default false,
  draft_locked boolean not null default false,
  created_at timestamptz not null default now()
)
world_moderators (
  world_id uuid, user_id uuid,
  granted_by uuid references auth.users on delete set null,
  granted_at timestamptz not null default now(),
  primary key (world_id, user_id),
  foreign key (world_id, user_id) references world_members on delete cascade
)
community_moderation_log (
  id bigint generated always as identity primary key,
  world_id uuid not null references community_halls on delete cascade,
  actor_id uuid references auth.users on delete set null,
  action text not null check (action in ('grant_moderator','revoke_moderator','publish','rollback','hide_stroke',
    'restore_stroke','clear_region','lock_canvas','unlock_canvas','lock_draft','unlock_draft')),
  target jsonb not null default '{}' check (octet_length(target::text) <= 4096),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
)

-- CH-03 canvas
canvas_strokes (
  id uuid primary key,                       -- made by the client: makes a resend after a reconnect idempotent
  world_id uuid not null references community_halls on delete cascade,
  author_id uuid references auth.users on delete set null,
  tool text not null check (tool in ('pen','marker')),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  width smallint not null check (width between 1 and 64),
  points bytea not null check (octet_length(points) between 8 and 16384),  -- int32 x,y start + int16 deltas
  point_count smallint not null check (point_count between 1 and 2000),
  bbox box not null,                         -- in world units, includes the width
  created_at timestamptz not null default now(),
  hidden_at timestamptz, hidden_by uuid,     -- erase / undo / moderation (soft delete)
  hidden_reason text check (hidden_reason in ('erased','undone','moderated','cleared'))
)
create index on canvas_strokes using gist (bbox) where hidden_at is null;
create index on canvas_strokes (world_id, created_at);

canvas_ops (                                  -- the log clients catch up from
  seq bigint generated always as identity primary key,
  world_id uuid not null references community_halls on delete cascade,
  kind text not null check (kind in ('add','hide','restore','clear')),
  stroke_id uuid, region box, actor_id uuid,
  created_at timestamptz not null default now()
)
create index on canvas_ops (world_id, seq);

-- CH-05 website
community_website_revisions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references community_halls on delete cascade,
  number int not null,                       -- 1, 2, 3... per world
  author_id uuid references auth.users on delete set null,
  content jsonb not null check (octet_length(content::text) <= 3000000), -- {title, homePage, pages[], css, assets[]}
  created_at timestamptz not null default now(),
  unique (world_id, number)
)
community_websites (
  world_id uuid primary key references community_halls on delete cascade,
  draft_revision int not null default 0,     -- the CAS counter of the shared draft
  draft_id uuid references community_website_revisions,
  published_id uuid references community_website_revisions,
  published_at timestamptz, published_by uuid
)
community_website_assets (id uuid pk, world_id, name, mime_type, byte_size, storage_path unique, created_at)
-- bucket 'community-assets', path '{world}/{asset id}'
```

All tables: RLS on, **no client write grants** (writes only through security-definer functions, as Phase 4/5);
`select` policies `private.is_world_member(world_id)`; `community_moderation_log` select only for moderators.

### Functions (all `security definer`, `search_path = ''`, `auth.uid()` only)

| Function | Who | Notes |
|---|---|---|
| `hall_context(p_world)` | member | hall row, my role (`owner` / `moderator` / `member`), locks |
| `grant_moderator(p_world, p_user)`, `revoke_moderator(...)` | owner | target must be a member; logged |
| `list_moderation_log(p_world, p_before, p_limit)` | moderator | newest first, paged |
| `canvas_strokes_in(p_world, p_box, p_limit)` | member | viewport load, `bbox && p_box and hidden_at is null`, limit 2,000; returns the latest `seq` too |
| `canvas_ops_since(p_world, p_seq, p_limit)` | member | catch-up after a reconnect |
| `add_canvas_stroke(p_world, p_id, ...)` | member | validates size, coordinates (+-1e6), bbox recomputed **server-side** from the points; rate limit (60 / minute / member, 20,000 visible strokes / hall); idempotent on `p_id`; refused while locked (except moderators) |
| `hide_canvas_stroke(p_world, p_id, p_reason)` | author (`erased`/`undone`), moderator (`moderated`, logged) | `restore_canvas_stroke` for redo / moderator undo |
| `clear_canvas_region(p_world, p_box, p_reason)` | moderator | soft-hides everything in the box; logged |
| `set_hall_lock(p_world, p_what, p_locked)` | moderator | logged |
| `get_community_website(p_world, p_which)` | member | `'draft'` or `'published'` |
| `save_community_draft(p_world, p_base_revision, p_site)` | member (not while draft locked) | CAS on `draft_revision` (`WTCON`), same validation as `save_website`, inserts a revision |
| `publish_community_website(p_world, p_revision_number)` | moderator | publishes exactly the revision the moderator reviewed; logged |
| `list_community_revisions(p_world, ...)` | member | number, author, time (no content) |

## 4. Workflows

### 4.1 Entering the Hall (CH-02)
`HALL` entrance from the church's `StructurePlacement` (no row in `HOUSES`; houses and slots unchanged).
`InteriorSceneData` gains `place: { kind: 'house'; houseId } | { kind: 'hall' }` (houses default to the first, so
existing calls do not change). In the Hall: fixed layout from a `community-hall` template, editor off, objects with
new roles `kiosk` and `easel`. Multiplayer scene id `'hall'` added to the protocol (`SCENE` regex); older clients
simply drop those messages. Device-only mode: the door says the Hall opens online.

### 4.2 Canvas (CH-03, CH-04)
- **Coordinates:** integer world units within +-1,000,000; stored points are a flat `int[]` (x0, y0, x1, y1, ...),
  1 to 2,000 points (CH-03). Points simplified client-side (RDP, 0.5 px at the drawing zoom) in CH-04.
- **Limits (CH-03):** 60 strokes a minute and 1,500 a day per member (erased ones count, which bounds what one member
  can store), 20,000 visible strokes per Hall. Hidden strokes are kept (so they can be restored) and visible only to
  their author and moderators; a retention purge for old hidden strokes is a later task.
- **Viewport loading:** the view is divided into chunks of 1,024 x 1,024 units. Chunks overlapping the viewport plus
  one ring are loaded with one `canvas_strokes_in` per batch of chunks; chunks two rings away are unloaded with their
  strokes (never this client's unsaved ones). Strokes in memory are scanned by bounding box (at most 20,000 visible per
  Hall, so a grid index is not needed yet). Zoomed far out (more than 16 chunks across) new loads wait for zoom-in and
  the status line says so; what is loaded is still drawn (no sampled level of detail yet).
- **Consistency (CH-04):** reads run one at a time; each load returns the newest `seq`, never older than anything the
  client has seen, because a Hall's operations commit in sequence order (every writer takes the Hall row lock first,
  migration `20261220090000_community_canvas_order.sql`). After a load the client catches up from its `seq`; applying
  an operation twice is harmless and operations at or below `seq` are ignored. A catch-up longer than 5 pages
  (2,500 operations) reloads the view instead. Own changes are shown at once and never advance `seq`.
- **Live:** while drawing, the client broadcasts `{ v, s, id, points-delta, tool, color, width }` previews on
  `hall:<uuid>` at most 15 times a second (same validators style as `protocol.ts`; others draw them faded).
  On pen-up: `add_canvas_stroke`; the database announces `{ seq, kind }` (H5); everyone fetches the
  op with `canvas_ops_since` and replaces the preview with the stored stroke. Previews older than 5 s without a commit vanish.
- **Ordering and reconnect:** each client keeps the highest `seq` seen; on (re)join it calls `canvas_ops_since`
  until caught up, then applies live ops, ignoring any `seq` already applied. Gaps (a missed `seq`) trigger a catch-up.
- **Offline strokes:** kept in memory with their client id and retried with backoff; the id makes retries
  idempotent; after 60 s offline the user is told "Not saved yet" and the stroke stays local until it is.
- **Undo/redo:** a per-user stack of own stroke ids -> `hide` (`undone`) / `restore`. Erasing others' strokes:
  members may erase their own only; moderators any (logged).

### 4.3 Website (CH-05, CH-06)
- `SiteTarget = { kind: 'house'; houseId } | { kind: 'hall'; worldId }`. `site-project` types gain a target instead
  of a bare `houseId` (a mechanical change with the house path unchanged). The Studio receives a `writer` and a
  `reload` as today; for the Hall, `CommunityDraftWriter` calls `save_community_draft` with the base revision.
- Conflict: `WTCON` -> the Studio's existing "Saved somewhere else" dialog (keep editing, load theirs, save mine).
- Presence on `hall:<uuid>`: `{ editing: 'draft' }` shows "Ada is editing the draft" in the Studio header.
- Viewing: the kiosk shows the published revision through `SiteFrame` (unchanged sandbox and CSP). Moderators also
  see "Draft (unpublished)" and "Publish this version", with a diff summary (pages added/changed/removed).
- Rollback: publish an older revision number.

### 4.4 Bounds
Draft revisions kept: the last 50 plus every published one (older drafts pruned by `save_community_draft`).
Website: 3 MB content, 50 images of 5 MB (same as houses). Canvas: 20,000 visible strokes per Hall; hidden strokes
kept 30 days then purged by a scheduled job (or manual SQL until scheduling exists).

## 5. Isolation and permissions

| Action | Stranger | Member | Moderator | Owner |
|---|---|---|---|---|
| See Hall, website (published), canvas | no | yes | yes | yes |
| Edit draft | no | yes (unless locked) | yes | yes |
| Publish / roll back | no | no | yes | yes |
| Draw; erase / undo own | no | yes (unless locked) | yes | yes |
| Hide others' strokes, clear region, lock | no | no | yes | yes |
| Read audit log | no | no | yes | yes |
| Grant / revoke moderators | no | no | no | yes |

Every function checks `auth.uid()` against `world_members` / `world_moderators` / `worlds.owner_id` for the
`p_world` given; RLS repeats the member check for reads; the channel policy repeats it for `hall:<uuid>`.

## 6. Migration plan (one file per milestone, never editing an applied one)

1. `…_community_hall_core.sql` (CH-01): halls, trigger, backfill, moderators, audit log, `is_hall_moderator`,
   `hall_context`, grant/revoke, log read, `realtime_hall_member` + policies for `hall:<uuid>`. Grants per the S4 rule.
2. `…_community_canvas.sql` (CH-03): strokes, ops, functions, announcement trigger (H5).
3. `…_community_website.sql` (CH-05): revisions, websites, assets, bucket and its policies, functions.
4. Shim (tests only) gains what the new SQL needs (`realtime.send` stub that records calls).
Each applied with `supabase db push --remote` after `--dry-run`, as Phase 5.1.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A large canvas floods clients | Viewport chunks, server limit per query, LOD when zoomed out, memory cap |
| Spam or abuse (strokes, previews) | Server rate limit and caps; receiver limits on previews (as `TokenBucket`); moderator clear and lock |
| Forged authorship | Committed ops announced by the database (H5); previews are never stored |
| Lost strokes on disconnect | Client ids, idempotent add, retry queue, catch-up by `seq` |
| Duplicates after reconnect | Apply by `seq` and stroke id, ignore seen |
| Lost website edits | CAS + revisions + conflict dialog; unsaved-changes guard already in the Studio |
| Executing user HTML | Only the existing sanitiser and double sandbox; no new render path |
| `realtime.send` unavailable or worded differently on Supabase | Verify on the test project in CH-04; fallback in H5 |
| `InteriorScene` changes break houses | Place defaults to house; the existing interior, editor, app and e2e suites must stay green |
| Changing `SiteProject.houseId` ripples widely | Done as its own mechanical step (CH-05a) with the full suite before any Hall code |
| Moderator removed mid-action | Every function re-checks; cascade on membership removal |
| Storage files orphaned | Same caveat as houses; documented |
| Two Realtime channels per player | Same socket; joins at Hall entry only; left on exit |

## 8. Tests required
- PGlite: one Hall per world (backfill, trigger, second insert refused), every function for stranger / member /
  moderator / owner / other world / anon, locks, rate limits, CAS conflicts, revision pruning, audit log append-only,
  channel policy for `hall:<uuid>` (and that `world:` rules are unchanged), grant list.
- Unit: stroke encoding round trip and limits, simplification, chunk maths, viewport loader, op ordering and
  catch-up, preview validators, undo/redo stack, `SiteTarget` writer.
- Component: canvas tools and pan/zoom, Studio in Hall mode, publish and rollback, moderation panel.
- Two real browsers on the stand-in: draw and see, erase, reconnect catch-up, publish seen by the other, a member
  cannot publish, a stranger cannot read or join `hall:<uuid>`, movement and presence unaffected.
- Regression: the whole existing suite (houses, Studio, Sketchbook, multiplayer, audio).
- Live (gated): the same against the real test project, including H5's `realtime.send`.
