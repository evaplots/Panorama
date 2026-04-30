# Strategy v2 — Real-data underpainting + canonical pointillism

This document refines the painter pipeline described in
[ARCHITECTURE.md](./ARCHITECTURE.md). It does **not** replace it — the
module map, dependency graph, event bus, and "edit one thing at a time"
principle all stand. What changes is the role each module plays in
producing the final artwork, and the contract that connects the
composition stage to the painting stage.

Short version: the 3D scene was always scaffolding in service of a 2D
painting. v2 makes that explicit and unlocks a cleaner pipeline where
real-world data flows directly into the painted canvas without a 3D
render in the critical path.

---

## The pipeline in one diagram

```
  COMPOSITION (real-time 3D)              PAINTING (one-shot 2D)
  ──────────────────────────              ──────────────────────
  Map (Leaflet + OSM)                     Underpainting synthesis
   │  drop pin + rotate FOV cone          from snapshot:
   ▼                                       · real DEM skyline
  3D viewer                                · OSM polygons (with gradients)
   │  orbit · look-around                  · sky gradient from sun
   │  walk (small radius)                  · iconic elements drawn
   │  eye-height adjust                      pointillist-style
   ▼                                            │
  "Paint" button                                ▼
   │  capture Snapshot {…}                Canonical to-pointillism
   ▼                                       · Scharr + Gaussian
  ───────── snapshot ─────────►            · 11×11 median
                                           · ColorThief / curated palette
                                           · weighted-random sampling
                                           · 0.7 mm physical strokes
                                                │
                                                ▼
                                          PNG @ 300 DPI
                                          (A4 / A3 default / A2)
```

Composition is a **measuring instrument**. Painting is the **artwork**.
The two are decoupled by a serialisable JSON snapshot. That decoupling
is the architectural unlock — either side can change independently,
snapshots are shareable and replayable, and the painter never depends on
Three.js.

---

## The Snapshot — the new central contract

A Snapshot is everything the painter needs and nothing it doesn't. The
3D scene state, the camera matrix, the renderer — none of that crosses
the boundary.

```js
{
  observer: {
    lat:        45.8326,
    lon:        6.8652,
    eyeHeightM: 1.7,             // user-adjustable in 3D preview
  },
  view: {
    azimuthDeg: 175,             // bearing, 0=N, 90=E
    fovDeg:     60,
    paperSize:  'A3',            // 'A4' | 'A3' (default) | 'A2'
    orientation:'portrait',      // 'portrait' | 'landscape'
    aspectRatio: 297/420,        // derived from paperSize + orientation
  },
  time: {
    iso8601:  '2026-04-30T19:42:00+02:00',
    timezone: 'Europe/Rome',
  },
  sun: {                          // derived via SunCalc, materialised for replay
    azimuthDeg:  263,
    altitudeDeg: -3.2,
    phase:       'civil-twilight',
  },
  weather: {                      // null OK; painter degrades gracefully
    windDirDeg:  240,
    windSpeedMs: 4.6,
    cloudCover:  0.3,
    humidity:    0.62,
    precipMmH:   0,
  },
  marine:    { /* wave dir/height; null inland */ },
  astronomy: { /* moon, stars, aurora */ },
  wildlife:  { /* bird flock observations near observer */ },
  ground:    { osmFeatures: [ /* polygons in FOV cone */ ] },
  style: {
    painter:           'nolde',     // 'nolde' | 'turner' | 'whistler' | 'kirchner' | 'marc' | 'munch' | 'auto'
    paletteSource:     'curated',   // 'curated' | 'colorthief'
    divisionStrength:  0.7,
    strokeWidthMm:     0.7,
    celestial: {
      sunDiscScale:  1.0,           // 1.0 = realistic; >1 = artistic exaggeration
      moonDiscScale: 1.0,
    },
  },
  rngSeed: 0x7a31f2,                // deterministic stroke placement
}
```

Two contracts on the Snapshot:

1. **Determinism.** Same Snapshot in → same painting out. The painter is
   a pure function modulo the seeded RNG, which lives inside the
   Snapshot itself.
