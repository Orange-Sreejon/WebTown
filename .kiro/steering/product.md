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

**Sketchbook: WebTown Paint** (`.kiro/specs/sketchbook-paint/`). A late-1990s desktop paint program, evoked with
original artwork (title "<name> - WebTown Paint"; no Microsoft names, icons or fonts). White 640 x 480 canvas by
default (Image > Attributes: up to 1280 x 1024, white or transparent), pencil, brush, eraser, airbrush, fill, pick
colour, text, line, rectangle and ellipse, 28-colour palette, undo / redo, Export PNG. Several drawings per house
(up to 50), saved automatically; only the owner draws, visitors see the drawings read-only.

**Website: the HTML/CSS Site Studio.** A resident's website is files they write themselves: HTML pages, one
shared `style.css` and uploaded images and GIFs, in the spirit of Neocities and the variety of old GeoCities home
pages. There is no fixed page structure or theme. Two starting points are offered, **Blank website** and
**Classic personal homepage**; both are ordinary files to change or delete. The Studio has a code editor
(CodeMirror 6), a live preview at desktop and phone widths, pages, images and Save. The form-based editor built as
P3-07 was removed (kept in commit `9837da3`). See `.kiro/specs/website-studio/`.

- Pages are rendered only inside a two-layer sandboxed iframe, never in the
  WebTown document (see `security.md`).
- **In Phase 3a resident JavaScript never runs**, in the preview or for visitors.
- Resident pages make **no network requests** in 3a: they can use only their own
  files. External links open only after the player confirms in WebTown's chrome.
- Existing structured websites are shown converted in memory; the converted
  project is written only on the owner's first Save, and the old record is kept.
- A house with no website shows "Nothing here yet"; only its owner is offered a starting point.
- Status: built (website-studio W-01 to W-10); the security policy awaits the owner's review.
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
- Furniture layouts remain in memory and reset on reload without an account (Phase 4 saves them to the account).

### Phase 4 - Accounts, guest identity and persistence (built; `.kiro/specs/phase4-accounts/`)

Guest first: a first visit plays at once as a guest (Supabase anonymous sign-in); a small "Guest" control at the
bottom left offers to add an email later, which keeps everything (same user). Each player gets a personal world with
the seven village houses, owns `house-a`, and their furniture, website and Sketchbook are saved to their account. A
permanent account can log out and in on any device. Guests are told plainly that a guest account lives in one
browser until they add an email. Shared worlds are prepared in the data model but not offered yet.

Without a configured Supabase project, WebTown behaves as in Phase 3a (this device only, furniture in memory).
With one, content is in the player's account: say "saved to your account" (or "guest account"), never "on this
device", and never promise other players can see a house (worlds are personal for now).
## Out of Scope (until a later phase)

- Multiplayer networking
- A real house ownership model (buying, renting, permissions)
- Undo/redo, multi-select and rotation art in the furniture editor
- Multiplayer: shared worlds, realtime, seeing other players' houses, chat, friends
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
