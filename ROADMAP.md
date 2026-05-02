# Roadmap

Panorama is built in seven phases. Each phase produces a runnable, demonstrable app — you can stop after any phase and have something useful, then come back later for the next.

The phases map onto the directory structure: each phase touches a defined set of modules, so a phase is also a clean unit of work for one developer.

> **Phase 2.5 is the project's signature feature.** Painterly stylization (pointillism v0) is what makes Panorama distinctive, not a Phase-5 footnote. After Phase 2 the project has a *good 3D scene*; after Phase 2.5 it has a *signature output*. Every later phase exports the stylized image, not the photoreal one.

> **Note on phase order:** Phase 1.5 (Ground Cover) was inserted between Phase 1 and Phase 2 after Phase 1 testing showed that recognisable colours (sand, water, grass, urban) matter more for visual recognition than buildings. Ground cover is also technically simpler than buildings, so it makes sense to validate the OSM data layer before tackling extruded geometry. Phase 2.5 (Stylization) was likewise inserted after Phase 2 because reviewing the build revealed the project was building toward photorealism with stylization deferred indefinitely — directly contradicting the project's stated artistic intent. Stylization moved up to make sure the signature feature actually ships.

---

## Phase 1 — MVP: terrain + sky + sun

**Goal:** Beautiful sunset terrain images from anywhere on Earth. No buildings or trees yet.

**Modules involved:**

- ✅ `src/main.js`, `src/config.js`, `src/state.js`
- ✅ `src/scene/` (SceneManager, Renderer)
- ✅ `src/terrain/` (all three files)
- ✅ `src/sky/` (both files)
- ✅ `src/camera/CameraController.js` (basic orbit, no scenic default)
- ✅ `src/ui/` (LocationPicker, TimeSlider, basic ControlsPanel)
- ✅ `src/data/` (Cache, Geocoder, TileMath)
- ❌ `src/osm/` — empty stubs
- ❌ `src/export/` — basic screen-resolution PNG only
- ❌ `src/camera/ScenicDefault.js` — empty stub returning `{azimuth: sunAzimuth, elevation: -5}`

**What works:**

- User searches for a place by name or pastes lat/lon.
- Terrain mesh loads within ~5 seconds for default radius.
- Sky shows correct sunset colours for the location and time.
- Time slider scrubs through ±2 hours of sunset, sky updates live.
- User can drag to look around.
- "Save image" button downloads a 1920×1080 PNG.

**What doesn't work yet:**

- No buildings, no trees, no recognisable landmarks.
- Camera doesn't know the ground exists — may clip through terrain.
- Export is screen resolution only.

**Success criteria:** You can produce a beautiful, recognisable sunset image of Mont Blanc, the Grand Canyon, or your local hill, just from terrain + sky.

**Estimated effort:** 1–2 weeks for one developer.

---

## Phase 1.5 — Ground Cover

**Goal:** Make every location *look* like itself. Beaches turn sandy, water turns blue, fields turn green, urban areas turn grey. The single highest-impact change for recognisability — locations become identifiable from colour and material alone, before any 3D objects are added.

**Why this comes before Phase 2:** Phase 1 testing revealed that even great terrain + sky doesn't produce recognisable images of most places — a beach without sand colour looks like any other coastline; a meadow without green looks like bare rock. Ground cover is also technically simpler than buildings (just polygons projected onto terrain — no extrusion, no LOD, no instancing), so it's a good way to validate the OSM data layer before tackling extruded buildings in Phase 2.

**Modules involved:**

- 🆕 `src/osm/GroundCoverBuilder.js` — turns OSM area polygons into coloured/textured terrain overlays
- ⬆️ `src/osm/OSMFetcher.js` — add ground-cover Overpass query
- ⬆️ `src/osm/LODManager.js` — add ground-cover LOD tier
- ⬆️ `src/scene/SceneManager.js` — add ground-cover group to rebuild flow
- ⬆️ `src/data/Cache.js` — now caches Overpass too
- ⬆️ `src/terrain/TerrainBuilder.js` — provide UV coordinates on the terrain mesh so ground cover can be projected onto it (or alternative: ground cover renders as separate slightly-offset geometry above terrain)

**What works that didn't before:**

