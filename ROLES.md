# Roles — The Panorama Team

Panorama is structured as if a small team of specialists built it. Each role owns one module, has clear authority over its files, and explicit contracts with adjacent roles. A future developer should be able to "hire" themselves into one role and edit only that module.

This document is the org chart. For *what each module does internally*, read the module's own doc in `docs/modules/`.

---

## How to read this document

Each role has six fields:

- **Mandate** — one sentence describing what they own.
- **Owned files** — the exact files they may modify.
- **Public API** — the functions/events other roles may call.
- **Depends on** — other roles whose APIs they consume.
- **Must not touch** — files outside their remit.
- **Decision authority** — what they can change unilaterally vs. needs cross-role agreement.

---

## 🏛 Lead Architect

**Mandate:** Owns the overall structure, the contracts, and the roadmap. Resolves disputes between roles.

**Owned files:**
- `README.md`
- `SETUP.md`
- `ARCHITECTURE.md`
- `ROLES.md` (this file)
- `DATA-CONTRACTS.md`
- `ROADMAP.md`
- `src/main.js`
- `src/config.js`
- `src/state.js`

**Public API:** N/A — this role provides structure, not runtime code.

**Depends on:** Nobody. Everybody depends on the architect.

**Must not touch:** Any module's internals. The architect specifies *what* a module exports, never *how* it implements it.

**Decision authority:** Adding/removing modules, changing the event bus shape, changing the state schema, defining new shared types. Anything in `DATA-CONTRACTS.md`.

---

## 🎬 Scene Orchestrator

**Mandate:** Wires the modules together at runtime. Owns the Three.js scene graph and the render loop.

**Owned files:**
- `src/scene/SceneManager.js`
- `src/scene/Renderer.js`

**Public API:**
- `SceneManager.init(canvas)` — bootstraps everything.
- `SceneManager.rebuild(location, presets)` — triggers a full scene rebuild.
- The render loop (no public API; runs internally).

**Depends on:** Renderer (own), Terrain, Sky, OSM, Camera, State.

**Must not touch:** Anything inside `src/terrain/`, `src/sky/`, `src/osm/`, `src/camera/`. Only calls their public APIs.

**Decision authority:** Render loop frequency, when to dispose old scene objects, how to interleave async builds with rendering. May NOT add new state fields or events without architect sign-off.

**See:** [docs/modules/scene.md](./docs/modules/scene.md)

---

## 🏔 Terrain & DEM Engineer

**Mandate:** Turns elevation data into a Three.js mesh, and exposes height queries.

**Owned files:**
- `src/terrain/TerrainBuilder.js`
- `src/terrain/DEMFetcher.js`
- `src/terrain/HeightSampler.js`

**Public API:**
- `TerrainBuilder.build(location, radius) → Promise<THREE.Group>`
- `HeightSampler.getHeightAt(lat, lon) → Number` (metres above sea level)
- `HeightSampler.getHeightAtWorld(x, z) → Number` (Three.js coords)

**Depends on:** Data Layer (for tile fetching and caching).

**Must not touch:** OSM features, sky, camera, UI. Knows nothing about time of day.

**Decision authority:** Mesh resolution, LOD strategy for far terrain, DEM source choice (currently AWS Terrain Tiles), interpolation algorithm. May NOT change the public API signatures without architect sign-off.

**See:** [docs/modules/terrain.md](./docs/modules/terrain.md)

---

## ☀️ Sky & Lighting Engineer

**Mandate:** Produces realistic sunset skies and the directional light that drives shading.

**Owned files:**
- `src/sky/SkySystem.js`
- `src/sky/SunCalculator.js`

**Public API:**
- `SkySystem.init(scene) → void` — adds sky dome, directional light, ambient light.
- `SkySystem.update(timestamp, location) → void` — called every frame.
- `SunCalculator.getSunPosition(timestamp, lat, lon) → {azimuth, altitude}`
- `SunCalculator.getSunsetTime(date, lat, lon) → Date`

**Depends on:** SunCalc library only. No internal Panorama modules.

**Must not touch:** Terrain, OSM, camera. Doesn't care what's in the scene; it just lights it.

**Decision authority:** Sky shader parameters (turbidity, rayleigh, mie), light colour temperature curves through dusk, atmospheric haze. The Sky engineer is the artist of the project — they own the look.

