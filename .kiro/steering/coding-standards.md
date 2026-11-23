# WebTown — Coding Standards

## TypeScript

- Strict mode enabled (`"strict": true` in tsconfig).
- No `any` — use `unknown` and narrow, or define a proper type.
- Prefer `interface` for object shapes, `type` for unions and aliases.
- Export only what is needed. Avoid barrel files that import everything.
- All functions have explicit return types.
- No implicit `undefined` — use optional chaining and nullish coalescing.

## File and Module Conventions

- One class or primary export per file.
- File names: `kebab-case.ts` for modules, `PascalCase.ts` for classes/scenes.
- Scene files: `BootScene.ts`, `TownScene.ts` — always PascalCase matching the class name.
- Test files: co-located as `*.test.ts` or in `src/__tests__/`.

## React

- Functional components only. No class components.
- Props typed with `interface`, not inline objects.
- `useEffect` cleanup is mandatory for any subscription, interval, or Phaser instance.
- Do not reach into the Phaser game object from React — use the event bus in `src/lib/`.
- Do not store Phaser objects in React state.

## Phaser

- Scenes extend `Phaser.Scene`. Always call `super(config)` with a key.
- Asset keys are string constants defined in `src/game/config/AssetKeys.ts`.
  Never use raw string literals for asset keys outside that file.
- Load assets in `preload()`. Create objects in `create()`. Update in `update(delta)`.
- Destroy listeners in scene `shutdown` or `destroy` events to prevent leaks.
- Never use `Phaser.Game` constructor outside the designated factory in `src/game/`.

## Game Constants

All magic numbers belong in `src/game/config/GameConfig.ts`:
- Tile size (16)
- Display scale (2)
- Player speed (pixels/second)
- Map dimensions (in tiles)
- Physics body dimensions

## Movement and Physics

- Always use `delta`-based or velocity-based movement — never `x += n` per frame.
- Normalize diagonal velocity before applying speed.
- Physics body offsets are defined once in the Player entity, not scattered.

## Testing

- Test pure logic: movement calculations, boundary clamping, collision helpers.
- Do not test Phaser internals — mock the physics body interface.
- Tests run with `vitest --run` (single pass, no watch mode unless requested).
- Test file naming: `<module>.test.ts`.

## Comments

- JSDoc on public methods and classes.
- Inline comments explain *why*, not *what*.
- No commented-out code committed.

## Formatting

- 2-space indentation.
- Single quotes for strings.
- Trailing commas in multi-line arrays/objects.
- No semicolons (Prettier default for this project).
- Max line length: 100 characters.

## Dependencies

- Pin exact versions (`npm install --save-exact`).
- Do not add a dependency that can be replaced by 10 lines of code.
- Audit new dependencies for active maintenance and known vulnerabilities.
- No runtime dependencies beyond: React, ReactDOM, Phaser, and the CodeMirror 6 editor packages (`codemirror`,
  `@codemirror/state`, `view`, `commands`, `lang-html`, `lang-css`, `lint`, `theme-one-dark`; decision W-2, approved in the Site Studio brief).
  CodeMirror may be imported only by `src/components/website-studio/CodeEditor.tsx`, which is reached only from the
  owner's lazily loaded Studio chunk; `source-safety.test.ts` enforces this.
- `@supabase/supabase-js` (Phase 4, decision C-1): imported only by `src/cloud/supabase-backend.ts`, loaded on demand.
- Dev dependencies: Vite, TypeScript, Vitest, @types/*, `fake-indexeddb` (D5, tests only) and
  `@playwright/test` (SD-10, real-browser security tests in Chromium, Firefox and WebKit) and `@electric-sql/pglite`
  (C-9, real PostgreSQL for the RLS tests) and `ws` (Phase 5, the WebSocket server of the test-only Supabase stand-in in
  `tests/multiplayer/`). None of them may be
  imported by anything under `src/` that ships, nor appear in `dist/`.
- No other code-editor dependency (Monaco, Ace or similar) is approved.

## Git

- Do not commit without permission from the developer.
- Do not push without permission.
- Do not force-push.
- .gitattributes is sacred — do not modify it.
