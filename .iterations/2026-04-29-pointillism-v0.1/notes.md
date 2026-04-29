# Pointillism v0.1 — autonomous A3 test (2026-04-29T01:02:18.573Z)

## What this is

Headless A3 @ 300 DPI perf test of `src/style/Pointillism.js`. Generated
three synthetic landscape source images, ran pointillism on each, saved
source + output PNGs.

This validates (or invalidates) the load-bearing assumption from the
architecture review: that a CPU pointillism pass at 17.4 megapixels
completes in 10–30 seconds. If it doesn't, the entire user-triggered
model needs to replan.

## Verdict

**PASS — well within the 30s user-tolerance bar.**

Average over three scenes: 8098 ms (8.1 s).

## Files

For each scene (alpine-sunset, coastal-twilight, forest-noon):
- `<scene>-source.png` — synthetic A3 input (use to evaluate "what was painted from")
- `<scene>-pointillism.png` — pointillism output (use to evaluate the painterly result)

Plus `timing.json` for the per-scene perf breakdown.

## Caveats

- These are **synthetic** sources, not real Three.js renders. The algorithm's
  behaviour on actual rendered terrain may differ — gradient density,
  stroke distribution, palette behaviour all depend on the source. The real
  visual QA (in-browser, on a real scene) is still pending.
- Node-canvas perf is a **proxy** for browser perf. Browser `ctx.ellipse`
  is generally faster than node-canvas's, so the browser run should be
  comparable or slightly quicker.
- Palette is a small hardcoded set, not the curated painter palettes the
  creative-tech reviewer recommended. Output looks generic; v0.2 swaps in
  Cézanne/Soutine/Kirchner palettes.
- v0.1 uses **gradient angle** for stroke direction (with one wind-stub
  override per scene). When the Weather module ships, real wind data
  replaces the stub.
