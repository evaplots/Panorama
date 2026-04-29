# Panorama

An artistic landscape generator that turns real Earth data into painterly artwork — Van-Gogh-of-this-specific-place-at-this-specific-moment, not a photograph.

The user picks a location, a date and time, and a viewing direction. Panorama fetches real-world elevation data (DEM), OpenStreetMap features (ground cover, buildings, vegetation), and (post-Phase 2.5) real meteorology and astronomy for that exact lat/lon/timestamp. The user composes the scene at human eye height, then triggers a **painterly transform** — pointillism in v0, with parameters driven by the real data: wind direction shapes brushstroke angle, wind speed shapes stroke length, sun phase shapes the palette. The output is a print-quality A3 300 DPI PNG meant to be hung on a wall.

Painterly stylization is the **signature** of the project, not a Phase-5 nice-to-have. Every architectural decision should reinforce that goal: real-world data flowing into deterministic painterly output.

**The six pillars** that define what Panorama is *for*:
1. **Real-data-driven** — terrain, sun, weather, astronomy, all from free APIs keyed to a real lat/lon and timestamp.
2. **First-person human-scale** — eye height ~1.7 m, walk-around (WASD), look-around. Compose like a real photographer scouting a location.
3. **Recognisability** — the result must read as *this place* (ground cover colours, building heights, vegetation density).
4. **Painterly stylization is the signature** — final image is a painting, not a photograph; parameters are *bound to real data*.
5. **Multi-sensory ambition** (aspirational) — bird flocks (eBird), aurora (NOAA SWPC), bird-call audio (xeno-canto). At-risk; defer if scope demands.
6. **Print-quality export** — A3 300 DPI as the canonical output.

---

## Tech stack

| Concern              | Choice                                                                |
| -------------------- | --------------------------------------------------------------------- |
| Build tool           | **Vite** (ES modules, hot reload, zero-config bundling)               |
| Language             | **Vanilla JavaScript** (ES2022 modules) — no UI framework             |
| 3D engine            | **Three.js** (WebGL2, Sky shader, instanced meshes)                   |
| Sun math             | **SunCalc** (azimuth/altitude from lat/lon/timestamp)                 |
| Terrain (DEM)        | **AWS Terrain Tiles** (free, no auth, global)                         |
| OSM features         | **Overpass API** (free, rate-limited)                                 |
| Geocoding            | **Nominatim** (free, rate-limited)                                    |
| State                | Plain object + pub/sub event bus (no framework)                       |

No paid APIs. No mandatory accounts. Just `npm install` and run.

---

## Document map

Read these in order if you're new to the codebase:

1. **[SETUP.md](./SETUP.md)** — install, run, build, troubleshoot.
2. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — high-level architecture, module map, data flow.
3. **[ROLES.md](./ROLES.md)** — the team of expert agents and who owns what.
4. **[DATA-CONTRACTS.md](./DATA-CONTRACTS.md)** — the shared types and events that connect modules; includes the **data → style binding** contract that defines which real-world signals drive painterly parameters.
5. **[ROADMAP.md](./ROADMAP.md)** — the build phases. Phase 2.5 (Stylization) is the project's signature feature.

Then dive into the module you need to work on:

- [docs/modules/scene.md](./docs/modules/scene.md) — Scene Orchestrator (the conductor)
- [docs/modules/terrain.md](./docs/modules/terrain.md) — Terrain & DEM
- [docs/modules/sky.md](./docs/modules/sky.md) — Sky & Sun
- [docs/modules/osm-features.md](./docs/modules/osm-features.md) — Buildings, vegetation, LOD
- [docs/modules/camera.md](./docs/modules/camera.md) — Camera & composition
- [docs/modules/export.md](./docs/modules/export.md) — Print export pipeline
- [docs/modules/ui.md](./docs/modules/ui.md) — UI controls
- [docs/modules/data-layer.md](./docs/modules/data-layer.md) — Fetching, caching, tile math
- [docs/modules/style.md](./docs/modules/style.md) — **Painterly stylization (Phase 2.5)**
- [docs/modules/weather.md](./docs/modules/weather.md) — Real-world meteorology (post-2.5, stub)
- [docs/modules/astronomy.md](./docs/modules/astronomy.md) — Moon, stars, aurora (post-2.5, stub)
- [docs/modules/wildlife.md](./docs/modules/wildlife.md) — Bird flocks (aspirational, stub)

---

## Design principle: edit one thing at a time

Every module has a single owner role, a documented input/output contract, and a list of files it owns. A future developer working on (say) the export pipeline should be able to read **two documents** — `ARCHITECTURE.md` and `modules/export.md` — and confidently make changes without touching anything else.

If you find yourself needing to edit a module that isn't yours to fix a bug, that's a contract violation and the fix belongs upstream.
