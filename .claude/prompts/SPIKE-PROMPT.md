# Phase 0 — Spike prototypes

Paste the contents below into a **fresh** Claude Code session as your
first message. Do not include this header line or anything above the
divider.

---

You are starting Phase 0 of the Panorama rebuild. This is a **spike
phase** — throwaway prototypes that validate three project-killing
risks before the main build commits to them. Do not start the main
build during this phase.

# Read first

Before any code work, read in this order:

1. `STRATEGY-V2-REVISED.md` — the source of truth
2. `REQUIREMENTS-CHECKLIST.md` — comprehensive feature list
3. `ARCHITECTURE.md` — module boundaries
4. `generative_panorama.html` — the original tool whose painterly
   output is the aesthetic baseline we must match or beat

If `STRATEGY-V2-REVISED.md` does not exist, stop and ask the project
owner to run the multi-agent strategy review first.

# What you are building

Three independent prototypes. Each is throwaway. Each ends with a 1-page
written assessment and a go/no-go decision. None of this code lives in
`src/`; all of it lives in `test/spikes/<spike-name>/` and is
gitignored or removed at end of phase.

---

## Spike 1 — Synthetic underpainting → canonical to-pointillism

**Critical question:** Does feeding the existing `src/style/Pointillism.js`
algorithm a synthetic flat-or-gradient underpainting produce a painterly
image, or a colouring-book?

**Why this matters:** Three reviewers in the strategy review (stylization,
algorithm specialist, art director) flagged this independently as a P0
risk. The to-pointillism algorithm was tuned for photographs. Synthetic
input may produce dense edge outlining and sparse interior — a schematic,
not a painting.

**What to do:**

1. Read `src/style/Pointillism.js` and `src/style/algorithm.js`
   thoroughly. Do not modify them.
2. Create `test/spikes/spike1/` with:
   - A node script or browser harness that builds an A3-portrait
     (3508×4961 px) underpainting in pure canvas calls — no Three.js.
   - The underpainting must include: an eight-phase sky gradient (use
     a sun-altitude of −5° / civil twilight as the test case), a
     skyline silhouette polygon (you can draw a rough mountain
     freehand for this spike), and three ground colour zones (water,
     forest, foreground earth) with **gradients within zones** (not
     flat colour) — atmospheric depth lighter near horizon, darker
     in foreground.
   - Run the existing `Pointillism.js` over this underpainting.
   - Save the output PNG.
3. Render a comparable scene from `generative_panorama.html` (study its
   sunset/civil-twilight output style first). Save its output PNG.
4. Place the two PNGs side-by-side. Take a screenshot of the comparison.
5. Write `test/spikes/spike1/ASSESSMENT.md` answering:
   - Does the canonical algorithm produce a painterly result on
     synthetic gradient input?
   - If not, what is missing? (most likely candidates: internal zone
     texture, palette adaptation to flat colour, stroke density floor)
   - Recommended strategy revision, or **GO** if no revision needed.

**Decision criteria:** If the spike1 output is significantly worse than
the HTML tool's output, the strategy needs a Stage 1.5 (texture or noise
layer) before main build. Document what's needed.

---

## Spike 2 — SkylineCaster performance and edge cases

**Critical question:** Can we compute an analytic skyline against cached
DEM tiles in milliseconds, at sufficient resolution, with proper edge
case handling?

**Why this matters:** SkylineCaster is the new public contract that
makes Path B possible. Until it works, the painter cannot run.

**What to do:**

1. Read `src/terrain/DEMFetcher.js`, `src/terrain/HeightSampler.js`, and
   `src/data/TileMath.js`. Understand the existing tile fetching and
   sampling.
2. Create `test/spikes/spike2/SkylineCaster.js` with:
   ```js
   getSkyline(observer, viewAzimuthDeg, fovDeg, samples = 360)
     → Float32Array of elevation angles
   ```
3. Implementation requirements:
   - For each azimuth sample, ray-cast outward from the observer
   - Accumulate maximum elevation angle along the ray
   - Apply Earth curvature correction:
     `apparent_elevation -= (distance_m)^2 / (2 * 6371000) * 0.87`
   - Configurable ray range (default 50 km), step size (default 100 m)
   - Configurable DEM tile zoom (default 12; allow zoom-up for close
     terrain)