2. **Self-contained.** Network-derived values (sun, weather, OSM, eBird,
   etc.) are *materialised* into the Snapshot at capture time. The
   painter never makes a network call. Paintings are replayable
   indefinitely even if APIs change or disappear.

Snapshots are JSON. Save / load / share is therefore free — every preset
is a Snapshot template, every user creation is a Snapshot, every
exhibition print has its Snapshot archived alongside the PNG.

---

## Output sizes

Three paper sizes supported, both orientations:

| Size | Portrait (mm) | Landscape (mm) | Portrait @ 300 DPI (px) | Landscape @ 300 DPI (px) |
| ---- | ------------- | -------------- | ----------------------- | ------------------------ |
| A4   | 210 × 297     | 297 × 210      | 2480 × 3508             | 3508 × 2480              |
| **A3 (default)** | 297 × 420 | 420 × 297 | 3508 × 4961        | 4961 × 3508              |
| A2   | 420 × 594     | 594 × 420      | 4961 × 7016             | 7016 × 4961              |

The painter natively produces at the chosen pixel size — no tiled
rendering needed. Memory note: A2 raw RGBA buffer is ~140 MB. Desktop
hardware target.

---

## Composition — three entry points, one viewer

All three flows converge on the same 3D viewer, where the user finalises
bearing, FOV, eye height, and (within a small radius) position before
pressing Paint.

### 1. Preset gallery

A curated strip of ~12–16 iconic viewpoints. Click a preset → the 3D
viewer loads at that location, bearing, and recommended time. The user
can still freely adjust everything before painting. **Presets are a
starting state, never a final state.**

A preset is a partial Snapshot:

```js
{
  slug:        'fuji-kawaguchi',
  name:        'Mount Fuji from Lake Kawaguchi',
  region:      'Japan',
  observer:    { lat: 35.5172, lon: 138.7531, eyeHeightM: 1.7 },
  view:        { azimuthDeg: 175, fovDeg: 60 },
  recommended: { hour: 5, month: 11 },
  blurb:       'Reflected Fuji at first light over the lake.',
}
```

Initial curation balances continents, terrain types, and time-of-day.
A starter set worth shipping (final list to be verified against
photographer guides):

- **Mountains:** Mont Blanc · Half Dome from Glacier Point · Fuji from
  Lake Kawaguchi · Matterhorn from Zermatt · Moraine Lake · Trolltunga
- **Coast & cliffs:** Oia at sunset · Cliffs of Moher · Cape of Good
  Hope · Big Sur (Bixby) · Cinque Terre (Manarola)
