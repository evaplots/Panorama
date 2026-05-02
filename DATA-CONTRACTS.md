# Data Contracts

This document defines every shared type, every state field, and every event that crosses a module boundary. Changing anything in this document is an architectural change — it affects multiple roles and must be coordinated.

If a module needs data that isn't here, the right move is to add it here first, *then* implement it.

---

## Shared types (informal — JSDoc-style)

These are the shapes passed between modules. We're not using TypeScript, but we document them as if we were.

### `Location`

```js
/**
 * @typedef {Object} Location
 * @property {number} lat        Latitude in degrees, -90 to 90
 * @property {number} lon        Longitude in degrees, -180 to 180
 * @property {string} [displayName]  Human-readable name (from Nominatim)
 * @property {number} [groundElevation]  Metres above sea level (filled by Terrain)
 */
```

### `Viewpoint`

```js
/**
 * @typedef {Object} Viewpoint
 * @property {Location} location
 * @property {number} eyeHeight       Metres above ground (default 1.7)
 * @property {number} azimuth         Compass degrees, 0=N, 90=E, 180=S, 270=W
 * @property {number} elevation       Pitch in degrees, -90=down, 0=horizontal, 90=up
 * @property {number} fov             Horizontal FOV in degrees (default 60)
 * @property {'orbit' | 'walk'} mode  Camera mode (Phase 2+)
 * @property {{x: number, z: number}} [anchor]  Walk-mode position offset from chosen location, metres (Phase 2+)
 */
```

### `TimeSpec`

```js
/**
 * @typedef {Object} TimeSpec
 * @property {Date} timestamp         The exact moment being rendered (UTC under the hood)
 * @property {string} [timezone]      IANA timezone of the location, e.g. 'Asia/Kathmandu' (filled by UI on location change)
 * @property {boolean} followSun      If true, camera azimuth tracks sun azimuth
 */
```

The `timestamp` is always an absolute UTC instant. `timezone` is informational — used by the UI for display and by the time-slider to interpret slider position as "local time at the location." Sun calculations don't need timezone (they take UTC + lat/lon and work it out).

### `SunPosition`

```js
/**
 * @typedef {Object} SunPosition
 * @property {number} azimuth         Compass degrees, where the sun is
 * @property {number} altitude        Degrees above horizon, negative if below
 * @property {number} colourTempK     Estimated colour temperature in Kelvin
 * @property {string} phase           'day' | 'goldenHour' | 'sunset' | 'civilTwilight' | 'night'
 */
```

### `RadiusPreset`

```js
/**
 * @typedef {Object} RadiusPreset
 * @property {string} name            'urban' | 'suburban' | 'open' | 'alpine' | 'custom'
 * @property {number} terrainRadius   Metres — how far terrain extends
 * @property {number} osmRadius       Metres — how far OSM features extend (capped at 5000)
 * @property {Object} lod             LOD distance thresholds
 * @property {number} lod.near        e.g. 500
 * @property {number} lod.mid         e.g. 2000
 * @property {number} lod.far         e.g. 5000
 */
```

Default presets (defined in `src/config.js`):

| Name     | terrainRadius | osmRadius | lod.near | lod.mid | lod.far |
| -------- | ------------- | --------- | -------- | ------- | ------- |
| urban    | 5 km          | 2 km      | 300 m    | 1000 m  | 2000 m  |
| suburban | 15 km         | 3 km      | 500 m    | 1500 m  | 3000 m  |
| open     | 40 km         | 4 km      | 500 m    | 2000 m  | 4000 m  |
| alpine   | 100 km        | 5 km      | 500 m    | 2000 m  | 5000 m  |

### `ExportSpec`

```js
/**
 * @typedef {Object} ExportSpec
 * @property {'A4' | 'A3' | 'A2'} format       Narrowed in v3.9 to match what
 *                                              `Pointillism.computeEffectiveDpi`
 *                                              actually accepts (A1 / custom
 *                                              are not in the engine table).
 * @property {'landscape' | 'portrait'} orientation
 * @property {150 | 300 | 600} dpi
 */
```

A3 landscape @ 300 DPI = 4961×3508 px. A3 portrait @ 300 DPI = 3508×4961 px.

---

## State schema (`src/state.js`)

The single source of truth at runtime. Lives in memory, never persisted (yet — Phase 5 may add localStorage).

```js
const state = {
  // -------- User-facing inputs --------
  location: null,           // Location | null
  preset: 'suburban',       // RadiusPreset.name
  customRadius: null,       // number | null (only used if preset === 'custom')
  time: {
    timestamp: new Date(),  // Date — always UTC instant
    timezone: null,         // string | null — IANA tz of current location, set by UI
    followSun: true,        // boolean
  },
  viewpoint: {
    azimuth: 270,           // degrees
    elevation: -5,          // degrees (slight downward tilt)
    fov: 60,                // degrees
    eyeHeight: 1.7,         // metres
    mode: 'orbit',          // 'orbit' | 'walk' (Phase 2+)
    anchor: { x: 0, z: 0 }, // walk-mode offset from chosen location in metres (Phase 2+)
  },

  // -------- Derived / status --------
  sun: null,                // SunPosition | null (recomputed on time/location change)
  scene: {
    status: 'idle',         // 'idle' | 'loading' | 'ready' | 'error'
    progress: 0,            // 0..1
    error: null,            // string | null
  },

  // -------- Export --------
  export: {
    format: 'A3',
    orientation: 'landscape',
    dpi: 300,
    inProgress: false,
  },

  // -------- Weather overrides (V2 Step 5) --------
  // Each field is null when the WeatherPanel input is empty (= take fetched
  // value); a number when the user has typed an override. mergeWeather() in
  // src/weather/mergeWeather.js composes the effective WeatherSnapshot
  // override-wins-else-fetched, per field.
  weatherOverrides: {
    wind: { directionDeg: null, speedMs: null },
    cloudCover_pct: null,
    humidity_pct: null,
    precipitation_mmh: null,
    temperature_C: null,
  },

  // -------- Painter parameter surface (V2 Step 5c, water added v3.11) --------
  // PainterParamsPanel writes here on slider input. ControlsPanel's stylize
  // handler reads at trigger time and spreads into applyPointillism opts.
  // Defaults match the engine's DEFAULTS so an untouched panel reproduces
  // the pre-step-5c painting bit-for-bit.
  painter: {
    brushWidthMm: 0.7,         // 0.3–3.0 mm, physical stroke width
    density: 0.06,             // 0.01–0.20, fraction of pixels that get a stroke
    brushOpacity: 0.85,        // 0.50–1.00 (precip binding can override)
    brushStrokeFactor: 1.0,    // 0.3–3.0 (wind speed binding can override)
    paletteTemperature: 28,    // 5–100, softmax temperature for sampling
    paletteSize: 20,           // 8–50, k for median-cut extraction
    windInfluenceOverride: null, // null = auto (PR #9 wind rule); finite = force
    seed: 0xC0FFEE,            // mulberry32 seed; "🎲 New seed" rerolls
    water: {                   // v3.11 — painterly water reflections
      reflectionStrength: 0.6, // 0–1, sky-band override strength (cosine falloff)
      sunGlitterEnabled: true, // back-lit sun glitter on/off
      rippleDensity: 0.4,      // 0–1, horizontal surface stroke density
    },
    atmospherics: {            // v3.12 — atmospheric depth post-passes (Phase 5)
      enabled: true,           // global toggle; off = byte-identical to pre-PR
      hazeStrength: 0.5,       // 0–1, distance-based desaturation toward sky tint
      bloomStrength: 0.4,      // 0–1, soft warm halo at projected sun position
      grainAmount: 0.15,       // 0–1, Mulberry32 paper-texture noise
    },
  },

  // -------- Terrain options (V2 Step 5c) --------
  // TerrainPanel writes here on slider release. SceneManager listens for the
  // dedicated `terrainOption:changed` event and rebuilds. TerrainBuilder
  // multiplies the heightmap by yExaggeration before HeightSampler is
  // populated, so every downstream consumer (mesh, camera, painter
  // projection, Precipitation respawn altitude) sees the same scaled world.
  terrain: {
    yExaggeration: 1.0,        // 0.3–3.0, default 1.0 = honest DEM
  },
};
```

---

## Event bus

`state.js` exposes an `EventEmitter`-like API:

```js
state.on(eventName, handler);
state.off(eventName, handler);
state.set(path, value);   // Mutates state and fires 'pathPart:changed' events
```

### Event catalogue

Every event that may be emitted, who emits it, and who listens.

