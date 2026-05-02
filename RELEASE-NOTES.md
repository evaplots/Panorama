# Panorama — release notes

## fix — Two-tier terrain mesh, finer triangulation in the foreground (2026-05-02)

The live preview at any selected location used to show a soft tinted
gradient band in the bottom 30–40 % of the canvas, between the terrain
silhouette and the canvas bottom edge. At civil twilight the band read
as "greyish-mauve"; at golden hour as warm peach over olive-green —
same artefact, different phase tint. The bisection probe in
`.iterations/2026-05-02-foreground-rendering/` (added in the prior
investigation PR) traced it to a meshing issue: the terrain mesh has
512 segments over a 30 km × 30 km extent (~58.6 m vertex spacing), and
the camera sits inside one ~58.6 m × 58.6 m triangle pair. Everything
from canvas-bottom (~3.5 m at default −5° tilt) out to the nearest
mesh edge (~29 m) renders inside that one triangle as a flat-coloured
trapezoid. The painter pipeline projects most OSM polygons to thin
slivers at the horizon (because they're flat ground at distance), so
the foreground gets little painter content. Haze tints the resulting
geometrically-uniform foreground uniformly. The "soft gradient band" is
the haze pass doing its job over a foreground that lacks the detail
variation it's meant to act on.

### Root cause

`TerrainBuilder` builds a single `PlaneGeometry` covering the full
clamped radius (15 km cap) at a fixed segment count (512). At any
realistic eye height + downward tilt, the foreground falls inside the
single near-camera triangle pair — the mesh is geometrically uniform
where the rendered scene needs the most detail.

### Fix

Two-tier terrain mesh. Both tiers share the existing DEM heightmap and
the existing `HeightSampler` so the surface stays continuous across
the boundary.

1. **Outer mesh.** Unchanged: 30 km × 30 km, 512 segments, ~263 k
   vertices, ~58.6 m spacing. Covers the visible vista from the inner
   boundary out to the horizon.
2. **Inner concentric mesh.** New: 1 km × 1 km centred on the chosen
   location, 256 segments, ~66 k vertices, ~3.9 m spacing. Covers the
   first ~500 m around the camera (the half-side; corners reach ~707 m).
   World-anchored — built once per `location:changed`, same trigger
   the outer mesh uses. Material uses `polygonOffset` so it wins the
   depth test against the outer mesh in the overlapping region without
   needing to cut a hole in the outer mesh; both tiers sample the same
   heightmap so the surface itself is continuous.

Total: ~329 k vertices, ~655 k triangles. +25 % on the outer-mesh
vertex count, well within WebGL's static-scene budget.

### Architectural choices, recorded for the next reader

- **World-anchored, not camera-anchored.** The painter consumes a
  static Snapshot and doesn't care; the question is only about
  walk-mode UX. The project's flow is *compose, then paint*; users
  rarely walk past the inner-mesh boundary. World-anchored is cheaper
  (no per-frame re-tessellation, no edge-stitching across moving
  boundaries) and matches the realistic session length. v1 trade-off:
  walking past ~500 m degrades the foreground back to coarse mesh.
  Documented in DIAGNOSIS.md; ROADMAP Decision Log entry recorded.
- **Shared mesh, not painter-only.** Both the 3D viewer and the
  painter use the two-tier mesh. The painter doesn't directly walk
  triangles (it consumes the WebGL snapshot canvas as an image), so
  painter render time is unchanged regardless of mesh density. The
  3D viewer FPS regression is bounded by the +25 % vertex count on a
  static scene (expected < 5 %). Fallback path if profiling later
  shows regression: gate `mesh.visible` on the inner tier in the live
  render and keep it on in the offscreen painter snapshot capture
  path. Reserved for v2 if needed.

### Probes

`scripts/terrain-mesh-density-probe.js` — structural sanity check that
the inner tier lands within the 80 k-vertex budget and ≤ 5 m spacing:

```
outer: 30000m × 30000m, 512 segs → 263169 verts, 524288 tris, spacing 58.6m
inner:  1000m × 1000m, 256 segs →  66049 verts, 131072 tris, spacing  3.9m
combined: 329218 verts, 655360 tris
inner overhead: +66049 verts (+25.1% on outer)
PASS
```

`scripts/foreground-rendering-probe.js` — pre-existing bisection probe.
Outputs are byte-identical pre/post the mesh change: the painter
pipeline doesn't touch mesh triangles, only the WebGL snapshot
canvas, so synthetic-source probes stay deterministic. Real-app
verification (richer foreground in the live preview) is a manual
browser test — the painter probes can't see the mesh because they
run against a synthesised WebGL-like source.

`scripts/water-determinism-probe.js` and `scripts/water-perf-probe.js
sun` and `scripts/atmospheric-perf-probe.js haze` — all PASS post-fix.

### Manual verification checklist

`npm run dev` and visit four scenes:

- [ ] **Chamonix** at default time. Foreground (bottom 30 %) shows
      recognisable ground texture (canopy stippling where forest exists,
      ground-polygon colours where they exist, terrain shading where
      neither does) — not a flat tinted gradient.
- [ ] **Saarland** (the original bug-reveal scene, 49.41097, 7.12606,
      bearing 270°). Same check.
- [ ] **Mediterranean coast** (e.g. 43.6, 7.2 looking south). Water
      polygons should now have real foreground area to fill, not just
      the thin sliver at the horizon they had before.
- [ ] **Yosemite** (e.g. 37.7459, −119.5332). No OSM ground polygons
      available at most US locations; foreground should read as bare
      painterly terrain (DEM elevation gradient + lighting), not as the
      haze-mauve band.
- [ ] **Walk-mode at Chamonix:** walk forward 100 m. Inner mesh is
      world-anchored so it stays centred on the original location;
      verify the foreground remains rich at the new position (still
      well inside the 500 m boundary). Walking >500 m in any direction
      degrades back to coarse mesh — expected, documented.
- [ ] **3D-viewer FPS** at default Chamonix (DevTools performance):
      regression < 5 % vs. main.

### Files changed

```
src/terrain/TerrainBuilder.js               extract buildMeshTier helper, add inner mesh
src/config.js                               +TERRAIN_INNER_MESH_RADIUS_M, +TERRAIN_INNER_MESH_SEGMENTS
RELEASE-NOTES.md                            this entry
ROADMAP.md                                  Decision Log entry recording the architectural choice
scripts/terrain-mesh-density-probe.js       new — vertex / spacing structural sanity check
.iterations/2026-05-02-foreground-rendering/DIAGNOSIS.md   updated with Q1 / Q2 answers
```

State schema unchanged. DATA-CONTRACTS unchanged (the mesh exposes no
new fields to the painter). No new dependencies.

## V2 — Atmospheric depth (released 2026-05-01)

Three painterly post-passes that turn the painting from "diagram" into
"scene": distance-based haze, soft sun bloom, ambient grain + global
colour grading. They share an architectural slot at the end of the
underpainting and tune together — haze without bloom looks sterile,
bloom without haze looks pasted-on, grain without either reads as noise.
Combined PR per the brief's "right granularity" guidance.

Phase 5 polish per ROADMAP.md (three items at once: "Atmospheric haze
with distance," "Bloom on the sun disk," "Subtle film grain / colour
grading"). Lives entirely inside the painter pipeline — no 3D scene
changes — and plugs in after `paintGround → waterPainter → canopyPainter
→ landmarkPainter → median blur` in `src/style/underpainting.js`.

### Highlights

- **`src/style/atmosphericPasses.js` (new)** — three named passes plus
  an `applyAtmospherics` orchestrator that composes them in order
  (haze → bloom → grain). Order matters: haze before bloom (so the
  bloom isn't hazed); grain last (so it reads as physical paper texture
  rather than blurred noise).
  1. `applyHaze(ctx, projectionCtx, sun, opts)` — per-pixel typed-array
     pass over the below-horizon strip; cosine-shaped depth curve peaks
     at the horizon and tapers to zero at the canvas bottom. Sky region
     gets no haze. Sun-phase tint envelope (cool blue-grey at noon,
     warm peach at golden hour, orange / pink at sunset, mauve dusk
     at civil twilight, deep navy at night).
  2. `applySunBloom(ctx, projectionCtx, sun, opts)` — soft radial
     gradient at the projected sun position, additive blend (`lighter`
     composite). Fires only when sun above horizon AND projected
     screen position falls within the canvas bounds (with one
     bloom-radius margin so a sun just outside the frame still lights
     up the edge). Bloom radius scales with physical mm via
     `effectiveDpi` so prints at any DPI carry the same halo size.
     Sun-phase warm tint (warm-white at noon, deep orange at sunset).
     Phase-aware altitude attenuation: low sun = wide diffuse glow,
     high sun = tighter halo.
  3. `applyGrainAndGrade(ctx, sun, opts)` — Mulberry32-seeded paper
     grain at one cell per ~2.1 px (cell size derived from
     `GRAIN_CELL_MM = 0.18 mm` × effectiveDpi); uniform amplitude.
     Grading is a gentle global sun-phase tint envelope applied via
     composite ops — `overlay` for the warm push, `saturation` for the
     desat — fast, native paths.
- **`src/style/underpainting.js` updated** to plug `applyAtmospherics`
  in at the end of the pipeline (after the median-blur softening).
  The `projectionCtx` is hoisted from inside the bindings-gated
  painter block to a top-level local so the haze (horizon Y) and
  bloom (sun projection) passes can use it. When `bindings.viewpoint`
  is missing (early app boot, node-side probes without full snapshot),
  haze falls back to a default horizon at 40% canvas height; bloom
  no-ops without sun data.
- **State schema bumped to v7** with the new `painter.atmospherics`
  block: `{ enabled: true, hazeStrength: 0.5, bloomStrength: 0.4,
  grainAmount: 0.15 }`. Defaults reproduce the engine baseline on
  scenes where the post-passes don't fire (no projection context,
  sun below horizon → bloom no-ops; foreground-dominated scenes →
  haze barely registers); regression-guard path
  `atmosphericsEnabled: false` produces output byte-identical to
  pre-PR (parity hash unchanged at `cf15cf7b…80b39f`).
- **PainterParamsPanel** gains an "Atmosphere" subgroup with one
  toggle ("Atmospherics enabled" — for fast comparison "with vs
  without") + three sliders (Haze, Sun bloom, Grain). Writes to
  `state.painter.atmospherics.*` on `input` events;
  UnderpaintingPreviewPanel picks them up live like every other slider.
- **ControlsPanel** plumbs the four atmospherics knobs through to
  `applyPointillism` opts at the stylize-trigger site.
- **Determinism preserved.** Each painter forks its own Mulberry32
  from the master seed. Atmospherics uses `opts.seed ^ 0x4D_4D_4D_4D`
  (4D for "depth"; matches the canopy/landmark/water XOR-salt
  convention). Same Snapshot in → byte-identical output across two
  paints, verified by hashing perf.png across two runs:
  `83f5b555…ef238d1e` identical.

### Risk-first probes — three pass

`scripts/atmospheric-perf-probe.js` runs all three and exits non-zero
on any failure.

#### 1. Haze depth correctness (alpine vs courtyard)

Alpine vista (1500 m observer, 12 km valley) vs urban courtyard (street
level, 30 m residential polygon foreground). Same haze strength.

| Scene     | Horizon-band sat | Foreground-band sat | Delta  |
| --------- | ---------------: | ------------------: | -----: |
| alpine    |            0.403 |               0.502 | +0.099 |
| courtyard |            0.538 |               0.187 | −0.352 |
| **Differential** | | |        | **+0.451** |

Alpine shows clear horizon-band desaturation (positive delta — far band
hits heavier than foreground); courtyard shows a NEGATIVE delta because
there's no real horizon for the haze to act on. The +0.45 differential
between the two scenes confirms the depth proxy is scene-scale aware.

#### 2. Bloom horizon gate (4 times of day)

Coastal observer with a level-ish camera (elevation=10°, sun azimuth
fixed at 180° = ahead). Verifies bloom fires only when above horizon.

| Time     | Altitude | Phase         | Expected | Observed | Match |
| -------- | -------: | ------------- | -------- | -------- | ----- |
| 6am      |       4° | goldenHour    | YES      | YES      | ✓     |
| noon     |      25° | day           | YES      | YES      | ✓     |
| sunset   |       2° | sunset        | YES      | YES      | ✓     |
| midnight |     −25° | night         | NO       | NO       | ✓     |

#### 3. Perf at A3 @ 300 DPI

Coastal extent scene, expressionist preset, atmospherics enabled at
default sliders.

| Metric                | Value     | Bar             | Verdict |
| --------------------- | --------: | --------------- | ------- |
| Haze ms               |  ~85–150  | < 80 ms target  | ⚠ over  |
| Bloom ms              |       ~2  | < 80 ms target  | ★ PASS  |
| Grain ms              |  ~620–650 | < 80 ms target  | ⚠ over  |
| Atmospherics total    |     ~720  | —               | —       |
| **TOTAL A3 render**   |   24.3 s  | **< 28 s**      | **PASS** |

Total A3 render passes the 28 s user-tolerance bar with ~3.7 s headroom.
The atmospherics overhead is ~720 ms (3% of total render).

**Per-pass overruns surfaced per the brief's escalation path** ("If
grain exceeds budget, surface and propose downsampled grain"). The
80 ms-per-pass target is fundamentally tight for any per-pixel JS write
on a 17.4 MP canvas: a `getImageData + putImageData` round-trip alone
is ~70 ms before any per-pixel work. Three faster alternatives were
tried and discarded (drawImage scale-up + overlay; createPattern +
fillRect with overlay; per-pixel JS without mid-tone weighting) — all
hit the same ceiling because node-canvas's `overlay` composite at
17 MP is itself the bottleneck. The grain pass already uses the brief's
recommended downsampling (cell-based at GRAIN_CELL_MM=0.18 mm — the
noise buffer is ~1/4 the canvas pixel count). Faster grain would
require WebGL fragment shading; out of scope (the painter has been
canvas2D-only since Phase 2.5).

### Solo decisions (surfaced per the brief)

- **Depth proxy = vertical-screen-position relative to projected
  horizon line, NOT a real per-pixel depth buffer.** A real depth
  buffer would require touching `src/terrain/` or threading new
  contract through the snapshot, both forbidden by the brief's
  "stay inside src/style/" rule. The screen-Y proxy is monotonic
  with distance for any flat-ground scene (which the painter
  projection approximates anyway) and produces convincing recession
  in vista scenes — verified by Probe 1.
- **Bloom radius = 18 mm at full strength.** Wider than a 3D engine
  bloom (which is typically 5–10 mm screen equivalent) because the
  painter reads as a painting and a painted sun's halo is a generous
  patch — think Turner's *Norham Castle*, not a digital lens flare.
- **Grain distribution = uniform amplitude (cell-based), NOT
  brightness-modulated.** Paper grain in real prints is uniform; the
  variance is in spatial frequency and texture, not per-pixel
  brightness response. Cell-based downsampling (one ~2.1 px cell per
  noise sample at 300 DPI) keeps grain visible across the dynamic
  range without ever overpowering shadows or highlights.

### What's intentionally deferred

- **Real per-pixel depth buffer.** Currently the haze depth proxy is
  screen-Y-relative-to-horizon. If curation surfaces a scene where the
  proxy fails (looking down a valley with a rising ridge in the middle,
  for example), threading a real depth buffer from the terrain step is
  a one-PR change to the terrain → painter contract — but it touches
  modules outside `src/style/`, so it's a separate PR.
- **Brightness-modulated grain.** Currently uniform. If curation
  surfaces a need for highlights or shadows to grain differently, a
  per-cell luminance attenuation pass can be added inside
  `applyGrainAndGrade` without changing the public surface.
- **WebGL fragment-shader grain.** Would unlock per-pass A3 perf under
  10 ms but requires the painter to leave canvas2D, which is a
  meaningful architectural change.
- **Bloom on the moon at night.** Currently the bloom only fires for
  sun.altitude > 0. A moon-bloom variant could re-use the same
  apparatus once the Astronomy module ships its
  CelestialSnapshot.moon contract.

### Files changed

```
src/style/atmosphericPasses.js           new — haze + bloom + grain/grade passes
src/style/underpainting.js               wire applyAtmospherics; +atmospherics opts
                                         pass-through; hoisted projectionCtx; +timing
src/style/Pointillism.js                 pass-through atmospherics opts; +timing
src/state.js                             +painter.atmospherics block, schema → v7
src/ui/PainterParamsPanel.js             +Atmosphere subgroup (3 sliders, 1 toggle);
                                         refactored makeBoolRow helper
src/ui/UnderpaintingPreviewPanel.js      +atmospherics opts in renderUnderpainting call
src/ui/ControlsPanel.js                  +atmospherics opts in painterParams
scripts/atmospheric-perf-probe.js        new — 3 risk-first probes
scripts/parity-probe.js                  +atmosphericsEnabled:false to keep baseline
DATA-CONTRACTS.md                        v3.12 entry; state-schema doc bump
ARCHITECTURE.md                          painter pipeline diagram updated
ROADMAP.md                               Phase 5 haze/bloom/grain marked done;
                                         four new Decision Log entries
```

---

## V2 — Painterly water reflections (released 2026-05-01)

A four-pass painter for `natural=water` polygons. Water reads as water now,
not as flat blue paint — deep-water base, a sky-sampling band along each
polygon's far edge with cosine falloff, a back-lit sun-glitter streak
that fires only when the sun's geometry says it should, and stippled
horizontal ripple texture. Sun-phase aware tints so the same lake at
golden hour goes warm-orange and at twilight goes mauve.

Phase 5 polish item per ROADMAP.md ("Reflective water for natural=water
polygons (sunset on a lake is dramatic)"). Lives entirely inside the
existing painter pipeline — no 3D scene changes — and plugs in between
`paintGround` and `paintCanopy` in `src/style/underpainting.js`.

### Highlights

- **`src/style/waterPainter.js` (new)** — owns `natural=water` polygons
  end-to-end. Five passes per polygon:
  1. Deep-water fill: polygon's tag colour darkened 35 % (water is darker
     than sky from above, deeper than its surface tone).
  2. Sky-sampling band: a vertical gradient along the polygon's far edge,
     sampling the actual sky pixels just above that edge, with cosine
     falloff over `SKY_BAND_FRACTION × polygon-height`. Strength governed
     by `painter.water.reflectionStrength` (0–1, default 0.6). Source-
     canvas sampling means the band tint tracks the rendered sky's actual
     gradient — not just the sun phase enum.
  3. Sun-glitter streak: stippled warm dabs from the contact point (where
     the sun's azimuth meets the polygon's far edge) running toward the
     camera. Only fires when the sun's screen position projects above the
     polygon's far edge AND the sun is in front of the camera (back-lit
     water) AND the sun is above horizon. Front-lit water (sun behind
     camera) shows no glitter — the brief's design constraint over the
     "some real lakes do, very faint" hint. Per-dab intensity scales with
     sun altitude: golden hour / sunset = 1.0×, soft afternoon = 0.7×,
     high noon = 0.5×, below horizon = 0×.
  4. Ripple texture: thin elongated horizontal dabs (water is flat in
     screen-space) with mm-physical length so prints at any DPI carry the
     same texture. Density governed by `painter.water.rippleDensity`
     (0–1, default 0.4).
  5. Sun-phase tint envelope: same warm/cool/desat pattern groundPainter
     uses, slightly stronger alphas because water is more reflective.
- **`groundPainter` updated** to skip `category==='water'` polygons;
  waterPainter owns them, no double-paint.
- **State schema bumped to v6** with `painter.water` block:
  `{ reflectionStrength: 0.6, sunGlitterEnabled: true, rippleDensity: 0.4 }`.
  Defaults reproduce the engine baseline on water-free scenes — the
  parity-probe SHA-256 hash is unchanged at `cf15cf7b…80b39f`.
- **PainterParamsPanel** gains a "Water" subgroup with two sliders
  (Reflection, Ripple density) and one toggle (Sun glitter). Writes to
  `state.painter.water.*` on `input` events; UnderpaintingPreviewPanel
  picks them up live like every other slider.
- **ControlsPanel** plumbs the three water knobs through to
  `applyPointillism` opts at the stylize-trigger site.
- **Determinism preserved.** waterPainter forks its own Mulberry32 from
  `opts.seed ^ 0x77_77_77_77` (seven for "wet"; matches the
  canopy/landmark XOR-salt convention). Same Snapshot in →
  byte-identical water region out, verified by
  `scripts/water-determinism-probe.js` (identical SHA-256 across two
  paints).

### Risk-first probes — three pass

`scripts/water-perf-probe.js` runs all three and exits non-zero on any
failure.

#### 1. Perf at coastal extents (A3 @ 300 DPI)

Mediterranean cliff observer (80 m above sea), 8 km × 4 km lake polygon
projected to ~10 MP of water on the canvas. v1.4 expressionist preset.

| Metric                     | Value      | Bar           | Verdict |
| -------------------------- | ---------- | ------------- | ------- |
| Water painter (direct cost) | 62 ms     | < 100 ms      | ★ PASS  |
| Glitter dabs               | 117        | —             | —       |
| Ripple dabs                | 312        | —             | —       |
| Underpainting total        | 145 ms     | —             | —       |
| **TOTAL A3 render**        | **27.4 s** | < 28 s        | PASS    |

Gradient + strokes pass takes ~27 s — same range the canopy-landmark
probe sees on identical hardware (forest scene without water: 27.08 s).
The water painter's net cost stays under 1 s end-to-end.

A note on tuning: the ripple-dab `RIPPLE_DENSITY_BASE` constant walked
from 0.45 → 0.30 → 0.20 → 0.10 over the development cycle. The
straightforward 0.45 default put waterPainter at 113 ms (over the
escalation threshold) and pushed the gradient + strokes pass past 28 s
on warm-process runs because each ripple dab raises Scharr gradient
magnitude → longer strokes → more time. Settling at 0.10 (with the
slider's default 0.4 multiplier → ~400 dabs at coastal extents) keeps
the total under budget. Curators who want denser ripples can push the
slider above 0.4 (it goes to 1.0).

#### 2. Sun-direction matrix (4 azimuths × 3 elevations = 12 outputs)

Same lake rendered at sun azimuths {ahead, behind, left, right} crossed
with elevations {30°, 5°, -5°}. Saved as PNGs in
`.iterations/2026-05-01-water-reflections/sun-az<DEG>-alt<DEG>.png`.

| Sun                     | Glitter expected         | Glitter observed  |
| ----------------------- | ------------------------ | ----------------- |
| ahead, alt +30° (noon)  | back-lit, dimmed         | YES (101 dabs)    |
| ahead, alt +5° (golden) | back-lit, strongest      | YES (204 dabs)    |
| ahead, alt -5° (twilight) | sun below horizon → none | no              |
| behind, any altitude    | front-lit → none         | no                |
| left/right, any         | side, glitter unconstrained | no             |

All cases match expected geometry. Front-lit water never lights up;
back-lit water near horizon shows the densest glitter; below-horizon
sun produces no glitter regardless of azimuth.

#### 3. Tint correctness (noon vs sunset, sampled inside the sky band)

Same lake, same observer, two phases. Sampled the canvas just inside
the band (where source-canvas sky pixels and sun-phase-tint envelope
both contribute):

| Phase   | Avg band RGB | Warmth (R−B)  |
| ------- | ------------ | ------------- |
| Noon    | 90, 118, 148 | **−58 (cool)** |
| Sunset  | 145, 92, 95  | **+50 (warm)** |
| **Δ**   |              | **+108**       |

The band tint changes by 108 R−B units between noon and sunset — the
SUN_PHASE_TINT envelope reaches waterPainter and the source-canvas
sampling reflects sky-gradient changes. If both had been identical,
the envelope wasn't wired through; the +108 delta confirms the data
path.

### What's intentionally deferred (per the brief's "v2" callouts)

- **Reflections of land objects** ("a tower next to a lake doesn't
  reflect into it in v1"). The water-as-mirror-surface treatment is
  brief-flagged for v2; this PR puts water before landmarks in the
  pipeline so the order is right when that lands.
- **Animated ripples.** This is a still painting; the ripple texture
  is texture, not motion.
- **Per-water-type colour overrides.** Wetlands, rivers, and lakes all
  share the `category==='water'` mapping today; the painter uses the
  per-tag `GROUND_COVER_COLOURS` lookup so each polygon's base tone is
  faithful to its specific tag. If curation surfaces a need for
  category-specific behaviours (e.g. wetland gets less specular
  reflection because wet meadow ≠ open lake), it lands as a per-category
  branch in waterPainter.
- **Hi-fi browser visual QA.** This PR ships with node-side probes and
  PNG outputs in `.iterations/2026-05-01-water-reflections/`. Browser
  `npm run dev` flow remains the canonical visual-QA gate.

### Files changed

```
src/style/waterPainter.js                 new — water reflection painter
src/style/groundPainter.js                +category==='water' skip
src/style/underpainting.js                wire waterPainter; +water timing fields
src/style/Pointillism.js                  pass-through water opts; +water timing
src/state.js                              +painter.water block, schema → v6
src/ui/PainterParamsPanel.js              +Water subgroup (2 sliders, 1 toggle)
src/ui/UnderpaintingPreviewPanel.js       +water opts in renderUnderpainting
                                          call; +water dab count in stat bar
src/ui/ControlsPanel.js                   +water opts in painterParams
scripts/water-perf-probe.js               new — 3 risk-first probes
scripts/water-determinism-probe.js        new — byte-parity check
DATA-CONTRACTS.md                         v3.11 entry; state-schema doc bump
ARCHITECTURE.md                           painter pipeline diagram updated
ROADMAP.md                                Phase 5 reflective-water marked done;
                                          Phase 2.5 non-goal reworded;
                                          two new Decision Log entries
```

---

## V2 — Live underpainting preview (released 2026-05-01)

Curation infrastructure, not a painter feature. Splits the painter into
two named stages — **underpainting** (paintGround + canopy + landmarks +
optional median-blur softening) and **pointillism** (palette + gradient +
stroke pass) — and adds a live preview panel that renders only the first
stage at sidebar size, so curating with sliders and orbiting the camera
gives sub-50 ms feedback instead of waiting 22 s for a full A3 paint.

The pointillism pipeline is byte-identical to pre-PR. Verified by
`scripts/parity-probe.js`: same fixed snapshot + same seed produces the
exact same SHA-256 PNG hash before and after the refactor.

### Highlights

- **`renderUnderpainting(sourceCanvas, opts)`** in
  `src/style/underpainting.js` — owns the working canvas, paintGround,
  paintCanopy, paintLandmarks, and the optional median-blur softening
  pass. Each painter forks its own Mulberry32 from `opts.seed` (canopy:
  `seed^0xC4_C4_C4_C4`, landmarks: `seed^0x14_14_14_14`) so canopy /
  landmark consumption doesn't shift the stroke-pass `rand` downstream.
  `medianKernel: 'auto'` (the new default) scales `11 × shortEdge / 3508`
  with a floor of 3 (always odd); Pointillism explicitly pins `11` to
  preserve byte parity at A3.
- **`applyPointillism` refactor** — delegates underpainting to
  `renderUnderpainting`, then runs palette / gradient / strokes itself.
  Pure refactor, byte-parity verified.
- **`UnderpaintingPreviewPanel`** — floating overlay anchored
  bottom-right, 480 × 340 (long-edge cap, short scales to maintain export
  aspect ratio). Subscribes to `viewpoint:changed` (debounced 100 ms),
  `painter:changed`, `terrain:changed`, `time:changed`,
  `location:changed`, `sun:changed`, `export:changed`,
  `weather:fetched`, `weatherOverrides:changed`, `scene:ready`.
  Token-counter cancellation: every render bumps a token; older
  in-flight renders discard their result silently. Soften-edges toggle
  (default on). Render-time stat: `<ms> · <dabs> dabs · <marks> mks`.
- **`buildSnapshot()`** in `src/snapshot.js` — single source of truth
  for the StyleBindings shape, used by both the existing "Test
  pointillism" trigger and the new live preview, so they consume
  identical inputs (modulo render dimensions). Replaces the
  in-`ControlsPanel` `buildBindings` helper with a shared module.
- **No new state fields, no DATA-CONTRACTS.md schema bump.** The preview
  is a derived view of existing state; show/hide and soften-edges are
  in-session UI ephemera.

### Performance

A3 landscape, v1.4 expressionist preset, three synthetic perf-probe scenes
at `scripts/preview-speed-probe.js` (480 × 340, 6 samples + warmup):

| Scene  | Median  | Min     | Max     |
| ------ | ------- | ------- | ------- |
| forest | 10.1 ms | 8.6 ms  | 10.4 ms |
| city   | 10.5 ms | 10.2 ms | 16.5 ms |
| combo  | 11.9 ms | 9.6 ms  | 14.3 ms |

10–12 ms median — 20× under the 200 ms pass bar, 8× under the 100 ms
star bar. The auto-kernel scaling cut median-blur cost from ~21 ms
(11×11 at preview size) to ~9 ms (3×3 at preview size).

### Agreement

Preview-vs-full agreement probe (`scripts/preview-agreement-probe.js`):
same Snapshot rendered at 480×340 and at 4961×3508, A3 downsampled to
preview size with bilinear, mean absolute error per channel measured
against the preview render. Result: **MAE 0.18 / channel** (pass bar:
< 14, ~5.5 % of 255). The horizon line and landmark silhouettes are
visible in the preview, matching the downsampled A3 in structure.

### What's intentionally deferred

- **OSM-fetched event** to refresh the preview when an Overpass cache
  warm lands. Brief restricted edits to `src/style/`, `src/ui/`, and
  the new `src/snapshot.js`. Today the preview re-renders on
  `scene:ready` and on every user-driven event; OSM cache landing is
  invisible until the user nudges anything.
- **Sky-gradient and DEM-skyline rendering inside `renderUnderpainting`.**
  STRATEGY-V2 lists these as Stage 1 underpainting steps but they
  don't exist yet (`SkylineCaster.getSkyline()` is unbuilt). Today the
  source canvas comes from the WebGL viewer snapshot — same as pre-PR
  Pointillism. Future PR can replace that with synthesised sky+skyline
  once `SkylineCaster` lands.
- **Persistence of show/hide and soften-edges toggle.** Local toggle
  resets to default on reload by design. Not adding state fields
  unless a need is surfaced.
- **PR #12 canopy-density curation pass.** Stays parked for a
  separate PR — this PR is the infrastructure that makes that curation
  fast.

### Files changed

```
src/snapshot.js                           new — shared StyleBindings builder
src/style/underpainting.js                new — extracted underpainting renderer
src/style/Pointillism.js                  refactor — delegates underpainting
src/ui/UnderpaintingPreviewPanel.js       new — live preview overlay
src/ui/ControlsPanel.js                   uses buildSnapshot, mounts preview
src/ui/styles.css                         overlay + sidebar toggle styles
scripts/parity-probe.js                   new — refactor byte-parity check
scripts/preview-speed-probe.js            new — 480×340 perf probe
scripts/preview-agreement-probe.js        new — preview vs A3 downsampled
ARCHITECTURE.md                           painter pipeline diagram updated
```

---

## V2 — Painterly vegetation + landmarks (released 2026-05-01)

The post-pivot reincarnation of what ROADMAP.md called "Phase 3" — forests
that read as forests and landmarks (towers, churches, monuments, castles,
named tourist attractions) visible at painter scale, all expressed *inside
the painter pipeline* rather than as 3D geometry. The v3.6 chore (2026-05-01)
that deleted the 3D OSM rendering stays deleted; the artistic intent of
Phase 3 lives inside `src/style/`.

### Highlights

- **Two new painter modules.** `src/style/canopyPainter.js` draws stippled
  dark-green dabs over `landuse=forest` and `natural=wood` polygons, with
  per-polygon dab density driven by screen-projected bbox area and
  mm-physical dab radius matching the v1.4 stroke width. `src/style/landmarkPainter.js`
  draws archetypal silhouette marks per category — thin tall stroke for
  towers, taper-and-cross for churches, chunky tapered stone for monuments,
  crenellated keep for castles, slim mark for tourist attractions —
  scaled by the OSM `height` tag (or a per-category default) via the same
  focal-length math the existing pinhole projector uses, so a 50 m tower
  at 800 m and a 100 m tower at 1600 m render at the same pixel size.
- **Five landmark archetypes.** `tower` (`man_made=tower`), `castle`
  (`historic=castle`), `monument` (`historic=monument` + `historic=memorial`),
  `church` (`amenity=place_of_worship` + `building=church|cathedral|chapel|mosque|temple`),
  `attraction` (`tourism=attraction` filtered to entries with a `name` tag).
  Tag mapping documented in DATA-CONTRACTS.md "Landmark category mapping."
- **Plug points.** Both painters run on the working canvas between
  `paintGround` and the median-blur underpainting step, so the median
  softens dab + silhouette edges into the rest of the painting and the
  Pointillism stroke pass downstream samples from the canopy-textured /
  silhouette-marked underpainting.
- **Determinism preserved.** Each painter forks its own Mulberry32 PRNG
  from the master seed (`seed ^ 0xC4_C4_C4_C4` for canopy,
  `seed ^ 0x14_14_14_14` for landmarks), so canopy / landmark consumption
  doesn't shift the stroke-pass `rand`. Verified by re-rendering the same
  source + bindings + seed twice and comparing PNG buffers byte-for-byte.
- **OSM fetch surface extended.** Combined Overpass query gains node
  coverage for `man_made=tower`, `historic=castle|monument|memorial`,
  `amenity=place_of_worship`, and `tourism=attraction`. Per taginfo
  (verified 2026-05-01), 77 % of `man_made=tower` and 68 % of
  `tourism=attraction` are nodes — the way-only query before this PR was
  missing three quarters of the landmark candidates. Two new methods:
  `OSMFetcher.fetchLandmarks(location, preset)` and
  `OSMFetcher.peekLandmarks(location, preset)` — same fetch/peek split
  as the existing ground-cover methods, sharing the combined-query cache
  so calling both for the same `(location, preset)` pair issues no extra
  Overpass round-trips.
- **Snapshot contract.** `GroundSnapshot` gains an optional
  `landmarks: Landmark[]` field where `Landmark` is
  `{category, name, lat, lon, heightM}`. Optional so older snapshots
  without it render without silhouettes (graceful degrade). DATA-CONTRACTS.md
  bumped to v3.10.
- **Performance.** A3 landscape @ 300 DPI v1.4 expressionist preset, three
  synthetic perf-probe scenes (forest / city / combo) at
  `scripts/canopy-landmark-perf-probe.js`. Steady-state totals 22–26 s
  (matching the pre-PR baseline within node-canvas variance); painter
  timings < 60 ms on every run. The painters do not push the budget past
  the 30 s user-tolerance bar.

### What's intentionally deferred (per the brief)

- **Tree species by climate zone (latitude approximation).** Original
  Phase 3 flagged this as polish; deferred. Future PR can plumb a
  per-latitude canopy-palette swap into `canopyPainter`.
- **Seasonal foliage colours by date.** Same — deferred. The current
  canopy palette is the dark-green family `GROUND_COVER_COLOURS` uses
  for forest / wood; a date-driven seasonal palette would extend
  `canopyPainter`'s `CANOPY_GREENS` table.
- **Walker collision with trees.** Not applicable in V2 — there is no
  3D vegetation to collide with. The painter's canopy is rendered into
  the 2D paint, not the 3D scene.
- **A `painter.canopyDabDensity` slider on `PainterParamsPanel`.** Out
  of scope for this PR. The default density is conservative (faint
  speckle); a future curation PR can plumb a slider through after
  browser visual QA confirms the right level.
- **Browser visual QA.** This PR shipped with a node-side perf probe
  and saved A3 PNG outputs in `.iterations/2026-05-01-canopy-landmark-perf/`.
  The user's `npm run dev` browser flow remains the canonical visual-QA
  gate; the probe proves the pipeline works end-to-end with the
  Pointillism path that the browser uses.

### Files changed

```
src/style/canopyPainter.js          new — forest canopy stipple
src/style/landmarkPainter.js        new — landmark silhouettes
src/osm/OSMFetcher.js               +node coverage in combined query,
                                    +fetchLandmarks/peekLandmarks,
                                    +classifyLandmark/parseHeightM/
                                     ringCentroid/elementsToLandmarks
src/style/Pointillism.js            +canopy + landmark plug points,
                                    +canopyDabCount/canopyMs/
                                     landmarkDrawnCount/landmarkMs in timing
src/style/groundPainter.js          Path2D → ctx.beginPath/moveTo/lineTo
                                    (pure refactor, same visual output;
                                     unblocks node-side test coverage)
src/ui/ControlsPanel.js             buildBindings now peeks landmarks;
                                    result panel surfaces canopy + landmark counts
scripts/canopy-landmark-perf-probe.js  new — risk-first A3 perf probe
DATA-CONTRACTS.md                   v3.10 — Landmark type, "Landmark
                                    category mapping" section
ROADMAP.md                          original Phase 3 marked SUPERSEDED
                                    with pointer to V2 painter approach
                                    + Decision Log entry
```

---

## Phase 2.5 v1.4 — Pointillism (released 2026-04-29)

The Pointillism pass is the project's signature transform: real-world data
fed through a faithful port of `guillaume-gomez/to-pointillism` augmented
with curated painter palettes, physical-mm stroke widths, and Huang's-
algorithm sliding median. v1.4 is the recommended preset; v1.4-faithful
is the algorithm-true default and v1.4-expressionist (`--curated --no-median
--width-mm=1.2 --brush-stroke=2.0 --density=0.03`) is the museum-bar
opt-in.

### Highlights

- **Nine curated painter palettes**: Munch (sunset / anxious),
  Kirchner (alpine cool), Soutine (gestural earth), Whistler (nocturne),
  Turner (atmospheric haze), Marc (primary symbolism), Nolde (storm),
  Klimt (golden ornamental), Macke (Tunisian sun).
- **Nine geographic scene types**: alpine sunset, coastal twilight,
  forest noon, storm seascape, mountain twilight, urban dusk, desert noon,
  snow blizzard, canyon. Each paired with a best-fit painter; the
  remaining painter (Klimt) accessible via palette-comparison runs.
- **Eighty-one renders**: every scene × every painter, all rendered at
  A3 @ 300 DPI, all in `.iterations/2026-04-29-pointillism-v1.6-palette-comp/`
  (alpine row) and `.iterations/2026-04-29-pointillism-v1.12-matrix-*/`
  (other 8 rows). Single-image contact sheet at
  `exhibition/matrix-9x9.png`.
- **Six exhibit plates**: museum-pitch portfolio in `exhibition/`, each A3
  @ 300 DPI, with curator wall labels in `EXHIBITION.md` and
  press summary in `exhibition/PRESS-KIT.md`.
- **Four output formats per plate**: print-quality PNG (12-14 MB each),
  web-resolution JPEG (~400 KB each), A3-portrait process plate (source +
  painted), A3 contact sheet (`exhibition/exhibition-contact-sheet.png`).
- **Determinism**: same source + same seed + same opts = identical output,
  every time. Mulberry32 PRNG, no live state reads during transform.
- **Performance**: 22-26 s avg per A3 render at v1.4 settings (PASS,
  comfortable headroom under the 30 s user-tolerance bar).

### Algorithm fidelity

This is a faithful port of `guillaume-gomez/to-pointillism` with surgical
modifications:

- ColorThief-equivalent palette extraction via median cut (default), with
  saturation-boost + 2× hue-rotation extension producing a 4× palette
- Curated painter palettes opt-in via `palette: <colors>` or `--curated`
  CLI flag
- Scharr gradient with Gaussian-equivalent smoothing (3-pass separable
  box blur, radius `max(w,h)/50`)
- 11×11 RGB median underpainting using Huang's algorithm sliding-window
  median (43.9 s → 26.4 s on the full 5-scene benchmark)
- Weighted-random palette sampling per stroke (softmax over `-distance /
  temperature`)
- Stroke width as **physical measurement** (default 0.7 mm; v1.4 uses
  1.2 mm at A3 print resolution) — derived as `brushWidthMm × dpi / 25.4`
  so prints at any DPI carry the same texture
- Brush length scales with image-gradient magnitude (`brushStrokeFactor ×
  √mag`) so edges become impasto strokes while flat regions stay short

### What's not in v1.4 (intentionally deferred)

- **Real Three.js render integration**: the pointillism transform works
  in-browser via the "🎨 Test pointillism" button in `ControlsPanel.js`,
  but full visual QA on real OSM-fed Three.js scenes requires the user
  to run `npm run dev` and click the button — outside the autonomous loop's
  reach. Synthetic test scenes are used for the corpus and exhibition.
- **Phase 3 vegetation, Phase 4 scenic-default, Phase 5 multi-sensory**
  (weather/astronomy/wildlife) are roadmapped but not started; module
  stubs exist in `src/weather/`, `src/astronomy/`, `src/wildlife/`.
- **Floating-buildings investigation**: parked. Defensive 30 cm inset
  hedge applied; full investigation note in `.iterations/blockers.md`.
  Awaits a user-supplied test location to verify the symptom.

### Documentation surface

- Engineering: `README.md`, `SETUP.md`, `ARCHITECTURE.md`, `ROLES.md`,
  `DATA-CONTRACTS.md`, `ROADMAP.md`, `docs/modules/*.md`
- Curatorial: `EXHIBITION.md` (wall labels for the six plates)
- Press: `exhibition/PRESS-KIT.md` (journalist-friendly summary)
- Operational: `exhibition/README.md` (file inventory + print
  recommendations), `docs/EXHIBITION-CHECKLIST.md` (pre-submission
  practical checklist), `.iterations/PROJECT-STATE.md` (current
  pointillism module state)
- Per-cycle: `.iterations/session-*.md` (33 cycles of work logged)
- Licensing: `LICENSE` (MIT, software), `LICENSE-ART.md` (CC BY-NC-SA 4.0,
  rendered artworks; CC0 1.0 for the palette JSON)

### npm scripts

```bash
npm run dev               # Vite dev server (in-browser visual QA)
npm run build             # production bundle
npm run pointillism <ver> # CLI: render at v1.4 settings, see scripts/pointillism-test.js
npm run gallery <name>    # build a named gallery (best-of-mixed, v1.4-nine-scenes, …)
npm run matrix            # build the 9×9 matrix contact sheet
npm run thumbnails        # regenerate web JPEG thumbnails of exhibition/*.png
npm run process-plates    # rebuild the six A3-portrait process plates
```

### Reproducibility

The exhibition `exhibition/` outputs are reproducible from this commit's
git state. To regenerate from scratch:

```bash
node scripts/pointillism-test.js v1.4-reproduce --curated --no-median \
  --width-mm=1.2 --brush-stroke=2.0 --density=0.03
node scripts/build-matrix-gallery.js
node scripts/build-gallery.js exhibition-six
node scripts/build-process-plates.js
node scripts/build-thumbnails.js
```

The mulberry32 PRNG is seeded by `0xC0FFEE ^ name.length` per scene, so
output is byte-identical across re-runs.

---

## Future versions

The natural next versions are:

- **v1.5**: real Three.js render integration (scene snapshots fed through
  the same pipeline). Requires browser path validation — outside the
  autonomous loop's reach until a real-render visual QA gate is shipped.
- **v2.0**: real meteorology data binding (Open-Meteo wind direction →
  brushstroke angle, cloud cover → desaturation). Wires the
  `src/weather/` stub.
- **v2.5**: Phase 3 OSM vegetation + landmarks. Wires `src/osm/VegetationBuilder.js`.
- **v3.0**: real astronomy (NOAA SWPC Kp index → aurora, Hipparcos →
  stars, moon phase → night palette warmth). Wires `src/astronomy/`.

These are the planned phases; the current v1.4 ships standalone as a
complete museum-submission package.
