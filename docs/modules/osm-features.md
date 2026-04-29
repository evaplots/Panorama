# Module: OSM Features

**Owner role:** 🏘 OSM Features Engineer
**Phase introduced:** Phase 1.5 (ground cover), Phase 2 (buildings), Phase 3 (3D vegetation)
**Files:**
- `src/osm/OSMFetcher.js`
- `src/osm/GroundCoverBuilder.js`     ← Phase 1.5
- `src/osm/BuildingsBuilder.js`        ← Phase 2
- `src/osm/VegetationBuilder.js`       ← Phase 3
- `src/osm/LODManager.js`

---

## Purpose

OpenStreetMap data turned into visual content: ground colours, buildings, trees, forests, landmarks. This is what makes a location *recognisable* — anyone can render terrain with a Sky shader, but Mont Saint-Michel without the abbey, or a Mediterranean coast without sand colour, isn't recognisable.

The module operates in three layers, built in increasing 3D complexity:

1. **Ground cover** (Phase 1.5) — flat coloured polygons projected onto terrain. Sand, water, grass, urban, rock, forest floor.
2. **Buildings** (Phase 2) — extruded 3D polygons with proper heights.
3. **3D vegetation** (Phase 3) — instanced 3D trees scattered above forest ground cover; landmark detection.

Each layer adds meaningfully to recognisability and can be skipped or scaled back independently.

---

## Public API

```js
// Top-level orchestrator within the module
export const OSMFeatureBuilder = {
  build(location: Location, preset: RadiusPreset): Promise<THREE.Group>
};
// The returned group contains sub-groups:
//   - 'groundCover' — flat coloured polygons on terrain (Phase 1.5+)
//   - 'buildings'   — extruded building meshes, instanced (Phase 2+)
//   - 'vegetation'  — 3D forests, individual trees (Phase 3+)
//   - 'landmarks'   — always-visible notable structures (Phase 3+)
```

Internal builders (`GroundCoverBuilder`, `BuildingsBuilder`, `VegetationBuilder`) are not part of the public API — they're orchestrated by `OSMFeatureBuilder` (which lives at the top of `OSMFetcher.js` or in its own `index.js`).

In Phase 1.5, only `groundCover` is populated; the other sub-groups exist as empty groups so the orchestrator can attach them unchanged in later phases.

---

## Data source: Overpass API

Endpoints: see `APIS.overpass` in `config.js` — an array of fallback mirrors. Strict etiquette rules are documented in [`data-layer.md`](./data-layer.md). **Read those before writing any fetcher code.**

We use one **combined Overpass query per tile** that fetches everything at once. Filter the result client-side. This is non-negotiable — separate queries per feature type were the cause of the rate-limit storm during early Phase 2 testing.

### Combined query (used by all builders)

```
[out:json][timeout:60];
(
  // Ground cover (Phase 1.5)
  way["natural"~"water|wood|sand|beach|bare_rock|scree|grassland|wetland|glacier|heath"](s,w,n,e);
  relation["natural"~"water|wood|sand|beach|bare_rock|scree|grassland|wetland|glacier|heath"](s,w,n,e);
  way["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|commercial|industrial|cemetery|recreation_ground|allotments|brownfield"](s,w,n,e);
  relation["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|commercial|industrial|cemetery|recreation_ground|allotments|brownfield"](s,w,n,e);
  way["waterway"="riverbank"](s,w,n,e);
  way["leisure"~"park|garden|pitch|golf_course"](s,w,n,e);

  // Buildings (Phase 2)
  way["building"](s,w,n,e);
  relation["building"](s,w,n,e);

  // Landmarks (Phase 3, free to include now)
  way["man_made"~"tower|chimney|lighthouse"](s,w,n,e);
  way["historic"~"castle|monument|memorial"](s,w,n,e);
  way["amenity"="place_of_worship"](s,w,n,e);

  // Vegetation point features (Phase 3)
  node["natural"="tree"](s,w,n,e);
);
out geom;
```