| Event                  | Emitted when                                    | Emitter           | Typical listeners              | Payload                  |
| ---------------------- | ----------------------------------------------- | ----------------- | ------------------------------ | ------------------------ |
| `location:changed`     | User picks a new location                       | UI (LocationPicker) | Scene, Camera, ScenicDefault | `Location`               |
| `preset:changed`       | User picks a different distance preset          | UI (PresetSelector) | Scene                        | `RadiusPreset`           |
| `time:changed`         | User moves the time slider                      | UI (TimeSlider)   | Sky, Scene, Camera (if followSun) | `TimeSpec`            |
| `viewpoint:changed`    | User drags the scene or types FOV               | Camera            | UI (for compass overlay)       | `Viewpoint`              |
| `viewpoint:mode_changed` | User toggles orbit/walk mode (Phase 2+)        | UI (ModeToggle)   | Camera                         | `{mode: 'orbit' \| 'walk'}` |
| `walker:moved`         | Walker position changed (Phase 2+, throttled to 4 Hz to avoid event spam) | Camera | UI (walk-distance readout) | `{anchor: {x, z}, distanceFromOriginM: number}` |
| `sun:updated`          | After SunCalculator runs (every frame in followSun mode, or on time change) | Sky | UI (compass overlay)         | `SunPosition`            |
| `scene:loading`        | A rebuild starts                                | Scene             | UI (progress bar)              | `{phase: string}`        |
| `scene:progress`       | A rebuild advances                              | Scene             | UI (progress bar)              | `{progress: 0..1}`       |
| `scene:ready`          | A rebuild completes                             | Scene             | UI                             | `null`                   |
| `scene:error`          | A rebuild fails                                 | Scene             | UI (error display)             | `{message: string}`      |
| `export:start`         | User clicks export                              | UI                | Export                         | `ExportSpec`             |
| `export:progress`      | Tiled export advances                           | Export            | UI (progress bar)              | `{tile, total}`          |
| `export:complete`      | Export finished                                 | Export            | UI                             | `{filename, sizeBytes}`  |
| `export:error`         | Export failed                                   | Export            | UI                             | `{message: string}`      |
| `weather:fetched`      | Open-Meteo warm fetch resolved successfully (V2 Step 5) | Scene     | UI (WeatherPanel placeholder refresh) | `null`             |
| `weatherOverride:changed` | User typed/cleared a weather override input  | UI (WeatherPanel) | (informational; bindings composition reads state directly at trigger time) | `null` |
| `terrainOption:changed`   | User committed a terrain slider (V2 Step 5c) | UI (TerrainPanel) | Scene (rebuild)                                                             | `null` |

### Naming convention

- `noun:verb` past tense for state changes (`location:changed`, `time:changed`).
- `noun:verb` present tense for transient events (`scene:loading`, `export:progress`).
- Errors always have a string `message` field.
- Payloads are always objects, never bare values, even if there's only one field. This keeps the API extensible.

---

## Module-to-module direct calls

In addition to events, modules may call each other's public APIs directly when an immediate return value is needed. These are listed in [ROLES.md](./ROLES.md) under each role's "Public API." Summary of the full call graph:

```
SceneManager
  ├─→ Renderer.render(scene, camera)
  ├─→ TerrainBuilder.build(location, radius)         [Promise<Group>]
  ├─→ OSMFeatureBuilder.build(location, lodConfig)   [Promise<Group>]
  ├─→ SkySystem.update(timestamp, location)
  ├─→ CameraController.update()
  └─→ CameraController.placeAt(location, eyeHeight)

OSMFeatureBuilder
  └─→ HeightSampler.getHeightAt(lat, lon)            [for placing buildings on ground]

CameraController
  ├─→ HeightSampler.getHeightAt(lat, lon)            [for "stand on the ground"]
  └─→ SunCalculator.getSunPosition(t, lat, lon)      [for "follow sun"]

ScenicDefault
  ├─→ HeightSampler.getHeightAt(lat, lon)            [to find interesting silhouettes]
  └─→ SunCalculator.getSunPosition(t, lat, lon)

ExportPipeline
  ├─→ Renderer (mutate size, render, restore)
  └─→ CameraController.getCamera()                   [to read aspect ratio]

TerrainBuilder, OSMFetcher
  └─→ Cache.get/set, Geocoder, TileMath              [data layer]

UI components
  └─→ Geocoder.search()
  └─→ state.get/set/on/off
```

---

## Configuration constants (`src/config.js`)

Centralised constants. Modules import from here rather than hardcoding values.

```js
export const PRESETS = { /* RadiusPreset definitions, see table above */ };
export const DEFAULT_PRESET = 'suburban';

export const EYE_HEIGHT_M = 1.7;
export const DEFAULT_FOV_DEG = 60;
export const DEFAULT_TILT_DEG = -5;

// Phase 2: walking mode
export const WALK_SPEED_MS = 1.4;            // m/s, normal walking pace
export const JOG_SPEED_MS = 4.0;             // m/s, with Shift held
export const ACCELERATION_MS2 = 8.0;         // ramp velocity smoothly to target
export const WALK_Y_SMOOTHING_MS = 200;      // smooth Y over this duration on cliffs
export const WALK_HARD_BOUND_MARGIN_M = 100; // stop walker this far from terrain edge

export const DEM_TILE_ZOOM = 12;          // Slippy zoom level for DEM fetches
export const OSM_TILE_SIZE_M = 1000;      // Overpass query tile size in metres

export const SKY = {
  turbidity: 6,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
};

// Phase 1.5: ground cover colours by OSM tag.
// Single source of truth — never hardcode in builders. Tune by editing here.
// All values tuned to look right under sunset directional light.
export const GROUND_COVER_COLOURS = {
  'natural=water':        0x3b6ea5,
  'waterway=riverbank':   0x3b6ea5,
  'natural=beach':        0xe8d8a8,
  'natural=sand':         0xe8d8a8,
  'natural=bare_rock':    0x9a8b7a,
  'natural=scree':        0xa89a88,
  'natural=glacier':      0xe8eef2,
  'natural=wood':         0x3a5538,
  'landuse=forest':       0x3a5538,
  'natural=grassland':    0x7a9050,
  'natural=heath':        0x8a7a5a,
  'natural=wetland':      0x5a7868,
  'landuse=grass':        0x8aa55a,
  'landuse=meadow':       0x9ab050,
  'landuse=farmland':     0xc5b078,
  'landuse=orchard':      0x7a8a48,
  'landuse=vineyard':     0x8a6850,
  'landuse=residential':  0xb0a89a,
  'landuse=commercial':   0xa8a098,
  'landuse=industrial':   0x909088,
  'landuse=cemetery':     0x6a7050,
  'landuse=brownfield':   0x7a6a55,
  'leisure=park':         0x8aa55a,
  'leisure=garden':       0x8aa55a,
  'leisure=pitch':        0x7aa550,
  'leisure=golf_course':  0x7aa550,
};

// Tag priority — lower number = higher priority. Used when a polygon has
// multiple matching tags or when polygons overlap.
export const GROUND_COVER_PRIORITY = {
  'natural':  1,    // physical reality wins
  'waterway': 1,    // water is water
  'leisure':  2,    // park inside residential land = park
  'landuse':  3,    // most general
};

export const GROUND_COVER_Z_OFFSET_M = 0.1;   // lift above terrain to prevent Z-fighting

export const EXPORT = {
  A3: { widthMm: 420, heightMm: 297 },
  A2: { widthMm: 594, heightMm: 420 },
  A1: { widthMm: 841, heightMm: 594 },
};
export const DEFAULT_EXPORT_DPI = 300;

export const APIS = {
  nominatim: 'https://nominatim.openstreetmap.org',
  // Overpass: the only browser-friendly public endpoint as of 2026 is overpass-api.de.
  // Historic mirrors (kumi.systems, private.coffee) suffer CORS issues or intermittent
  // outages and produce ERR_CONNECTION_REFUSED in browsers regardless of whether the
  // server is actually up. For development with frequent reloads, run a local Overpass
  // instance via Docker — see docs/modules/data-layer.md "Local Overpass via Docker".
  // For production deployments with traffic, self-hosting is mandatory; the public
  // endpoint will not tolerate a busy app proxying requests for many users.
  overpass: [
    'https://overpass-api.de/api/interpreter',
    // Add localhost endpoint here when running Docker Overpass:
    // 'http://localhost:12345/api/interpreter',
  ],
  awsTerrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
  userAgent: 'Panorama/1.0 (https://github.com/yourname/panorama)',
};

// Phase 2 fix: Overpass etiquette (see docs/modules/data-layer.md)
export const OVERPASS_MAX_CONCURRENT = 1;          // serial only — never increase
export const OVERPASS_QUERY_TIMEOUT_S = 60;        // sent inside Overpass QL [timeout:N]
export const OVERPASS_BACKOFF_429_MS = [10000, 30000, 90000];  // wait before each retry — generous to avoid IP bans
export const OVERPASS_MAX_429_RETRIES = 3;         // give up after this many
export const OVERPASS_TILE_SIZE_M = 1000;          // 1km × 1km bounding boxes
export const OVERPASS_SPLIT_ON_504 = true;         // split tile into 4 sub-tiles on 504
```

