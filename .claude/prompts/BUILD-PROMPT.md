# Phase 1 — MVP build

Paste the contents below into a **fresh** Claude Code session as your
first message. Do not include this header line or anything above the
divider. Start a new session — do not continue from the spike phase.

---

You are building Panorama, a tool that generates painterly artwork from
real Earth data. You are starting from a clean slate (the existing
`src/` is being rebuilt, not patched). This is Phase 1 — the MVP.

# Read first, in this exact order

1. `STRATEGY-V2-REVISED.md` — the source of truth, non-negotiable
2. `REQUIREMENTS-CHECKLIST.md` — what the project must include
3. `ARCHITECTURE.md` — module structure and contracts
4. `ROLES.md` — module ownership
5. `DATA-CONTRACTS.md` — types and events shared across modules
6. `README.md` — project pillars
7. `test/spikes/PHASE-0-REPORT.md` — outcomes of the three spike
   prototypes; folds into your strategy
8. `generative_panorama.html` — the original tool whose output sets
   the aesthetic baseline
9. The existing `src/style/Pointillism.js`, `src/style/algorithm.js`,
   `src/terrain/DEMFetcher.js`, `src/terrain/HeightSampler.js`,
   `src/data/TileMath.js` — proven code you will reuse

If any document above is missing, stop and ask the project owner.

# What you are building

The MVP. Strict scope. Anything not on this list is V2+.

## MVP delivers

A working Vite-based web app that:

1. **Loads with three hardcoded preset locations** — Mont Blanc, Half
   Dome, Matterhorn. Each preset pre-fills lat/lon, default azimuth,
   default FOV, and recommended time. Stored in
   `src/presets/iconicViews.json`.

2. **Provides a 3D preview** at the chosen preset using the existing
   DEM mesh approach. No OSM ground tint. No advanced sky shader (a
   simple gradient skybox is enough). Camera at default eye height
   1.7 m.

