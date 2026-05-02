# Foreground rendering — diagnosis

**Symptom.** Live preview with a location selected shows a soft
greyish-mauve gradient band in the bottom 30–40 % of the canvas,
between the terrain silhouette and the canvas bottom edge.

**Status.** Diagnostic only — no code changes. Implementation pending
user direction on options below.

## What the bisection found

`scripts/foreground-rendering-probe.js` synthesises a WebGL-canvas-like
source (sky in the upper 39 %, a dark silhouette band, and a flat-brown
foreground trapezoid representing the camera's enclosing mesh triangle),
runs `renderUnderpainting` for Chamonix at `radius=2000 m` (the
suburban preset), and counts pixels written into the bottom 30 % strip
across pass-disabled variants. Two phases — `goldenHour` and
`civilTwilight` — to confirm the "greyish-mauve" colour signature.

```
chamonix-civilTwilight (radius 2000 m, sun=civilTwilight alt=-2°)
                       polygons: { farmland: 59, forest: 39, water: 35, urban: 9 }

  variant            bottom-30% pixel writes              avgΔR  avgΔG  avgΔB
  ------------------ ------------------------------       -----  -----  -----
  source-only             0/ 48960  (0.0%)                    0      0      0
  no-paintGround      44022/ 48960  (89.0%)                  -3   4.93  16.25
  no-paintCanopy      44022/ 48960  (89.0%)                  -3   4.93  16.25
  no-haze             49440/ 48960 (100.0%)               -74.7  -6.28  29.79
  no-bloom            49440/ 48960 (100.0%)              -68.74  -1.19  40.05
  no-grain            49440/ 48960 (100.0%)              -68.74  -1.20  40.05
  no-paintWater       49440/ 48960 (100.0%)              -68.74  -1.19  40.05
  no-median           49440/ 48960 (100.0%)              -68.73  -1.18  40.05
  no-atmospherics     49440/ 48960 (100.0%)              -73.84  -5.29  29.78
  full                49440/ 48960 (100.0%)              -68.74  -1.19  40.05
```

Reading: the brown source #7f4c1a (127, 76, 26) ends up as ~(58, 75, 66)
post-pipeline — a desaturated cool/mauve-grey tone. That matches the
user's "greyish-mauve" description (mauve = the civil-twilight haze
tint `[125, 130, 175]` shifted onto the brown source).

The pass-disabled rows say two things:

1. `no-paintGround` removes ~11 % of the foreground writes. So
   `paintGround` *is* projecting some polygons onto the bottom-30 %
   strip — a few forest / farmland polygons close enough to project
   below the horizon — but it covers nowhere near all of it. The
   remaining ~89 % of the strip is either the source (the mesh's
   near-camera triangle) or atmospherics on top of the source.

2. `no-haze`, `no-bloom`, `no-grain`, `no-atmospherics` all still
   write 100 % of the strip, but the colour balance shifts. Disabling
   `haze` brings ΔB down from +40 to +30 — i.e. haze is responsible
   for ~10 units of the blue/mauve push. Disabling all atmospherics
   does the same, plus removes a small additional grain contribution.
   Median blur and the other painters don't move the needle on the
   foreground.

So the "soft greyish-mauve gradient band" is the combination of three
things, in this order of contribution:

1. **The mesh's near-camera triangle.** With
   `TERRAIN_MESH_SEGMENTS = 512` and `PHASE1_TERRAIN_CAP_M = 15 000 m`,
   the terrain `PlaneGeometry` has 30 km × 30 km extent and ~58.6 m
   vertex spacing. The camera sits inside one ~58.6 m × 58.6 m
   triangle pair; everything from ~4 m (the bottom of the canvas at
   `−5°` tilt + 1.7 m eye height) out to ~29 m (the nearest mesh edge)
   renders inside that one triangle. Bilinear interpolation of the
   four corner vertices' elevation-coloured Y values produces a
   geometrically uniform trapezoid: same colour, no detail, no edges
   for the gradient field to find.
2. **`paintGround` partially fills the bottom strip.** A handful of
   forest / farmland polygons project into the bottom 30 % (because
   they're large enough to extend across the camera's azimuth at the
   current radius), but most of the strip falls in the gap between
   the polygon outlines.
3. **`applyHaze` paints across the whole below-horizon strip** with
   the phase-tinted gradient. At `civilTwilight` the tint is
   `[125, 130, 175]` — mauve. Cosine-falloff alpha peaks at the
   horizon (where the polygons cluster) and tapers toward the canvas
   bottom. *Where polygons cover, the haze sits on top of the painted
   colour and reads as atmospheric perspective. Where polygons don't
   cover, the haze sits on top of the geometrically-uniform mesh
   triangle and reads as a flat tinted band.*

