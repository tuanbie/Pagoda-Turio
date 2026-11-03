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

The app needs the realtime backend (https://github.com/tuanbie/Pagoda-BE). Locally it defaults to `http://localhost:8787`.
In production, set the `VITE_BACKEND_URL` environment variable (on Vercel: `https://pagoda.bijancob.io.vn`, the backend's custom domain; it is baked in at build time, so redeploy after changing it).
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

Before going live, put your own name and payment details in `src/config.ts`.
The Lao and Khmer translations still need review by native speakers.

## Not a real temple · supporting the developer

Tịnh Tâm Tự is a **fictional virtual temple** in a personal software project. It is not a real temple and does not represent any temple, place of worship, the Vietnam Buddhist Sangha or any other religious organisation.

The "Support the developer" button (heart icon in the top bar) works like Buy Me a Coffee / GitHub Sponsors: voluntary support for an independent developer, paid into their **personal account**, used only for servers, the domain and development. It is **not** "công đức" or "cúng dường", and no money goes to any temple or to religious purposes. The panel says this in all four languages.

If you fork or deploy this project, keep it that way:

- Never word the support feature as công đức / cúng dường / an offering / merit, and never suggest that money goes to a temple.
- Keep money out of the 3D scene. No donation boxes, QR codes or bank details inside the temple.
- Put the real developer or team name in `siteConfig.developer`. It appears in the disclaimer on the welcome screen, in Settings → Credits and in the support panel.
- Keep the suggested transfer memo (`siteConfig.donation.memo`) about the software.
- Raising money on behalf of a real temple needs written authorisation from that temple or the competent Sangha body, and has to follow the Law on Belief and Religion (2016) and Decree 93/2021/NĐ-CP. This project is not set up for that.