`out geom;` returns vertex coordinates inline, saving a second query for `out body; >; out skel;`. The 60-second timeout is mandatory — combined queries are larger than single-feature ones.

### Result distribution

`OSMFetcher.fetchTile(s, w, n, e)` returns the raw JSON. Each builder filters it client-side:

```js
// In OSMFetcher.js
async function fetchTile(bbox) {
  const cached = await Cache.get(`osm:${bbox.key}`);
  if (cached) return cached;
  const result = await overpassQueue.run(() => postCombinedQuery(bbox));
  await Cache.set(`osm:${bbox.key}`, result, 7 * 86400e3);
  return result;
}

// In GroundCoverBuilder.js
const polygons = result.elements.filter(el =>
  el.tags?.natural || el.tags?.landuse || el.tags?.leisure || el.tags?.waterway
);

// In BuildingsBuilder.js
const buildings = result.elements.filter(el => el.tags?.building);
```

Filtering is fast (microseconds for thousands of elements). Network round-trips are slow (seconds). Always prefer one big query and client-side filter over multiple small queries.

### Tile splitting

Overpass times out on large or dense queries. We split the OSM radius into 1km × 1km tiles. **Tiles are fetched strictly serially**, one at a time, through the global `overpassQueue` (see data-layer.md). Not 4 in parallel. Not 2. **One.**

If a tile returns 504 Gateway Timeout, split *that tile* into four 500m × 500m sub-tiles and retry as four serial queries. Do not retry the same query — the answer will be the same.

The `Cache` module deduplicates and persists across page reloads. Verify caching by reloading and checking that no new Overpass requests are made for an already-loaded location.

### Why this changed

Earlier drafts of this doc said "rate-limited to 4 concurrent — Overpass etiquette." That was wrong and produced a rate-limit storm during Phase 2 testing. The corrected rule is **1 concurrent, ever**, with mandatory backoff on 429. See [`data-layer.md`](./data-layer.md) for the full etiquette specification.


---

## LOD strategy

Three concentric zones around the camera, defined per preset in `DATA-CONTRACTS.md`:

### Near zone (0 → `preset.lod.near`)

- **Ground cover:** full polygon detail with subtle texture variation per type.
- **Buildings:** full detail. Each building is its own extruded polygon. Roof height from `height` tag, fallback to `building:levels * 3`, fallback to type-based default (see table below).
- **Trees:** individual `natural=tree` points become tree billboards (two crossed textured planes).
- **Forests:** dense scatter of tree instances at ~200 trees/hectare for `landuse=forest`, lower for scrub/grass.

### Mid zone (near → mid)

- **Ground cover:** full polygon detail, flat colours (no texture variation needed at distance).
- **Buildings:** Phase 2 ships uniform-detail extrusions merged by LOD bucket — same geometry as the near zone, just batched into a separate merged mesh. Convex-hull simplification at mid distance is deferred to a Phase 3 perf pass; it's a future optimization, not a Phase 2 blocker.
- **Trees:** sparser scatter (~50/hectare), instanced billboards only.

### Far zone (mid → far)

- **Ground cover:** simplified polygons (Douglas–Peucker decimation), still coloured correctly.
- **Buildings:** only the `landmarks` query results render. Everything else dropped.
- **Trees:** none individually. Forests rely on the ground-cover green colour alone.

### Beyond far zone

Pure terrain + sky. At sunset, distant detail is silhouette anyway, so users won't notice missing detail at 10 km.

---

## Ground cover generation (Phase 1.5)

Ground cover is a flat overlay on the terrain mesh, slightly offset upward (~10cm) to avoid Z-fighting. Each OSM polygon becomes a triangulated mesh with a single colour per type.

### Colour palette

The colour map lives in `src/config.js` as `GROUND_COVER_COLOURS`. Initial values (RGB hex, tuned for sunset lighting — they look slightly washed-out at noon, correct at golden hour):

