# WebTown — Product Steering

## Vision

WebTown is a browser-based 2D pixel-art RPG inspired by GeoCities.

Eventually, players will own houses that function as personal websites. Friends
will explore a shared town and visit one another's houses — the town is a living
social space rendered as a game world.

## Current Phase

**Phase 2 — Houses & Interiors** (Phase 1, the single-player town, is complete.)

The player can walk up to a house, press E, walk around one reusable interior
and return to the exact outdoor spot. The interior shows a computer and a
notebook as props only. See `.kiro/specs/phase-2-houses-interiors/`.

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

## Out of Scope (until a later phase)

- Multiplayer networking
- Authentication / user accounts
- Supabase or any backend service
- A real house ownership model (buying, renting, permissions)
- Persistent layouts (localStorage or backend)
- Undo/redo, multi-select and rotation art in the furniture editor
- Personal website content hosted in houses (Phase 3: the computer website and
  the notebook application)
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
