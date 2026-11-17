# WebTown — Product Steering

## Vision

WebTown is a browser-based 2D pixel-art RPG inspired by GeoCities.

Eventually, players will own houses that function as personal websites. Friends
will explore a shared town and visit one another's houses — the town is a living
social space rendered as a game world.

## Current Phase

**Phase 3a — Personal Spaces** is in progress (see below). Phases 1 (town) and
2 (houses, furniture editor) are implemented.

**Phase 2 — Houses & Interiors.** The player can walk up to a house, press E,
walk around one reusable interior and return to the exact outdoor spot. See
`.kiro/specs/phase-2-houses-interiors/`. (The computer and notebook were props
only in Phase 2; Phase 3a makes them interactive.)

Still single-player and fully local: no multiplayer, no backend, no
authentication.

### In progress — Furniture Editor MVP

Every house starts as an independent copy of one default room. The owner can
edit their own house: select, drag, add and remove furniture on a grid, then
save or cancel. Visitors' houses are read-only. See
`.kiro/specs/furniture-editor-mvp/`.

- **Ownership stand-in:** until accounts exist, one configured house
  (`src/game/config/ownership.ts`, currently `house-a`) is "yours". A dev-only
  `?owner=<houseId>` URL parameter can pick another one for testing.
- **Persistence:** layouts live in memory only. Every change is lost when the
  page is reloaded, by design, until a backend phase.

### Phase 3a — Personal Spaces (in progress, branch `feature/phase-3-personal-spaces`)

The computer opens the resident's personal website. The notebook (shown to
players as the **Sketchbook**; type key and role stay `notebook`) opens
**WebTown Paint**, a retro drawing app. Both are React overlays; Phaser only
decides when they open, freezes the player and restores the room. See
`.kiro/specs/personal-spaces-mvp/`.

**Phase 3a is a local demonstration, not public sharing.**

- Website content and drawings are saved in the browser's IndexedDB on **this
  device only**. Visitors on other devices or browsers cannot see them. Nothing
  in the UI, docs or comments may claim otherwise.
- "Public" in 3a means any visitor in the same browser can browse a house's
  website and drawing gallery read-only.
- Owner editing is restricted in the component tree and in the repository
  interfaces (visitor components only receive reader interfaces). **This is
  client-side and can be bypassed with browser developer tools** (and, in dev
  builds, `?owner=`). It is not authorization.
- Furniture layouts remain in memory and reset on reload; website and drawings
  persist. This inconsistency is known and accepted.
- No Supabase, authentication or backend code is written in 3a.

### Phase 3b — Real sharing (planned, not started)

Needs its own spec and review before any code. Preferred provider: Supabase
(architectural approval only). Security model: `.kiro/steering/security.md`.

## Out of Scope (until a later phase)

- Multiplayer networking
- Authentication / user accounts (Phase 3b)
- Supabase or any backend service (Phase 3b, separate spec)
- A real house ownership model (buying, renting, permissions)
- Persistent furniture layouts (localStorage, IndexedDB or backend). Layouts stay
  in memory in Phase 3.
- Undo/redo, multi-select and rotation art in the furniture editor
- Cross-device sharing of websites and drawings (Phase 3b)
- Guestbooks
- AI features
- Inventory system
- Combat
- Quests

Entering the church is not part of Phase 2; it stays an outdoor landmark.
Interiors and the furniture editor are no longer out of scope.

## Kiroween 2026 Resurrection Context

This project was started for Kiroween 2026. It is a personal/creative project
with potential for public release. Keep it fun and playable.

## Branding

The name is **WebTown** — one word, capital W and T. Do not abbreviate.