---

## Data → Style binding (Phase 2.5)

Painterly stylization is the project's signature feature. The painterly look is *driven by real-world data* — wind direction shapes brushstroke angle, light intensity shapes density, cloud cover shapes saturation, etc. This section is the contract that turns "data-driven stylization" from a slogan into named inputs that two different developers can wire on two different days.

The Style module receives a single `StyleBindings` snapshot at trigger time. The snapshot is **frozen** — taken once when the user clicks "Transform → Pointillism" — so the resulting painting is deterministic regardless of state changes during the transform.

### `StyleBindings`

```js
/**
 * @typedef {Object} StyleBindings
 * @property {SunPosition} sun           Frozen at trigger; sun.altitude drives palette warmth
 * @property {WeatherSnapshot} [weather] Frozen at trigger; optional until Weather module ships
 * @property {CelestialSnapshot} [celestial] Frozen at trigger; optional until Astronomy module ships
 * @property {ViewpointSnapshot} viewpoint  Frozen at trigger; drives painter-side projection (Step 4+)
 * @property {GroundSnapshot} [ground]   Frozen at trigger; OSM polygons projected into underpainting (Step 4+)
 * @property {Date} timestamp            The exact moment being painted (also frozen)
 * @property {Location} location         Where we are
 */
```

### `ViewpointSnapshot` (v3.5+)

The viewpoint values needed by painter-side projection. A subset of the live
`Viewpoint` type, augmented with the camera world-Y at trigger time so the
projection is reproducible without the painter calling back into HeightSampler.

```js
/**
 * @typedef {Object} ViewpointSnapshot
 * @property {Location} location       lat/lon of the observer
 * @property {number} azimuthDeg       Compass bearing (0=N, 90=E, ...)
 * @property {number} elevationDeg     Pitch (-90=down, 0=horizontal, 90=up)
 * @property {number} fovDeg           Horizontal FOV
 * @property {number} eyeHeightM       Above local ground
 * @property {number} cameraWorldY     groundY + eyeHeightM, snapshot-frozen
 * @property {number} groundY          Sampled terrain elevation under observer
 * @property {{width:number, height:number}} canvas  Painter canvas dimensions
 */
```

### `GroundSnapshot` (v3.5+, landmarks added v3.10)

OSM ground polygons projected by the painter into the underpainting. The shape
captured here is the *post-adapter* shape produced at the snapshot-assembly
site — it is **not** the raw `OSMFetcher.elementsToPolygons` shape, but it
preserves enough of it (multi-tag tags, outer + inner rings) that the painter
can render holes correctly.

```js
/**
 * @typedef {Object} GroundSnapshot
 * @property {GroundFeature[]} osmFeatures
 * @property {Landmark[]}     [landmarks]   v3.10+: tower / church / monument /
 *                                          castle / named-attraction points,
 *                                          consumed by `landmarkPainter`.
 *                                          Optional — older snapshots without
 *                                          this field are rendered without
 *                                          silhouettes (graceful degrade).
 */

/**
 * @typedef {Object} GroundFeature
 * @property {Object<string,string>} tags   All OSM tags on the polygon — needed because
 *                                          tag → colour resolution uses GROUND_COVER_PRIORITY
 *                                          and a single "winner" tag would lose information.
 * @property {'water'|'forest'|'urban'|'farmland'|'beach'} category
 *                                          Computed at adapter time from `tags` against the
 *                                          5-category mapping (see "Ground category mapping").
 * @property {{lat:number, lon:number}[]} outer   Outer ring vertices.
 * @property {{lat:number, lon:number}[][]} inners  Inner rings (holes), zero or more.
 */

/**
 * @typedef {Object} Landmark
 * @property {'tower'|'church'|'monument'|'castle'|'attraction'} category
 *                                  Painterly archetype, derived from OSM tags by
 *                                  `OSMFetcher.classifyLandmark` — see "Landmark
 *                                  category mapping" below.
 * @property {string|null} name     OSM `name` tag if present. `tourism=attraction`
 *                                  drops anonymous entries upstream; `name` may be
 *                                  null for the other categories.
 * @property {number} lat           Centroid latitude (way landmarks) or coordinate
 *                                  (node landmarks).
 * @property {number} lon           Same, longitude.
 * @property {number|null} heightM  Parsed from OSM `height` or `building:height`
 *                                  if metric; null otherwise. Painter uses a
 *                                  category-default when null.
 */
```

### Ground category mapping (v3.5+)

Each OSM tag in `GROUND_COVER_COLOURS` maps to exactly one of the five painter
categories. The mapping lives in `src/style/categories.js` so the painter and
the adapter share one source of truth. Polygons whose tags don't resolve to a
category are dropped at the adapter — they don't appear in `osmFeatures`.

| Category   | Member tags                                                                          |
| ---------- | ------------------------------------------------------------------------------------ |
| `water`    | `natural=water`, `natural=wetland`, `natural=glacier`, `waterway=riverbank`          |
| `beach`    | `natural=beach`, `natural=sand`                                                      |
| `forest`   | `natural=wood`, `landuse=forest`                                                     |
| `urban`    | `landuse=residential`, `landuse=commercial`, `landuse=industrial`, `landuse=cemetery`, `landuse=brownfield` |
| `farmland` | `landuse=farmland`, `landuse=orchard`, `landuse=vineyard`, `landuse=meadow`, `landuse=grass`, `natural=grassland`, `natural=heath`, `leisure=park`, `leisure=garden`, `leisure=pitch`, `leisure=golf_course` |

`natural=bare_rock` and `natural=scree` are not in the five-category set; they
keep their 3D rendering but don't appear in the painter underpainting at v0.

### Landmark category mapping (v3.10+)

`OSMFetcher.classifyLandmark` resolves a tags object to one of the five
painter landmark archetypes (or null if no tag matches). The mapping lives
inside `OSMFetcher.js` so the painter consumes a fully-classified shape;
`landmarkPainter.ARCHETYPE` keeps a sibling `KNOWN_CATEGORIES` set as a
hardening guard against future tag drift.

| Category     | Member tags                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `tower`      | `man_made=tower`                                                                                  |
| `castle`     | `historic=castle`                                                                                 |
| `monument`   | `historic=monument`, `historic=memorial`                                                          |
| `church`     | `amenity=place_of_worship`, `building=church`, `building=cathedral`, `building=chapel`, `building=mosque`, `building=temple` |
| `attraction` | `tourism=attraction` AND has a `name` tag                                                         |

Order is significant: an element tagged both `man_made=tower` AND
`tourism=attraction` resolves to `tower` (more specific archetype wins).
Anonymous `tourism=attraction` entries are dropped upstream — most are
information boards, viewpoints, and rest stops that don't paint as a
recognisable mark.

`historic=tower` is deliberately excluded: per taginfo (verified 2026-05-01)
it doesn't appear in the top 30 historic values, and historic towers in
practice are tagged `man_made=tower` with `historic=yes`. Future PRs can
revisit if curation surfaces a counterexample.

### v0 bindings (pointillism)

These bindings ship with the v0 pointillism prototype. They are deliberately minimal — solid bindings beat guesses. The list grows from observed prototype behaviour, not from theory. All derivations live at the `applyPointillism` call site in `ControlsPanel.js`; the engine itself is unchanged from v3.5.

| Visual parameter            | Source signal                              | Mapping                                                                 |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Brushstroke angle           | `weather.wind.directionDeg` (Open-Meteo)   | `windDirectionDeg = directionDeg + 90` (strokes run *along* the wind)   |
| Brushstroke length          | `weather.wind.speedMs`                     | `brushStrokeFactor = 1 + speedMs/10`; `windInfluence = speedMs > 1.5 ? 0.4 : 0` |
| Brushstroke opacity         | `weather.precipitation_mmh`                | `brushOpacity = clamp(0.85 - precip/40, 0.55, 0.85)` — heavy rain softens strokes |

### Stroke-width as physical measurement (v1.1+)

Stroke width is specified as a **physical measurement in millimetres**, not a pixel count, so that paintings rendered at any export DPI come out with consistent visual texture. The pixel value is derived at trigger time from the export DPI:

```
brushThicknessPx = round(brushWidthMm × dpi / 25.4)
```

