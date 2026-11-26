# Subtle audio - audit and plan

## Audit (branch at `e025c26`)

- No audio exists: no files, no Phaser `this.sound` use, no AudioContext. Phaser 3.90 would create its own sound
  manager (and AudioContext) at boot by default.
- Hooks available without changing mechanics:
  - Walking: `Player` plays `walk-<dir>[@look]` (frames f0, f1, f2, f1 at `WALK_FRAME_RATE` 6); its feet give the
    tile; `kindAt(TERRAIN, tx, ty)` says grass, path (the paved road), bank or water. Interiors have wooden floors.
  - Doors: `TownScene.enterHouse` (after the transition lock is taken) launches `InteriorScene`; `InteriorScene.create`
    either opens the room or, on a failed load, goes straight back (`returnToTown`). `InteriorScene.leave` is the only
    successful exit.
  - Computer and Sketchbook: `app-bridge` publishes `{ open: 'website' | 'paint' | null }`; React already listens.
    The Studio's editor is `.ws-code`; the Sketchbook canvas is `canvas.pt-canvas`.
  - Day and night: `TownScene.applySky(frame)` runs every frame with `frame.night` 0..1.
- Settings: device preferences are kept in the storage layer (`personal-spaces/storage/`, localStorage or IndexedDB);
  `source-safety.test.ts` forbids web storage elsewhere.
- Multiplayer: nothing about sound may go over Realtime; remote players stay silent.

## Decisions

| # | Decision | Why |
|---|---|---|
| A1 | **One audio system**: a small Web Audio engine (`src/audio/`), and Phaser's own sound manager switched off (`audio: { noAudio: true }`). | Sounds come from both Phaser scenes and React windows, and need separate ambient and effect volumes (buses). Phaser's manager has one global volume and lives inside the game; keeping both would mean two AudioContexts. |
| A2 | **Every sound is synthesised in code** (`src/audio/synth.ts`): filtered noise, soft tones, short envelopes, from a seeded generator. No files are downloaded. | No licence risk (original work, documented in `docs/ASSETS.md`), nothing added to the download, and each sound can be tuned to stay quiet and soft. |
| A3 | Footsteps come from the walk animation: a step on the two foot-down frames (1 and 3 of 4), only while walking, at most one every 150 ms. | Exactly in step with the legs; stops the moment the walk animation stops. |
| A4 | Door open plays when the room has actually opened (`InteriorScene.create` succeeded); door close when the player uses the exit (`leave`). A failed load plays nothing. | "Once per successful transition". |
| A5 | Computer on/off and book open/close from the app-bridge transitions; key clicks only for real key presses in the Studio's editor and fields; pencil only while drawing on the canvas (pointer held and moving). | Never continuous while idle. |
| A6 | Ambience: soft wind always, sparse birds by day, crickets at night, crossfaded by `night`; indoors the same ambience muffled (low-pass) and quieter. | Cozy, calm, unobtrusive. |
| A7 | The audio starts only after a real user gesture (pointer or key); it is suspended while the tab is hidden; muting silences everything and stops scheduling; volume changes only move gains (no restart). | Browser autoplay rules; no audio in the background. |
| A8 | Settings (master, ambient, effects, mute) saved in localStorage via `personal-spaces/storage/audio-preferences.ts`; defaults quiet (master 0.6, ambient 0.35, effects 0.5). A small speaker button opens the controls. | Per device, survives reloads. |
| A9 | Limits: at most 2 of the same effect at once and a per-sound minimum gap; at most 8 effects in total. | No pile-ups. |

## Files

- `src/audio/synth.ts`, `src/audio/audio-engine.ts`, `src/audio/footsteps.ts`, `src/audio/index.ts`
- `src/personal-spaces/storage/audio-preferences.ts`
- `src/components/audio/SoundControl.tsx`, `src/components/audio/AppSounds.tsx`
- Hooks: `Player.ts` (step events only), `TownScene.ts`, `InteriorScene.ts`, `create-game.ts`, `GameContainer.tsx`
- Tests: unit (synth, footsteps, engine with a fake AudioContext, preferences, components) and a real-browser test
  (`tests/e2e/audio.spec.mjs`).
