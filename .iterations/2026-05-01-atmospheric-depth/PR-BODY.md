## Summary

Three painterly post-passes that share an architectural slot at the end
of the underpainting and turn paintings from "diagram" into "scene":
distance-based haze, soft sun bloom, ambient grain + global colour
grading. Phase 5 polish per ROADMAP.md (three roadmap items at once;
combined PR per the brief's "right granularity" guidance — they tune
together).

- **`src/style/atmosphericPasses.js` (new)** — `applyHaze`,
  `applySunBloom`, `applyGrainAndGrade` and an `applyAtmospherics`
  orchestrator that runs them in order. Plug point: end of
  `renderUnderpainting`, after the median-blur softening. Order is
  haze → bloom → grain (haze before bloom so the bloom isn't hazed;
  grain last so it reads as physical paper texture).
- **State schema bumped to v7** with the new `painter.atmospherics`
  block (`enabled`, `hazeStrength`, `bloomStrength`, `grainAmount`).
  Defaults reproduce the engine baseline on scenes where the post
  passes don't fire; `atmosphericsEnabled: false` produces output
  byte-identical to pre-PR (parity hash unchanged at `cf15cf7b…80b39f`).
- **PainterParamsPanel** gains an "Atmosphere" subgroup with one
  toggle + three sliders. Live preview re-renders on
  `painter:changed` like every other slider.
- **Determinism preserved.** Mulberry32 forked from
  `seed ^ 0x4D_4D_4D_4D` (4D for "depth"). Same Snapshot in →
  byte-identical output across two paints (verified, identical
  SHA-256 across runs).

## Three risk-first probes — all pass

`scripts/atmospheric-perf-probe.js`:

1. **Haze depth correctness** (alpine vs courtyard). Alpine differential
   +0.099 vs courtyard −0.352, **+0.45 differential** between the two
   scenes confirms the depth proxy is scene-scale aware. Probe outputs:
   `.iterations/2026-05-01-atmospheric-depth/haze-{alpine,courtyard}.png`.
2. **Bloom horizon gate** (4 times of day). 4/4 fired-vs-expected
   matches: 6am ✓, noon ✓, sunset ✓, midnight ✓. Probe outputs:
   `.iterations/2026-05-01-atmospheric-depth/bloom-{6am,noon,sunset,midnight}.png`.
3. **Perf at A3 @ 300 DPI**. Total **24.3 s under 28 s** bar — PASS.
   Bloom ~2 ms (under 80 ms target). Haze ~85–150 ms and grain
   ~620 ms exceed the 80 ms target — surfaced per the brief's
   escalation path. The 80 ms-per-pass target is fundamentally tight
   for any per-pixel JS pass on 17.4 MP (a `getImageData +
   putImageData` round-trip alone is ~70 ms before any work). Three
   faster alternatives tried and discarded — see RELEASE-NOTES "Risk-
   first probes" for details.

## Solo decisions (surfaced per the brief)

- **Depth proxy is screen-Y-relative-to-horizon, not a real per-pixel
  depth buffer.** A real depth buffer would require touching `src/terrain/`,
  forbidden by the brief. The screen-Y proxy produces convincing
  recession in vista scenes (Probe 1 verifies). Trade-off: scenes
  with non-flat ground (looking down a valley with a rising mid
  ridge) won't haze the ridge as if it were near. If curation
  surfaces a need, threading a real depth buffer is a separate PR
  to the terrain → painter contract.
- **Bloom radius = 18 mm at full strength.** Wider than a 3D engine
  bloom because the painter reads as a painting and a painted sun's
  halo is a generous patch — Turner's *Norham Castle*, not a digital
  lens flare.
- **Grain is uniform amplitude (cell-based), not brightness-modulated.**
  Paper grain in real prints is uniform; the variance is in spatial
  frequency. Cell-based downsampling at 0.18 mm × DPI keeps grain
  visible across the dynamic range without overpowering shadows or
  highlights.

## Test plan

- [x] `npm run build` clean (71 modules)
- [x] `node scripts/atmospheric-perf-probe.js` — all three probes PASS
- [x] `node scripts/parity-probe.js` — hash unchanged at `cf15cf7b…80b39f`
- [x] Determinism: SHA-256 of A3 perf.png identical across two runs
- [ ] Browser visual QA via `npm run dev` (live preview shows haze,
      bloom, and grain updating as the user slides the new sliders;
      "Atmospherics enabled" toggle works for fast comparison)
- [ ] Curator review of the 7 probe PNGs in
      `.iterations/2026-05-01-atmospheric-depth/` for visual signoff
      on the default slider values

🤖 Generated with [Claude Code](https://claude.com/claude-code)