| Field           | Default | Bounds       | Notes                                                           |
| --------------- | ------- | ------------ | --------------------------------------------------------------- |
| `brushWidthMm`  | `0.7`   | `0.3` – `3.0` | Physical stroke width in mm. 0.7 mm at 300 DPI ≈ 8.27 px (matches the to-pointillism reference's empirical computeBrushThickness for A3). Lower values = pointillism / Seurat character; higher values = impasto / Soutine character. |
| `dpi`           | `300`   | export-derived | The DPI at which the painting will be rasterised. Default 300 matches the canonical A3 print target. |

Length still varies per stroke as `brushThicknessPx + brushThicknessPx × brushStrokeFactor × √magnitude` — only the width is fixed by physical measurement. Wind-bound stroke direction (when `windDirectionDeg` is set) is unaffected.

### Palette: extracted from source (v1.1+)

The painter extracts the palette from the rendered scene via median-cut (a ColorThief-equivalent), then extends it via saturation-boost and 2× hue-rotation copies — matching `guillaume-gomez/to-pointillism`'s palette pipeline. (Curated painter palettes were an earlier opt-in override; that path was retired when the curation feature shipped.)

| Field                | Default  | Notes                                                           |
| -------------------- | -------- | --------------------------------------------------------------- |
| `paletteSize`        | `20`     | k-value for the median-cut extraction                           |
| `extendPalette`      | `true`   | Apply saturation-boost + 2× hue-rotation extension (4× size)   |
| `paletteSatBoost`    | `20`     | Saturation increase (HSL %) for the boosted copy               |
| `paletteHueJitter`   | `20`     | Hue rotation range (deg) for the two random-hue copies         |
| `paletteTemperature` | `28`     | Softmax temperature for weighted-random sampling per stroke    |

### Underpainting and gradient smoothing (v1.1+)

| Field                    | Default  | Notes                                                       |
| ------------------------ | -------- | ----------------------------------------------------------- |
| `applyMedianUnderpaint`  | `true`   | Apply 11×11 RGB median blur on the source as the soft underpainting strokes paint over (matches the reference's `cv.medianBlur` step). Disable for cheaper but less-faithful runs. |
| `medianKernel`           | `11`     | Square kernel size; reference uses 11. Lower for speed at edge-preservation cost. |
| `smoothGradientField`    | `true`   | Apply Gaussian-equivalent smoothing (3-pass separable box blur) to the Scharr gradient field. Reference radius = `max(width, height) / 50`. |
| `gradientSmoothRadius`   | derived  | Override the default radius if needed.                      |

**Explicitly NOT v0 bindings**, despite intuition:

- Sun altitude → grid density (creative reviewer flagged: counterintuitive — Seurat used dense dots for *darks*, not lights)
- Cloud cover → opacity (creative reviewer flagged: low opacity reads as "unfinished," not "overcast"). When cloud cover is wired in v1, it should drive *desaturation* + *stroke softness* instead.

### Future bindings (post-v0, pluggable)

These are reserved fields in `StyleBindings` that future style implementations may consume. Adding a new binding is a `DATA-CONTRACTS.md` change (architect sign-off); the Style engineer alone can't introduce one.

| Visual parameter         | Source signal                          | Notes                                                  |
| ------------------------ | -------------------------------------- | ------------------------------------------------------ |
| Stroke thickness         | `weather.pressure_hPa`                 | low pressure = heavier, more anxious strokes           |
| Edge bleed / wet-on-wet  | `weather.humidity_pct`                 | humid days = softer edges                              |
| Sky-band stroke clusters | `wildlife.birdActivityIndex`           | bird density gestural marks in sky region              |
| Night palette bias       | `celestial.moon.illumination`          | full moon = cool blue bias, new moon = warm/dim        |
| Stroke softness          | `weather.cloudCover_pct`               | overcast = softer strokes (NOT lower opacity)          |
| Palette desaturation     | `weather.cloudCover_pct`               | overcast = lower saturation                            |

### `WeatherSnapshot` (live as of v3.7)

The Weather module ships in V2 Step 5. The cached snapshot is the *mapped*
shape below — never the raw Open-Meteo response — so `peekWeather` and
`fetchWeather` return the same object shape and the painter never re-parses
hourly arrays.

```js
/**
 * @typedef {Object} WeatherSnapshot
 * @property {{ directionDeg: number, speedMs: number, gustMs: number }} wind
 * @property {number} cloudCover_pct       0–100
 * @property {number} humidity_pct         0–100
 * @property {number} pressure_hPa         millibars
 * @property {number} temperature_C
 * @property {number} precipitation_mmh    mm/hour
 * @property {number} weatherCode          Raw Open-Meteo WMO weather code (integer).
 *                                         The "mapped enum" originally drafted in v3.4
 *                                         is deferred until a binding actually consumes
 *                                         this field; for now we cache the integer.
 * @property {Date} timestamp              UTC hour-bucket the snapshot is valid for
 *                                         (the requested timestamp floored to the hour)
 */
```

As of v3.7, `wind.directionDeg`, `wind.speedMs`, `cloudCover_pct`, and
`precipitation_mmh` are consumed by v0 bindings (see the table above).
`humidity_pct`, `pressure_hPa`, `temperature_C`, and `weatherCode` flow
through the snapshot and the WeatherPanel override path but are not yet
read by any binding — they land as targeted PRs during curation when a
specific painting demands them.

The user can override any of `wind.directionDeg`, `wind.speedMs`,
`cloudCover_pct`, `humidity_pct`, `precipitation_mmh`, `temperature_C` via
the WeatherPanel; `mergeWeather` in `ControlsPanel.buildBindings` composes
the effective snapshot per field (override wins if finite, else fetched).
This makes the offline-curation path real: with a cold cache, a fully
overridden snapshot still drives a weather-aware painting.

### `CelestialSnapshot` (forward declaration)

```js
/**
 * @typedef {Object} CelestialSnapshot
 * @property {{ azimuth: number, altitude: number, phase: number, illumination: number }} moon
 * @property {number} kpIndex              Geomagnetic activity (NOAA SWPC) — drives aurora
 * @property {number} bortleClass          1–9, light pollution at this location
 */
```

### Determinism contract

The Style module receives a frozen `StyleBindings`. It MUST produce the same output canvas given the same inputs. This means:

- No `Math.random()` keyed only on time (use a deterministic PRNG seeded by `timestamp.getTime() ^ location.lat * 1e6`)
- No reads of live state during the transform
- No async fetches inside the transform — bindings must be pre-fetched and frozen by the caller

Determinism makes "this day in history" replay possible: same location + timestamp = same painting, every time.

### Trigger flow

```
1. User commits scene composition (location, time, viewpoint).
2. User clicks "Transform → Pointillism" in ControlsPanel.
3. ControlsPanel asks Scene Orchestrator to:
     a. pin renderer.toneMappingExposure (avoid mid-transform drift)
     b. render one frame to an offscreen canvas at export resolution
     c. assemble StyleBindings snapshot from current state.weather, state.celestial, etc.
4. Scene Orchestrator calls applyStyle('pointillism', canvas, bindings).
5. Style returns a stylized canvas.
6. ControlsPanel hands the stylized canvas to ExportPipeline for download.
7. Renderer.toneMappingExposure restored.
```

This trigger flow is the only currently-defined path through Style. The architecture deliberately does NOT support a real-time painterly preview mode — that decision is documented in the user's memory and informs the entire module design.

Paint-time weather access is cache-only via `WeatherFetcher.peekWeather` — identical discipline to the OSM `peekGroundCover`. Cold cache returns `null`, the bindings carry `weather: undefined`, and the painter falls back to gradient-only stroke direction.

---

## Versioning the contracts

This file is treated as an API. If a field is added or its meaning changes, bump a version comment at the top of `state.js`:

```js
// State schema version: 5
// See docs/DATA-CONTRACTS.md
```

The state-schema version is independent of the contract-doc version. Version 3
of the runtime state schema was stable from Phase 2 through V2 Step 4 — the
v3.1–v3.6 entries below all add or revise *shared types* (StyleBindings,
SnapshotShapes, etc.) without touching the live `state` object. Version 4
(V2 Step 5) added the `weatherOverrides` field. Version 5 (V2 Step 5c) added
the `painter` and `terrain` blocks. Version 6 (v3.11) adds the
`painter.water.*` block for painterly water reflections. Version 7 (v3.12)
adds the `painter.atmospherics.*` block for the haze + bloom + grain
post-passes. Bump the state comment only when a field is added/removed/renamed
in `src/state.js`.

When a future contributor sees their local checkout's state version doesn't match the doc, they know to read the changelog at the bottom of this file before debugging.

---

## Changelog

- **v3.12** — Atmospheric depth (Phase 5 polish item per ROADMAP.md —
  haze + bloom + grain/grading). Three painterly post-passes that share
  one architectural slot at the end of the underpainting and tune
  together: distance-based haze, sun bloom, ambient grain + global
  colour grading. New module file: `src/style/atmosphericPasses.js`
  exporting `applyHaze`, `applySunBloom`, `applyGrainAndGrade` and an
  `applyAtmospherics` orchestrator that runs them in order
  (haze → bloom → grain). Plug point: end of `renderUnderpainting`,
  after the median-blur softening — so the grain sits on top of the
  fully-composed underpainting and reads as physical paper texture
  rather than blurred noise.
  **Haze depth proxy:** vertical-screen-position relative to the
  projected horizon line (computed by `projection.js` `horizonY()`).
  Pixels above the horizon get zero haze; pixels just below get the
  strongest desaturation toward a sky-tinted colour, tapering to near-
  zero at the canvas bottom along a cosine curve. A real per-pixel
  depth buffer would require touching the terrain step, which the
  brief explicitly forbade — surfaced as a Decision Log entry. The
  screen-Y proxy naturally satisfies "haze obeys scene scale" because
  vista scenes (alpine, coastal) project a wide far-band while close
  scenes (urban courtyard) fill the canvas with foreground polygons;
  Probe 1 verifies this empirically (alpine vs courtyard saturation
  differential = +0.45).
  **Bloom horizon gate:** fires only when sun.altitude > 0 AND the
  sun's projected screen position falls within (or one bloom-radius
  outside) the canvas bounds. Probe 2 verifies four times of day with
  3-of-3 above-horizon firing and 0-of-1 below-horizon firing.
  **Grain:** Mulberry32-seeded noise at one cell per ~2.1 px (cell size
  derived from `GRAIN_CELL_MM = 0.18 mm` × effectiveDpi), uniform
  amplitude. Per-cell noise stored in an `Int8Array` and applied via
  `getImageData` + per-pixel walk + `putImageData`. Determinism: same
  master seed → same noise pattern; the master seed is forked from
  `opts.seed ^ 0x4D_4D_4D_4D` (4D for "depth"), matching the
  canopy/landmark/water XOR-salt convention.
  **State schema bumped to v7** with the new `painter.atmospherics`
  block: `{ enabled: true, hazeStrength: 0.5, bloomStrength: 0.4,
  grainAmount: 0.15 }`. Defaults reproduce the engine baseline on
  scenes where the post-passes don't fire (no projection context, no
  sun above horizon → bloom no-ops; foreground-dominated scenes →
  haze barely registers); regression-guard path
  `atmosphericsEnabled: false` is byte-identical to pre-PR (hash
  unchanged at `cf15cf7b…80b39f`, same as v3.11).
  **PainterParamsPanel** gains an "Atmosphere" subgroup with one
  toggle ("Atmospherics enabled") + three sliders (Haze, Sun bloom,
  Grain). Writes to `state.painter.atmospherics.*` on `input`;
  UnderpaintingPreviewPanel picks them up live like every other
  slider.
  **Sun-phase tint envelope:** all three passes consume `sun.phase`
  and apply phase-keyed tints (haze cool at noon / warm at sunset;
  bloom warm-white at noon / deep orange at sunset; grading slight
  warm push at golden hour / sunset, slight cool push at twilight /
  night). Tints are local to the pass (not shared via a single
  source-of-truth constant) because each pass uses a different shape
  of tint envelope — surface-level duplication is cheaper than
  cross-module coupling.
  **mm-not-px discipline:** bloom radius (18 mm at full strength) and
  grain cell size (0.18 mm) are sized in physical mm via
  `effectiveDpi`, so an A3 print and an 800-px preview look
  proportionally identical.
  **Three probes pass** (`scripts/atmospheric-perf-probe.js`):
  Probe 1 (haze depth scene-scale awareness): alpine differential
  +0.099 vs courtyard −0.352, differential +0.45 → PASS.
  Probe 2 (bloom horizon gate): 4/4 fired-vs-expected matches → PASS.
  Probe 3 (perf at A3): total 24.3 s under 28 s bar → PASS;
  per-pass 80 ms target met by bloom (~2 ms) but exceeded by haze
  (~85–150 ms) and grain (~620 ms) — surfaced per the brief's
  escalation path. The 80 ms bar is fundamentally tight for any
  per-pixel JS pass on a 17.4 MP canvas (a getImageData +
  putImageData round-trip alone is ~70 ms before any work). Total
  render cost of atmospherics is ~720 ms (3 % of the 24.3 s end-to-
  end). Grain already uses the brief-recommended cell-based downsampling;
  faster grain would require WebGL, which is a meaningful
  architectural shift — out of scope here.
  **Determinism preserved:** same Snapshot in → byte-identical output
  across two paints, verified by `scripts/atmospheric-perf-probe.js perf`
  (SHA-256 `83f5b555…ef238d1e` identical across two runs).
  **No new dependencies.**
  **Verified against code on 2026-05-01:** `src/style/atmosphericPasses.js`
  (new), `src/style/underpainting.js` (atmospherics plug-in slot +
  hoisted projectionCtx + new opts pass-through + timing fields),
  `src/style/Pointillism.js` (atmospherics opts pass-through + timing
  fields), `src/state.js` (v7 schema, `painter.atmospherics` block,
  comment bumped), `src/ui/PainterParamsPanel.js` (Atmosphere subgroup,
  three sliders + one toggle, refactored makeBoolRow helper),
  `src/ui/UnderpaintingPreviewPanel.js` (atmospherics opts wired
  through), `src/ui/ControlsPanel.js` (atmospherics opts in
  painterParams), `scripts/parity-probe.js` (added
  `atmosphericsEnabled: false` to keep hash baseline meaningful) all
  match this entry; `npm run build` clean (71 modules); parity-probe
  hash unchanged (`cf15cf7b…80b39f`); new
  `scripts/atmospheric-perf-probe.js` ships alongside the painter.
