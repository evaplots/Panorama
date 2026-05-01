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
 * @property {'A3' | 'A2' | 'A1' | 'custom'} format
 * @property {'landscape' | 'portrait'} orientation
 * @property {150 | 300 | 600} dpi
 * @property {number} [customWidthMm]
 * @property {number} [customHeightMm]
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

### `GroundSnapshot` (v3.5+)

OSM ground polygons projected by the painter into the underpainting. The shape
captured here is the *post-adapter* shape produced at the snapshot-assembly
site — it is **not** the raw `OSMFetcher.elementsToPolygons` shape, but it
preserves enough of it (multi-tag tags, outer + inner rings) that the painter
can render holes correctly.

```js
/**
 * @typedef {Object} GroundSnapshot
 * @property {GroundFeature[]} osmFeatures
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

### v0 bindings (pointillism)

These bindings ship with the v0 pointillism prototype. They are deliberately minimal — two solid bindings beat five guesses. The list grows from observed prototype behaviour, not from theory.

| Visual parameter            | Source signal                              | Mapping                                                         |
| --------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| Brushstroke angle           | `weather.wind.directionDeg` (Open-Meteo)   | direction_in_radians + π/2 (strokes run *along* the wind)       |
| Brushstroke length          | `weather.wind.speedMs`                     | base × (1 + windSpeedMs/10) — calmer days = shorter strokes     |
| Palette                     | `palettes.json` curated set + `sun.phase`  | nearest curated palette by climate-zone × sun.phase enum         |

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

### Palette: extracted-from-source vs curated (v1.1+)

The Style module's default behaviour is to **extract the palette from the rendered scene** via median-cut (a ColorThief-equivalent), then extend it via saturation-boost and 2× hue-rotation copies — matching `guillaume-gomez/to-pointillism`'s palette pipeline. Curated painter palettes (Munch, Kirchner, Soutine, Whistler, Turner, Marc, Nolde — see `src/style/palettes.json`) are **opt-in overrides**.

| Field                | Default  | Notes                                                           |
| -------------------- | -------- | --------------------------------------------------------------- |
| `palette`            | `null`   | `null` → extract from source via median-cut; pass an array of `[r,g,b]` triples to override (curated).                            |
| `paletteSize`        | `20`     | k-value for the median-cut extraction                           |
| `extendPalette`      | `true`   | Apply saturation-boost + 2× hue-rotation extension (4× size)   |
| `paletteSatBoost`    | `20`     | Saturation increase (HSL %) for the boosted copy               |
| `paletteHueJitter`   | `20`     | Hue rotation range (deg) for the two random-hue copies         |
| `paletteTemperature` | `28`     | Softmax temperature for weighted-random sampling per stroke    |

Curated palettes can be invoked from a future palette-by-context routing layer (climate × sun.phase enum) once it exists, but that lookup is deliberately not the default — extracting the palette from the actual rendered scene preserves the per-image chromatic relationship the painter would have observed.

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

### `WeatherSnapshot` (forward declaration)

The Weather module isn't built yet, but the Style contract assumes this shape. Defining it here means whoever builds Weather first knows what fields Style will consume:

```js
/**
 * @typedef {Object} WeatherSnapshot
 * @property {{ directionDeg: number, speedMs: number, gustMs: number }} wind
 * @property {number} cloudCover_pct       0–100
 * @property {number} humidity_pct         0–100
 * @property {number} pressure_hPa         millibars
 * @property {number} temperature_C
 * @property {number} precipitation_mmh    mm/hour
 * @property {string} weatherCode          Open-Meteo WMO code (mapped enum)
 * @property {Date} timestamp              When this snapshot was valid
 */