| OSM tag                          | Colour    | Notes                                  |
| -------------------------------- | --------- | -------------------------------------- |
| `natural=water`                  | `#3b6ea5` | Lake, sea, pond                        |
| `waterway=riverbank`             | `#3b6ea5` | River surface                          |
| `natural=beach`, `natural=sand`  | `#e8d8a8` | Sandy coast, dunes                     |
| `natural=bare_rock`              | `#9a8b7a` | Exposed rock                           |
| `natural=scree`                  | `#a89a88` | Scree slope, looser than bare rock     |
| `natural=glacier`                | `#e8eef2` | Ice                                    |
| `natural=wood`, `landuse=forest` | `#3a5538` | Dark forest green (3D trees in P3)     |
| `natural=grassland`              | `#7a9050` | Wild grassland                         |
| `natural=heath`                  | `#8a7a5a` | Moorland, heath                        |
| `natural=wetland`                | `#5a7868` | Swamp, marsh                           |
| `landuse=grass`                  | `#8aa55a` | Manicured grass, parks                 |
| `landuse=meadow`                 | `#9ab050` | Meadow                                 |
| `landuse=farmland`               | `#c5b078` | Cropland (varies seasonally)           |
| `landuse=orchard`                | `#7a8a48` | Orchards                               |
| `landuse=vineyard`               | `#8a6850` | Vineyards (purple-brown)               |
| `landuse=residential`            | `#b0a89a` | Light grey-brown                       |
| `landuse=commercial`             | `#a8a098` | Slightly cooler grey                   |
| `landuse=industrial`             | `#909088` | Cooler darker grey                     |
| `landuse=cemetery`               | `#6a7050` | Dark muted green                       |
| `landuse=brownfield`             | `#7a6a55` | Disturbed/abandoned ground             |
| `leisure=park`, `leisure=garden` | `#8aa55a` | Same as grass                          |
| `leisure=pitch`, `leisure=golf_course` | `#7aa550` | Sport surface                    |

These are starting values. Expect to tune. `src/config.js` is the single source of truth — never hardcode colours in the builder.

### Build pipeline

```
GroundCoverBuilder.build(location, preset)
  ├─ 1. fetch ground-cover polygons via OSMFetcher
  ├─ 2. for each polygon:
  │      ├─ pick its colour by tag priority (more-specific tags win)
  │      ├─ project lat/lon vertices to local XZ
  │      ├─ triangulate (earcut, handles holes)
  │      ├─ for each vertex: sample HeightSampler.getHeightAt() and lift by 0.1 m
  │      └─ append into a per-colour BufferGeometry
  ├─ 3. merge all polygons of the same colour into one BufferGeometry
  ├─ 4. one Mesh per colour with MeshBasicMaterial({ color, vertexColors: false })
  └─ 5. group all colour-meshes into 'groundCover' THREE.Group
```

### Tag priority

OSM polygons can have multiple tags (`natural=wood` + `leaf_type=needleleaved`, or layered `landuse=forest` inside `boundary=national_park`). Resolve in this order:

1. `natural=*` wins over `landuse=*` (more specific physical reality)
2. `waterway=riverbank` and `natural=water` are equivalent — water is water
3. `leisure=*` wins over `landuse=*` (a park inside residential land is a park)
4. If multiple polygons overlap, draw order = polygon area descending (smaller polygons render on top)

### Z-fighting prevention

Ground cover sits at terrain height + 0.1 m. This is enough to win the depth test reliably. For very steep terrain (alpine), the offset may need to follow the terrain normal rather than pure Y — note for Phase 5 polish.

Alternative considered: render ground cover *as part of* the terrain mesh by computing per-vertex colours during terrain build. Rejected because it tightly couples Terrain and OSM modules — ground cover should be replaceable without rebuilding terrain.

### Polygon overlap and donuts

