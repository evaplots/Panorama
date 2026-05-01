# Architecture

This document describes how Panorama is organised at the highest level: the modules, how they communicate, and the data flow from "user clicks a location" to "PNG saved to disk."

For who owns each module, see [ROLES.md](./ROLES.md). For the exact shapes of the data passed between modules, see [DATA-CONTRACTS.md](./DATA-CONTRACTS.md).

---

## Guiding principles

1. **One module, one concern.** If a file mixes terrain math with HTML controls, it's wrong.
2. **Modules talk through contracts, not implementation.** The Terrain module exposes a `getHeightAt(lat, lon)` function. Nobody outside `src/terrain/` knows or cares how it works inside.
3. **State changes flow through the event bus.** Modules don't call each other directly except through public APIs. UI fires events, the orchestrator routes them.
4. **Async work is explicit.** Anything that hits the network returns a Promise and is cancellable. Nothing blocks the render loop.
5. **Phase boundaries are real.** Phase 1 modules don't import from Phase 3 modules. The roadmap maps onto the directory structure.

---

## Module map

```
                         ┌───────────────────────┐
                         │   UI (controls panel) │
                         │   src/ui/             │
                         └───────────┬───────────┘
                                     │ user events
                                     ▼
                         ┌───────────────────────┐
                         │   State + Event Bus   │
                         │   src/state.js        │
                         └───────────┬───────────┘
                                     │ state changes
                                     ▼
                         ┌───────────────────────┐
                         │   Scene Orchestrator  │
                         │   src/scene/          │
                         └───┬───────┬───────┬───┘
                             │       │       │
                ┌────────────┘       │       └──────────────┐
                ▼                    ▼                      ▼
        ┌──────────────┐    ┌──────────────┐       ┌──────────────┐
        │   Terrain    │    │     Sky      │       │ OSM features │
        │ src/terrain/ │    │   src/sky/   │       │   src/osm/   │
        └──────┬───────┘    └──────┬───────┘       └──────┬───────┘
               │                   │                      │
               └───────────────────┴──────────────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │  Data Layer (fetch)   │
                         │   src/data/           │
                         └───────────────────────┘

      ┌─────────────────────────────────────────────────────┐
      │   Camera (src/camera/)  &  Export (src/export/)     │
      │   read from Scene; never modify Terrain/Sky/OSM     │
      └─────────────────────────────────────────────────────┘
```

---

## Modules at a glance

| Module        | Path             | Owns                                                                           | Depends on              | Phase     |
| ------------- | ---------------- | ------------------------------------------------------------------------------ | ----------------------- | --------- |
| **Scene**     | `src/scene/`     | Three.js scene graph, render loop, module wiring                               | Renderer, all builders  | 1         |
| **Terrain**   | `src/terrain/`   | DEM fetching, mesh generation, height queries                                  | Data Layer              | 1         |
| **Sky**       | `src/sky/`       | Sky shader, sun position, directional lighting                                 | (none)                  | 1         |
| **OSM**       | `src/osm/`       | Buildings, vegetation, landmarks, LOD                                          | Data Layer, Terrain     | 1.5 / 2   |
| **Camera**    | `src/camera/`    | View controls, walk mode, scenic default, FOV, eye height                      | Terrain (height query)  | 1 / 2     |
| **Export**    | `src/export/`    | A3 300 DPI render, tiled fallback, PNG download                                | Scene, Camera, **Style** | 4        |
| **UI**        | `src/ui/`        | Controls panel, sliders, location picker, mode toggle, **stylize trigger**     | State                   | 1 / 2     |
| **Data**      | `src/data/`      | HTTP, caching, tile math, geocoding                                            | (none — bottom layer)   | 1         |
| **State**     | `src/state.js`   | Central state object, event bus                                                | (none — top layer)      | 1         |
| **Style**     | `src/style/`     | Painterly transforms (pointillism v0). One-shot CPU canvas pass on user trigger | Scene canvas (read-only) | **2.5**   |
| **Weather**   | `src/weather/`   | Clouds, rain, fog, wind via Open-Meteo. Drives data→style bindings              | Data Layer              | post-2.5  |
| **Astronomy** | `src/astronomy/` | Moon phase, stars (Hipparcos), constellations, aurora (NOAA SWPC)               | Data Layer              | post-2.5  |
| **Wildlife**  | `src/wildlife/`  | Bird flocks (eBird) — aspirational; soundscape (xeno-canto) at risk of cut      | Data Layer              | post-2.5  |

---

## Data flow: user input → image

The path of a single user action from click to pixel:

