# Community Hall - Requirements (CH-00 audit)

Brief: "Community Hall" (fixed product decisions, technical constraints). Audited at `ba62b61` on
`feature/phase-3-personal-spaces`. Nothing in the application was changed by this audit.

## Audit findings

### F1. The building - needs a decision (see Q1)
- The brief says "the large building at the top-right of the town, near the well".
- The map (`src/game/maps/town-layout.ts`, 80 x 64 tiles) has **one well**, at tile (20, 18), by the north junction,
  in the **top-left** next to house-a (tiles 14-18) and house-b (22-29).
- The only large building in the **top-right** is the **church** (`STRUCTURES` label `church`, tiles 48-55 x 5-11,
  8 x 7 tiles, door offset 64 px, its own forecourt plaza at (52, 15) and a market stall at (50, 17)). It is solid and
  deliberately not enterable (`src/game/config/houses.ts`: "the church stays an outdoor landmark").
- house-b (8 x 7, near the well) is equally large but it is a **player house slot**: using it would cut a world to 6
  houses and so 6 members (`private.town_slots()`, `max_world_members()` = 7).
- **Recommendation:** the church becomes the Community Hall (top-right, large, not a house slot, already has a door
  position and a forecourt). The well stays where it is; the brief's "near the well" appears to describe a different
  view of the map. Confirmation needed before CH-02.

### F2. Phaser and React
- Doors: `buildEntrances(HOUSES, STRUCTURES)` makes an `Entrance` per row of `HOUSES`; `TownScene.enterHouse`
  launches `InteriorScene` with `InteriorSceneData { houseId, interiorId, layout?, recovered? }` and sleeps the town.
- `InteriorScene` is house-centric: 16 references to `houseId`, `canEditHouse`, `houseLayouts` and the furniture
  editor. Objects are found by furniture `role` (`computer` -> app `website`, `notebook` -> app `paint`;
  `src/game/maps/house/object-targets.ts`).
- Apps: `AppSession` (Phaser) publishes `AppView { open: 'website' | 'paint' | null, houseId, mode }` on `app-bridge`;
  `AppHost` (React) shows `WebsiteApp` or `PaintApp`, lazily loading the owner's tools. Keyboard hand-over, freeze and
  close are already solved there.
- Audio hooks (`AppSounds`) key off `AppView.open`.

### F3. Supabase
- Auth: anonymous guests first (Phase 4); `SessionGate` sets `activeCloud()` (backend + `PlayerContext` with
  `world.id`, `role`); the game is remounted per identity and per world.
- Membership: `worlds` (owner), `world_members` (owner/resident/visitor), `houses`; reads gated by
  `private.is_world_member`, writes only through security-definer functions; tables have no client write grants.
- Conventions: every function `search_path = ''`; refusals `42501`; player-facing `22023`; compare-and-swap `WTCON`;
  `private` helpers granted one by one (migration `20261205090000`, rule in `.kiro/steering/security.md`).
- Realtime: one private channel per world, `world:<uuid>`, presence and broadcast for movement and emotes only;
  authorised by RLS on `realtime.messages` via `private.realtime_world_member`, which accepts **only** `world:<uuid>`.
  The adapter (`supabaseRealtime` in `src/cloud/supabase-backend.ts`) opens any topic and waits for a leaving
  channel of the same topic.
- Storage: buckets `website-assets`, `artworks`, paths `{world}/{house}/{file}` checked by `private.house_path_allows`.

### F4. Reusable pieces
- **Website:** `site-project` (types, rules, `builder.ts` that turns a project into a sanitised document), `SiteFrame`
  (double sandboxed iframe, CSP `script-src` nonce only, scripts stripped), `SiteStudio` (CodeMirror editor, pages,
  CSS, images, preview, conflict handling). The model and Studio are tied to a house (`SiteProject.houseId`,
  `guardProjectWriter` requires owner mode, `save_website` requires `owns_house`).
- **Paint:** `src/personal-spaces/paint` is a **raster** engine (pixel buffer, fixed 640 x 480, PNG save). Not
  reusable for an infinite vector canvas; its palette and window chrome are.
- **UI:** `WindowFrame`, `KeyboardShield`, `useAction`, `account.css` styles, the multiplayer status and toast styles.
- **Tests:** PGlite with the Supabase shim (RLS under real roles), `MemoryHub` (in-memory realtime),
  the Supabase stand-in (`tests/multiplayer/emulator.mjs`) for two real browsers, gated live tests.
