# Halloween Night Mode — Requirements

## Overview

Add a seasonal Halloween atmosphere to the finished Phase 1 town. The same
village is unchanged in daylight; after dark it becomes a cozy, slightly spooky
Halloween village — dark blue/purple light, glowing carved pumpkins, warm house
windows, lit lamps, a moon, a few bats — and then returns to normal.

This is an enhancement on top of the completed Phase 1 town. Nothing from
Phase 2 (multiplayer, houses as websites, interiors, furniture, guestbooks,
quests, inventory, combat) is in scope.

---

## FR-01 — In-game clock

The game shall simulate its own 24-hour clock, independent of the computer's
real clock.

**Acceptance criteria**

- The clock advances from in-game time only (`delta` accumulated in the scene);
  changing the OS clock changes nothing.
- A full 24-hour cycle takes `CYCLE_DURATION_MS` from a single config file,
  default **15 minutes** (the existing day length).
- The clock reports `hour`, `minute`, and a `period` of `day` | `evening` |
  `night`.
- Period boundaries: **day 06:00–17:59, evening 18:00–19:59, night
  20:00–05:59.** The clock wraps 23:59 → 00:00 with no jump in lighting.
- Every timing constant (cycle length, period boundaries, keyframe hours,
  fade durations) lives in one file: `src/game/config/halloween.ts`.

## FR-02 — Developer time override

The developer shall be able to jump straight to any time of day without
waiting for the cycle.

**Acceptance criteria**

- `?time=21:00` in the URL starts the game at that in-game time.
- With `?time=` set and no other flag, the clock keeps running from there.
- `?timeFrozen=1` (combined with `?time=`) holds that time still.
- In dev builds only, keys `1`, `2`, `3` jump to 09:00 / 18:30 / 22:00.
- The override is inert in production builds except the URL parameters, which
  are documented as developer-only and add no UI.
- No permanent settings screen or HUD is added.

## FR-03 — Daytime is preserved

**Acceptance criteria**

- Between 06:00 and 17:59 the town renders as it does today: same terrain,
  houses, trees, decorations, market props, character.
- No Halloween object is visible: pumpkins, window glow, bats, moon and stars
  are all fully hidden (alpha 0, not merely dark).
- The existing sky tint at midday is white (no multiply darkening).

## FR-04 — Evening transition

**Acceptance criteria**

- 18:00–19:59 warms the light through sunset into dusk with no visible step:
  sampling the lighting once per in-game minute produces a continuous curve.
- Street lamps come up during the evening (they are already driven by the lamp
  curve) and are at full strength by 20:00.
- Halloween decorations do **not** appear during the evening.

## FR-05 — Nighttime Halloween appearance

From 20:00 to 05:59 the village shall show:

| Element | Requirement |
|---|---|
| Ambient light | Dark blue/purple multiply tint, dark enough to read as night, light enough that the whole map and the player stay clearly visible |
| Pumpkins | Carved jack-o'-lanterns placed around the village, each with a small warm additive glow from the carved face |
| Windows | Warm glow on the windows of the houses and the church, layered under the building sprite's window frames where possible so it reads as light inside |
| Lamps | Existing street lamps are lit (already implemented) and their light reads warmer at night |
| Decor | A small number of subtle Halloween touches (e.g. a scatter of pumpkins at yards, gates and the market), no clutter on roads and no blocking of existing paths |
| Bats | Two or three small bats crossing the sky, sparse, slow, looping |
| Moon / stars | A moon, plus a few stars, drawn above the map in a fixed screen-space layer |

**Acceptance criteria**

- Every listed element is visible at 22:00 and invisible at 12:00.
- Decorations fade in over 20:00–20:30, stay fully visible until 05:30, and
  fade out again over 05:30–06:00; nothing pops. They are completely hidden
  from 06:00 to 19:59 (day and evening).
- Pumpkins never overlap houses, fences, the well, market stalls, trees, the
  pond or the player's start tile.
- Each pumpkin has a small solid footprint at its base, like a lamp post's,
  and that footprint is only active while the pumpkin is visible.
- The player is always distinguishable — no glow drawn at full alpha over the
  character.
- Bats and stars are subtle: no more than 3 bats on screen, no flapping
  strobe, no particle storms.

## FR-06 — Visual quality

**Acceptance criteria**

- Pixel-perfect rendering is preserved: `roundPixels` stays on, no camera
  rotation/zoom changes, no non-integer sprite scaling of pixel art, and no
  smooth (blurred) gradients — glows use a small number of hard alpha steps,
  as the existing lamp texture does.
- New art matches the existing top-down 16 px style and scale.
- No post-processing that washes out the palette; the tint is one multiply
  overlay, as today.

## FR-07 — Assets and licences

**Acceptance criteria**

- Existing packs are reused wherever possible; the only new art is
  `public/assets/halloween pumpkins/pumpkins-outline.png` (already in the
  project) and code-generated textures (moon, stars, bats).
- Every asset used is recorded in `docs/ASSETS.md` with creator, source,
  licence terms and redistribution status, including the pumpkin pack's
  "commercial use allowed, no resale" terms.
- No asset is downloaded, generated by an outside service, or added without
  the owner's approval.

## FR-08 — Performance and stability

**Acceptance criteria**

- The Halloween layer is created once per scene run; reloading the game or
  re-entering the scene does not stack duplicate pumpkins, bats or tweens.
- No per-frame allocation of game objects; the only per-frame work is setting
  alphas on a fixed list of objects.
- The game holds its existing frame rate on the current map with the layer on.
- Timers, tweens and keyboard listeners added for the mode are removed on
  scene shutdown.

## FR-09 — No regressions

**Acceptance criteria**

- Movement, collision (houses, trees, props, water, lamp posts including the
  thin post collider), y-sorting with lamp posts, camera follow and zoom are
  unchanged.
- All existing tests still pass; the production build still succeeds.

---

## Out of scope

Multiplayer, authentication, Supabase, house interiors, furniture editing,
personal websites, guestbooks, proximity voice chat, Halloween quests,
inventory, combat, and any general seasonal-event framework.

---

## Verification checklist

1. 12:00 via `?time=12:00` — town unchanged, no pumpkins/windows/bats/moon.
2. `?time=18:30` — warm evening light, lamps coming up, still no pumpkins.
3. `?time=20:05` — decorations fading in.
4. `?time=22:00` — full Halloween night.
5. `?time=05:50` then wait — decorations fading out, then dawn.
6. `?time=22:00` — walk the map: player visible, no floaty glow over them.
7. Camera follows through the crossroad and along the pond.
8. Collision unchanged: walk into a house, a tree, a lamp post, the pond.
9. Reload twice at 22:00 — same number of pumpkins/bats each time.
10. `npm test -- --run` and `npm run build` pass.