- Beaches show sand colour for `natural=beach` and `natural=sand`.
- Water surfaces (lakes, rivers, sea) show blue for `natural=water` and `waterway=*`.
- Forests show dark green for `landuse=forest` and `natural=wood` (still no individual trees yet — that's Phase 3).
- Grass/meadow/farmland show appropriate greens/yellows for `landuse=grass`, `landuse=meadow`, `landuse=farmland`, `landuse=orchard`, `landuse=vineyard`.
- Urban areas show muted grey-brown for `landuse=residential`, `landuse=commercial`, `landuse=industrial`.
- Bare rock and scree show grey-brown for `natural=bare_rock` and `natural=scree`.
- Wetlands, glaciers, and sand desert have appropriate colours.

**What still doesn't work:**

- No buildings (Phase 2).
- No individual trees or 3D vegetation (Phase 3).
- No reflections on water (Phase 5).
- Camera still floats — ground-aware camera lands in Phase 2.

**Success criteria:** Show three test images side-by-side — a Mediterranean coast, a Tuscan countryside, an alpine valley. All three should be visually distinct and recognisable as those places, even without any 3D objects above the ground plane.

**Estimated effort:** 4–7 days. Less than a full phase because it's geometrically simple and reuses Phase 2's planned Overpass infrastructure.

---

## Phase 2 — Buildings, ground-aware camera, walking mode

**Goal:** Add OSM buildings so locations become recognisable. Make the camera stand properly on the ground. Let the user walk through the scene at human speed to find the perfect viewpoint.

**Modules involved:**

- ✅ `src/osm/BuildingsBuilder.js`
- ⬆️ `src/osm/OSMFetcher.js` (extend with buildings query — Phase 1.5 built the fetcher)
- ⬆️ `src/osm/LODManager.js` (now handles buildings tier as well)
- ⬆️ `src/camera/CameraController.js` (now uses HeightSampler; adds orbit/walk mode switching)
- ✅ `src/ui/ModeToggle.js` (new component for switching modes)
- ⬆️ `src/scene/SceneManager.js` (add buildings to rebuild flow; pass `dt` to camera update)
- ⬆️ `src/ui/ControlsPanel.js` (mount the ModeToggle)

**What works that didn't before:**

- Buildings appear within OSM radius, properly extruded by height.
- LOD: full detail near, simplified mid, landmarks-only far.
- Camera sits exactly 1.7 m above the ground beneath the user's location.
- Cities like Manhattan, Paris, Florence, Rome are recognisable.
- **Walk mode**: WASD / arrow keys to move, mouse to look, Shift to jog. Camera follows terrain. Pointer lock when canvas is clicked.
- **Reset position** button to snap walker back to chosen location.
- Toggle between orbit and walk modes from a button group in the control panel.

**Known limits going into Phase 3:**

- No vegetation. Cities look right, countryside still looks bare.
- Buildings have flat-extruded "Lego" look — no roofs, no windows.
- Walker doesn't collide with buildings — you can walk through walls. (Adding collision is Phase 3 polish if it bothers people.)

**Estimated effort:** 2–3 weeks. Walking mode adds about a week to what was originally Phase 2.

---

## Phase 2.5 — Painterly stylization (the signature feature)

**Goal:** The project's signature output. User composes the scene, clicks "Transform → Pointillism," gets a painterly version of the rendered scene with parameters driven by real-world data (wind direction → brushstroke angle, wind speed → stroke length, sun phase → palette). One-shot CPU canvas transform on user trigger — not a real-time render mode.

**Why this is the most important phase:** Without it, Panorama is a photorealistic-3D-from-OSM tool, of which there are many. With it, Panorama produces art that *could not exist without this specific project* — the binding to real data is the differentiator. See `DATA-CONTRACTS.md` "Data → Style binding" for the full contract.

**Modules involved:**

- 🆕 `src/style/Pointillism.js` — algorithm port from `guillaume-gomez/to-pointillism` (canvas-only; no OpenCV.js, no ColorThief deps)
- 🆕 `src/style/gradient.js` — vanilla-JS Scharr + Gaussian
- 🆕 `src/style/palettes.json` — curated painter-extracted palettes ("Cézanne Provence," "Monet Giverny," "Sorolla beach"); replaces ColorThief on the photoreal render
- ⬆️ `src/ui/ControlsPanel.js` — adds "Transform → Pointillism" button next to "Save image"
- ⬆️ `src/scene/SceneManager.js` — pin `renderer.toneMappingExposure` at trigger; assemble `StyleBindings` snapshot
- ⬆️ `src/export/ExportPipeline.js` — accept stylized canvas as the export target (the stylized image becomes the saved PNG)

**The 6-step pipeline (per the reference repo):**

1. Pick palette from curated set, keyed by climate zone × `sun.phase`.
2. Greyscale + Scharr gradient (dx, dy) on the rendered canvas.
3. Smooth gradient with Gaussian (radius ≈ max(w,h)/50).
4. Median-blur the source as soft underpainting.
5. Generate randomized grid of stroke centres (deterministic PRNG seeded by timestamp + location).
6. For each grid point, draw an elongated ellipse: angle = gradient + 90° (or wind direction), length = f(magnitude, wind speed), colour = weighted-random from palette.

**What works that didn't before:**

- A "Transform → Pointillism" button in the control panel.
- The exported PNG is a painting, not a photograph.
- Two real-world data signals (wind direction, wind speed) demonstrably affect the output. (Even before the Weather module exists, the bindings can use stub values from a hand-set `state.style.testBindings` so the pipeline is exercised.)
- Same location + timestamp = same painting (determinism contract).

**The load-bearing risk to validate FIRST in this phase:**

A3 @ 300 DPI is ~17.4 megapixels — 50× the typical input the reference repo handles. **The very first prototype task is to measure CPU runtime at full export resolution.** If it's >60s, the architecture pivots (Web Worker, tiled, or accept-as-export-only-with-explicit-progress). Don't build the full feature until this is measured.

**What still doesn't work:**

- Only one style (pointillism). Hockney-flat-on-polygons, Van Gogh impasto, etc. are post-v0.
- Wind values come from a hand-set test object until Weather module ships (post-2.5).
- The *full* A3 painting is one-shot — a 22–28 s CPU pass on user trigger,
  not a real-time render mode. The original "no real-time painterly preview
  — by design" non-goal turned out to be too strong: V2's
  `UnderpaintingPreviewPanel` ships a sub-50 ms live preview of stage 1
  (paintGround + paintWater + paintCanopy + paintLandmarks + optional
  median-blur softening) at sidebar size for curation, while the full
  pointillism stroke pass remains one-shot. See `panorama_stylization_ux.md`
  decision memo and the Decision Log entry on the live-preview reversal.

**Estimated effort:** 1-2 weeks. Smaller than it looks because the algorithm is well-documented and the trigger flow is simple. Bigger than it looks if the A3 perf assumption fails.

**Success criteria:** A user can produce a pointillist print of Mont Blanc at sunset, with a clearly-different stroke pattern when wind direction is varied. The print is recognisable as a painting AND as Mont Blanc.

---

## Phase 3 — 3D Vegetation & landmarks  ⚠️ SUPERSEDED

> **Superseded 2026-05-01.** The 3D vegetation / 3D landmark detection
> path described below is no longer the plan. The v3.6 chore (commit
> `d7cd185`) deleted the 3D OSM rendering pipeline (`GroundCoverBuilder`,
> `BuildingsBuilder`, `VegetationBuilder`, `LODManager`); the painter
> (`src/style/`) now owns OSM expression directly via `OSMFetcher.peekGroundCover`
> and `OSMFetcher.peekLandmarks`. The artistic intent of Phase 3 — *forests
> read as forests, landmarks visible* — is achieved instead by the
> **painterly vegetation + landmarks** PR (`feature/painterly-vegetation-landmarks`):
> two new painter modules (`src/style/canopyPainter.js`,
> `src/style/landmarkPainter.js`) that draw painterly canopy stipple and
> archetypal landmark silhouettes into the underpainting before the
> Pointillism stroke pass. See the V2 vegetation/landmarks entry in
> RELEASE-NOTES.md and the v3.10 changelog entry in DATA-CONTRACTS.md
> for the contract.
>
> The original Phase 3 description below is preserved as historical context;
> do not implement it.

**Goal (original, superseded):** Add 3D vegetation on top of the ground cover from Phase 1.5. Trees, forests, individual notable trees. Combined with Phase 1.5 (correct ground colours) and Phase 2 (buildings), this completes the recognisability story.

**Modules involved (original, all deleted in v3.6):**

- ✅ `src/osm/VegetationBuilder.js` — instanced 3D trees scattered within forest polygons
- ⬆️ `src/osm/LODManager.js` (now handles vegetation tiers as well)
- ⬆️ `src/osm/BuildingsBuilder.js` (add landmark detection: tall buildings, towers, churches)

**What works that didn't before:**

- `landuse=forest` and `natural=wood` polygons get instanced 3D trees scattered at appropriate density (the dark-green ground colour from Phase 1.5 already exists; this adds *trees on top of it*).
- Individual `natural=tree` points become tree billboards.
- Notable landmarks (towers, monuments, churches) are tagged for "always visible" treatment regardless of LOD distance.

**What you can add as polish:**

- Different tree species by climate zone (rough approximation by latitude).
- Seasonal foliage colours by date.

**Estimated effort:** 2 weeks. Vegetation is finicky — Poisson-disk sampling, instancing performance, billboard alignment.

---

## Phase 4 — Print export & UX polish

**Goal:** Real A3 300 DPI prints. Make the app pleasant to use.

**Modules involved:**

- ✅ `src/export/ExportPipeline.js`
- ✅ `src/export/TiledRenderer.js`
- ⬆️ `src/ui/ControlsPanel.js` (export panel, format/DPI/orientation pickers)
- ⬆️ `src/ui/` (preview framing overlay showing A3 aspect ratio)
- ⬆️ `src/scene/SceneManager.js` (cooperate with export — pause render loop)

**What works that didn't before:**

- A3 landscape & portrait, 150/300/600 DPI exports.
- GPU capability check; tiled fallback for low-end machines.
- Preview shows an A3 framing rectangle so the user composes correctly.
- Loading progress for long exports.
- "Follow sun" toggle: camera azimuth tracks the sun automatically as time changes.

**Estimated effort:** 1–2 weeks.

---

## Phase 5 — Smart defaults & post-processing (optional)

**Goal:** Polish that turns Panorama from "tool" into "delight."

**Modules involved:**

- ✅ `src/camera/ScenicDefault.js` (now non-trivial)
- ⬆️ `src/scene/Renderer.js` (post-processing pipeline: bloom, colour grading, atmospheric haze)
- 🆕 `src/sky/PostProcessing.js` (or similar)
- ⬆️ `src/state.js` (persist last location/preset to localStorage)

**Features:**

- Scenic default analyses terrain around the location to pick the best viewing direction (not just "face the sun").
- ✅ **Bloom on the sun disk — that warm haze around it** — shipped 2026-05-01
  as part of `src/style/atmosphericPasses.js`, feature/atmospheric-depth.
  Soft radial gradient with `lighter` composite, mm-physical 18 mm radius
  scaled by `bloomStrength` slider, sun-phase tint envelope (warm-white at
  noon, deep orange at sunset). Fires only when sun above horizon AND
  projects within canvas bounds.
- ✅ **Subtle film grain / colour grading for photographic look** — shipped
  2026-05-01 as part of `src/style/atmosphericPasses.js`. Mulberry32-seeded
  noise at GRAIN_CELL_MM=0.18 mm cells (paper-texture spatial frequency),
  uniform amplitude with seed forked from `opts.seed ^ 0x4D_4D_4D_4D`.
  Grading is a gentle global sun-phase tint envelope (warm push at golden
  hour / sunset, slight desaturation at twilight / night), applied as
  composite ops over the whole canvas — fast.
- ✅ **Atmospheric haze with distance — depth cue, especially in alpine** —
  shipped 2026-05-01 as part of `src/style/atmosphericPasses.js`. Depth
  proxy is per-pixel screen-Y relative to the projected horizon line
  (cosine peak at the horizon, taper to zero at the canvas bottom);
  pixels above horizon get no haze. Probe 1 verifies the proxy is
  scene-scale aware (alpine vs courtyard saturation differential = +0.45).
  Sun-phase aware tint (cool blue-grey at noon, warm peach at sunset).
- ✅ **Reflective water for `natural=water` polygons (sunset on a lake is
  dramatic)** — shipped 2026-05-01 as `src/style/waterPainter.js`,
  feature/painterly-water-reflections. Four-pass painter: deep-water base +
  sky-sampling band (cosine falloff) + sun-glitter (back-lit only) +
  horizontal ripple texture. Sun-phase aware tints. Live preview in
  UnderpaintingPreviewPanel. Three sliders surfaced in PainterParamsPanel.
- localStorage persistence: app remembers your last location, preset, and time.
- Optional: shareable URLs encoding location + time + viewpoint.

**Estimated effort:** open-ended. Pick what you care about.

---

## Cross-cutting workstreams

Things that aren't a "phase" but accumulate over time:

### Performance

- Phase 1: profile DEM fetch and mesh generation.
- Phase 2: instanced building meshes; budget vertex count.
- Phase 3: tree LOD by camera distance; cull occluded vegetation.
- Phase 4: ensure 60 FPS in preview; export can take longer.

### Caching

- Phase 1: in-memory cache for DEM tiles.
- Phase 2: IndexedDB persistence; survives reload.
- Phase 4: pre-cache popular locations on first install (optional).

### Testing

- Manual testing initially. Add Vitest for pure modules (TileMath, SunCalculator wrapper, height interpolation) at any phase.
- Visual regression testing is out of scope — sunsets vary by definition.

### Accessibility

- Phase 4: keyboard navigation for all controls.
- Screen-reader labels on the canvas (description of current scene).

---

## Decision log

Record significant architectural decisions here so future contributors understand the *why*. Initial entries:

- **Why Three.js, not Cesium?** Cesium has terrain and atmosphere built in but constrains artistic control. Sunset look is the point of this app, so we chose Three.js + Sky shader for full shader access.
- **Why Vite + vanilla JS, not React?** UI is small (location picker, sliders, export panel). React would add bundle size and a state-management dependency. We use a simple event bus instead.
- **Why AWS Terrain Tiles, not Mapbox?** No API key required. Resolution is enough for human-scale views. Mapbox Terrain-RGB is an easy upgrade later if needed.
- **Why separate terrain and OSM radii?** Terrain at 75 km is a few MB; OSM features at 75 km is gigabytes. Different problems, different solutions.
- **Why no UI framework for the controls?** See above. The controls are simple enough that DOM manipulation in `src/ui/` is more honest than wrapping a framework.
- **Why was Phase 1.5 (Ground Cover) inserted between Phase 1 and Phase 2?** After Phase 1 was built and tested, it became clear that the placeholder elevation-based terrain colouring (blue/green/brown by altitude) made every location look essentially the same — beaches looked like fields, urban areas looked like meadows, water blended into terrain. Adding ground cover (OSM `natural` and `landuse` polygons projected as coloured terrain overlays) turned out to be the single highest-impact change for recognisability and is technically simpler than buildings (no extrusion, no LOD complexity). It also validates the OSM data layer and Overpass infrastructure before the more complex Phase 2 work begins.
- **Why was walking mode added to Phase 2 instead of being a later phase?** Phase 2's ground-aware camera already requires per-position terrain height queries via `HeightSampler.getHeightAtWorld()`. Walking mode reuses exactly that query, just runs it every frame. Bundling them avoids touching the Camera module twice. It also dramatically improves the user experience — being able to wander to find the perfect viewpoint matches how a real photographer scouts a location, and is a more natural way to use a sunset-photography tool than dragging a fixed point. Walk mode (Mode B in design discussion) was chosen over free-fly (Mode A — too god-like for stills work) and walk-with-collision (Mode C — overkill; one can simply walk around buildings). **Honest reframing (post-Phase 2.5 reasoning):** walk mode is composition-finding, which is a means to the end of "painting the right scene." Once the painterly trigger ships, walk mode is best understood as *easel-positioning*, not as "exploring an art gallery." Orbit-only would have shipped sooner; walk mode is kept because it's already done and because finding viewpoint at human eye height is a more natural composition tool than orbit. If maintenance cost ever becomes painful, demoting walk mode to a feature flag and using orbit + scenic-default as the primary flow is on the table.
- **Why was Phase 2.5 (Stylization) inserted between Phase 2 and Phase 3?** The vision-diagnostic review (2026-04-28) revealed that the documented roadmap had stylization in Phase 6 (WebGL shaders) or Phase 7 (ML), but the user's stated artistic intent had stylization as the project's *signature*. Six phases of photorealism work before the signature feature shipped contradicted the goal. Stylization moved to 2.5 to ship the signature early — even one simple style (pointillism) on a half-built scene proves the painterly pipeline. Later phases keep adding scene fidelity (vegetation, landmarks, multi-sensory layers) but every export from 2.5 onward is the stylized image, not the photoreal one. Pointillism was chosen as v0 over Hockney-flat-on-polygons because a reference algorithm exists and the wind-direction binding is clean; Hockney remains a post-v0 candidate. The user-triggered (not real-time) model was decided in the same diagnostic and is documented in the user's memory `panorama_stylization_ux.md`.
- **Why did Phase 3 become painter-side, not 3D? (2026-05-01)** The v3.6 chore (commit `d7cd185`) deleted the 3D OSM rendering pipeline because the in-scene 3D versions had become composition-distracting (offset textures, unwanted extrusions) and Path B had already declared the 3D scene composition scaffolding only. Restoring 3D vegetation / 3D landmark builders for Phase 3 would have reintroduced exactly the problems v3.6 removed. The artistic intent of Phase 3 — *forests read as forests, landmarks visible* — was preserved instead by adding two new painter modules that draw painterly canopy stipple and archetypal landmark silhouettes directly into the underpainting before the Pointillism stroke pass. This decision affects three modules (Style, OSM, UI) and is the canonical example of "if a Phase needs 3D today, ask whether the painter could express the same signal first." Trade-offs accepted: per-tree visibility (a single mapped `natural=tree` node) is lost — a forest reads as a textured zone, not as individuated trees, by design at this scope. If per-tree expression is wanted later, it lands as a `paintIndividualTrees` painter that draws one mark per node, in `src/style/`, not as 3D.
- **Live underpainting preview reversed the "no real-time preview" non-goal (2026-05-01).** The original Phase 2.5 spec stated "No real-time painterly preview — by design (it's a one-shot transform)." The V2 underpainting-preview PR demonstrated that the *underpainting* (paintGround + paintWater + paintCanopy + paintLandmarks + optional median-blur softening) renders in sub-50 ms at sidebar size, an order of magnitude faster than the Pointillism stroke pass. Curation work — comparing how a slider movement affects the painting — was previously a 22-second feedback loop per slider tweak; with the live preview it's <50 ms. The trade-off: the preview shows what pointillism *starts from*, not what it *ends at*, but the structural composition (sun-phase tinted ground, water reflections, canopy stipple, landmark silhouettes) is faithful enough to drive curation decisions. The full A3 painting remains one-shot. The non-goal is reworded above; this Decision Log entry records the reversal so future contributors know the original "by design" framing is obsolete.
- **Why painterly water reflections are own painter, not part of paintGround (2026-05-01).** Water polygons need a fundamentally different treatment than other ground categories: a vertical gradient (lighter at top, darker at bottom) reads as atmospheric depth on land but reads wrong on water (water is reflective, not atmospheric). The reflection treatment — deep base + sky-sampling band + sun-glitter + horizontal ripple texture — is layered enough to deserve its own module rather than special-casing inside `groundPainter`. Decision: `groundPainter` skips `category==='water'` polygons; `waterPainter` owns them end-to-end (`src/style/waterPainter.js`). Determinism preserved via Mulberry32 forked from `seed ^ 0x77_77_77_77` (matches the canopy/landmark XOR-salt convention). Sun-glitter geometry rule: front-lit water (sun behind camera) shows no glitter; back-lit water (sun ahead, near horizon) shows the strongest. Future water-reflects-land-objects ("v2 mirror surface") will land in the same module without disturbing this layer.
- **Why the haze depth proxy is screen-Y, not a real per-pixel depth buffer (2026-05-01).** The brief explicitly forbade reaching into `src/terrain/` or `src/scene/`, which is where a real per-pixel depth buffer would have to be built. The screen-Y-relative-to-horizon proxy uses `projection.js` `horizonY()` (already exposed) and produces convincing recession in the scenes we tested: alpine scenes where the horizon dominates the canvas get heavy mid-band haze; urban courtyards where the canvas is filled with foreground polygons get barely any. Probe 1 verifies the proxy is scene-scale aware (alpine differential +0.099 vs courtyard −0.352, +0.45 differential between the two). The trade-off accepted: scenes with non-flat ground (looking down a valley with a rising ridge in the middle, for example) won't haze the ridge as if it were near. If curation surfaces a need, threading a real depth buffer from the terrain step is a one-PR change to the terrain → painter contract — but it would touch modules outside `src/style/`, so it's not a change the painter role can make alone.
- **Why grain is uniform, not brightness-modulated (2026-05-01).** Paper grain in real prints is uniform amplitude — the variance is in spatial frequency and texture, not in per-pixel brightness response. Brightness-modulated grain (uniform on shadows, attenuated on highlights) reads as "paper texture" but biases the visual: at night the whole image is dark and the grain becomes overpowering. Uniform amplitude with cell-based downsampling (one ~2.1 px cell per noise sample at 300 DPI) keeps grain visible across the dynamic range without ever overpowering shadows or highlights. The cell-based downsampling matches the brief's "downsampled grain" suggestion. Future PR can revisit if curation surfaces a need for fully brightness-keyed grain.
- **Concentric inner-mesh foreground triangulation chosen over haze masking (2026-05-02).** The terrain `PlaneGeometry` was a single tier — 30 km × 30 km / 512 segs / ~58.6 m vertex spacing — which made the camera's enclosing triangle pair span ~58.6 m × 58.6 m. Everything from canvas-bottom (~3.5 m at default −5° tilt) out to the nearest mesh edge (~29 m) rendered inside that single triangle as a flat-coloured trapezoid. The painter projects most OSM polygons to thin slivers at the horizon (because polygons are flat ground at distance), so the foreground got little painter content; haze tinted the geometrically-uniform foreground uniformly, producing the "soft tinted gradient band" artefact the user reported. **Decision:** add an inner concentric mesh tier — 1 km × 1 km, 256 segments, ~3.9 m spacing, ~66 k extra vertices, world-anchored at the chosen location, sharing the existing DEM heightmap. **Three options were on the table** (`.iterations/2026-05-02-foreground-rendering/DIAGNOSIS.md`): (a) mask haze to rendered-terrain region only — rejected as a symptom-mask that the brief explicitly warned against, and which leaves the underlying geometric uniformity for the stroke pass to misread; (b) extend the mesh — chosen, as the only option that fixes the underlying problem at the right level; (c) add a foreground enrichment painter — deferred as a Phase-6+ painterly-composition feature, too large for what is structurally a meshing issue. **Why world-anchored, not camera-anchored:** the painter consumes a static Snapshot and doesn't care; the project's flow is *compose, then paint* (already recorded in the walk-mode entry above), so users rarely walk past the inner-mesh boundary; world-anchored is cheaper (no per-frame re-tessellation, no edge-stitching across moving boundaries). Trade-off accepted: walking past ~500 m from origin degrades the foreground back to coarse mesh. v2 path to camera-anchored stays open if telemetry surfaces a need. **Why shared, not painter-only:** painter render time is unchanged regardless of mesh density (the painter consumes a snapshot canvas image, not mesh triangles); 3D viewer FPS regression is bounded by +25 % vertex count on a static scene (expected < 5 %); fallback path to painter-only-mesh is a one-line `mesh.visible` gate on the inner tier in the live render if profiling later shows otherwise.
- **Why per-pass A3 perf overshoots the 80 ms target — and the 28 s total bar still passes (2026-05-01).** The brief's 80 ms-per-pass target is fundamentally tight for any per-pixel JS pass on a 17.4 MP canvas: a getImageData + putImageData round-trip alone costs ~70 ms in node-canvas before any per-pixel work. Haze (~85–150 ms) is essentially at the bar; grain (~620 ms) exceeds it by ~8×. Three faster alternatives were tried and discarded (drawImage scale-up + overlay → 686 ms; createPattern + fillRect with overlay → 584 ms; per-pixel JS without mid-tone weighting → 622 ms) — all hit the same ceiling because node-canvas's `overlay` composite at 17 MP is itself slow. Surfaced per the brief's escalation path. Total A3 render still passes the 28 s user-tolerance bar (24.3 s with atmospherics enabled, 23 s baseline) — the ~720 ms atmospherics overhead is 3 % of the budget. Future fast-grain landing requires WebGL fragment shading; out of scope for this PR (the painter has been canvas2D-only since Phase 2.5).

Add a new entry here whenever a decision affects more than one module.
