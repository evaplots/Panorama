# Panorama — Requirements Checklist

This document consolidates every requirement, decision, and open question
for the Panorama rebuild as discussed across strategy sessions. Use it to
verify nothing is missing before running the formal multi-agent review
and handing the strategy to a fresh Claude Code session.

---

## 1. Vision & pillars

- Real Earth data → painterly artwork: "Van-Gogh-of-this-specific-place-
  at-this-specific-moment, not a photograph"
- Real DEM-derived skyline is the project's differentiator vs the
  original HTML tool
- Output is print-quality wall art
- Six README pillars preserved: real-data-driven · first-person
  human-scale · recognisability · painterly stylization is the
  signature · multi-sensory ambition · print-quality export

## 2. User-controllable inputs

| Input               | Notes                                                       |
| ------------------- | ----------------------------------------------------------- |
| Location (lat/lon)  | Via preset, map drop, or manual entry                       |
| Date and time       | Specific timestamp; drives sun, weather, astronomy          |
| Viewing direction   | Azimuth — set in 3D viewer; pre-filled from preset/compass  |
| Field of view       | Set in 3D viewer; pre-filled from preset/compass            |
| Eye height          | Default 1.7 m, adjustable                                   |
| Painter palette     | Nolde, Turner, Whistler, Kirchner, Marc, Munch — or auto    |
| Celestial sizes     | sunDiscScale, moonDiscScale — independent customization     |
| Paper size          | **A4, A3 (default), A2**                                    |
| Orientation         | Portrait / landscape                                        |

## 3. Composition workflow (3D viewer)

- Three entry points converge on the same 3D viewer:
  - **Preset gallery** — curated iconic viewpoints
  - **Map + compass** — drop pin + rotate FOV cone (Leaflet + OSM)
  - **Manual coordinates** — Nominatim search or paste lat/lon
- 3D viewer controls: orbit, look-around, walk within small radius
  (~50 m), eye-height adjustment
- 3D viewer's job: *recognisability of the place*, not beautiful render
- "Paint" button captures snapshot and hands off to painter
- 3D preview minimum: DEM mesh + sky shader + flat OSM ground polygons

## 4. Real-world data sources (all kept)

| Source               | Provider              | Auth                                       |
| -------------------- | --------------------- | ------------------------------------------ |
| DEM heightmaps       | AWS Terrain Tiles     | None                                       |
| OSM features         | Overpass API          | None                                       |
| Sun position         | SunCalc (offline)     | None                                       |
| Moon, stars          | SunCalc / Hipparcos   | None (Hipparcos bundled)                   |
| Weather              | Open-Meteo            | None                                       |
| Marine waves         | Open-Meteo Marine     | None                                       |
| Aurora (Kp index)    | NOAA SWPC             | None                                       |
| Bird flocks          | eBird                 | **Requires API key — open question**       |
| Atmospheric optics   | Derived (sun+weather) | N/A                                        |
| Geocoding            | Nominatim             | None (User-Agent required)                 |
| Bird-call audio      | xeno-canto            | **Deferred (README pillar 5 at-risk)**     |

## 5. Snapshot contract

Fields:

- `observer: {lat, lon, eyeHeightM}`
- `view: {azimuthDeg, fovDeg, aspectRatio}` — aspect from paper+orientation
- `time: {iso8601, timezone}`
- `sun, weather, marine, astronomy, wildlife` — materialized at capture
- `ground: {osmFeatures: [...]}` — polygons in FOV cone
- `style: {painter, paletteSource, divisionStrength, strokeWidthMm,
  paperSize, orientation, celestial: {sunDiscScale, moonDiscScale}}`
- `rngSeed`

Contracts:

- **Determinism:** same snapshot → same painting
- **Self-contained:** painter makes zero network calls
- **Seed vs Snapshot split** (from review): small URL-shareable Seed,
  large materialized Snapshot — *pending fold-in*

## 6. Painter pipeline

### Stage 1 — Underpainting synthesis

Layered back-to-front:

1. **Sky gradient** — eight-phase table keyed on sun altitude (inherited
   from the original HTML tool)
2. **Atmospheric phenomena** — rainbow at anti-solar point, aurora at
   high latitudes (Kp-driven), halos and sundogs in ice clouds
3. **Celestial bodies** — sun and moon discs (scalable), stars when
   sun altitude < −6°, Milky Way band when conditions warrant
