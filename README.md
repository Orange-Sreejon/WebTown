# WebTown

> **Don't scroll the internet. Explore it.**

WebTown is a browser-based, top-down 2D pixel-art world where every house can become someone's personal website. Instead of discovering people through profiles and feeds, visitors explore a shared town, enter homes and discover the spaces people create.

## Demo

<video src="./webtown-demo-revised.mp4" controls="controls" width="100%"></video>

[If the video player does not appear, watch or download the demo video here.](./webtown-demo-revised.mp4)

## What is WebTown?

WebTown brings back the spirit of the early personal web: homepages, guestbooks and small web neighborhoods. A player explores a town, approaches a house and enters the resident's personal space.

The intended experience is:

1. Walk around the shared town.
2. Approach a house and enter it.
3. Explore the interior and its objects.
4. Visit the owner's personal website through an in-world computer.
5. Read public notes and writing through an in-world book or notebook.

The town and house interiors form the foundation. Personal website and notebook content systems are planned as a later stage.

## Current prototype

The current prototype and supplied demo footage showcase:

- A top-down pixel-art town with roads, houses, trees, paths and decorations.
- A player character with keyboard movement.
- Camera follow/zoom and world collision handling.
- A day/night environment, including a Halloween night presentation.
- A house interior prototype with furniture and in-world computer and book props.

This is an actively developed project. The demo is a short capture of the prototype, not a claim that every item on the longer-term roadmap is already implemented.

## Technology

The project brief defines the following architecture and stack:

| Technology | Responsibility |
| --- | --- |
| React + Vite | Web application shell and interface |
| TypeScript | Application and game logic |
| Phaser 3 | Game rendering, scenes, movement, camera and collisions |
| Tailwind CSS | Styling for regular web UI |
| Supabase (planned) | Authentication, PostgreSQL, storage and realtime features |
| Vitest / Playwright | Unit and browser end-to-end testing |

Phaser is responsible for the game world. React is responsible for normal application UI such as world selection, editors and website/notebook panels. User-created content should use safe, predefined components rather than executing arbitrary HTML or JavaScript in the game origin.

## Getting started

### Prerequisites

- Node.js
- npm
- Git

### Run locally

```bash
git clone <your-repository-url>
cd webtown
npm install
npm run dev
```

Vite will print the local development URL in the terminal.

### Useful scripts

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
```

Run the test script configured in `package.json` to execute the project's test suite.

## Controls

- **W / A / S / D** or **Arrow keys** — move your character.
- Use the in-game interaction prompt/key when approaching an interactive entrance or object, where available.

## Roadmap

The project is being developed in stages. The broader direction includes:

- **Personal spaces:** owner websites, notebooks and a basic content editor.
- **Accounts and persistence:** registration, worlds, memberships, house assignment and saved content.
- **Multiplayer:** invitations, shared presence and synchronized movement.
- **Community:** guestbooks, public discovery and moderation.
- **World builder:** tools to customize maps and place objects.
- **Property system:** optional virtual house allocation, renting or trading, while keeping ownership separate from personal identity.
- **Proximity voice:** distance-based communication with clear privacy controls.

These are roadmap goals, not all current features.

## Development principles

- Keep the game world separate from the ordinary web application UI.
- Build and verify one phase at a time.
- Review AI-generated changes instead of accepting them blindly.
- Keep the application runnable after each milestone.
- Document asset sources and redistribution permissions before publishing assets.
- Keep a person's website and notebook separate from the house itself, so transferring a house never transfers someone's identity or content.

## Assets and licensing

Before redistributing any third-party sprites, tilesets, characters or other assets, verify that their licences permit the intended use and public source-code distribution. A licence that allows commercial use does not automatically allow standalone redistribution of the original asset files.

Document asset sources and permissions in `docs/ASSETS.md` as they are verified.

## Contributing

Contributions, feedback and ideas are welcome. For substantial changes, open an issue first to discuss the proposed scope. Keep pull requests focused and include relevant tests or verification notes.

## Project

Built for **Kiroween 2026 — Resurrection**.

**WebTown — Don't scroll the internet. Explore it.**