3. **Provides composition controls:**
   - Orbit and look-around (mouse / touch)
   - Eye-height slider (1.0 m to 3.0 m)
   - Time slider (24-hour, in location's local time)
   - Paper size selector: A4, A3 (default), A2
   - Orientation toggle: portrait, landscape

4. **Provides a Paint button** that:
   - Captures a Snapshot (per `DATA-CONTRACTS.md`) from current viewer
     state
   - Computes the analytic skyline via `SkylineCaster.getSkyline()`
   - Builds an underpainting in canvas: eight-phase sky gradient (per
     sun altitude) + skyline silhouette polygon + simple ground colour
     **with vertical gradient** (per Phase 0 Spike 1 findings)
   - Runs canonical to-pointillism with **one** curated palette
     (`Nolde palette`, from existing `palettes.json`)
   - Outputs a PNG at the chosen paper size and orientation, 300 DPI
   - Triggers download

5. **Determinism contract holds:** same Snapshot in → same painting out.
   Verified by a regression test.

## MVP does NOT include

- Map + compass UI (manual coordinates input is fine if user wants
  off-preset locations)
- Full preset gallery (the 3 hardcoded are enough)
- OSM polygons in painter
- Real weather data
- Real astronomy data (moon, stars, aurora)
- Wildlife data (bird flocks)
- Atmospheric phenomena (rainbow, halos, sundogs)
- Multiple painter palettes (Nolde only in MVP)
- Wave-line patterns in water
- Building silhouettes
- Walk mode in 3D viewer
- Snapshot save / load / share UI
- Session history

These are V2+ and will be addressed in BUILD-V2-PROMPT.md.

# MVP acceptance criteria

The MVP is complete when **all** of these pass:

| Criterion                                                                  | How to verify                                |
| -------------------------------------------------------------------------- | -------------------------------------------- |
| All 3 presets produce a paintable image                                    | Manual run                                   |
| Each painting is recognisable as the place from silhouette                 | Project owner's visual review                |
| Each painting equals or beats the closest existing exhibition plate         | Project owner's side-by-side review          |
| Determinism: same Snapshot → same painting                                  | Regression test                              |
| All 3 paper sizes (A4/A3/A2) export correctly at 300 DPI                   | File inspection                              |
| Both orientations (portrait/landscape) export correctly                     | File inspection                              |
| End-to-end paint operation completes in under 30 seconds                   | Profiling                                    |
| `SkylineCaster.getSkyline()` runs in under 500 ms (warm cache)             | Spike-2 benchmark, re-run                    |
| Strategy contracts in ARCHITECTURE.md are not violated                     | Code review by `@director` subagent          |

# Implementation order

Strict critical path. Each step is a self-contained PR / commit set.

1. **Project structure scaffold** per ARCHITECTURE.md. Empty modules,
   public APIs declared, no implementation. Run `npm run dev` and
   verify the app boots to a placeholder page. Commit.

2. **Data Layer** (`src/data/`). Reuse existing `TileMath.js` and
   `Cache.js`. Verify with unit tests.

3. **Terrain module** (`src/terrain/`). Reuse `DEMFetcher.js` and
   `HeightSampler.js`. Add new `SkylineCaster.js` per Phase 0
   Spike 2 results. Unit tests for `getSkyline()` against the 5
   spike locations.

4. **Painter module** (`src/style/`).
   - `Painter.paint(snapshot) → HTMLCanvasElement`
   - Stage 1: `Underpainting.synthesize(snapshot, skyline) → canvas`
     - Sky gradient (eight-phase)
     - Skyline silhouette polygon
     - Ground gradient zone (single zone for MVP)
   - Stage 2: reuse existing `Pointillism.js` and `algorithm.js`
   - One curated palette: Nolde
   - Regression test: same Snapshot → same canvas hash

5. **Presets module** (`src/presets/`).
   - `iconicViews.json` with 3 entries
   - `PresetLoader.js` with `getAll()` and `loadIntoState(slug)`

6. **Scene module** (`src/scene/`). Three.js scaffold for the 3D
   preview. DEM mesh only. Sky as gradient skybox.

7. **Camera module** (`src/camera/`). Orbit + look-around. No walk
   mode. Eye-height adjustment.

8. **UI module** (`src/ui/`). Preset gallery (3 cards), eye-height
   slider, time slider, paper size selector, orientation toggle,
   manual coordinate input, Paint button.

9. **Export module** (`src/export/`). Receives canvas from Painter,
   triggers PNG download with correct filename including snapshot
   metadata (`panorama_<location>_<date>_<size>.png`).

10. **End-to-end MVP validation** against acceptance criteria.

# Subagents to use during the build

The 7 subagents in `.claude/agents/` are available. Dispatch to them
for code review at each PR's completion:

- Module changes in `src/style/` → `@stylization-engineer`
- Module changes in `src/terrain/` → `@terrain-engineer`
- Module changes in `src/data/` → `@data-layer-engineer`
- Aesthetic outcome review at end of step 4 → `@art-director`
- Algorithm correctness in step 4 → `@algorithm-specialist`
- Scope creep concerns at any time → `@pragmatist`
- Architecture violations or contract disputes → `@director`

After step 10 acceptance, dispatch `@director` for a final review and
write a Phase 1 closeout document at `PHASE-1-CLOSEOUT.md`.

# Ground rules

1. **STRATEGY-V2-REVISED.md is the source of truth.** Anything not in
   it requires escalation.
2. **MVP scope is sacred.** Do not build V2 features.
3. **Reuse proven code.** `Pointillism.js`, `algorithm.js`,
   `DEMFetcher.js`, `HeightSampler.js`, `TileMath.js` are validated.
   Copy them in; don't reinvent.
4. **Determinism.** No bare `Math.random()`. All randomness flows
   from the seeded RNG in the Snapshot.
5. **Module contracts.** Boundaries in ROLES.md are enforced. To break
   a contract, escalate to `@director`.
6. **Small frequent commits.** One concern per commit.
7. **Tests on public APIs.** Every module's public API gets at least
   one unit test.
8. **Regression test for determinism.** A single integration test:
   load preset 1 → snapshot → paint → assert canvas hash equals stored
   reference hash.

# Non-negotiable contracts

Do not deviate from these without explicit project owner approval:

- The painter consumes a Snapshot and produces a canvas. Pure function.
  No network calls inside the painter.
- `SkylineCaster.getSkyline()` is the ONLY way the painter learns about
  terrain. The painter does not import Three.js.
- The 3D scene is for composition only. It never feeds the painter.
- Canonical to-pointillism is canonical. No bespoke stroke variations.
  All data binding lives in the underpainting (Stage 1).
- Painter palettes are colour-only. No claim of reproducing painter
  technique. Branding: "Nolde palette," not "in the style of Nolde."

# When MVP is complete

Stop. Run `@director` final review. Write `PHASE-1-CLOSEOUT.md`. Hand
back to project owner. Do not proceed to V2 without approval.