**See:** [docs/modules/sky.md](./docs/modules/sky.md)

---

## 🏘 OSM Features Engineer

**Mandate:** Owns Overpass fetching and the cache that backs both the 3D
scene's cache-warming pass and the painter's polygon rendering. As of the
chore that removed 3D OSM rendering, this role no longer constructs Three.js
geometry — the painter (Style role) does the polygon work directly via
`OSMFetcher.peekGroundCover`.

**Owned files:**
- `src/osm/OSMFetcher.js`
- `src/osm/index.js` — `OSMFeatureBuilder.build()` is now a cache-warming
  wrapper around `fetchGroundCover` that returns an empty `osmFeatures` Group.

**Public API:**
- `OSMFetcher.fetchGroundCover(location, preset) → Promise<polygons>`
  Fetches (and caches) ground-cover polygons. Used by the scene-rebuild path
  to warm the cache for the painter.
- `OSMFetcher.peekGroundCover(location, preset) → Promise<polygons>`
  Cache-only read. Never triggers a network request. Used by the painter at
  trigger time so paint is fast even when the scene fetch is still in flight.
- `OSMFeatureBuilder.build(location, preset) → Promise<THREE.Group>`
  Calls `fetchGroundCover` to warm the cache and returns an empty Group named
  `osmFeatures`. Kept so `SceneManager`'s add/dispose flow stays unchanged.

**Depends on:** Data Layer (Overpass + Cache).

**Must not touch:** Terrain, sky, camera, painter.

**Decision authority:** OSM tag selection, Overpass query construction,
cache TTLs, peek vs fetch semantics.

**See:** [docs/modules/osm-features.md](./docs/modules/osm-features.md)
(Note: that doc still describes the deleted 3D builders. It will be
rewritten when the role is next active; until then, it is preserved as
historical reference for restoration.)

---

## 📸 Camera & Composition Engineer

**Mandate:** Owns the viewer's eyes. Where they stand, where they look, how they move.

**Owned files:**
- `src/camera/CameraController.js`
- `src/camera/ScenicDefault.js`

**Public API:**
- `CameraController.init(canvas, scene) → THREE.PerspectiveCamera`
- `CameraController.placeAt(location, eyeHeight) → void`
- `CameraController.lookAt(azimuth, elevation) → void`
- `CameraController.update() → void` — called every frame.
- `ScenicDefault.suggest(location, time) → {azimuth, elevation}`

**Depends on:** Terrain (for ground height under camera), Sky's SunCalculator (for "follow sun" mode).

**Must not touch:** Anything else. The camera is purely a transform; it owns nothing in the scene.

**Decision authority:** Drag/orbit behaviour, FOV value, eye height (default 1.7 m), tilt limits, scenic-default heuristic.

**See:** [docs/modules/camera.md](./docs/modules/camera.md)

---

## 🖨 Export Pipeline Engineer

**Mandate:** Renders the scene at print resolution and saves a PNG.

**Owned files:**
- `src/export/ExportPipeline.js`
- `src/export/TiledRenderer.js`

**Public API:**
- `ExportPipeline.export({format, dpi, orientation}) → Promise<Blob>`
- `ExportPipeline.canRenderInOnePass({width, height}) → Boolean`

**Depends on:** Scene Orchestrator (the renderer + scene + camera), Camera (for aspect ratio).

**Must not touch:** Anything that produces the scene. Export is read-only with respect to terrain/sky/OSM. Temporarily mutates renderer/camera but always restores.

**Decision authority:** DPI options, tile count for tiled renders, MSAA level for export, file naming convention, format options (PNG always; JPG/WebP optional later).

**See:** [docs/modules/export.md](./docs/modules/export.md)

---

## 🎛 UI/Controls Engineer

**Mandate:** All things DOM. Sliders, inputs, panels, the export button.

**Owned files:**
- `src/ui/ControlsPanel.js`
- `src/ui/LocationPicker.js`
- `src/ui/TimeSlider.js`
- `src/ui/PresetSelector.js`
- `src/ui/ModeToggle.js` (Phase 2 — orbit/walk mode switcher)
- `src/ui/DebugOverlay.js` (Phase 2 — toggleable diagnostic panel)
- All CSS for the controls panel.

