# Phase 2+ — V2 build

Paste the contents below into a **fresh** Claude Code session as your
first message. Run only after Phase 1 MVP is shipping and acceptance
criteria are met.

---

You are extending Panorama past the MVP. Phase 1 is complete and
shipping. This phase adds V2 features in a deliberate order — one
feature group per PR — to avoid scope explosion.

# Read first

1. `STRATEGY-V2-REVISED.md` — the source of truth (still)
2. `REQUIREMENTS-CHECKLIST.md` — comprehensive feature list
3. `PHASE-1-CLOSEOUT.md` — what shipped in MVP and what's deferred
4. `ARCHITECTURE.md`, `ROLES.md`, `DATA-CONTRACTS.md` — contracts
5. The existing `src/` codebase — Phase 1 output

# What you are building (in this order, one PR at a time)

Each step is its own PR. Do not start the next step until the current
one is merged and the project owner has signed off.

## Step 1 — Map + compass UI

Add Leaflet + OSM tile layer. User can click anywhere on the map to
drop a pin, then rotate an FOV cone widget on the map to set bearing
and FOV. Pressing "View in 3D" loads the 3D preview at those
parameters. Manual coordinate input remains as a third entry point.

## Step 2 — Full preset gallery

Expand `src/presets/iconicViews.json` from 3 to ~12 entries spanning
the geographic diversity in REQUIREMENTS-CHECKLIST.md (mountains,
coast, desert/canyon, cultural, water/forest). Verify each viewpoint
against photographer guides.

## Step 3 — Multi-palette painter

Wire up the remaining curated palettes from `palettes.json` (Turner,
Whistler, Kirchner, Marc, Munch). Add palette picker to UI. ColorThief
extraction option for "auto" mode.

## Step 4 — OSM ground polygons in painter

Painter consumes OSM polygons from the Snapshot's `ground.osmFeatures`
array. Project them to canvas. Render as flat-coloured zones with
**vertical gradients** for atmospheric depth (lighter near horizon,
darker in foreground). Categories: water, forest, urban, farmland,
beach. Each category has its own colour range that adapts to the
sky-phase lighting.

Test against urban presets (e.g., Manhattan if added) and coastal
presets (e.g., Cinque Terre).

## Step 5 — Real weather data

Open-Meteo integration. Wind direction → influences cloud streak
orientation in sky underpainting. Cloud cover → sky band density.
Humidity → horizon haze warmth. Precipitation → rain streaks (broad,
not thin) and reduced ridge contrast.

Cache TTL: 1 hour per (lat, lon, hour-bucket).

## Step 6 — Real astronomy

SunCalc moon position. Hipparcos star catalogue (offline) for stars
when sun altitude < −6°. Milky Way band when conditions warrant.
Aurora (NOAA SWPC Kp-driven) at high latitudes. Each rendered
pointillist-style at scales that survive the median filter.

## Step 7 — Atmospheric phenomena

Rainbow at anti-solar point when sun + recent rain conditions match.
Halos and sundogs near sun in ice-cloud conditions. All rendered
pointillist-style.

## Step 8 — Wave-line patterns

Marine wind direction → wave-line patterns inside water polygons.
Open-Meteo Marine API integration.

## Step 9 — Wildlife (bird flocks)

eBird integration with API key support. Bird flocks as small clusters
of dark marks at altitudes consistent with observations. **Note:**
eBird requires registration, which contradicts README's "no mandatory
accounts." Resolve by making this an opt-in feature: user provides
their own eBird key in a settings panel, otherwise the feature is
disabled.

## Step 10 — Snapshot save / load / share

Distinguish:
- **Seed** (small, URL-friendly): lat, lon, time, view, style. Goes
  in the URL hash. Can be shared as a link.
- **Snapshot** (large, materialised): all fetched data baked in.
  Stored in IndexedDB for replay.

UI: "Share view" button copies a URL with the Seed; "Save painting"
button stores the materialised Snapshot alongside the PNG.

## Step 11 — Building silhouettes for urban scenes

Painter projects OSM building polygons as flat silhouettes at the
horizon (no 3D extrusion). Painter palette adapts: urban scenes get
slightly muted ground tones to keep the silhouettes readable.

## Step 12 — Walk mode in 3D viewer (small radius)

Within ~50 m of the entry point, user can step left/right or forward
to refine foreground composition. WASD or click-to-move. Camera stays
at chosen eye height.

# Subagents during V2 build

Same as Phase 1. Dispatch the relevant module owner for each PR's
review. `@art-director` should review aesthetic outcomes after every
visual feature lands (steps 3, 4, 5, 6, 7, 8, 11).

# Ground rules

Same as Phase 1. STRATEGY-V2-REVISED.md remains the source of truth.
Each PR ships a working tool — never break the MVP.

# When V2 is feature-complete

Run `@director` for a final review. Write `PHASE-2-CLOSEOUT.md`.
Hand back to project owner.