The user's hypothesis was approximately right — *terrain doesn't reach
close enough to the camera* — with a refinement: the mesh **does**
geometrically reach the camera (it's a continuous plane centred on the
viewer), but it has only **one large triangle pair** of detail in the
near-camera region, so it renders as a flat-coloured trapezoid. The
haze pass then tints that trapezoid uniformly. The "band" the user is
seeing is the haze pass doing its job over a foreground that lacks the
detail variation that haze is *meant* to act on.

## Options

### (a) Mask haze to rendered-terrain region only

Detect where the source canvas has terrain content — either by colour
(non-sky pixels) or by mask (where the painters have written) — and
only haze those pixels, leaving the geometrically-uniform mesh strip
untouched.

- **Cost.** Small. One-pass canvas inspection in `applyHaze`, gated by
  a luminance / hue heuristic. Or: thread a "painted-mask" buffer from
  `paintGround` / `paintCanopy` through to atmospherics.
- **What it fixes.** Removes the visible haze band.
- **What it doesn't fix.** The foreground is still a geometrically
  uniform brown trapezoid. The pointillism stroke pass downstream
  reads gradient magnitude from `srcData`; with no edges in the
  foreground, strokes go in random directions there, which produces
  the same flat-foreground problem at the painted output, just without
  the mauve tint.
- **Symptom-mask risk.** High. The brief explicitly warned against
  this pattern on the last fix.

### (b) Extend terrain mesh to reach the camera with finer triangulation

Add geometric detail to the terrain mesh in the camera's first few
hundred metres. Two shapes this could take:

- *Inner concentric mesh.* Keep the existing 512-segment outer mesh
  (15 km radius, 58.6 m spacing). Add a smaller inner `PlaneGeometry`
  covering, say, the first 500 m around the camera at 128–256
  segments — vertex spacing 2–4 m. The camera's enclosing region
  becomes hundreds of triangles instead of one, with real elevation
  variation from the same heightmap.
- *Variable-density mesh.* Build the existing PlaneGeometry but
  subdivide the central N×N quads into finer triangles before
  uploading. Same data, denser sampling near the centre.

- **Cost.** Medium. New `TerrainBuilder` code path, ~64 k extra
  vertices for a 256-seg inner mesh on top of 263 k for the outer
  mesh — manageable. Touches the 3D scene module; needs a small
  dispose/rebuild cycle alongside the existing mesh.
- **What it fixes.** The underlying geometric problem. The foreground
  shows actual terrain variation; haze acts on a varied surface and
  reads as perspective rather than as a flat band; the painter's
  gradient field has edges to find for stroke direction.
- **What it doesn't fix.** Doesn't add painterly content to the
  foreground (no grass, no stones, no near-camera vegetation).
  That's a separate composition concern.

### (c) Add a foreground enrichment painter

A new painter pass dedicated to the bottom strip: stippled grass,
small soil patches, scattered stones, painterly brush textures.
Treats the foreground as a deliberate painterly composition zone
rather than a geometric extension of the mesh.

- **Cost.** Large. A whole new module, design choices about content,
  density, palette per ground category. Per the project's brief
  granularity discipline this is a Phase-6+ feature, not a fix.
- **What it fixes.** The foreground reads as a *deliberate* painted
  area, with the kind of micro-detail Pointillism can stroke against.
- **What it doesn't fix.** The mesh is still uniform underneath, but
  becomes a substrate for the painter rather than a visible artefact.
- **Risk.** High. The painter has to sit alongside `paintGround` /
  `paintCanopy` without contradicting them, and has no tag-data to
  drive content choices in the near-camera region (the camera's
  enclosing OSM polygon is whatever the camera lat/lon falls in,
  which is a single-tag answer at best).

## Recommendation

**Option (b) — extend the terrain mesh to reach the camera with finer
triangulation, via an inner concentric mesh.**

Reasons:

1. The bug is geometric. The mesh has one triangle pair where it
   should have many. Adding density at the right place fixes the
   actual problem instead of hiding it (a) or working around it (c).
2. Option (a) is the symptom-mask we were warned against. Even
   stripped of the mauve tint, the foreground is still a uniform
   brown trapezoid.
3. Option (c) is too large for what's effectively a meshing issue.
   Painterly enrichment is a real Phase-6+ feature, not a way to
   patch over a Phase-1 mesh.
4. The cost is bounded. An inner 256-segment mesh covering 500 m
   around the camera is ~64 k vertices — a small fraction of the
   existing 263 k-vertex outer mesh. The DEM data is already
   available (HeightSampler reads from the same heightmap regardless
   of mesh resolution), so the inner mesh costs only the geometry
   and a single rebuild path.
5. It's compatible with (a) and (c) later if the user decides to
   layer them on top — fixing the mesh first means any later
   painterly enrichment paints onto a richer substrate.