1. **User picks a location** — `LocationPicker.js` calls `Geocoder.search("Mont Blanc")`. Geocoder hits Nominatim, returns `{lat, lon, displayName}`. `LocationPicker` updates `state.location`.
2. **State change broadcast** — The state setter emits `'location:changed'`. The Scene Orchestrator listens.
3. **Orchestrator triggers builders** — On `'location:changed'`, the orchestrator:
   - Asks `TerrainBuilder.build(location, radius)` for a new terrain mesh.
   - Asks `OSMFeatureBuilder.build(location, lodConfig)` for buildings & vegetation.
   - Asks `CameraController.placeAt(location, eyeHeight)` to snap the camera.
   - Asks `ScenicDefault.suggest(location, time)` for the default azimuth.
4. **Builders fetch data** — Each builder calls into `src/data/` for raw bytes. Cache returns hits immediately; misses go to the network.
5. **Builders produce Three.js objects** — Terrain becomes a `Mesh`, buildings become an instanced `Mesh`, etc. Each builder returns a `THREE.Group` to the orchestrator.
6. **Orchestrator swaps groups** — Old groups are disposed; new groups are added to `scene`.
7. **Sky updates each frame** — `SkySystem` reads `state.time` and updates sun uniform + directional light. This is cheap and runs in the render loop.
8. **Camera updates each frame** — `CameraController` reads pointer/keyboard input and updates the camera.
9. **Render loop draws** — `Renderer.render(scene, camera)` runs at 60 FPS.
10. **User clicks Export** — `ExportPipeline.export(format)` resizes the renderer to A3@300DPI, renders one frame, calls `canvas.toBlob()`, triggers download. Restores preview size.

Crucially: steps 1–6 are async and triggered by events. Steps 7–9 run every frame regardless. Step 10 is a one-shot that pauses the render loop for ~1 second.

---

## Painter pipeline (Phase 2.5+)

The painter is split into two named stages so the live preview can run
the cheap one without paying for the slow one. The `applyPointillism`
function in `src/style/Pointillism.js` chains both; the live preview
panel calls only the first.

```
                 sourceCanvas (WebGL snapshot or downscaled copy)
                             │
                             ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Stage 1 — renderUnderpainting (src/style/underpainting.js) │
   │   1. Allocate working canvas (drawImage source)             │
   │   2. paintGround       broad colour fills, sun-phase tint   │
   │   3. paintCanopy       stippled forest dabs (PR #12)        │
   │   4. paintLandmarks    silhouette marks (PR #12)            │
   │   5. Optional: median-blur softening (auto-scaled kernel)   │
   │  Returns { canvas, srcData, timing }                        │
   └─────────────────────────────────────────────────────────────┘
                             │
            ┌────────────────┴───────────────┐
            ▼                                ▼
  ┌─────────────────────────┐    ┌─────────────────────────┐
  │  UnderpaintingPreview   │    │  Stage 2 — pointillism  │
  │  (live, ~10 ms @ 480 px)│    │  (~22 s @ A3 + strokes) │
  │  draw onto preview canvas│    │   palette extraction   │
  └─────────────────────────┘    │   Scharr + Gaussian    │
                                 │   weighted-random ←    │
                                 │   stroke ellipse pass  │
                                 │  Returns { canvas, ... }│
                                 └─────────────────────────┘
                                              │
                                              ▼
                                       Stylized canvas
                                       (A3 export PNG)
```

`buildSnapshot()` in `src/snapshot.js` is the single entry point both
stages use to assemble the `StyleBindings` from current state — the
preview and the full paint consume identical inputs (modulo render
dimensions). All peeks are cache-only — paint-time and preview-time
never block on Overpass / Open-Meteo round-trips.

Determinism contract: same Snapshot + same seed → byte-identical Stage 1
output. Stage 2 inherits that determinism via the master Mulberry32
PRNG. Verified by `scripts/parity-probe.js`.

---

## Communication patterns

Three patterns, used consistently:

### 1. Public module API (function calls)

For request/response: "give me the height at this point."

```js
// in src/scene/SceneManager.js
import { getHeightAt } from '../terrain/HeightSampler.js';
const h = getHeightAt(lat, lon);
```

### 2. Event bus (pub/sub)

For state changes: "the location changed, react however you want."

```js
// in src/ui/LocationPicker.js
import { state } from '../state.js';
state.set('location', { lat: 45.83, lon: 6.86 });

// in src/scene/SceneManager.js
state.on('location:changed', (newLoc) => { /* rebuild scene */ });
```

### 3. Three.js scene graph

For rendering. Builders attach `THREE.Object3D` instances to groups; the renderer draws them. No module reaches into another module's group.

---

## File structure (canonical)

