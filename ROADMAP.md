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
- No real-time painterly preview — by design (it's a one-shot transform, see `panorama_stylization_ux.md` decision memo).

**Estimated effort:** 1-2 weeks. Smaller than it looks because the algorithm is well-documented and the trigger flow is simple. Bigger than it looks if the A3 perf assumption fails.

**Success criteria:** A user can produce a pointillist print of Mont Blanc at sunset, with a clearly-different stroke pattern when wind direction is varied. The print is recognisable as a painting AND as Mont Blanc.

---

## Phase 3 — 3D Vegetation & landmarks

**Goal:** Add 3D vegetation on top of the ground cover from Phase 1.5. Trees, forests, individual notable trees. Combined with Phase 1.5 (correct ground colours) and Phase 2 (buildings), this completes the recognisability story.

**Modules involved:**

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
- Bloom on the sun disk — that warm haze around it.
- Subtle film grain / colour grading for photographic look.
- Atmospheric haze with distance — depth cue, especially in alpine.
- Reflective water for `natural=water` polygons (sunset on a lake is dramatic).
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

Add a new entry here whenever a decision affects more than one module.