4. **Real DEM skyline** — analytic ray-cast, projected to canvas
   (the project's differentiator)
5. **OSM ground polygons with gradients** — water, forest, urban,
   farmland, beach. **Gradients within zones, not flat colours**
   (atmospheric depth, lighting variation, distance haze)
6. **Wave-line patterns** in water polygons (marine wind direction)
7. **Building silhouettes** at horizon for urban scenes (projected OSM
   polygons, no 3D extrusion)
8. **Wildlife** — bird flocks as small clusters, pointillist-style

All iconic elements drawn pointillist-style at scales that survive
Stage 2 — clusters of substantial colour patches, not fine line art.

### Stage 2 — Canonical to-pointillism

Faithful implementation of `guillaume-gomez/to-pointillism`:

- ColorThief-equivalent palette extraction OR curated painter palette
- Scharr gradient + Gaussian smoothing
- 11×11 median filter
- Weighted-random palette sampling, density driven by gradient magnitude
- **0.7 mm physical stroke width** (configurable via strokeWidthMm)
- **No bespoke variations** — all data binding lives upstream in Stage 1
- Determinism via seeded RNG (RNG choice TBD)

## 7. Output

- **PNG raster** at 300 DPI
- Three sizes: A4 (210×297 mm), A3 (297×420 mm, default), A2 (420×594 mm)
- Both orientations: portrait, landscape
- Pen-plotter conversion is the user's separate workflow — out of scope

## 8. Presets

- ~12–16 curated iconic viewpoints (cut to 12 for v0)
- Each preset is a partial Snapshot (lat, lon, default azimuth, default
  FOV, recommended hour/month, blurb)
- **User can fully adjust everything after loading**
- Geographic diversity: mountains, coast, desert/canyon, cultural
  landscapes, water/forest
- Stored as JSON: `src/presets/iconicViews.json`

## 9. UI components

- Leaflet map with OSM tiles (no auth, no key)
- Compass widget on map (drop pin + rotate FOV cone)
- Manual coordinates input (Nominatim search)
- Preset gallery (card strip)
- Time slider with timezone awareness
- Eye-height slider
- Paper size selector (A4 / A3 / A2)
- Orientation toggle (portrait / landscape)
- Painter palette picker
- Sun and moon size sliders (independent)
- 3D viewer controls (orbit, look, small-radius walk)
- Paint button
- Progress indicator

## 10. Architecture & engineering constraints

- Vite build tool
- Vanilla ES2022 modules, no UI framework
- Three.js for 3D preview (WebGL2)
- Modular per ROLES.md: 13 module roles with strict contracts
- Event bus / pub-sub for state changes
- No paid APIs · No mandatory accounts (eBird is the open exception)
- Two licences: MIT (software) + CC BY-NC-SA 4.0 (rendered art)
- IndexedDB + in-memory cache
- Snapshots are JSON, save/load/share native

## 11. Explicitly cut or deferred

- ~~Walk-mode WASD free-roam~~ → small-radius walk inside 3D viewer
- ~~3D building extrusions as default~~ → projected OSM silhouettes in
  painter; 3D extrusions optional polish for urban presets only
- ~~Vegetation 3D instances~~ → deferred indefinitely; colour-band only
- ~~Tiled rendering for export~~ → painter produces native paper size
- ~~Pen-plotter output~~ → user's downstream workflow
- ~~Bird-call audio (xeno-canto)~~ → deferred
- ~~Stroke-level data binding~~ → all data binding moves to underpainting

## 12. Open items from fast review (not yet folded into strategy)

| Item                                                              | Severity |
| ----------------------------------------------------------------- | -------- |
| Earth curvature correction in SkylineCaster                       | P1       |
| DEM ray range, step size, tile zoom strategy                      | P0       |
| Edge cases: flat horizon, occluded view, negative-elevation       | P1       |
| Iconic element minimum-size table                                 | P1       |
| Painter palette renaming ("Nolde palette" not "in style of Nolde")| P1       |
| Per-source cache TTL table                                        | P2       |
| Graceful degradation per data source (`required: true/false`)     | P1       |
| Seed vs Snapshot distinction                                      | P0       |
| eBird API key handling vs "no mandatory accounts" claim           | P1       |
| Determinism RNG specification                                     | P2       |
| MVP scope explicitly defined                                      | P0       |
| Spike prototypes before main build                                | P0       |
| v0 acceptance test                                                | P1       |
| Recognisability test for 3D viewer                                | P1       |
| Building silhouettes in painter (V2 Step 11) — projected polygons, no extrusion. Reuses `src/style/projection.js` from Step 4. | P2 |
| Wave-line patterns inside water polygons (V2 Step 8) — marine wind direction → stroke patterns within water category. Step 4 ground polygons currently get a flat gradient instead. | P2 |
| Weather influence on painter underpainting (V2 Step 5) — wind direction → cloud streak orientation, cloud cover → sky band density, humidity → horizon haze warmth, precipitation → rain streaks. Step 4 deliberately scoped to sun.phase only. | P2 |
| Real astronomy (V2 Step 6) — moon, stars, milky way, aurora rendered into underpainting. | P2 |
| Atmospheric phenomena (V2 Step 7) — rainbow at anti-solar point, halos, sundogs. | P2 |
| Wildlife (V2 Step 9) — eBird-driven bird flock marks. | P2 |
| Painter ground polygons use flat-Y projection (Step 4 v0) — every polygon vertex assumed at observer's groundY, ignoring local terrain elevation. Increasingly inaccurate at distance / on hilly terrain. Fix: per-vertex HeightSampler call at snapshot-assembly time, with a small spatial cache. Defer until painter→Path-B migration touches the snapshot pipeline anyway. | P2 |
| Painter ground polygons skip `bare_rock` and `scree` tags (not in the 5 painter categories). The 3D scene still renders these. Add a 6th painter category "rocky" if alpine presets read poorly. | P2 |
| Per-source cache TTL table for V2 painter snapshot data | P2 |

## 13. Open questions for project owner

Decisions that have been made implicitly or remain ambiguous:

1. **Paper size selection timing.** Pick before composing (3D viewer
   matches FOV to aspect) or after (painter crops/letterboxes)?
2. **Painter palette default.** Curated or ColorThief?
3. **Time + weather coupling.** What happens for far-future or far-past
   dates without weather data?
4. **OSM data radius.** What max radius for FOV-cone polygon fetch?
5. **Session history.** Keep multiple paintings, just current, or
   save-and-restore?
6. **Hardware target.** Desktop-only, or mobile-friendly? A2 output is
   ~140 MB raw RGBA — heavy on mobile.