```
src/
├── main.js                      Entry point. Imports modules, calls SceneManager.init().
├── config.js                    Constants: presets, defaults, FOV, DPI, tile zoom levels.
├── state.js                     State object + event bus. Owned by no module, used by all.
│
├── scene/
│   ├── SceneManager.js          Wires all modules; runs the render loop.
│   └── Renderer.js              Three.js WebGLRenderer setup, resize handling.
│
├── terrain/
│   ├── TerrainBuilder.js        Public API: build(location, radius) → Promise<Group>
│   ├── DEMFetcher.js            Fetches AWS Terrain RGB tiles, decodes to Float32 heights.
│   └── HeightSampler.js         Public API: getHeightAt(lat, lon) → Number (metres).
│
├── sky/
│   ├── SkySystem.js             Three.js Sky shader, directional light, ambient light.
│   └── SunCalculator.js         Wraps SunCalc; returns {azimuth, altitude} for time/loc.
│
├── osm/
│   ├── OSMFetcher.js            Overpass queries by tile, with retries.
│   │                            Exposes fetchGroundCover (3D scene cache-warm)
│   │                            and peekGroundCover (painter, cache-only).
│   └── index.js                 OSMFeatureBuilder.build(): cache-warming
│                                placeholder; painter consumes the warmed
│                                cache via peekGroundCover (V2 Step 4). The
│                                3D ground/buildings/vegetation builders and
│                                LODManager were removed; see git history if
│                                they need to be restored.
│
├── camera/
│   ├── CameraController.js      Orbit/pan controls, FOV, eye height, drag-to-look.
│   └── ScenicDefault.js         Picks the "best" default direction for a location/time.
│
├── export/
│   ├── ExportPipeline.js        Public API: export({format, dpi}) → triggers download.
│   └── TiledRenderer.js         Fallback for GPUs that can't handle 4961×3508 in one pass.
│
├── ui/
│   ├── ControlsPanel.js         Top-level UI container. Owns the DOM.
│   ├── LocationPicker.js        Address search + lat/lon input.
│   ├── TimeSlider.js            Full-24h time slider in location's local time, "follow sun" toggle.
│   ├── PresetSelector.js        Distance presets (urban / suburban / open / alpine).
│   ├── ModeToggle.js            Phase 2: orbit/walk mode switch + reset-position button.
│   └── DebugOverlay.js          Phase 2: toggleable diagnostic panel ('?' key).
│
├── data/
│   ├── Cache.js                 In-memory + IndexedDB cache for tiles and Overpass results.
│   ├── Geocoder.js              Nominatim wrapper.
│   └── TileMath.js              Slippy-map tile <-> lat/lon math.
│
├── style/                       Phase 2.5: painterly transforms.
│   └── index.js                 Stub. v0 target: src/style/Pointillism.js (CPU canvas pass).
│
├── weather/                     Post-2.5: real-data weather (Open-Meteo).
│   └── index.js                 Stub.
│
├── astronomy/                   Post-2.5: moon, stars, constellations, aurora.
│   └── index.js                 Stub.
│
└── wildlife/                    Aspirational: eBird flocks, xeno-canto soundscape.
    └── index.js                 Stub.
```

---

## What each module is NOT allowed to do

This is the contract that keeps the codebase editable:

- **Terrain** must not know about OSM, time of day, or the camera. It produces a mesh; that's it.
- **Sky** must not know about terrain or buildings. It produces a sky dome and a directional light.
- **OSM** must not modify terrain geometry. It reads heights *from* Terrain to place buildings on the ground, but never writes back.
- **Camera** must not own scene objects. It only reads heights and writes its own transform.
- **Export** must not modify the scene. It changes renderer size, renders, restores. No side effects on builders. May call **Style** as a post-render transform on the exported canvas (the only cross-module call Export is allowed to make beyond reading the scene).
- **UI** must not import from `src/scene/`, `src/terrain/`, etc. It only reads/writes `state`.
- **Data Layer** must not import from any other module. It's the bottom of the dependency graph.
- **Style** must not modify the scene, the camera, or any builder. It receives a frozen RGBA canvas + a frozen data-bindings snapshot (wind, sun altitude, etc.) and returns a new canvas. Pure transform. Determinism is a contract — same input must produce same output.
- **Weather / Astronomy / Wildlife** are data fetchers + optional visual contributors. They may publish state (e.g. `state.weather`, `state.celestial`) but must not import from rendering modules. Visual contribution lands as new builders consumed by the Scene Orchestrator, not as direct mutations of Terrain / Sky / OSM groups.

If you find yourself wanting to break one of these rules, the architecture probably needs a new contract — open `DATA-CONTRACTS.md` and add one rather than reaching across modules.

---

## Lifecycle

```
main.js
  │
  ├─ SceneManager.init()
  │    ├─ Renderer.init(canvas)
  │    ├─ SkySystem.init(scene)
  │    ├─ CameraController.init(canvas)
  │    └─ subscribe to state events
  │
  ├─ ControlsPanel.init(domRoot)
  │
  └─ start render loop
       └─ requestAnimationFrame(tick)
            ├─ SkySystem.update(time)
            ├─ CameraController.update()
            └─ Renderer.render(scene, camera)
```

When the user changes location, the orchestrator runs `rebuildScene(newLocation)` which is async and may take 5–30 seconds. During this time the old scene continues to render; new objects swap in atomically when ready.
