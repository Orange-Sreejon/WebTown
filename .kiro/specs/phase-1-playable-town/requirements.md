# Phase 1 Requirements — Playable Single-Player Town

## Overview

Build a playable, browser-based, single-player top-down pixel-art town.
One animated player character, keyboard movement, camera following, two
recognisable houses, and working collision. No backend, no multiplayer.

---

## Functional Requirements

### FR-01 — Town Rendering
The game shall render a top-down pixel-art town using the PIXELJAD
"Tileset Village Top Down" assets.

**Acceptance criteria:**
- The town fills a map of at least 40×30 tiles (640×480 px at 1× scale).
- The ground layer is fully covered (no empty/black tiles visible).
- Roads and pavements are visually distinct from grass.
- At least one water feature or decorative terrain element is present.

### FR-02 — Vegetation and Decoration
The town shall include trees and decorative ground detail tiles.

**Acceptance criteria:**
- At least 4 trees placed on the map using TREE 1, TREE 2, or TREE 3 assets.
- At least 3 distinct grass or ground detail tile variants are used.
- Decorations feel distributed naturally, not in a single cluster.

### FR-03 — Houses
The town shall include at least two recognisable houses.

**Acceptance criteria:**
- HOUSE 1 (80×112 px) and HOUSE 2 (128×112 px) assets are both present.
- Houses are placed at fixed positions on the map.
- Houses are visually distinct from each other and from the background.
- The player cannot walk through any house.

### FR-04 — Player Character
The game shall load one player character from the Tiny Cast Village Folk pack.

**Acceptance criteria:**
- The traveller character is used as the default player.
- The character spritesheet (`$traveller.png`, 144×256) is loaded correctly.
- The character is visible on screen at game start.
- The character is rendered at 2× pixel scale with nearest-neighbour filtering.

### FR-05 — Walk Animation
The player character shall animate while moving and stand still when not moving.

**Acceptance criteria:**
- Walking animation plays frames 1→2→3→2 in a loop at approximately 6 FPS.
- The correct directional row is shown (down/left/right/up).
- The standing frame (frame 2 of the last direction) is shown when stationary.
- Animation does not flicker or skip frames during normal movement.

### FR-06 — WASD Movement
The player shall move using the W, A, S, D keys.

**Acceptance criteria:**
- W moves the player upward (negative Y).
- S moves the player downward (positive Y).
- A moves the player left (negative X).
- D moves the player right (positive X).
- Holding two orthogonal keys simultaneously produces diagonal movement.

### FR-07 — Arrow Key Movement
The player shall also move using the arrow keys.

**Acceptance criteria:**
- Up/Down/Left/Right arrow keys produce identical movement to WASD.
- Both input schemes work simultaneously (a WASD key and an arrow key held
  together produce combined movement).

### FR-08 — Frame-Rate-Independent Movement
Player movement speed shall be consistent regardless of frame rate.

**Acceptance criteria:**
- Player speed is defined in pixels per second (not pixels per frame).
- Movement uses velocity × delta integration (Phaser Arcade physics).
- At 30 FPS and 60 FPS, the player covers the same distance in one second.
- Diagonal movement speed equals straight movement speed (velocity normalised).

### FR-09 — Camera Following
The camera shall follow the player smoothly and stay within map bounds.

**Acceptance criteria:**
- The camera is centred on the player at all times.
- The camera does not show area outside the map boundaries.
- When the player is near a map edge, the camera stops at that edge;
  the player can continue moving to the edge of the walkable area.
- Camera uses `roundPixels: true` to prevent subpixel jitter.

### FR-10 — Collision — Buildings
The player shall not be able to walk through buildings (houses, church).

**Acceptance criteria:**
- Attempting to walk into a house stops the player at its boundary.
- The player can walk along the side of a house without clipping inside.
- Collision bodies for houses cover the full visible footprint of each building.

### FR-11 — Collision — Trees and Obstacles
The player shall not be able to walk through trees or other obstacles.

**Acceptance criteria:**
- Attempting to walk into a tree stops the player at its boundary.
- Tree collision bodies are smaller than the full sprite (trunk area only)
  to allow the player to appear to walk behind the canopy.
- At least all trees on the map have collision enabled.

### FR-12 — Map Boundary Collision
The player shall not be able to walk outside the map.

**Acceptance criteria:**
- Moving toward any map edge stops the player at the last walkable tile.
- The player cannot reach negative coordinates or coordinates beyond
  (mapWidth × tileSize, mapHeight × tileSize).
- The boundary check is handled by Phaser world bounds, not manual clamping.

### FR-13 — Pixel Art Crispness
All pixel art shall render without blur or antialiasing at any supported
browser zoom level.

**Acceptance criteria:**
- Phaser is initialised with `pixelArt: true`.
- The canvas element has `image-rendering: pixelated` applied via CSS.
- No antialiased edges are visible on tiles or character sprites at 1:1 zoom.
- Sprites scale correctly at 2× without blurring.

### FR-14 — Phaser Lifecycle
Phaser shall initialise and clean up correctly within React.

**Acceptance criteria:**
- The Phaser game instance is created inside a React `useEffect`.
- The `useEffect` cleanup function calls `game.destroy(true)`.
- Navigating away from the game component and back does not create a second
  Phaser canvas or leave dangling event listeners.
- No "canvas already exists" or "game already running" errors in the console.

### FR-15 — Loading Screen
A loading screen shall display while assets are being fetched.

**Acceptance criteria:**
- A visible loading indicator (text or progress bar) is shown before the
  game scene starts.
- The loading indicator disappears when the game is ready to play.
- The loading screen is implemented in React (not inside a Phaser scene)
  or as a Phaser BootScene that emits a ready event to React.

### FR-16 — Error Handling
Asset load failures shall be caught and surfaced to the user.

**Acceptance criteria:**
- If a required asset fails to load, an error message is displayed.
- The error message is human-readable (not a raw exception stack).
- The game does not silently continue in a broken state after a load failure.
- A React error boundary wraps the game component.

---

## Non-Functional Requirements

### NFR-01 — Performance
The game shall run at a stable 60 FPS on a mid-range laptop in Chrome/Firefox.

### NFR-02 — Browser Support
The game shall run in the latest stable versions of Chrome, Firefox, and Edge.
Safari support is a best-effort goal, not a hard requirement for Phase 1.

### NFR-03 — No Backend
The game is fully client-side. No HTTP requests are made to any backend
service during gameplay. Assets are loaded from the same origin only.

### NFR-04 — Accessibility (minimum)
The game canvas has an `aria-label` describing it as an interactive game.
Keyboard navigation for menu elements (if any) uses semantic HTML.

---

## Out of Scope for Phase 1

- NPC movement or dialogue
- Day/night cycle (DAY assets only)
- Sound / music
- Saving progress
- Multiple scenes beyond Boot + Town
- Any multiplayer, auth, or backend feature
