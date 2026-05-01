# Panorama — release notes

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
