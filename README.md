# Tịnh Tâm Tự (淨心寺) — Frontend

A 3D online temple where people sit together quietly. This repository contains the frontend.
Languages: Tiếng Việt · English · ພາສາລາວ · ភាសាខ្មែរ.

- **UI:** React 18 for the HUD and panels.
- **3D engine:** Three.js. The temple, statues and trees are generated procedurally; static geometry is merged, and quality tiers adapt to the device.
- **Audio:** Web Audio API. All sound is synthesised in the browser: wooden fish, bells, hall music and the DJ songs.
- **Realtime:** WebSocket client with snapshot interpolation, NTP-style clock sync and reconnect with jitter.
- **Pathfinding:** A* on a navigation grid.
- **Shared contract:** `shared/` holds the wire protocol and world layout used by both frontend and backend.

## Run

```bash
npm install
npm run dev            # http://localhost:5173 (proxies /api and /ws to the backend)
npm run build          # production build → dist/
```

The app needs the realtime backend, which defaults to `http://localhost:8787`.
To use a different one: `BACKEND_URL=http://host:port npm run dev`.

## Structure

```
src/
  App.tsx           screens, hotkeys, audio sync
  game/             World (scene), Avatar, Game (engine loop, input, camera), nav (A*), layout, textures
  audio/            AudioEngine (procedural sound)
  net/              Net (websocket client)
  ui/               HUD, panels, chat, seat dialogs, DJ, minimap, beads, wooden fish
  i18n/             vi / en / lo / km
shared/             protocol + world layout (shared with the backend)
```

Before going live, put your own payment details in `src/config.ts`.
The Lao and Khmer translations still need review by native speakers.