Open implementation question, to confirm before coding: should the
inner mesh use the same DEM zoom-12 data that the outer mesh does, or
fetch zoom-14 / zoom-15 tiles for the inner ring (genuinely finer
elevation data, at the cost of more tile fetches)? The bisection
diagnosis doesn't need this answered to fix the artefact; the inner
mesh at zoom-12 already produces real triangle variation. Higher-zoom
data is a separate quality knob.

---

## Implementation choices (option (b) confirmed by user)

Two architectural questions answered before code lands:

### Q1: camera-anchored or world-anchored mesh?

**Decision: world-anchored, v1.** The inner mesh is centred at the
chosen location (the same origin the outer mesh is centred at). The
mesh is rebuilt only on `location:changed`, the same trigger the outer
mesh already uses.

Rationale:

- The painter doesn't care either way — it consumes a static Snapshot,
  and by the time the painter runs the camera has stopped moving. This
  question only affects the 3D viewer's walk-mode UX.
- The project's flow is *compose, then paint*. `RESOLUTION-LOG`-style
  pattern from the ROADMAP Decision Log: walk mode is "easel-positioning
  for the chosen scene," not free exploration. Composition typically
  happens within tens of metres of where the user dropped the pin.
- A 500 m inner-mesh radius covers more than three minutes of jogging
  (`JOG_SPEED_MS = 4.0` from `src/config.js`), so for the realistic
  composition-finding session the user never leaves the rich foreground.
- World-anchored is cheaper: no per-frame re-tessellation, no DEM
  resampling, no edge-stitching across moving boundaries. Each location
  change rebuilds both meshes once; everything else is static.
- If users routinely walk past 500 m, *that's* the signal to upgrade to
  camera-anchored. We have no telemetry for that today (the
  `walker:moved` event reports `distanceFromOriginM` to the UI but
  nothing persists it), and the project deliberately doesn't collect
  user telemetry.

The cost of being wrong: foreground degrades to coarse mesh once the
walker passes ~500 m from origin. Acceptable v1; documented in the
walker UI as a known boundary if needed later. The walk-bounds soft
clamp (`_walkBoundRadius`) already kicks in at the outer terrain edge
(~15 km), so the inner-mesh boundary is well within the existing
"you've left composition territory" zone.

### Q2: shared mesh or painter-only mesh?

**Decision: shared mesh.** Both the 3D viewer and the painter consume
the same two-tier mesh.

Rationale:

- ~64 k extra vertices (256-segment inner mesh) on top of the existing
  ~263 k-vertex outer mesh is a small fraction of WebGL's comfortable
  budget for a static scene. Modern hardware draws millions of
  triangles per frame; this is a few hundred thousand and updates only
  on `location:changed`.
- The painter doesn't directly walk mesh triangles — it consumes the
  WebGL snapshot canvas as an image — so painter render time is
  unchanged regardless of mesh density. (The brief's "painter render
  time should be unchanged or barely slower" prediction expected
  triangle iteration that doesn't actually happen; we verified with
  the bisection probe.) The richer 3D foreground produces a richer
  *source canvas*, which is exactly what the painter wants.
- Splitting the meshes means maintaining two builders and two
  HeightSampler conventions for no compelling reason.

Fallback if profiling shows >5 % FPS regression in walk mode: drop
the inner mesh from the 3D viewer and keep it only for the offscreen
painter snapshot path (a `TerrainBuilder.buildPainterMesh()` variant
that the snapshot capture uses). The implementation reserves room for
this — the inner mesh is a separate `Mesh` added to the same `terrain`
group, so disabling it for the live render is a one-line gate on
`mesh.visible`.

### Implementation outline

- `TerrainBuilder.build()` adds a second `PlaneGeometry(1000, 1000,
  256, 256)` (or 128 segments if profiling demands it) rotated to
  the XZ plane, vertex-coloured by the same `elevationColor` ramp,
  and added to the `terrain` group at the world origin. Vertices
  sample `HeightSampler.getHeightAt()` at their lat/lon — same
  source data the outer mesh uses.
- Inner mesh material has `polygonOffset = true` /
  `polygonOffsetFactor = -1` / `polygonOffsetUnits = -1` so it wins
  the depth test against the outer mesh in their shared region.
  No hole-cutting in the outer mesh required.
- `HeightSampler` is unchanged. The inner mesh's vertex sampling at
  ~3.9 m spacing oversamples the DEM (Terrarium tiles at zoom 12 are
  ~30 m per cell in central Europe), so the inner mesh's surface is
  the bilinear-interpolated DEM at finer triangulation — smooth, not
  stepped. Verified visually in the post-implementation probe outputs.
- No DATA-CONTRACTS change: the `viewpoint`, `groundY`, `cameraWorldY`,
  and snapshot fields are unchanged. `HeightSampler` continues to
  return the same Y at any (lat, lon).

Implementing now.