- **v3.11** — Painterly water reflections (Phase 5 polish item per
  ROADMAP.md). New module file: `src/style/waterPainter.js`. Owns
  `natural=water` polygons end-to-end via four layered passes per polygon:
  (1) deep-water base fill (the polygon's tag colour darkened 35 %), (2)
  sky-sampling band along the polygon's far edge with cosine falloff
  governed by `painter.water.reflectionStrength`, (3) sun-glitter streak
  when the sun's projection falls above the far edge AND the sun is in
  front of the camera (back-lit) AND above the horizon — front-lit water
  shows no glitter (design constraint), (4) horizontal ripple dabs along
  the water's surface direction, density governed by
  `painter.water.rippleDensity`. (5) Sun-phase tint envelope reused from
  groundPainter so water shifts warm at golden hour / sunset and cool /
  desaturated at twilight / night. Plug point: between `paintGround` and
  `paintCanopy` in `src/style/underpainting.js` — water before forest
  because a forest can't grow on a lake; water before landmarks because
  a tower on a lake reflects into the water in a hypothetical v2.
  **`groundPainter` updated** to skip `category==='water'` polygons
  entirely; waterPainter owns them, no double-paint. **State schema
  bumped to v6** with the new `painter.water` block:
  `{ reflectionStrength: 0.6, sunGlitterEnabled: true, rippleDensity: 0.4 }`.
  Defaults match the engine baseline so an untouched panel reproduces
  the pre-PR painting on water-free scenes (verified: parity-probe SHA-256
  hash unchanged at `cf15cf7b…80b39f`). **PainterParamsPanel** gains a
  "Water" subgroup with two sliders (Reflection, Ripple density) and one
  toggle (Sun glitter); writes to `state.painter.water.*` on `input`.
  **UnderpaintingPreviewPanel** picks up the new sliders live — water
  reflections re-render on `painter:changed` like every other slider.
  **ControlsPanel** plumbs the three water knobs through to
  `applyPointillism` opts. **Determinism preserved:** waterPainter forks
  its own Mulberry32 from `opts.seed ^ 0x77_77_77_77` (seven for "wet"),
  matching the canopy/landmark XOR-salt convention; same Snapshot in →
  byte-identical water region out (verified by
  `scripts/water-determinism-probe.js`, identical SHA-256 across two
  paints). **Sky-band tint**: localised per-polygon
  `ctx.getImageData(stripX, stripY, stripW, stripH)` reads (sampleH ≤ 40 px
  × bbox-width strip) — full-canvas getImageData on A3 is ~30 ms; the
  strip read is ~1 ms. Falls back to per-phase `SKY_BAND_FALLBACK` when
  sampling fails. **Glitter geometry**: the sun is treated as a point at
  infinity; its screen position is computed from
  `(sin(az)cos(alt), sin(alt), -cos(az)cos(alt))` projected through the
  same camera basis `projection.js` uses. Glitter fires only when the
  resulting `viewDot > 0` (sun in front of camera = back-lit water),
  the sun's altitude > -2° (above horizon-band cutoff), and the sun's
  screen-x is within `GLITTER_AZIMUTH_TOLERANCE` polygon-widths of the
  polygon's centre. Per-dab intensity scales with sun altitude (golden
  hour / sunset = 1.0×, soft afternoon = 0.7×, high noon = 0.5×, below
  horizon = 0×) so the brief's "back-lit, near horizon, strongest"
  rule holds. **Three probes pass** (`scripts/water-perf-probe.js`):
  perf at coastal-extent A3 (water painter 62 ms < 100 ms ceiling, total
  27.4 s < 28 s budget); sun-direction matrix (4 azimuths × 3 elevations,
  glitter present only when geometry says it should be); tint
  correctness (noon band warmth -58, sunset band warmth +50, delta +108
  → SUN_PHASE_TINT envelope reaches waterPainter, source-canvas
  sampling reflects sky gradient changes). Three risk-first ripple-dab
  density tunings (0.45 → 0.30 → 0.20 → 0.10) walked the constant down
  until the indirect cost on the gradient + strokes pass landed
  comfortably under the 28 s bar; curators wanting more visible ripples
  can push the slider above 0.4 (it goes to 1.0). **No new dependencies.**
  **Verified against code on 2026-05-01:** `src/style/waterPainter.js`
  (new), `src/style/groundPainter.js` (`category==='water'` skip),
  `src/style/underpainting.js` (water plug-in slot + opts pass-through +
  timing fields), `src/style/Pointillism.js` (water opts pass-through +
  timing fields), `src/state.js` (v6 schema, `painter.water` block,
  comment bumped), `src/ui/PainterParamsPanel.js` (Water subgroup,
  reflectionStrength + rippleDensity sliders, sunGlitterEnabled toggle),
  `src/ui/UnderpaintingPreviewPanel.js` (water opts wired through), and
  `src/ui/ControlsPanel.js` (water opts in painterParams) all match this
  entry; `npm run build` clean (70 modules, 2.77 s);
  `scripts/parity-probe.js` SHA-256 hash unchanged; new
  `scripts/water-perf-probe.js` and `scripts/water-determinism-probe.js`
  ship alongside the painter.