**Public API:**
- `ControlsPanel.init(rootElement) → void`

**Depends on:** State (for reading current values, dispatching changes), Data Layer (Geocoder for the search box).

**Must not touch:** Any rendering code, any builder. UI never imports from `scene/`, `terrain/`, `sky/`, `osm/`, `camera/`, or `export/`. It only reads/writes `state`.

**Decision authority:** UI layout, interaction patterns, when to debounce inputs, error message wording. May NOT add new state fields without architect sign-off.

**See:** [docs/modules/ui.md](./docs/modules/ui.md)

---

## 🌐 Data Layer Engineer

**Mandate:** Everything network-facing: HTTP, caching, retries, geocoding, tile math.

**Owned files:**
- `src/data/Cache.js`
- `src/data/Geocoder.js`
- `src/data/TileMath.js`

**Public API:**
- `Cache.get(key) → Promise<any | null>`
- `Cache.set(key, value, ttl?) → Promise<void>`
- `Geocoder.search(query) → Promise<{lat, lon, displayName}>`
- `Geocoder.reverse(lat, lon) → Promise<{displayName}>`
- `TileMath.lonLatToTile(lon, lat, zoom) → {x, y, z}`
- `TileMath.tileBounds(x, y, z) → {north, south, east, west}`

**Depends on:** Nothing. Bottom of the dependency graph.

**Must not touch:** Three.js, scene graph, builders, UI. The Data Layer is pure I/O.

**Decision authority:** Cache strategy (memory vs IndexedDB vs none), retry logic, rate limiting, request batching, User-Agent strings. Tile-zoom-level decisions for fetchers (the *what to fetch* belongs to terrain/OSM; the *how to fetch* belongs here).

**See:** [docs/modules/data-layer.md](./docs/modules/data-layer.md)

---

## 🎨 Stylization Engineer

**Mandate:** Owns the painterly transform that turns the rendered scene into the project's signature output. v0 is pointillism; future styles (Hockney-flat, Van Gogh, etc.) are pluggable behind the same interface.

**Owned files:**
- `src/style/Pointillism.js` (v0 target — pointillism algorithm port)
- `src/style/palettes.json` (v0 target — curated painter-extracted palettes)
- `src/style/gradient.js` (v0 target — vanilla-JS Scharr + Gaussian)
- Future: additional style modules under `src/style/<style-name>.js`

**Public API (planned):**
- `applyStyle(styleName, sourceCanvas, dataBindings, options) → Promise<HTMLCanvasElement>` — one-shot transform; takes a frozen Three.js render canvas and a frozen data-bindings snapshot, returns a stylized canvas.
- `listAvailableStyles() → string[]` — for the UI picker.

**Depends on:** Nothing inside `src/`. Receives canvas + data inputs from Scene Orchestrator (or Export Pipeline) at trigger time.

**Must not touch:** The scene, the camera, any builder, any state field. Pure transform. Determinism is a contract: same input → same output.

**Decision authority:** Algorithm choice within a style, palette curation, parameter binding (which data signal drives which visual parameter — must be declared in `DATA-CONTRACTS.md` data→style binding section). May NOT change the public API or trigger model without architect sign-off.

**See:** [docs/modules/style.md](./docs/modules/style.md)

---

## 🌦 Weather Engineer (stub — post-2.5)

**Mandate:** Real-world meteorology for the location/timestamp. Drives both visual atmospheric effects and the data→style binding (wind direction → brushstroke angle, wind speed → stroke length).

**Owned files (when implemented):**
- `src/weather/WeatherFetcher.js` — Open-Meteo client
- `src/weather/CloudLayer.js`
- `src/weather/Precipitation.js`
- `src/weather/Atmospherics.js` (fog, rainbow)

**Public API (planned):**
- `WeatherFetcher.getWeather(lat, lon, timestamp) → Promise<WeatherSnapshot>` — normalized shape defined in `DATA-CONTRACTS.md`.
- Visual builders (CloudLayer, etc.) follow the OSM-builder pattern: `build(weatherSnapshot, scene) → Promise<THREE.Group>`.

**Depends on:** Data Layer (HTTP + cache).

**Must not touch:** Terrain, Sky shader internals, OSM. May read sun position from `SunCalculator` (read-only).

