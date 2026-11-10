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
- No runtime dependencies beyond: React, ReactDOM, Phaser.
- Dev dependencies: Vite, TypeScript, Vitest, @types/*.

## Git

- Do not commit without permission from the developer.
- Do not push without permission.
- Do not force-push.
- .gitattributes is sacred — do not modify it.