- **Desert & canyon:** Horseshoe Bend · Monument Valley (Ford's Point) ·
  Uluru · Zabriskie Point
- **Cultural:** Bagan at sunset · Machu Picchu (Sun Gate) · Taj Mahal
  (Mehtab Bagh)
- **Water & forest:** Iguazu · Plitvice · Ha Long Bay (Ti Top)

### 2. Map + compass (drop pin)

Leaflet with OpenStreetMap tiles. User clicks anywhere on the map to
drop a pin, then rotates an FOV cone widget on the map to set bearing
and FOV. Pressing "View in 3D" enters the viewer.

No paid APIs. No auth. ~40 KB gzipped.

### 3. Manual coordinates

Type a place name (Nominatim) or paste lat/lon. Useful for power users
and for testing.

### The 3D viewer — what it is, what it isn't

**Job:** let the user recognise the place and confirm the framing.
**Not the job:** look beautiful as a render. Beauty is the painting's
problem, not the viewer's.

Controls:

- Orbit and look-around (mouse / touch).
- Walk within a small radius (~50 m) around the entry point — enough to
  step left/right or forward to refine the foreground, not free roam.
- Eye-height adjustment slider (default 1.7 m).
- Paper size selector (A4 / A3 / A2) and orientation toggle. The 3D
  viewer's FOV cone matches the chosen aspect ratio so what you compose
  is what gets painted.
- "Paint" button — captures the Snapshot, hands off, shows progress.

Visual minimum bar for recognisability:

- DEM mesh with elevation tinting (already in `src/terrain/`).
- Sky shader with sun position (already in `src/sky/`).
- Flat OSM ground polygons projected on terrain — water blue, forest
  green, urban grey, farmland tan, beach sand. New module work.
- Optional building footprints as low-poly extrusions for urban presets
  only.

This deliberately stops short of vegetation instances, atmospheric
effects, and material polish. The painting handles all of that.

---

## The painter — `src/style/`

The painter is a pure function:

```js
Painter.paint(snapshot) → HTMLCanvasElement   // at chosen paper size, 300 DPI
```

Two stages, in strict order.

### Stage 1 — underpainting synthesis

Build a clean 2D image at the chosen paper size, populated entirely
from Snapshot data. The underpainting's job is to give Stage 2 clean
gradients and colour masses to bite into.

Layered, back-to-front:

1. **Sky gradient.** Eight-phase table keyed on sun altitude (inherited
   from the original `generative_panorama.html`, which had it carefully
   tuned). Horizon / mid-sky / zenith colour stops. Cloud cover and
   humidity widen the horizon haze band.
2. **Atmospheric phenomena.** Rainbow arc at the anti-solar point when
   sun + recent rain conditions match. Aurora bands at high latitudes
   when NOAA SWPC Kp index warrants. Halos and sundogs near sun in
   ice-cloud conditions. Drawn as broad colour masses sized to survive
   the median filter.
3. **Celestial bodies.** Sun and moon discs at their computed canvas
   position. Disc radius scales with `style.celestial.sunDiscScale` and
   `moonDiscScale` — defaults 1.0 (realistic angular size, exaggerated
   slightly for visibility), user-adjustable for dramatic moonrise
   effects or tiny photographic accuracy. Stars as bright clusters at
   known positions when sun altitude < −6°. Milky Way as a broad band
   of mottled light when conditions warrant.
4. **Real DEM skyline.** Computed by `SkylineCaster.getSkyline()` (new
   module, see below). For each azimuth sample in the FOV, ray-cast
   against the cached heightmap, return the maximum elevation angle.
   Project to canvas Y using the same altitude→pixel mapping the sun
   uses. Filled below as a silhouette polygon in the local ground tone.
5. **OSM ground polygons with gradients.** Water → blue, forest →
   green, urban → grey, farmland → tan, beach → sand. **Each zone has
   internal vertical gradient** for atmospheric depth — lighter and
   sky-tinted near the horizon, darker and more saturated in the
   foreground. Optional wave-line patterns derived from marine wind
   direction. Building silhouettes for urban scenes: projected as flat
   polygons at the horizon, no extrusion.
6. **Wildlife.** Bird flocks as small clusters of dark marks at
   altitudes/positions consistent with eBird observations.

### Pointillist-style iconic rendering — the key technique

Every iconic element in Stage 1 (birds, sun, moon, stars, rainbow,
aurora, halos) is **drawn the way a pointillist painter would draw it**
— as clusters of substantial colour patches, not as fine line art. A
bird is not a thin curve; it is a small cluster of dark marks arranged
in a recognisable M-silhouette proportion. The sun is not a thin disc
outline; it is a generous radiant patch of warm colour. Stars are bold
bright dots, not pixel points.

This serves two purposes simultaneously:

- It ensures the elements **survive Stage 2's Gaussian smoothing and
  11×11 median filter** intact. Anything finer than ~10–15 px gets
  smeared away; pointillist-scale marks come through.
- It ensures the elements are **stylistically of-a-piece** with the
  rest of the painting. They look painted, not pasted on.

This is why we don't need an overlay layer or a canonical-algorithm
exception. We don't bypass to-pointillism; we feed it an underpainting
where the iconic elements are already drawn at a scale and in a style
the algorithm naturally preserves.

### Stage 2 — canonical to-pointillism

Faithful implementation of [`guillaume-gomez/to-pointillism`][togp].

[togp]: https://github.com/guillaume-gomez/to-pointillism

Algorithm contract:

1. **Palette.** ColorThief-equivalent extraction from the underpainting,
   OR override with a curated painter palette from `palettes.json`
   (Nolde, Turner, Whistler, Kirchner, Marc, Munch).
2. **Edge detection.** Scharr gradient with Gaussian smoothing.
3. **Underpainting prep.** 11×11 median filter for colour masses.
4. **Stroke placement.** Weighted-random sampling from the palette,
   density driven by gradient magnitude.
5. **Stroke geometry.** Round dots with physical width = 0.7 mm
   (configurable via `style.strokeWidthMm`). At 300 DPI, 0.7 mm ≈ 8.27 px.

**No bespoke variations.** No zone-aware stroke angles, no Van-Gogh
quadratic Béziers, no wind-tilt directly applied to strokes. All
data-binding happens upstream in Stage 1. The stroke engine is
canonical, full stop.

This contract is testable: a regression test runs the algorithm against
a fixed underpainting fixture and diffs against a reference image. Any
drift fails the test.

---

## Data bindings — every signal lives in the underpainting

Because Stage 2 is canonical, every real-world signal must express
itself by changing what the underpainting looks like. This is
*cleaner* than the original "wind direction shapes brushstroke angle"
plan: Scharr's gradient detector picks up streak direction in clouds
automatically, so a wind-streaked sky in the underpainting → strokes
that follow the streak — for free.

| Signal              | Source              | Underpainting expression                                       |
| ------------------- | ------------------- | -------------------------------------------------------------- |
| Sun position        | SunCalc             | Sky gradient phase, silhouette shadow direction, sun disc      |
| Moon, stars, MW     | SunCalc / Hipparcos | Disc + glow, point clusters, Milky Way band                    |
| Wind dir / speed    | Open-Meteo          | Cloud streak orientation, wave directions, foliage cues        |
| Cloud cover         | Open-Meteo          | Sky band density, horizon haze width                           |
| Humidity            | Open-Meteo          | Horizon haze warmth and saturation                             |
| Precipitation       | Open-Meteo          | Rain streaks (broad, not thin), reduced ridge contrast         |
| Rainbow             | Derived (sun + rain) | Arc at anti-solar point when conditions align                 |
| Waves               | Open-Meteo Marine   | Wave-line patterns inside water polygons                       |
| Aurora              | NOAA SWPC           | Vertical green/magenta bands at high latitudes when Kp warrants |
| Bird flocks         | eBird               | Small dark clusters at consistent altitudes                    |
| Atmospheric optics  | Derived             | Halos, sundogs, glories near sun                               |

Anything that can't be drawn at a scale the algorithm preserves can't be
in the painting. That's a feature, not a bug — it forces every signal to
commit to a visual language consistent with the rest of the work.

Bird-call audio (xeno-canto) remains out of scope for the visual
painter; the README's multi-sensory ambition explicitly flags it as
at-risk and deferred.

---

## Module-by-module impact

| Module        | Path             | Status in v2                                                                  |
| ------------- | ---------------- | ----------------------------------------------------------------------------- |
| **Data**      | `src/data/`      | Unchanged. Add Overpass query for OSM polygons in FOV cone.                   |
| **Terrain**   | `src/terrain/`   | Unchanged 3D builder. **Add `SkylineCaster.getSkyline(observer, az, fov)`** — analytic ray-cast against cached heightmap. |
| **Sky**       | `src/sky/`       | Stays for 3D preview only. The painter computes its own sky gradient.         |
| **OSM**       | `src/osm/`       | **Heavily reduced.** Flat ground-cover polygons for the 3D preview tint. Buildings as 3D extrusions become **optional** for urban presets only. Vegetation instancing **deferred indefinitely**. |
| **Camera**    | `src/camera/`    | Trim to orbit + look-around + small-radius walk + eye-height. No free-roam.   |
| **Scene**     | `src/scene/`     | Orchestrates 3D preview lifecycle only. On Paint: builds Snapshot, hands off. |
| **Export**    | `src/export/`    | Collapses. Receives canvas from Painter, writes PNG. No tiled rendering.      |
| **UI**        | `src/ui/`        | Add: PresetGallery, Map (Leaflet), CompassWidget, paper-size selector, orientation toggle. Trim: walk-mode controls. |
| **Style**     | `src/style/`     | **Major redesign.** Becomes Painter (synthesis + canonical to-pointillism). Existing `Pointillism.js` / `algorithm.js` become the Stage 2 engine. |
| **Weather**   | `src/weather/`   | Unchanged role: fetcher. Output flows into Snapshot, painter consumes.        |
| **Astronomy** | `src/astronomy/` | Unchanged role: fetcher. Output flows into Snapshot, painter consumes.        |
| **Wildlife**  | `src/wildlife/`  | Unchanged role: fetcher. Output flows into Snapshot, painter consumes.        |
| **Presets**   | `src/presets/`   | **New.** `iconicViews.json` + `PresetLoader.js`.                              |

The single most important new contract:

```js
// src/terrain/SkylineCaster.js (new)

/**
 * Compute the visible horizon as a 1D array of elevation angles.
 * No 3D rendering. Pure ray-cast against the cached heightmap.
 *
 * Includes Earth curvature correction:
 *   apparent_elevation -= (distance_m)^2 / (2 * 6371000) * 0.87
 *
 * @param  {Object} observer        { lat, lon, eyeHeightM }
 * @param  {number} viewAzimuthDeg  centre bearing
 * @param  {number} fovDeg          horizontal FOV
 * @param  {number} samples         azimuth samples (default 360)
 * @returns {Float32Array}          elevation angle (degrees) per sample
 */
export function getSkyline(observer, viewAzimuthDeg, fovDeg, samples = 360);
```

This is the piece that makes Path B possible. Until it exists, the
painter cannot run.

---

## What gets cut from the original ROADMAP

- **Phase 2 walk mode (free-roam WASD)** — replaced with small-radius
  refinement walk inside the 3D preview.
- **Phase 2 building 3D extrusions as a default** — demoted to optional
  polish for urban presets. Buildings appear in the painting as
  projected silhouettes from OSM polygons.
- **Phase 3 vegetation instancing (3D trees)** — deferred indefinitely.
  Vegetation expression is colour-band only.
- **Phase 4 tiled rendering for export** — no longer needed; painter
  produces native paper size.

What gets *expanded*:

- **Phase 2.5 Stylization** absorbs the underpainting synthesis and
  iconic-element rendering. The Stage 1 work is the new bulk of the
  painter module.

Net effect: total project scope **shrinks** while the signature feature
**strengthens**.

---

## Implementation order — suggested PR sequence

Each step is a self-contained PR.

1. **Land this strategy doc.** (This PR.)
2. **Edit `ARCHITECTURE.md`** to reference STRATEGY-V2 for module roles
   in the painter pipeline. Light edit, no code.
3. **`SkylineCaster.getSkyline()`** — new module on existing terrain
   layer. Pure function, fully unit-testable. Land with tests.
4. **`Painter.paint(snapshot)` skeleton** — Stage 1 sky gradient +
   skyline silhouette only. Stage 2 calls existing `Pointillism.js`.
   Output is recognisably *something*, even if very simple.
5. **OSM polygons with gradients in underpainting** — water, forest,
   urban, farmland, beach. Painter starts to read as a real place.
6. **Celestial bodies** — sun disc with customisable scale, then moon,
   then stars. One PR each.
7. **Atmospheric phenomena** — rainbow, aurora, halos. One PR each.
8. **Wildlife** — bird flocks.
9. **Preset gallery** — JSON + loader + UI strip. Can land in parallel
   with painter work; doesn't block it.
10. **Map + compass UI** — Leaflet integration. Can also land in
    parallel.
11. **3D preview trim** — remove walk-mode WASD, scope camera to orbit
    + look + small-radius + eye-height. After painter is producing
    usable output.

Steps 3 and 4 are the critical path. Everything else can parallelise.

---

## What hasn't changed

- The six pillars from the README.
- The "edit one thing at a time" principle from ARCHITECTURE.md.
- The dependency graph (UI → State → Scene → Builders → Data Layer).
- The event bus communication pattern.
- The two-licence model (MIT for software, CC BY-NC-SA for art).
- "No paid APIs. No mandatory accounts."

This is a refinement of the painter pipeline, not a rewrite of the
project.