```

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

---

## Versioning the contracts

This file is treated as an API. If a field is added or its meaning changes, bump a version comment at the top of `state.js`:

```js
// State schema version: 3
// See docs/DATA-CONTRACTS.md
```

The state-schema version is independent of the contract-doc version. Version 3
of the runtime state schema has been stable since Phase 2 (v3 changelog) — the
v3.1–v3.5 entries below all add or revise *shared types* (StyleBindings,
SnapshotShapes, etc.) without touching the live `state` object. Bump the state
comment only when a field is added/removed/renamed in `src/state.js`.

When a future contributor sees their local checkout's state version doesn't match the doc, they know to read the changelog at the bottom of this file before debugging.

---

## Changelog

- **v1** (initial) — first version.
- **v2** — Added Phase 1.5 (Ground Cover). New constants: `GROUND_COVER_COLOURS`, `GROUND_COVER_PRIORITY`, `GROUND_COVER_Z_OFFSET_M`. New OSM sub-group: `groundCover` (added to the OSMFeatureBuilder return group). No state schema changes.
- **v3** — Phase 2 additions. `Viewpoint` type gains `mode` and `anchor` fields. State schema's `viewpoint` gains the same fields. New constants: `WALK_SPEED_MS`, `JOG_SPEED_MS`, `ACCELERATION_MS2`, `WALK_Y_SMOOTHING_MS`, `WALK_HARD_BOUND_MARGIN_M`. Two new events: `viewpoint:mode_changed`, `walker:moved`. CameraController public API gains `setMode`, `getMode`, `resetToOrigin`; the `update()` signature changes to take `deltaSeconds`.
- **v3.1** — Overpass etiquette hardening (response to rate-limit storm during Phase 2 testing). `APIS.overpass` is now an array of fallback endpoints. New constants: `OVERPASS_MAX_CONCURRENT` (must be 1), `OVERPASS_QUERY_TIMEOUT_S`, `OVERPASS_BACKOFF_429_MS`, `OVERPASS_MAX_429_RETRIES`, `OVERPASS_TILE_SIZE_M`, `OVERPASS_SPLIT_ON_504`. The four separate Overpass queries (ground cover, buildings, vegetation, landmarks) are now a single combined query per tile, filtered client-side. Full etiquette rules in `docs/modules/data-layer.md`.
- **v3.2** — Phase 2 follow-up. `TimeSpec` and state's `time` block gain `timezone` field (IANA tz string). TimeSlider now covers full 24 hours in location's local time, with sunrise/sunset markers. New allowed dependency: `tz-lookup` (npm, ~500 KB, client-side timezone-by-coordinates lookup, no API). New UI sub-component: `DebugOverlay` (toggle with `?` key) showing live diagnostic info. New cache keys: `osm:{z}/{x}/{y}` (replaces per-feature-type keys), `tz:{lat},{lon}`. Camera doc gains a "W keydown fires but camera doesn't move" sub-checklist (8 specific failure modes diagnosed during testing).
- **v3.3** — Mirror config correction (response to broken-mirror failures during Phase 2 testing). Removed `overpass.kumi.systems` and `overpass.private.coffee` from the default `APIS.overpass` array — they have CORS issues from browsers and produce `ERR_CONNECTION_REFUSED`. The default config now contains only `overpass-api.de`. Backoff schedule bumped from 5/15/45s to 10/30/90s to be gentler on the public endpoint. Added "Local Overpass via Docker" section to data-layer.md as the **recommended development path** — eliminates rate-limit issues entirely. Added "Buildings (or other features) don't appear" five-step diagnostic to osm-features.md. Added rule 9 to CLAUDE.md: web-search to verify external URLs before committing them. **Verified against code on 2026-04-29:** `src/config.js` matches this config (the v3.3 changelog had previously claimed a removal that wasn't actually in the code; that drift is now resolved).
- **v3.4** — Phase 2.5 Style module contract introduced. New `StyleBindings`, `WeatherSnapshot`, and `CelestialSnapshot` shared types defined as forward declarations (Weather and Astronomy modules don't exist yet but their consumed shape is fixed). New section: "Data → Style binding" specifying the v0 pointillism bindings (wind direction → stroke angle, wind speed → stroke length, palette by sun.phase) and reserved post-v0 bindings. New top-level modules: `src/style/`, `src/weather/`, `src/astronomy/`, `src/wildlife/` (all stubs). Determinism contract added: Style is a pure function from frozen inputs to canvas. Trigger flow documented. Module docs moved from project root to `docs/modules/`; ROLES.md path references updated to match. ARCHITECTURE.md table and file structure updated for the four new modules. Added: "Going forward, every changelog entry must include a 'Verified against code on YYYY-MM-DD' marker if it claims a code change — to prevent the doc-vs-reality drift that v3.3 had."
- **v3.6** — Chore: removed 3D OSM rendering (ground cover, buildings, vegetation, LOD manager). The painter has owned OSM polygons since v3.5/Step 4 via `OSMFetcher.peekGroundCover`; the in-scene 3D versions had become composition-distracting (offset textures, unwanted extrusions) and Path B had already declared the 3D scene composition scaffolding only. `OSMFeatureBuilder.build()` is now a cache-warming wrapper around `OSMFetcher.fetchGroundCover` and returns an empty `osmFeatures` Group; it stays in the rebuild flow so the painter's cache-only peek finds polygons after `scene:ready`. Painter consumption path unchanged. Files removed: `src/osm/GroundCoverBuilder.js`, `src/osm/BuildingsBuilder.js`, `src/osm/VegetationBuilder.js`, `src/osm/LODManager.js`. ARCHITECTURE.md and ROLES.md updated; `docs/modules/osm-features.md` is preserved as historical reference (still describes the deleted builders) and will be rewritten when the OSM role is next active. **Verified against code on 2026-05-01:** `src/osm/index.js` matches; no remaining imports of the deleted modules; `npm run build` clean.
- **v3.5** — V2 Step 4: OSM ground polygons in painter. `StyleBindings` gains two new fields, `viewpoint: ViewpointSnapshot` (mandatory for projection) and `ground: GroundSnapshot` (optional; absent before OSM cache lands). New shared types: `ViewpointSnapshot`, `GroundSnapshot`, `GroundFeature`. New section: "Ground category mapping" — five painter categories (water, forest, urban, farmland, beach) each with their explicit OSM-tag members. New module file: `src/style/projection.js` (pinhole projector lat/lon → canvas px, shared with Step 11 building silhouettes when that ships). New module file: `src/style/categories.js` (single source of truth for the tag → category mapping). The `Pointillism.applyPointillism` opts gain a `bindings` field; when present and `bindings.ground.osmFeatures` is non-empty, ground polygons are rendered as gradient-filled zones into the source canvas before the median-blur underpainting step, with a sun-phase tint applied. **Paint-time OSM access is cache-only:** `OSMFetcher.peekGroundCover(location, preset)` reads from the tile cache without ever issuing a network request — paint-time must not block on a 10–60 s Overpass round trip. Cold cache → `osmFeatures: []` → painter no-ops the polygon pass; the next paint after the scene rebuild's fetch lands picks up the polygons automatically. **Note on the originating brief:** the V2 build prompt drafted `ground.osmFeatures` as `{tag, category, polygon: [[lat, lon], ...]}` — that draft was superseded because the actual `OSMFetcher.elementsToPolygons` cache output has multi-tag polygons with optional inner rings, and category is a computed value not a stored one. The contract above reflects the cache reality. **Verified against code on 2026-05-01:** `src/style/projection.js`, `src/style/categories.js`, `src/style/Pointillism.js`, `src/style/groundPainter.js`, `src/osm/OSMFetcher.js` (peekGroundCover added), `src/ui/ControlsPanel.js` all match this contract; `src/config.js` `GROUND_COVER_COLOURS` is unchanged (still the source of truth for per-tag colours; categories are an additional lookup, not a replacement).
