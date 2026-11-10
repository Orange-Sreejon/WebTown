# WebTown — Security Steering

## Phase 1 Threat Model

Phase 1 is a fully client-side, single-player, local-only browser game.
There is no server, no authentication, no user data, and no network traffic
beyond static asset loading. The attack surface is minimal.

These rules are written to establish good habits for future phases and to
prevent accidental introduction of risks during development.

## Asset Loading

- All assets are loaded from the same origin (`public/` served by Vite).
- Do not load assets from arbitrary user-supplied URLs.
- Do not use `eval()` or `new Function()` to construct asset paths.
- Asset key constants (in `AssetKeys.ts`) are the only source of asset path strings.

## Dependencies

- Pin all dependencies to exact versions in `package.json`.
- Run `npm audit` before adding any new dependency.
- Do not add dependencies with known high/critical vulnerabilities.
- Do not add packages that phone home or collect telemetry without disclosure.
- Review what a package does before installing — typosquatting is real.

## Build Output

- The Vite build produces only static files. No server-side code is generated.
- Do not include secrets, API keys, or credentials anywhere in the codebase.
- `.env` files must never be committed. Add `.env*` to `.gitignore` now,
  even though no env vars exist yet — it prevents accidental future commits.

## Asset Licence Compliance

- Do not publish the PIXELJAD tileset raw files in a public repository without
  explicit creator permission. See `docs/ASSETS.md` for full licence analysis.
- Do not use any asset to train AI/ML models (prohibited by both asset licences).
- Include required attribution for PIXELJAD assets in any public-facing release.

## Content Security

- This is a game, not a website. There is no user-generated content in Phase 1.
- Do not use `dangerouslySetInnerHTML` in any React component.
- Do not render any external HTML or markdown in the game canvas.

## Future Phase Reminders

When multiplayer and user accounts are added (future phases), the following
will need to be addressed before any public deployment:

- Input sanitisation for all user-supplied content (house names, usernames).
- Authentication token storage strategy (httpOnly cookies vs localStorage).
- WebSocket message validation — never trust client-sent game state.
- Rate limiting on movement/action messages to prevent cheating.
- Content moderation for user-generated house content.

These are out of scope for Phase 1 and must not be implemented now.