- **v3.10** — Painterly vegetation + landmarks. Reincarnates the artistic
  intent of the original ROADMAP Phase 3 (forests should read as forests,
  landmarks visible) inside the painter pipeline; no 3D geometry restored.
  `GroundSnapshot` gains an optional `landmarks: Landmark[]` field. New
  shared type: `Landmark` (`{category, name, lat, lon, heightM}`). New
  section: "Landmark category mapping" — five archetypes (tower, church,
  monument, castle, attraction) each with their explicit OSM-tag members;
  `historic=tower` deliberately excluded after taginfo verification (sparse,
  in practice tagged `man_made=tower + historic=yes`). New module files:
  `src/style/canopyPainter.js` (stippled forest dabs over forest / wood
  polygons) and `src/style/landmarkPainter.js` (archetypal silhouette marks
  per category, mm-physical sizing via the same focal-length math the
  pinhole projector uses). Plug points: canopy and landmarks both run on
  the working canvas between `paintGround` and the median-blur underpainting
  step, so the median softens dab + silhouette edges into the rest of the
  painting. Each painter forks its own Mulberry32 from the master seed
  (`seed ^ 0xC4_C4_C4_C4` for canopy, `seed ^ 0x14_14_14_14` for landmarks)
  so canopy / landmark consumption doesn't shift the stroke-pass `rand`.
  **Determinism contract preserved:** verified by re-rendering the same
  source + bindings + seed twice and comparing PNG buffers byte-for-byte
  (5,992,593 bytes, equal). **OSMFetcher extensions:** combined Overpass
  query gains node coverage for `man_made=tower`, `historic=castle|monument|memorial`,
  `amenity=place_of_worship`, and `tourism=attraction` (plus the way variant
  for tourism). Per taginfo (verified 2026-05-01), 77 % of `man_made=tower`
  and 68 % of `tourism=attraction` are nodes; the way-only query before this
  bump missed three quarters of the landmark candidates. Cache key is
  bbox-based so existing cached tiles silently miss the new categories
  until their 7-day TTL expires; new locations get the full set immediately.
  New methods: `OSMFetcher.fetchLandmarks(location, preset)` and
  `OSMFetcher.peekLandmarks(location, preset)` — same fetch/peek split as
  `fetchGroundCover` / `peekGroundCover`, sharing the combined-query cache
  so calling both for the same `(location, preset)` pair issues no extra
  Overpass round-trips. New helpers: `classifyLandmark`, `parseHeightM`,
  `ringCentroid`, `elementsToLandmarks` (way → centroid, node → coordinates,
  relation → first outer member's centroid). **Snapshot assembly site:**
  `ControlsPanel.buildBindings` peeks landmarks alongside ground-cover at
  paint time (cache-only, never blocks on Overpass); cold cache → empty
  list → painter no-ops the landmark pass; subsequent paints after the
  scene rebuild's warm lands pick up the landmarks automatically. **Pure
  refactor:** `groundPainter.js` swapped from `Path2D` to
  `ctx.beginPath` + `moveTo` / `lineTo`. node-canvas (used by the headless
  test scripts) doesn't expose `Path2D` as a global; this also unblocks
  node-side test coverage of the polygon underpainting path that had been
  latent. Same visual output. **No state schema change** — landmarks ride
  the same fetch-on-location-change path that ground-cover already uses,
  so no new top-level `state.*` field. **Performance:** A3 landscape @ 300
  DPI v1.4 expressionist preset. Painter timings (probe at
  `scripts/canopy-landmark-perf-probe.js`): canopy 0.1–9 ms, landmarks
  0.4–5 ms, three synthetic scenes (forest / city / combo). Total render
  22–26 s in steady-state — same as RELEASE-NOTES baseline before this PR;
  painters add < 15 ms. **Verified against code on 2026-05-01:**
  `src/style/canopyPainter.js`, `src/style/landmarkPainter.js`,
  `src/style/groundPainter.js` (Path2D-free), `src/style/Pointillism.js`
  (canopy + landmark plug points + new timing fields),
  `src/osm/OSMFetcher.js` (combined query node coverage, fetch/peekLandmarks,
  classifyLandmark, parseHeightM, elementsToLandmarks),
  `src/ui/ControlsPanel.js` (peekLandmarks + landmark count in result panel),
  `scripts/canopy-landmark-perf-probe.js` (new) all match this entry;
  `npm run build` clean (66 modules, 2.08 s).
- **v1** (initial) — first version.
- **v2** — Added Phase 1.5 (Ground Cover). New constants: `GROUND_COVER_COLOURS`, `GROUND_COVER_PRIORITY`, `GROUND_COVER_Z_OFFSET_M`. New OSM sub-group: `groundCover` (added to the OSMFeatureBuilder return group). No state schema changes.
- **v3** — Phase 2 additions. `Viewpoint` type gains `mode` and `anchor` fields. State schema's `viewpoint` gains the same fields. New constants: `WALK_SPEED_MS`, `JOG_SPEED_MS`, `ACCELERATION_MS2`, `WALK_Y_SMOOTHING_MS`, `WALK_HARD_BOUND_MARGIN_M`. Two new events: `viewpoint:mode_changed`, `walker:moved`. CameraController public API gains `setMode`, `getMode`, `resetToOrigin`; the `update()` signature changes to take `deltaSeconds`.
- **v3.1** — Overpass etiquette hardening (response to rate-limit storm during Phase 2 testing). `APIS.overpass` is now an array of fallback endpoints. New constants: `OVERPASS_MAX_CONCURRENT` (must be 1), `OVERPASS_QUERY_TIMEOUT_S`, `OVERPASS_BACKOFF_429_MS`, `OVERPASS_MAX_429_RETRIES`, `OVERPASS_TILE_SIZE_M`, `OVERPASS_SPLIT_ON_504`. The four separate Overpass queries (ground cover, buildings, vegetation, landmarks) are now a single combined query per tile, filtered client-side. Full etiquette rules in `docs/modules/data-layer.md`.
- **v3.2** — Phase 2 follow-up. `TimeSpec` and state's `time` block gain `timezone` field (IANA tz string). TimeSlider now covers full 24 hours in location's local time, with sunrise/sunset markers. New allowed dependency: `tz-lookup` (npm, ~500 KB, client-side timezone-by-coordinates lookup, no API). New UI sub-component: `DebugOverlay` (toggle with `?` key) showing live diagnostic info. New cache keys: `osm:{z}/{x}/{y}` (replaces per-feature-type keys), `tz:{lat},{lon}`. Camera doc gains a "W keydown fires but camera doesn't move" sub-checklist (8 specific failure modes diagnosed during testing).
- **v3.3** — Mirror config correction (response to broken-mirror failures during Phase 2 testing). Removed `overpass.kumi.systems` and `overpass.private.coffee` from the default `APIS.overpass` array — they have CORS issues from browsers and produce `ERR_CONNECTION_REFUSED`. The default config now contains only `overpass-api.de`. Backoff schedule bumped from 5/15/45s to 10/30/90s to be gentler on the public endpoint. Added "Local Overpass via Docker" section to data-layer.md as the **recommended development path** — eliminates rate-limit issues entirely. Added "Buildings (or other features) don't appear" five-step diagnostic to osm-features.md. Added rule 9 to CLAUDE.md: web-search to verify external URLs before committing them. **Verified against code on 2026-04-29:** `src/config.js` matches this config (the v3.3 changelog had previously claimed a removal that wasn't actually in the code; that drift is now resolved).
- **v3.4** — Phase 2.5 Style module contract introduced. New `StyleBindings`, `WeatherSnapshot`, and `CelestialSnapshot` shared types defined as forward declarations (Weather and Astronomy modules don't exist yet but their consumed shape is fixed). New section: "Data → Style binding" specifying the v0 pointillism bindings (wind direction → stroke angle, wind speed → stroke length, palette by sun.phase) and reserved post-v0 bindings. New top-level modules: `src/style/`, `src/weather/`, `src/astronomy/`, `src/wildlife/` (all stubs). Determinism contract added: Style is a pure function from frozen inputs to canvas. Trigger flow documented. Module docs moved from project root to `docs/modules/`; ROLES.md path references updated to match. ARCHITECTURE.md table and file structure updated for the four new modules. Added: "Going forward, every changelog entry must include a 'Verified against code on YYYY-MM-DD' marker if it claims a code change — to prevent the doc-vs-reality drift that v3.3 had."
- **v3.6** — Chore: removed 3D OSM rendering (ground cover, buildings, vegetation, LOD manager). The painter has owned OSM polygons since v3.5/Step 4 via `OSMFetcher.peekGroundCover`; the in-scene 3D versions had become composition-distracting (offset textures, unwanted extrusions) and Path B had already declared the 3D scene composition scaffolding only. `OSMFeatureBuilder.build()` is now a cache-warming wrapper around `OSMFetcher.fetchGroundCover` and returns an empty `osmFeatures` Group; it stays in the rebuild flow so the painter's cache-only peek finds polygons after `scene:ready`. Painter consumption path unchanged. Files removed: `src/osm/GroundCoverBuilder.js`, `src/osm/BuildingsBuilder.js`, `src/osm/VegetationBuilder.js`, `src/osm/LODManager.js`. ARCHITECTURE.md and ROLES.md updated; `docs/modules/osm-features.md` is preserved as historical reference (still describes the deleted builders) and will be rewritten when the OSM role is next active. **Verified against code on 2026-05-01:** `src/osm/index.js` matches; no remaining imports of the deleted modules; `npm run build` clean.
- **v3.7** — V2 Step 5: Weather data live (Open-Meteo) **+ override panel + new v0 bindings**. State schema bumped to **v4** with the new `weatherOverrides` field (default-null shape: `{ wind:{directionDeg,speedMs}, cloudCover_pct, humidity_pct, precipitation_mmh, temperature_C }`). New module file: `src/weather/WeatherFetcher.js` — `fetchWeather` + `peekWeather`, mirroring `OSMFetcher`'s peek/fetch split. Cache key: `weather:{lat3},{lon3},{hourBucketISO}`; TTL 1 h; cached value is the *mapped* `WeatherSnapshot`, not the raw API response. `peekWeather` does **not** route through `Cache.dedupe` (paint-time stays cache-only); `fetchWeather` does, so concurrent warms in one bucket coalesce. New endpoint: `APIS.openMeteo` in `src/config.js`. Warm path: `SceneManager` fires `WeatherFetcher.fetchWeather` fire-and-forget on `location:changed` and on `time:changed`, gated by an hour-bucket key so slider scrubs no-op within a bucket; token-guarded against stale responses. Successful warm now emits a new `weather:fetched` event so `WeatherPanel` can refresh its placeholders. New UI sub-component: `src/ui/WeatherPanel.js` — six override inputs (wind direction °, wind speed m/s, cloud cover %, humidity %, precipitation mm/h, temperature °C) plus a "Reset overrides" button. Each input's placeholder text is the value most recently peeked from the cache for the current location/time (e.g., `auto · 12`); empty input → use fetched value, non-empty → override. `WeatherPanel` is mounted by `ControlsPanel` between `PalettePicker` and `PresetSelector`. New event: `weatherOverride:changed` (informational). New helper: `mergeWeather(fetched, overrides)` in `ControlsPanel` composes the effective snapshot per field (override wins if finite, else fetched, else null) and returns `undefined` when both are entirely null — that single path covers the offline-curation case (cold cache + manual overrides) without changing the StyleBindings shape under destructuring. **v0 bindings consumed at the `applyPointillism` call site:** wind direction → stroke angle (`windDirectionDeg = directionDeg + 90`), wind speed → stroke length (`brushStrokeFactor = 1 + speedMs/10`, `windInfluence = speedMs > 1.5 ? 0.4 : 0`), **precipitation → `brushOpacity = clamp(0.85 - precip/40, 0.55, 0.85)`** (new), **cloud cover → palette desaturation `factor = min(0.5, cloudCover_pct/200)` via new `desaturatePalette(palette, factor)` helper in `src/style/algorithm.js`** (new). Per the brief's "no Pointillism engine changes" constraint, the cloud-cover binding is applied to the curated palette array at the call site and therefore only fires in curated mode; auto/ColorThief mode would need a post-extension engine hook and is deferred to a curation-phase targeted PR (the helper is in place; only the wiring is missing). `WeatherSnapshot.weatherCode` is the raw integer WMO code (the v3.4 "mapped enum" stays deferred until a binding consumes it). `humidity_pct`, `pressure_hPa`, `temperature_C`, `weatherCode` flow through the snapshot and the override path but are **not yet read by any binding**. After this PR, V2 is feature-complete and the next session pivots to exhibition curation per locked decision 13. **Amendment (same v3.7, same date — 2026-05-01):** Curation needs arbitrary dates, not just "today", so this PR also lands a date picker and forecast-vs-archive routing. New UI sub-component: `src/ui/DatePicker.js` — native `<input type="date">` mounted by `ControlsPanel` immediately above `TimeSlider`. Initial value is the date portion of `state.time.timestamp` rendered in the location's `tz-lookup` timezone; on change, the timestamp is shifted by the day-delta in UTC milliseconds (Date.UTC(picked) − Date.UTC(current)), preserving the existing hour-of-day component and matching `TimeSlider.minuteToTimestamp`'s simple-shift convention. The existing `time:changed` listeners (Sky, SceneManager weather warm) all fire automatically — no further wiring needed. New endpoint: `APIS.openMeteoArchive` (`https://archive-api.open-meteo.com/v1/archive`). `WeatherFetcher` now routes between `APIS.openMeteo` (forecast, ~today − a few days through ~16 days ahead) and `APIS.openMeteoArchive` (everything strictly older) based on whether the requested timestamp's UTC hour-bucket falls before the start of today UTC. `buildUrl` is split into `buildForecastUrl` (start_hour=end_hour) and `buildArchiveUrl` (start_date=end_date); the archive returns 24 hourly entries per day, so `toSnapshot` looks up the row matching `bucketDate.toISOString().slice(0,13)` rather than always reading index 0. Cache key is unchanged (`weather:{lat3},{lon3},{hourBucketISO}`), so a hit from either endpoint is reusable. **Verified against code on 2026-05-01:** `src/weather/WeatherFetcher.js` (forecast/archive routing, `toSnapshot` indexed by hour), `src/scene/SceneManager.js` (warm with bucket guard + `weather:fetched` emit), `src/ui/DatePicker.js`, `src/ui/WeatherPanel.js`, `src/ui/ControlsPanel.js` (mergeWeather + bindings bridge + DatePicker mount), `src/style/algorithm.js` (`desaturatePalette` exported), `src/state.js` (`weatherOverrides` field, version comment bumped to 4), `src/config.js` (`APIS.openMeteo` + `APIS.openMeteoArchive`) all match this entry; archive endpoint live-pinged 2026-05-01 (HTTP 200, ~280 ms).
- **v3.9** — V2 Step 5c: customisation panel surface (painter + output + terrain). Exposes the parameters from `generative_panorama.html` that map onto the existing engines so curation can iterate without editing source. **State schema bumped to v5** with two new top-level blocks: `painter` (`brushWidthMm`, `density`, `brushOpacity`, `brushStrokeFactor`, `paletteTemperature`, `paletteSize`, `windInfluenceOverride`, `seed`) and `terrain` (`yExaggeration`). Defaults match the engine's existing DEFAULTS, so an untouched panel reproduces the pre-Step-5c painting bit-for-bit (regression guard). **Three new UI sub-components:** `src/ui/PainterParamsPanel.js` — seven sliders + a "🎲 New seed" button with a hex display; mounted between `WeatherPanel` and `PresetSelector`. `src/ui/OutputPanel.js` — paper size (A4/A3/A2) and orientation (landscape/portrait) radio groups bound to `state.export.format` and `state.export.orientation`. `src/ui/TerrainPanel.js` — single "Verticality" slider (`state.terrain.yExaggeration`, range 0.3–3.0, default 1.0). The terrain slider commits on `change` (release), not `input`, so dragging doesn't trigger a flurry of rebuilds. **Wind-tilt override semantics:** `painter.windInfluenceOverride` is `null` when the user has selected "auto" — the PR #9 weather binding (`speedMs > 1.5 ? 0.4 : 0`) applies. A finite number forces `windInfluence` unconditionally at the call site. A "↺" button next to the slider writes `null` back to restore auto. **Wiring at `applyPointillism` call site** (in `ControlsPanel.js`'s stylize handler): spread order is `painterOpts → painterParams → weatherOpts`, with `weatherOpts` last so data-driven `brushOpacity` (precipitation) and `brushStrokeFactor` (wind speed) win over the equivalent panel sliders when weather is present — that's by design; the panel ships the parameter surface, the data surface stays in charge. **Fixed the broken paper/orientation TODO** in `ControlsPanel`: the stylize handler used to read `state.get('paperSize')` / `state.get('orientation')` (paths that didn't exist) and fall back to `'A3'` / `'portrait'`; now reads `state.get('export.format')` / `state.get('export.orientation')` from the canonical paths. **`ExportSpec.format` narrowed** from `'A3' | 'A2' | 'A1' | 'custom'` to `'A4' | 'A3' | 'A2'` — `Pointillism.computeEffectiveDpi` only accepts those three (A1 / custom were unreachable through the painter anyway, so the narrow drops dead options rather than removing capability). **TerrainBuilder** now reads `state.terrain.yExaggeration` once at the top of `build()` and multiplies it into every heightmap value *before* `HeightSampler.populate`, so mesh vertices, camera ground placement, painter pinhole projection, and `Precipitation` respawn altitude all see the same scaled world. The default 1.0 is a no-op. The original's "Mountain horizontal scale" is **deliberately not ported** — distorting real DEM in XY would break lat/lon distances and the painter's projection. **New event:** `terrainOption:changed` (UI → Scene rebuild). **Verified against code on 2026-05-01:** `src/state.js` (v5 schema, painter + terrain blocks), `src/ui/PainterParamsPanel.js`, `src/ui/OutputPanel.js`, `src/ui/TerrainPanel.js` (mounted in `ControlsPanel.init`), `src/ui/ControlsPanel.js` (paper/orientation paths fixed, painter params spread, wind-tilt override branch), `src/terrain/TerrainBuilder.js` (yExaggeration applied), `src/scene/SceneManager.js` (`terrainOption:changed` listener + rebuild), `DATA-CONTRACTS.md` (`ExportSpec.format` narrowed) all match this entry; `npm run build` clean.
- **v3.8** — V2 Step 5b: weather visible in the 3D scene (live-composition feedback, not a painter change). Curation needed to *see* what the painter is going to consume before clicking Test pointillism — clouds, rain, fog, dimmed sun. The painter pipeline is unchanged; `applyPointillism` still receives the same `bindings.weather` shape. **Pure refactor:** `mergeWeather(fetched, overrides)` moved from `src/ui/ControlsPanel.js` to `src/weather/mergeWeather.js` so SceneManager (live 3D weather) and ControlsPanel (paint-time bindings) consume the exact same composition rule. Behaviour is unchanged; ControlsPanel imports from the new path. **New modules:** `src/sky/CloudLayer.js` — sprite-based cloud field. ~300 `THREE.Sprite` instances pre-allocated with a shared canvas-rendered radial-gradient texture (data-URL, no external assets); deterministic per-place layout seeded by lat/lon (`mulberry32`); visible count = `round(300 * cloudCover_pct / 100)` with 0 below 5%; tint by `weatherCode` (0–2 warm white, 3 grey-white, 51–67 mid grey, 71–77 near white + larger, 95–99 dark grey); wind drift in tangent plane at `wind.speedMs * 0.5` m/s in `wind.directionDeg`; sprites that exit an 8 km field around the observer wrap to the opposite side. `src/sky/Precipitation.js` — `THREE.Points` particle system. Active when `precipitation_mmh > 0.1`; particle count `min(5000, round(2000 * precipitation_mmh / 10))`; rain (10 m/s, narrow streak texture) vs snow (1.5 m/s, soft blob texture) keyed off `weatherCode 71–77 → snow`; particles spawn at cloud altitude in a 1 km horizontal radius around the camera, fall at the chosen speed with horizontal velocity = wind, respawn at altitude when y reaches `groundY` or they escape the horizontal field. **Both modules** are camera-relative (translate with the observer) and disposed + re-init'd on `location:changed` so per-place determinism (CloudLayer's lat/lon seed) tracks the new observer. **`SkySystem.updateWeather(weather)`** — atmospheric modulation called from `SceneManager.tick` immediately before `SkySystem.update`. Two effects: fog density × `max(0.3, 1 + (humidity_pct - 50) / 50)` (50% baseline, 100% doubles, dry air halves with a 30% floor); sun intensity scales by `1 - cloudCover_pct / 200` (50% dim at full overcast). Tone-mapping exposure is left alone — it tracks sun altitude and shouldn't couple to weather. Cold snapshot = no-op for both effects. **SceneManager wiring:** `_currentWeather` cached in module scope, refreshed by an async `refreshCurrentWeather()` (peek + `mergeWeather`) on the four events that can change it (`location:changed`, `time:changed`, `weather:fetched`, `weatherOverride:changed`); `tick()` reads it synchronously and dispatches to `SkySystem.updateWeather`, `CloudLayer.update`, `Precipitation.update`. Per-frame peek deliberately avoided — async-in-tick is awkward and `Cache.get` logs every read, so the event-driven cache is both faster and quieter. `Precipitation.update` reads `groundY` per frame from `HeightSampler.getHeightAt` so respawn altitude tracks terrain. **No painter pipeline change:** the same scene before and after this PR produces identical paintings (same `bindings.weather`, same `mergeWeather`, same `applyPointillism` opts). **Verified against code on 2026-05-01:** `src/weather/mergeWeather.js` (extracted helper, unchanged behaviour), `src/sky/CloudLayer.js`, `src/sky/Precipitation.js`, `src/sky/SkySystem.js` (`updateWeather` + sun-intensity scale + fog-density base capture), `src/scene/SceneManager.js` (init/dispose/tick wiring + `refreshCurrentWeather` + four event listeners), `src/ui/ControlsPanel.js` (mergeWeather import path updated), `src/state.js` (comment updated to point at the new mergeWeather location) all match this entry; `npm run build` clean.
- **v3.5** — V2 Step 4: OSM ground polygons in painter. `StyleBindings` gains two new fields, `viewpoint: ViewpointSnapshot` (mandatory for projection) and `ground: GroundSnapshot` (optional; absent before OSM cache lands). New shared types: `ViewpointSnapshot`, `GroundSnapshot`, `GroundFeature`. New section: "Ground category mapping" — five painter categories (water, forest, urban, farmland, beach) each with their explicit OSM-tag members. New module file: `src/style/projection.js` (pinhole projector lat/lon → canvas px, shared with Step 11 building silhouettes when that ships). New module file: `src/style/categories.js` (single source of truth for the tag → category mapping). The `Pointillism.applyPointillism` opts gain a `bindings` field; when present and `bindings.ground.osmFeatures` is non-empty, ground polygons are rendered as gradient-filled zones into the source canvas before the median-blur underpainting step, with a sun-phase tint applied. **Paint-time OSM access is cache-only:** `OSMFetcher.peekGroundCover(location, preset)` reads from the tile cache without ever issuing a network request — paint-time must not block on a 10–60 s Overpass round trip. Cold cache → `osmFeatures: []` → painter no-ops the polygon pass; the next paint after the scene rebuild's fetch lands picks up the polygons automatically. **Note on the originating brief:** the V2 build prompt drafted `ground.osmFeatures` as `{tag, category, polygon: [[lat, lon], ...]}` — that draft was superseded because the actual `OSMFetcher.elementsToPolygons` cache output has multi-tag polygons with optional inner rings, and category is a computed value not a stored one. The contract above reflects the cache reality. **Verified against code on 2026-05-01:** `src/style/projection.js`, `src/style/categories.js`, `src/style/Pointillism.js`, `src/style/groundPainter.js`, `src/osm/OSMFetcher.js` (peekGroundCover added), `src/ui/ControlsPanel.js` all match this contract; `src/config.js` `GROUND_COVER_COLOURS` is unchanged (still the source of truth for per-tag colours; categories are an additional lookup, not a replacement).