OSM polygons frequently have inner rings (a lake with an island, a forest with a clearing). `earcut` handles holes if you pass them as flat coordinate arrays with hole indices. Self-intersecting polygons (broken OSM data) should be wrapped in try/catch and skipped with a console warning.

### Texture variation (optional, near zone only)

For Phase 1.5 we use flat colours per material type — no textures. This is deliberately simple and looks clean at any distance.

If textures are added later (Phase 5 polish):
- One small repeating texture per material type (sand grain, grass blades, asphalt)
- Triplanar mapping to avoid UV stretching on slopes
- Fade to flat colour at mid distance — texture detail invisible past ~500 m anyway

---

## Building height heuristic

Order of precedence:

```js
function buildingHeight(tags) {
  if (tags.height) return parseFloat(tags.height);
  if (tags['building:levels']) return parseFloat(tags['building:levels']) * 3;
  return DEFAULT_HEIGHTS_BY_TYPE[tags.building] ?? 8;
}

const DEFAULT_HEIGHTS_BY_TYPE = {
  'house':         6,
  'residential':  10,
  'apartments':   15,
  'commercial':   12,
  'industrial':    8,
  'church':       20,    // includes spire approximation
  'cathedral':    35,
  'tower':        40,
  'skyscraper':   80,
  // ... etc
};
```

These are heuristics — Phase 3 polish would refine them and add roof types (`roof:shape`, `roof:height`).

---

## Building geometry generation

For each building's polygon (a closed `LineString`):

1. Project lat/lon vertices to local XZ via `TileMath`.
2. Sample ground height at each vertex (`HeightSampler.getHeightAt`).
3. Use the *minimum* ground height across vertices as the building's base — buildings sit on graded ground, not floating.
4. Triangulate the polygon (use `THREE.ShapeGeometry` or earcut for non-convex).
5. Extrude upward by `buildingHeight - 0`.
6. Generate side wall faces.
7. Generate a flat roof (or sloped if `roof:shape` is set, Phase 3).

Mid-LOD building simplification (e.g. bounding-box single extrusions instead of triangulated footprints) is a Phase 3 perf pass — Phase 2 uses the full triangulated path for both near and mid buckets.

---

## Vegetation generation (Phase 3)

For each forest polygon:

1. Compute polygon area in m².
2. Determine target tree count: `area * density`. Density depends on the tag:
   - `landuse=forest`: 200/ha
   - `natural=wood`: 150/ha
   - `natural=scrub`: 50/ha
   - `landuse=grass`: 0 (just a textured ground patch)
3. Use Poisson-disk sampling within the polygon for natural-looking tree placement.
4. For each sample point: sample ground height, place an instanced tree billboard at that location.

We use `THREE.InstancedMesh` for trees — one geometry, thousands of instances, single draw call. Critical for performance.

### Tree billboards

Each "tree" is two crossed planes with an alpha-mapped texture. At sunset, trees are mostly silhouette so this looks fine.

Texture variants:

- Conifer
- Broadleaf
- Mediterranean
- Tropical (Phase 5)

Variant chosen by climate zone — initially just by latitude band; Phase 5 could read OSM `leaf_type` tags.

---

## Coordinate sanity

Everything in the OSM module operates in local Three.js XZ coordinates after the initial lat/lon → local conversion. No mixing. The boundary is clear:

- `OSMFetcher.fetch()` returns lat/lon vertices.
- `GroundCoverBuilder.build()`, `BuildingsBuilder.build()`, and `VegetationBuilder.build()` immediately convert to local on entry, then never look at lat/lon again.

---

## What this module does NOT do

- Doesn't modify terrain. Reads heights, never writes.
- Doesn't compute lighting. Materials are set up to receive Sky's directional light.
- Doesn't handle interior detail, windows, or doors. Sunset is silhouette-dominated; we save the cycles for atmosphere.
- Doesn't render roads or paths (out of scope; user is standing on terrain, not driving). May reconsider in Phase 5 if path networks turn out to matter for recognisability.
- Doesn't simulate water reflections — Phase 5 will add that. Phase 1.5 ground cover renders water as a flat opaque blue polygon.