**Decision authority:** Cloud rendering technique (billboard vs volumetric), precipitation density curves, fog Z-distance. Tag mapping for Open-Meteo response → `WeatherSnapshot`.

**See:** [docs/modules/weather.md](./docs/modules/weather.md)

---

## 🌌 Astronomy Engineer (stub — post-2.5)

**Mandate:** Beyond-sun celestial state. Stars, moon, constellations, aurora. Today the project only knows about the sun; this role unlocks night scenes and twilight nuance.

**Owned files (when implemented):**
- `src/astronomy/Stars.js` (offline Hipparcos catalogue)
- `src/astronomy/Moon.js`
- `src/astronomy/Constellations.js`
- `src/astronomy/Aurora.js` (NOAA SWPC Kp index)

**Public API (planned):**
- `getCelestialState(lat, lon, timestamp) → Promise<CelestialSnapshot>` (shape in `DATA-CONTRACTS.md`)
- Visual builders attach a `THREE.Group` of stars/moon/aurora geometry to the sky dome.

**Depends on:** Data Layer (for Kp index — Hipparcos is bundled offline). May read sun position to gate visibility.

**Must not touch:** Terrain, OSM, Camera, ground-level rendering. Lives "above" the world.

**Decision authority:** Star magnitude cutoff, moon phase rendering technique, aurora oval geometry, constellation line set.

**See:** [docs/modules/astronomy.md](./docs/modules/astronomy.md)

---

## 🐦 Wildlife Engineer (stub — aspirational)

**Mandate:** Living things in the scene — bird flocks (eBird) and optionally bird-call audio (xeno-canto). At risk of being deferred indefinitely per the scope-realism review; if it ships at all, **flocks ship and audio doesn't**.

**Owned files (if implemented):**
- `src/wildlife/EBirdFetcher.js`
- `src/wildlife/Flocks.js` (procedural flock animation)
- `src/wildlife/XenoCantoFetcher.js` (at risk)
- `src/wildlife/Soundscape.js` (at risk)

**Public API (planned):**
- `getRecentSightings(lat, lon, date, radiusKm) → Promise<Sighting[]>`
- `Flocks.build(sightings, scene) → Promise<THREE.Group>`

**Depends on:** Data Layer.

**Must not touch:** Anything else. Pure additive layer on top of the rendered scene.

**Decision authority:** Flock animation parameters, billboard vs sprite rendering, species → silhouette mapping. Whether soundscape ships at all (default: no, per scope review).

**See:** [docs/modules/wildlife.md](./docs/modules/wildlife.md)

---

## Communication summary

```
                                  STATE & EVENTS
                                  (Lead Architect)
                                         │
        ┌──────────────────┬─────────────┼─────────────┬──────────────────┐
        │                  │             │             │                  │
        ▼                  ▼             ▼             ▼                  ▼
       UI              Scene         Camera        Export             (Roadmap)
   (UI Eng.)       (Orchestrator)  (Camera Eng.) (Export Eng.)
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
         Terrain        Sky          OSM
       (Terrain Eng.) (Sky Eng.)  (OSM Eng.)
            │                         │
            └────────────┬────────────┘
                         ▼
                     Data Layer
                  (Data Eng.)
```

**Rule of thumb:** if you're a role and you want to call another role's code, you may only call functions listed under their **Public API**. If you need something they don't expose, that's a conversation with the Lead Architect — not a private patch.

---

## Hiring guide (for future contributors)

If you've cloned this repo and want to contribute, decide which role you're playing first:

| You want to...                                  | Read these docs                                       |
| ----------------------------------------------- | ----------------------------------------------------- |
| Improve sunset colours / atmospheric look       | `modules/sky.md`                                      |
| Add new building types or fix building heights  | `modules/osm-features.md`                             |
| Make terrain look better far away               | `modules/terrain.md`                                  |
| Add a new UI control                            | `modules/ui.md` + `DATA-CONTRACTS.md`                 |
| Support A2 or A1 export sizes                   | `modules/export.md`                                   |
| Speed up scene loading                          | `modules/data-layer.md`                               |
| Make the default view smarter                   | `modules/camera.md`                                   |
| Refactor across modules                         | `ARCHITECTURE.md` + `DATA-CONTRACTS.md` (you're now the architect for that change) |
