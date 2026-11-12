# Phase 2 — Tasks

One task at a time. Each leaves the tree green: `npx tsc -b`, `npm test`,
`npm run build`.

- [x] **P2-00** Milestone 0 visual test room (approved).
- [x] **P2-01** Spec, steering and `.gitignore` for unverified art.
- [x] **P2-02** Pure logic: houses, entrances, interaction, transition lock,
      return position — with tests.
- [x] **P2-03** Shared static-body helper and `Player` additions; existing
      collision tests unchanged.
- [x] **P2-04** Interior sprite tables and `cozy-room` layout, with walkability,
      overlap and reachability tests.
- [x] **P2-05** `interior-textures`, `InteractionPrompt`, `InteriorScene`;
      register in `create-game`.
- [x] **P2-06** `TownScene` integration: prompt, E key, sleep/wake, clock pause,
      exact restore.
- [x] **P2-07** Runtime verification in a browser, docs and checklist, final
      tsc / tests / build.

## Acceptance (whole phase)

- [x] All seven houses can be entered and left; the church cannot.
- [x] Return position, facing and camera are restored; no instant re-entry.
- [x] Clock does not advance indoors; `?timeFrozen=1` survives a visit.
- [x] Ten enter/leave cycles leave the scene and object counts unchanged.
- [x] Town works with the interior files blocked.
- [x] Phase 1 + Halloween tests still pass; production build succeeds.

## Bugs found during runtime verification (fixed)

- `body.reset()` ignores the Arcade body offset, so a teleported player snapped
  5.5 / 26.4 px on the next physics step. `Player.placeFeet` now solves the
  sprite position from the physics formula and syncs the body.
- `body.center` uses floored half-sizes (0.7 px off for this body), which made
  the player drift on every round trip. `Player.feet` uses the true centre.
- A freshly created body is unscaled until its first step, so the interior
  spawn landed 6.3 / 7.2 px off. `placeFeet` calls `updateBounds()` first.
- Using `scene.time.now` for the cooldown failed after a visit, because a
  sleeping scene's clock does not advance. Wall-clock time is used instead.
- The Cute Fantasy houses have a recessed porch, so their door could be
  reached without entering the zone. Zones now reach 8 px into the footprint.