---

## How to extend

### Tune ground cover colours

Single source of truth: `GROUND_COVER_COLOURS` in `src/config.js`. Iterate by:
1. Render a known location at golden hour and sunset.
2. Compare with reference photographs.
3. Adjust colours and reload — no code changes needed.

Tip: avoid pure saturated colours. Real-world surfaces are desaturated and slightly noisy. The provided palette starts at the right saturation level — don't push it.

### Add new ground cover types

1. Add the OSM tag to the Overpass query in `OSMFetcher.js`.
2. Add the colour to `GROUND_COVER_COLOURS` in `config.js`.
3. Update tag priority resolver in `GroundCoverBuilder.js` if needed.

### Seasonal ground colours

Driven by date, not implemented in Phase 1.5 but the hook is there. Farmland could be `#c5b078` (summer) → `#9aa050` (spring) → `#a89060` (autumn) → `#d8d8d8` (winter snow). Phase 5 polish.

### Add roof shapes (buildings)

Phase 3+. Read `roof:shape` (`flat`, `gabled`, `hipped`, `pyramidal`, `dome`). Each becomes a small post-extrusion geometry generator.

### Add windows / doors

Phase 5 polish. UV-map building walls and apply a tileable window texture, alpha-masked. Looks fine at distance, breaks down close-up.

### Improve building colours

Currently buildings are uniform light grey. Could be:
- By region (Mediterranean → ochre, Northern Europe → red brick).
- By `building:material` tag if present.
- By `roof:colour` for roofs.

### Add support for tunnels / bridges / fences

Map types: `tunnel=yes` (skip rendering), `bridge=yes` (extrude road segment as a thin slab), `barrier=fence` (extrude as line). Mostly invisible at sunset distance — low priority.

### Self-hosted Overpass

For development and any production deployment, see `docs/modules/data-layer.md` "Local Overpass via Docker" — full setup, wiring, verification.

---

## Diagnostic — "Buildings (or other features) don't appear"

Phase 2 testing surfaced this scenario: ground cover renders fine, terrain renders fine, but no buildings are visible anywhere in any direction at any time of day. Here's a focused checklist to distinguish the possible causes.

### Step 1 — Did the OSM data actually arrive?

Open DevTools → Application tab → IndexedDB → expand `panorama-cache` (or whatever name `Cache.js` uses) → look for `osm:tile:` entries.

- **No `osm:tile:*` entries at all.** Tiles failed to download. Check the Network tab for Overpass errors. Most likely: rate-limited, mirror unreachable. Fix the network problem first; building rendering is a downstream concern.
- **Some entries, but with size 0 or very small (<1 KB).** Empty tiles or error responses got cached. This is a Cache module bug — it's caching failures as successes. The cache writer must inspect response status and skip caching on non-200.
- **Entries present with reasonable sizes (>50 KB for urban tiles).** Data downloaded. The bug is downstream — proceed to Step 2.

### Step 2 — Does the data contain buildings?

Pick one of the cached tile entries in IndexedDB, double-click to view its contents. The decompressed JSON should contain an `elements` array. Search inside it for `"building"`:

- **Hits found, e.g. `"building": "yes"` or `"building": "apartments"`.** Building data is in the tile. Bug is in the BuildingsBuilder filter or rendering — proceed to Step 3.
- **No hits.** Either the Overpass query didn't request buildings (check it includes `way["building"](s,w,n,e);`), or the chosen test location genuinely has no buildings (try Rome center to be sure).

### Step 3 — Is BuildingsBuilder filtering correctly?

Add a one-time debug log at the start of `BuildingsBuilder.build()`:

