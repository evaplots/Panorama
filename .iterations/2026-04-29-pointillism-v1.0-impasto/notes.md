# Pointillism v1.0-impasto — autonomous A3 test (2026-04-29T04:54:10.994Z)

## What this is

Headless A3 @ 300 DPI test of `src/style/Pointillism.js` (v1.0-impasto).
Three synthetic landscape source images, each rendered with a different
curated expressionist palette:

- **alpine-sunset** → kirchner-alpine (Ernst Ludwig Kirchner, Davos and Swiss alpine paintings)
- **coastal-twilight** → munch-sunset (Edvard Munch, sunset and twilight works)
- **forest-noon** → soutine-landscape (Chaïm Soutine, Céret and Cagnes landscapes)

## Verdict (perf)

**PASS — well within the 30s user-tolerance bar.**

Average over three scenes: 12638 ms (12.6 s).

## v1.0-impasto algorithm changes (vs prior)

- Brush thickness 6 px (was 3 px in v0.1) — strokes actually read at A3
- brushStrokeFactor 1.8 (was 0.5) — stronger gradient-driven length variation
- brushOpacity 0.62 (was 0.85) — strokes layer like real paint
- density 0.04 (was 0.08) — fewer strokes, but each covers more area
- Weighted-random palette sampling via softmax (was nearest-colour) — produces the Seurat "vibration" effect; flat regions become mixed instead of solid bands

## Files

For each scene:
- `<scene>-source.png` — synthetic A3 input
- `<scene>-pointillism.png` — pointillism output
Plus `timing.json` for the perf breakdown.

## Caveats (still true after v0.2)

- Synthetic sources, not real Three.js renders. Real visual QA in-browser is still pending.
- Node-canvas perf is a proxy for browser perf.
- Wind-direction binding is a randomised stub per scene (no Weather module yet).
