# Module: Terrain & DEM

**Owner role:** 🏔 Terrain & DEM Engineer
**Phase introduced:** Phase 1
**Files:**
- `src/terrain/TerrainBuilder.js`
- `src/terrain/DEMFetcher.js`
- `src/terrain/HeightSampler.js`

---

## Purpose

Turn elevation data from the network into a Three.js mesh, and answer the question "how high is the ground at this lat/lon?" for everyone else.

---

## Public API

```js
// TerrainBuilder.js — builds the mesh
export async function build(location, radiusMetres) → Promise<THREE.Group>

// HeightSampler.js — singleton, populated after a build
export const HeightSampler = {
  getHeightAt(lat, lon): number,         // metres above sea level
  getHeightAtWorld(x, z): number,        // Three.js world units (metres from origin)
  getMinMax(): {min, max},               // for terrain bounds
  isReady(): boolean,
};
```

The HeightSampler is a singleton because it's queried often (camera, OSM building placement) and rebuilt rarely (only when the location changes).

---

## Data source: AWS Terrain Tiles

Free, global, no auth required. URL pattern:

```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

Each PNG encodes elevation in the RGB channels:

```
height = (R * 256 + G + B / 256) - 32768  // metres
```

Tile zoom 12 gives ~10 m horizontal resolution near the equator. We use zoom 12 for "near" terrain and progressively lower zoom (11, 10, 9) for distant rings to keep the vertex count down.

Documentation: <https://registry.opendata.aws/terrain-tiles/>

---

## Coordinate system

Three.js scene origin = the user's chosen location at sea level.
- **+X** = east
- **+Z** = south
- **+Y** = up

Conversion lat/lon → world is done in `TileMath.js`:

```js
TileMath.lonLatToLocal(lon, lat, originLon, originLat) → {x, z}
```

Internally this uses an equirectangular projection scaled by `cos(originLat)` so 1 unit ≈ 1 metre over the rendered area. This is accurate enough for radii under 200 km — beyond that, sphere curvature matters and we'd need a proper local tangent plane.

---

## Build pipeline

```
build(location, radius)
  ├─ 1. determine tile set
  │      (zoom 12 near, lower zoom far, in concentric rings)
  ├─ 2. fetch tiles in parallel via DEMFetcher
  │      (DEMFetcher uses Cache for hits; misses go to AWS)
  ├─ 3. decode each PNG to a Float32Array of heights
  ├─ 4. stitch tiles into one big heightmap, projected to local XZ
  ├─ 5. build a THREE.PlaneGeometry, displace vertices by heights
  ├─ 6. compute normals, generate texture (terrain tint by elevation)
  ├─ 7. return THREE.Group containing the mesh
  └─ side-effect: populate HeightSampler with the heightmap
```

---

## LOD (level-of-detail)

For a 75 km radius, a uniform 10 m mesh would be 7500×7500 = 56M vertices — unworkable. So we ring it:

| Ring         | Radius     | Tile zoom | Vertex spacing  |
| ------------ | ---------- | --------- | --------------- |
| Inner (hi-D) | 0–2 km     | 13        | ~5 m            |
| Mid          | 2–10 km    | 12        | ~10 m           |
| Outer        | 10–30 km   | 11        | ~20 m           |
| Far          | 30–100 km  | 9–10      | ~80–160 m       |

The transitions are stitched with seam-fixing triangles (mismatched vertex counts on shared edges cause cracks). Three.js doesn't have built-in clipmap support; we roll our own simple version.

For Phase 1, you can skip rings entirely and use a single zoom-12 mesh up to 15 km — it's about 1.5M vertices, still fine on most GPUs.

---

## HeightSampler implementation

After `build` finishes, HeightSampler holds:

```js
{
  origin: {lat, lon},
  bounds: {north, south, east, west},
  resolution: { x: 1024, z: 1024 },     // grid size
  data: Float32Array,                    // heights, row-major
}
```

Lookup uses bilinear interpolation between the four nearest grid points. Out-of-bounds queries return the nearest edge value (saturated, not zero — that would put the camera underground at the boundary).

---

## Terrain material

Phase 1 — simple vertex-coloured material based on elevation:

- Sea level: blue
- 0–500 m: green
- 500–1500 m: brown
- 1500–2500 m: grey
- 2500 m+: white

Phase 5 — replace with proper texture-mapped material using OSM landuse polygons projected onto the terrain. (Owned by OSM Engineer in Phase 5; we provide the mesh and UVs.)

---

## NOT this module's job

- **Buildings on terrain** — Buildings module asks us for heights via HeightSampler and places themselves. We don't know they exist.
- **Water reflections** — Phase 5, owned by Sky/effects.
- **Time-of-day shading** — Sky's directional light handles this. Our material just needs proper normals.
- **Caching tile data** — Cache module's job. We just call `Cache.get()` and `Cache.set()`.

---

## How to extend

### Switching to Mapbox Terrain-RGB

Two-line change in `DEMFetcher.js`: swap the URL template. Mapbox's encoding is slightly different:

```js
height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
```

Their resolution is better but requires an API token, which means `src/config.js` needs a `mapboxToken` field and the user has to provide it.

### Adding a higher-resolution near-field DEM

For very-near-camera detail (sub-1m), you'd need lidar data, which is regional. Out of scope for now — note in `DECISION-LOG` if pursued.

### Smoother far-distance silhouettes

The horizon line is what carries a sunset photo. If far terrain looks pixelated:

1. Lower the far ring's vertex spacing (more vertices, slower).
2. Apply a slight gaussian smoothing to far-ring heights.
3. Add atmospheric haze (Sky module's job, but you'll be the one asking for it).

---

## Common pitfalls

- **Tile pole problem.** Slippy-map tiles distort near the poles. Above latitude 85° things go weird. Document this limit; Panorama just refuses locations above ±85°.
- **Coastline accuracy.** AWS Terrain Tiles aren't great at coastlines — they sometimes show ocean as slightly negative heights. Clamp to zero for visual smoothness.
- **CORS.** AWS Terrain Tiles serve `Access-Control-Allow-Origin: *`, so we're fine. If you swap providers, check.
- **Memory.** A 1024×1024 Float32Array is 4 MB. Three rings = 12 MB just for heights. Don't keep the full PNG in memory after decoding.

---

## Tests worth writing

- Bilinear interpolation correctness (sample known heightmap).
- TileMath round-trip: `localToLonLat(lonLatToLocal(lon, lat))` ≈ `{lon, lat}` to 5 decimal places within reasonable radius.
- Edge clamping: out-of-bounds queries don't return NaN or zero.