4. Test against five locations and document results:
   - **Mont Blanc viewpoint** (45.83, 6.86, eye height 1.7 m, looking
     south) — expected: dramatic alpine silhouette
   - **Half Dome from Glacier Point** (37.73, −119.57, looking east) —
     expected: granite dome silhouette
   - **Venice (San Marco)** (45.43, 12.34, looking east toward sea) —
     expected: dead flat horizon
   - **Manhattan (top of Empire State)** (40.75, −73.99, looking south) —
     expected: distant horizon, no significant peaks (urban handled
     elsewhere)
   - **Death Valley (Badwater Basin)** (36.23, −116.77, looking west) —
     expected: observer below sea level, mountains rising sharply
5. For each location, plot the skyline as a 2D line chart and time
   the operation. Save plots to `test/spikes/spike2/skylines/`.
6. Write `test/spikes/spike2/ASSESSMENT.md` answering:
   - Time per call (target: < 500 ms after tile cache warm)
   - Resolution adequacy (does the silhouette read as the correct
     mountain?)
   - Edge case handling (Venice flat, Death Valley negative
     elevation, Manhattan coastal-flat-with-distant-haze)
   - **GO** or revisions needed.

**Decision criteria:** If skyline computation takes seconds per call,
or fails on any of the five edge cases, the SkylineCaster spec needs
revision. Document what's needed.

---

## Spike 3 — 3D viewer recognisability

**Critical question:** With DEM-only terrain (no OSM, no buildings, no
vegetation), can a user identify a place from the 3D viewer alone?

**Why this matters:** The strategy claims the 3D viewer's job is
"recognisability of the place." If users can't recognise the place, the
viewer fails its core purpose and the project loses its compositional
flow.

**What to do:**

1. Use the existing `TerrainBuilder.js` and `SceneManager.js` to render
   five places at preset viewing angles:
   - Mont Blanc (45.83, 6.86, looking south)
   - Half Dome (37.73, −119.57, looking east)
   - Matterhorn (45.98, 7.66, looking south)
   - Mont Saint-Michel area (48.64, −1.51, looking northwest)
   - Venice (45.43, 12.34, looking east)
2. Take a screenshot of each (render at 1280×720, no UI overlays).
3. Save to `test/spikes/spike3/screenshots/`.
4. Conduct a small user study:
   - Find 5 people willing to look at the screenshots (in person or
     via group chat — informal is fine for a spike)
   - Show them the 5 unlabelled screenshots
   - Ask them to identify each from a list of 8 candidates (5 correct +
     3 distractors: e.g. K2, Yosemite Falls, Cinque Terre)
   - Record identification rate
5. Write `test/spikes/spike3/ASSESSMENT.md` answering:
   - What was the average identification rate?
   - Which places were recognised? Which weren't?
   - For the unrecognised ones, what's missing? (likely: OSM features
     for urban/coastal scenes, vegetation cues for forested ones)
   - **GO** if average rate ≥ 60%; revisions needed below that.

**Decision criteria:** If identification rate is below 40%, the 3D
viewer needs more than DEM (OSM polygons, building silhouettes,
maybe vegetation cues) to deliver on its recognisability promise.
Strategy may need to defer some presets to V2 if they require
features not in MVP scope.

---

# Output of Phase 0

A summary file `test/spikes/PHASE-0-REPORT.md` containing:

- Each spike's GO/REVISE/NO-GO decision
- For REVISE decisions: specific strategy changes recommended
- An overall recommendation: proceed to Phase 1 as written, proceed
  with strategy revisions, or block until risks are mitigated

# Ground rules

- All spike code lives under `test/spikes/`. None of it is production code.
- Do not modify anything in `src/` during Phase 0.
- Do not install new npm dependencies. Use what is in `package.json`.
- Commit each spike separately so reverts are clean.
- If a spike reveals a strategy gap, **document** it in the assessment.
  Do not unilaterally revise the strategy. Escalate to the project owner.
- Use the subagents in `.claude/agents/` for review:
  - Spike 1 → `@algorithm-specialist` and `@art-director` for assessment
  - Spike 2 → `@terrain-engineer` for assessment
  - Spike 3 → `@art-director` for assessment

After all three spikes, hand back to the project owner with the
PHASE-0-REPORT.md. Do not proceed to Phase 1 without explicit approval.