```js
const buildings = result.elements.filter(el => el.tags?.building);
console.log(`[BuildingsBuilder] tile has ${result.elements.length} elements, ${buildings.length} buildings`);
```

- **`0 buildings` despite Step 2 finding them.** Filter mismatch. Check whether `el.tags.building` exists on every element or whether tags are nested differently (some Overpass responses put tags under `el.properties.tags` or similar). The exact path depends on the Overpass output format — `out geom;` returns `el.tags`, but other modes differ.
- **N buildings reported, but nothing rendered.** Filter works. The bug is in geometry generation or scene attachment — proceed to Step 4.

### Step 4 — Are buildings being created but not added to the scene?

After `BuildingsBuilder.build()` returns, log the resulting group:

```js
const group = await BuildingsBuilder.build(...);
console.log(`[BuildingsBuilder] returning group with ${group.children.length} children`);
```

- **`0 children`.** Buildings are filtered correctly but the polygon-to-mesh code is dropping them. Common causes: every polygon failing triangulation (wrap in try/catch and log the failure), or every building having `buildingHeight === 0` and being culled.
- **N children but invisible in scene.** The group isn't attached to the scene. SceneManager's rebuild flow adds the group to `scene` — verify with `scene.getObjectByName('osmFeatures')` in the console.

### Step 5 — Is the camera looking at them?

Sanity check after all the above: open the DebugOverlay, look at camera position vs walk anchor. If you've walked far from the chosen location, your visible area might genuinely have no buildings. Click "↺ Reset position" and check from the chosen point.

### Same checklist applies to ground cover, vegetation, landmarks

The same five-step protocol diagnoses missing OSM features of any type. Adapt the tag filter in Step 3 (`el.tags?.natural`, `el.tags?.landuse`, etc.).

---

## Common pitfalls

- **Overpass timeouts.** Default timeout 25s. Dense urban tiles (Manhattan, central Tokyo) may need 60s or smaller tile splits. Ground-cover queries are the heaviest of the three because polygons are big and numerous.
- **Polygons with holes.** OSM relations can be multi-polygons with inner rings (a lake with an island, a forest with a clearing). `earcut` handles these if you pass holes as flat coordinate arrays with hole indices. Failing to handle holes shows up as a lake covering its own island.
- **Self-intersecting polygons.** Some OSM data is broken. Wrap triangulation in try/catch and skip bad polygons rather than crashing the whole build. Log to console for OSM contributors to fix upstream.
- **Z-fighting on ground cover.** Without the +0.1m offset, ground cover flickers against terrain. With too much offset (>1m), it floats visibly on slopes. 0.1m is a good default; consider following terrain normal on steep slopes (Phase 5).
- **Overlapping ground cover polygons.** OSM doesn't guarantee non-overlap. A `landuse=residential` polygon may contain a `leisure=park` polygon — both cover the same ground. Render order matters: smaller polygons last (drawn on top). Implement via sort by area descending before mesh assembly.
- **Memory blow-up at scale.** Even instanced, 1M trees is too many. Cap forest tree counts at ~100k total per scene; for very large forests, increase Poisson radius rather than densify further.
- **Z-fighting on building bases.** If the building base is at exactly the terrain height, faces flicker. Always inset by 5cm into the ground.
- **`out geom;` payload size.** Can be 50+ MB for dense urban tiles, especially with ground cover included. Stream-parse where possible; the `Cache` module should compress.
- **Sunset washes out ground colours.** Colours that look right at noon look orange-tinted at sunset (correct — that's the directional light). Tune palette under sunset light, not noon light.

---

## Tests worth writing

- Building height heuristic: known tags → expected height.
- Polygon triangulation handles holes correctly.
- Tag priority resolver: a polygon with both `natural=water` and `landuse=residential` resolves to water.
- Ground cover Z offset: vertices are exactly 0.1m above terrain at known sample points.
- Instanced mesh count == sum of expected trees from forest polygons.
- LODManager picks correct builder for given distance.
