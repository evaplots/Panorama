# Panorama — release notes

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
