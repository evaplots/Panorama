# Project state — Phase 2.5 (pointillism)

> **For the cloud routine and any cold-start session.** Read this file FIRST.
> It supersedes the older session notes for understanding "where we are." The
> session notes (`session-YYYYMMDD-HHMM.md`) remain the cycle-by-cycle log;
> this file is the running summary.

Last updated: 2026-04-29 08:09 (cycle 9 close).

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

## Test corpus (5 synthetic source scenes)

Defined in `scripts/pointillism-test.js`, each paired with a best-fit palette
when running in standard (non-comparison) mode:

1. **alpine-sunset** → Kirchner alpine cool
2. **coastal-twilight** → Munch sunset
3. **forest-noon** → Soutine landscape
4. **storm-seascape** → Nolde storm
5. **mountain-twilight** → Whistler nocturne

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

---

## Active queue (in order; pick top item that's not blocked)

1. **Manual ImageData ellipse rasterisation perf optim.** Stroke loop is the
   new bottleneck after median was optimised. Replace `ctx.beginPath +
   ctx.ellipse + ctx.fill` (~5 µs/stroke overhead) with manual pixel writes
   into ImageData using the rotated-ellipse rasterisation formula. Plausibly
   2–3× speedup on the stroke pass; would unlock expressionist-mode-as-PASS.
2. **Tighter best-of gallery curation.** v1.3-expressionist outputs uniformly
   crossed the museum bar. The current best-of-6 mixes modes; a v1.3-only
   composite might be a stronger pitch. Could rebuild via
   `scripts/build-gallery.js` with different picks.
3. ~~**Explore mid-range stroke width.**~~ ✅ Done in cycle 11 — v1.4 at
   1.2 mm landed museum-bar at PASS perf. Now the recommended expressionist
   preset.
4. **More curated palettes.** Klimt golden, Schiele linear, Macke Tunisian,
   Hokusai snow could round out the emotional registers.
5. **Real-render integration.** All current testing is on synthetic canvas
   sources. The real test is on Three.js terrain renders in-browser. The
   "Test pointillism" button in `ControlsPanel.js` is wired and works, but
   the user has to run `npm run dev` and click it — outside the autonomous
   loop's reach.

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

The v1.3-expressionist outputs are the current high-water mark. The default
v1.2-faithful is the algorithmic baseline that future variants build on.
Every cycle should either (a) raise the visual bar somewhere, (b) make the
existing bar reachable faster, or (c) widen the range. Avoid feel-good
refactors that don't advance one of those.
