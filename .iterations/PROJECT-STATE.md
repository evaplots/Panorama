# Project state — Phase 2.5 (pointillism)

> **For the cloud routine and any cold-start session.** Read this file FIRST.
> It supersedes the older session notes for understanding "where we are." The
> session notes (`session-YYYYMMDD-HHMM.md`) remain the cycle-by-cycle log;
> this file is the running summary.

Last updated: 2026-04-29 (cycle 34 close — through v1.12 matrix, exhibition bundle, LICENSE, RELEASE-NOTES).

---

## What Panorama is

A web app that turns real Earth data (terrain, OSM features, sun position) into
**painterly landscape artwork** at A3 print resolution. The user's stated goal is
**museum-grade expressionist output for exhibition at a major digital-art museum**.

Six pillars (full statement in `README.md`):

1. Real-data-driven (terrain, sun, weather/astronomy/wildlife later)
2. First-person human-scale composition
3. Recognisability of place
4. **Painterly stylization is the signature** (not a Phase-5 nice-to-have)
5. Multi-sensory ambition (aspirational)
6. Print-quality A3 export

Phase 2.5 = pointillism transform; what this whole iteration is delivering.

---

## Current state of the pointillism module (as of cycle 9)

**Default mode (`v1.2-faithful`):** algorithm fidelity to
[`guillaume-gomez/to-pointillism`](https://github.com/guillaume-gomez/to-pointillism).

- Palette: extracted from the rendered scene via median-cut (ColorThief
  equivalent) + saturation-boost + 2× hue-rotation extension (4× set size)
- 11×11 RGB median underpainting (Huang's-algorithm sliding median for perf)
- Scharr gradient + Gaussian-equivalent smoothing (radius = max(w,h)/50)
- Weighted-random palette sampling (softmax over `-distance / temperature`)
- Stroke width as **physical measurement**: `brushWidthMm × dpi / 25.4`
  (default 0.7 mm at 300 DPI ≈ 8.27 px minor radius)
- Determinism: same source + same seed + same opts → same output

**Perf at A3 @ 300 DPI:** 26.4 s avg across 5 test scenes (PASS, well under
the 30 s user-tolerance bar with comfortable headroom).

**Opt-in expressionist mode — recommended preset (`v1.4-mid-stroke`):** layers
`--curated --no-median --width-mm=1.2 --brush-stroke=2.0 --density=0.03` on
top. Curated painter palette instead of source extraction; skip the median
underpainting; mid-range strokes that have impasto presence without
overpainting the source. **22.7 s avg — PASS.** Verified across all 5 test
scenes; storm seascape, mountain twilight, and forest noon all read as
genuine museum-bar work. This is the recommended setting when expressionist
character is wanted.

**Heavy expressionist mode (`v1.3-expressionist-comp`):** same family but
with `--width-mm=2.0 --brush-stroke=3.0 --density=0.025`. **39.6 s avg —
BORDERLINE.** Bigger, gestural strokes; suited to the most painterly outputs
but slow. v1.4 is preferred unless you specifically want the heavier impasto.

---

## Curated palette set (9 painters — opt-in)

In `src/style/palettes.json`, available via `--curated` in the test harness:

| Key                 | Painter         | Mood                              |
| ------------------- | --------------- | --------------------------------- |
| `munch-sunset`      | Edvard Munch    | sunset / anxious                  |
| `kirchner-alpine`   | E. L. Kirchner  | alpine cool                       |
| `soutine-landscape` | Chaïm Soutine   | distorted earth                   |
| `whistler-nocturne` | J. M. Whistler  | quiet tonal nocturne              |
| `turner-fog`        | J. M. W. Turner | atmospheric haze                  |
| `marc-symbolic`     | Franz Marc      | Der Blaue Reiter primary tensions |
| `nolde-storm`       | Emil Nolde      | storm / unsettled sea             |
| `klimt-golden`      | Gustav Klimt    | golden / ornamental jewel-tone    |
| `macke-tunisian`    | August Macke    | Tunisian sun-drenched             |

---

## Test corpus (9 synthetic source scenes)

Defined in `scripts/pointillism-test.js`, each paired with a best-fit palette
when running in standard (non-comparison) mode:

1. **alpine-sunset** → Kirchner alpine cool
2. **coastal-twilight** → Munch sunset
3. **forest-noon** → Soutine landscape
4. **storm-seascape** → Nolde storm
5. **mountain-twilight** → Whistler nocturne
6. **urban-dusk** → Whistler nocturne
7. **desert-noon** → Macke Tunisian
8. **snow-blizzard** → Turner fog
9. **canyon** → Marc symbolic (cycle 19 — red-rock canyon with sunlit/shadow
   walls; Marc's primary-tension palette translates the warm-cool drama)

Notes:
- urban-dusk and mountain-twilight share Whistler — intentional, both quiet
  blue-hour scenes from different geographies.
- All 8 painters now have scene assignments EXCEPT Klimt, which stays
  palette-only (still rendered via palette-comparison and 9-painter gallery).

These are SYNTHETIC sources (canvas-drawn, not Three.js renders). Real
in-browser renders are a pending visual-QA gate the user has to drive.

---

## Test harness CLI flags (one place to look them up)

```
node scripts/pointillism-test.js <version> [compare] [flags...]

  compare                        ONE source × ALL palettes (default: standard 5-scene)
  --density=0.06                 fraction of pixels that get a stroke
  --brush-stroke=1.0             brushStrokeFactor (length per √magnitude)
  --width-mm=0.7                 brushWidthMm (physical stroke width in mm)
  --dpi=300                      DPI for mm → px conversion
  --opacity=0.85                 stroke alpha
  --temperature=28               softmax temp for palette sampling
  --filter=name1,name2           run only scenes whose name contains a substring
  --curated                      use scene's curated paletteKey instead of extraction
  --no-median                    skip the 11×11 median underpaint
  --no-smooth                    skip Gaussian gradient smoothing
  --no-extend                    skip palette saturation+hue extension
```

---

## Iteration history (one line each)

| Version             | Avg perf | What it tried                                                  |
| ------------------- | -------- | -------------------------------------------------------------- |
| v0.1                | 8.1 s    | Baseline — algorithm proved out, but strokes too small at A3   |
| v0.2                | 12.6 s   | Bigger strokes + weighted-random palette — wind-stub wrecked it |
| v0.3                | 15.8 s   | Wind override off; flat-region random angle — image readable   |
| v0.4                | 19.8 s   | Stronger gradient-length response — first museum line-of-sight |
| v0.5 (palette-comp) | 31 s     | 1 source × 5 palettes — palette = signature confirmed          |
| v0.6                | 19.7 s   | Marc + Nolde palettes added (set now 7)                        |
| v0.7 (palette-comp) | 28.3 s   | 1 source × all 7 palettes; comparison-mode generalised         |
| v0.8                | 18.1 s   | 5 scenes; storm-seascape & mountain-twilight added — strongest yet |
| v0.9-dense          | 33.5 s   | density 0.10 experiment — overpainted source, NEGATIVE result  |
| v1.0-impasto        | 15.6 s   | low density + long stroke + bigger thickness — wins everywhere |
| v1.1-faithful       | 43.9 s   | Restored to-pointillism reference fidelity per user redirect   |
| v1.2 (fast median)  | 26.4 s   | Huang's algorithm; back into PASS                              |
| v1.3-expressionist  | 39.6 s   | Curated × 7 palettes in expressionist mode — museum bar reached |
| best-of gallery     | n/a      | 3×2 A3 composite of strongest outputs across all iterations    |
| v1.4-mid-stroke     | 22.7 s   | width-mm=1.2 sweet spot — museum-bar AT PASS perf              |
| v1.5-palette-comp   | 24.5 s   | alpine × 7 palettes at v1.4 settings (true-v1.4 Marc cell)     |
| v1.6-palette-comp   | 24.7 s   | Klimt + Macke palettes added (set now 9); alpine × 9           |
| v1.7-new-scenes     | 21.6 s   | urban-dusk + desert-noon scene factories added                  |
| v1.8 7-scene corp.  | 22.8 s   | full 7-scene v1.4 corpus (urban-dusk → Whistler re-pair)       |
| v1.9-snow-blizzard  | 20.1 s   | snow-blizzard scene → Turner pairing                            |
| v1.10-canyon        | 23.1 s   | canyon scene → Marc; SCENES now 9; only Klimt palette-only     |
| v1.11-manual-raster | 14.6 s   | manual ImageData rasterisation NEGATIVE result (slower than canvas) |
| v1.12-matrix        | 24-27 s  | 9×9 matrix complete: 81 cells, exhibition/matrix-9x9.png       |

---

## Project status: complete

The 33-cycle Phase 2.5 sprint has produced a complete museum-submission
bundle plus a closing release. All artifacts are reproducible,
deterministic, and archived to GitHub. The autonomous queue is genuinely
empty for substantive deliverables — nothing remaining is blocking the
user's stated goal of museum exhibition. Cron `0acf8fd4` keeps firing
maintenance-mode polish at 30-min intervals; can be ended with
`CronDelete 0acf8fd4` whenever you wish.

**What's shipped:**
- 9 source-scene types × 9 curated painter palettes (the full 81-cell
  corpus rendered)
- 5 named gallery layouts: best-of-mixed, v1.4-curation (6-cell),
  v1.4-eight-scenes, v1.4-nine-scenes, exhibition-six (3×2),
  v1.4-nine-painters (3×3 alpine source × 9 painters)
- 6-plate `exhibition/` package: print PNGs (12-14 MB each), web JPEGs
  (~400 KB each), source-and-painted process plates, contact sheet
- **9×9 matrix contact sheet** (`exhibition/matrix-9x9.png`, 33 MB
  print + 503 KB web JPEG) — every scene × every painter, the project's
  thoroughness statement
- Audience-specific docs: `EXHIBITION.md` (curator wall labels),
  `exhibition/PRESS-KIT.md` (journalist summary), `exhibition/README.md`
  (operational index), `docs/EXHIBITION-CHECKLIST.md` (pre-submission
  practical checklist), `RELEASE-NOTES.md` (v1.4 changelog)
- Licensing: `LICENSE` (MIT, software), `LICENSE-ART.md`
  (CC BY-NC-SA 4.0, rendered artworks; CC0 1.0 for palette JSON)
- v1.4 reference-faithful AND v1.4 expressionist modes both shipping
  PASS-perf museum-bar output (~22-26 s avg per A3 print)
- npm script aliases: `npm run pointillism|gallery|matrix|thumbnails|process-plates`
- Determinism contract intact (mulberry32 seed; same input = same output)

**What's not shipped (intentionally deferred):**
- Real Three.js render integration (requires browser; outside the
  autonomous loop's reach — wired in `ControlsPanel.js` but visual QA
  needs the user)
- Phase 3 vegetation, Phase 4 scenic-default, Phase 5 multi-sensory
  (weather/astronomy/wildlife)
- Floating-buildings investigation (parked; needs user-supplied test
  location/screenshot)

## Active queue (in order; pick top item that's not blocked)

1. ~~**Manual ImageData ellipse rasterisation perf optim.**~~ ✗ Cycle 20 —
   ~16% SLOWER than canvas-API. Behind `--manual-raster` flag; do not
   enable for perf.
2. ~~**Tighter best-of gallery curation.**~~ ✅ Cycle 13 — v1.4-curation
   gallery rebuilt with 100% v1.4 cells (Marc cell promoted from v1.3 to
   v1.5 in cycle 13).
3. ~~**Explore mid-range stroke width.**~~ ✅ Cycle 11 — v1.4 at 1.2 mm
   landed museum-bar at PASS perf. Now the recommended expressionist
   preset.
4. ~~**More curated palettes.**~~ ✅ Cycle 14 — Klimt golden + Macke
   Tunisian added; palette set now 9 painters.
5. **Real-render integration.** All current testing is on synthetic canvas
   sources. The real test is on Three.js terrain renders in-browser. The
   "Test pointillism" button in `ControlsPanel.js` is wired and works, but
   the user has to run `npm run dev` and click it — outside the autonomous
   loop's reach. **Pending user gate.**

The substantive queue is now empty. Future autonomous cycles operate in
maintenance mode (verify links, regenerate artifacts on source changes,
small polish if real gaps exist).

## Parked items (need user input)

- **Floating buildings**: full investigation in `.iterations/blockers.md`
  entry 2026-04-29. Defensive 30 cm inset hedge applied. Three repair options
  documented (per-vertex anchoring / tilted base / excavation skirt).
  Awaiting user-supplied test location or screenshot.

---

## Conventions (for cycle continuity)

- **Cycle close requires:** (a) at least one concrete change; (b) build or
  test run; (c) `.iterations/session-YYYYMMDD-HHMM.md` note; (d) `git add . &&
  git commit && git push origin main` so /loop and cloud routine stay in sync.
- **Iteration directory naming:** `.iterations/2026-MM-DD-pointillism-<vN.M>[-tag]/`.
  PNGs + notes.md + timing.json per directory.
- **Session note structure:** one paragraph per cycle. State what was picked
  from the queue, what concrete change shipped, the verdict (PASS / BORDERLINE
  / FAIL), and 2–4 next-cycle hints.
- **Commit messages:** `Phase 2.5 <version> — <one-line summary>` with a body
  that explains what changed and what the perf/visual verdict was.
- **Never ask permission** for tool use, file edits, or dep installs in this
  repo (full autonomy granted by the user). Genuine blockers go in
  `.iterations/blockers.md` with proposed-options-for-the-user, then move on
  to a different queue item.

---

## North Star

> Produce expressionist landscape paintings worthy of exhibition at a major
> digital-art museum.

The **v1.4-mid-stroke expressionist preset** (`--curated --no-median
--width-mm=1.2 --brush-stroke=2.0 --density=0.03`) is the current
recommended default for museum-bar output, at 22-26 s per A3 print.
The v1.4-faithful pipeline (default DEFAULTS in `Pointillism.js`)
remains the algorithm-true baseline. Six exhibit plates and the 9×9
matrix together represent the project's full statement. Every cycle
should either (a) raise the visual bar somewhere, (b) make the existing
bar reachable faster, or (c) widen the range. Avoid feel-good refactors
that don't advance one of those.

For reproducibility from scratch: see `RELEASE-NOTES.md` for the exact
command sequence to regenerate the entire `exhibition/` bundle.