- **Verified for this design:** PGlite supports the built-in `box` type with a GiST index (a viewport query on 11,341
  rows used the index).

## Requirements

### R1 The Hall
- R1.1 One Community Hall per world, created for every existing and future world; it cannot be deleted while the
  world exists, and a second cannot be made.
- R1.2 Entered like a house (door prompt, fade, E to leave). Inside: a website kiosk and a drawing easel (a
  noticeboard later). No furniture editing in the Hall.
- R1.3 Players inside the Hall see each other (presence and movement), exactly like inside a house.
- R1.4 Without a backend (device-only mode) the Hall is closed ("The Community Hall opens when you play online").

### R2 Roles and permissions
- R2.1 **Viewer**: every world member: sees the published Community Website and the whole canvas.
- R2.2 **Contributor**: every member: edits the shared website draft, draws, erases and undoes their own strokes.
- R2.3 **Moderator**: the world owner (always; cannot be removed) and members the owner appoints: publishes and
  rolls back the website, hides any stroke, clears a region, locks the canvas or the draft, reads the audit log.
- R2.4 Only the owner appoints or removes moderators. Removing a member from the world ends all their roles.
- R2.5 Every rule is enforced in PostgreSQL (RLS and functions). The client only hides buttons.
- R2.6 Strangers and other worlds' members see nothing and can write nothing; no world id from the client is trusted.

### R3 Community Website
- R3.1 One shared draft and one published version. Members edit the draft in the existing Studio; visitors to the
  kiosk see the published version in the existing sandbox. No HTML or script from users is ever executed.
- R3.2 Saving the draft is compare-and-swap on a draft revision: a stale save is refused with "Someone else saved
  the draft" and the Studio's existing conflict choices.
- R3.3 Every draft save keeps a revision (author, time); publishing snapshots a draft revision; a moderator can
  publish any earlier revision (rollback). History is bounded (see design 4.4).
- R3.4 Live hints, not live co-editing: who is editing the draft is shown (presence on the Hall channel). Character-
  level collaborative editing is out of scope.
- R3.5 Images go to a separate bucket, scoped to the world's Hall.

### R4 Canvas
- R4.1 An infinite-feeling plane (coordinates up to +-1,000,000 units), pan and zoom, vector strokes (pen, marker,
  eraser), a fixed palette and widths.
- R4.2 Only what is near the viewport is loaded, in chunks; panning far loads more and unloads what is far away.
- R4.3 Others' strokes appear while they are drawn (live preview) and become permanent when finished.
- R4.4 Undo and redo of your own strokes; erasing a stroke hides it (soft delete) for everyone.
- R4.5 After a disconnect, the canvas catches up from the server without gaps or duplicates; a stroke drawn while
  offline is kept locally and sent when back, or reported as not saved.
- R4.6 Limits: points per stroke, strokes per minute per member, strokes per Hall, payload size.

### R5 Moderation
- R5.1 Moderators: publish, roll back, hide strokes, clear a region, lock and unlock canvas or draft.
- R5.2 Every moderator action is recorded in an append-only audit log (who, what, when, reason); readable by
  moderators; never editable or deletable by anyone through the API.

### R6 Non-functional
- R6.1 Movement and presence unchanged; content never travels on `world:<uuid>`.
- R6.2 No new framework or large dependency.
- R6.3 Durable content in PostgreSQL; Realtime only for notifications and previews.

## Out of scope for the Community Hall milestones
Noticeboard (later milestone), character-level co-editing of the website, comments, reactions, notifications outside
the game, image layers on the canvas, exporting the canvas, public worlds.

## Decisions by the owner (after CH-00 review)
- **Q1 Building:** the **church** is the Community Hall. It stays out of `HOUSES`, so the 7 house slots and the
  7-member limit are unchanged.
- **Q2 Removed members:** their content stays, attributed to "a former member". Strokes and revisions keep
  `author_id`; the UI shows a name only for current members (profiles are readable only between members).
- **Q3 Website draft:** every member can edit the shared draft; only publishing and rollback are moderated.
- **Q4 Canvas:** strokes appear at once, without approval; moderators hide or clear afterwards.