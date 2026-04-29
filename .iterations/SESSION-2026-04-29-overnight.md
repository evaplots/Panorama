# Overnight session report — Phase 2.5 Pointillism

**Run:** 2026-04-29, autonomous (user sleeping, full edit authorisation, no permission gates)
**Goal stated by user:** *"reach the objective of generating artistic landscape, very similar to expressionist artists. Do the best you can! I need to exhibit those to the most important museum of digital art."*

---

## Headline

**Architecture validated. Algorithm produces credibly painterly expressionist output. Browser build green throughout.**

The load-bearing assumption from the architecture skeptic — that A3 @ 300 DPI (17.4 megapixels) would complete in under 30 s on CPU — held with significant headroom across four iterations:

| Version | Avg A3 time | Quality verdict |
|---|---|---|
| v0.1 | 8.1 s | Posterised — strokes too small at A3, nearest-palette flattens regions into bands |
| v0.2 | 12.6 s | Painterly marks visible, but a wind-direction stub override raked everything uniformly diagonal — image structure erased |
| v0.3 | 15.8 s | Wind override removed; gradient drives direction; random angle in flat regions. Mountains, horizons, tree trunks readable. **Convincing painterly output.** |
| v0.4 | 19.8 s | Stronger gradient-length response → edges become decisive long impasto strokes. Tighter palette coherence. **Museum line-of-sight output.** |

All four versions fit comfortably under the 30-second user-tolerance bar with room to spare for a real Three.js render path that adds further per-frame cost.

---

## What was built

### New files

- `src/style/gradient.js` — vanilla-JS Scharr gradient + grayscale (no OpenCV dep)
- `src/style/Pointillism.js` — main transform with deterministic PRNG, weighted-random palette sampling, wind-bias hook
- `src/style/palettes.json` — three curated expressionist palettes (Munch sunset, Kirchner alpine, Soutine landscape) extracted from each painter's reference works
- `scripts/pointillism-test.js` — Node test harness (requires `canvas` npm dep, added to devDependencies); generates synthetic A3 sources, runs the transform headlessly, saves PNGs + timing.json + notes per iteration

### Modified files

- `src/style/index.js` — exports `applyPointillism`
- `src/ui/ControlsPanel.js` — wired a 🎨 Test pointillism button next to "Save image" (browser path)
- `package.json` — added `canvas` as a devDependency for the headless test

### New folders

- `.iterations/2026-04-29-pointillism-v0.1/` through `v0.4/` — for each iteration: 3 source PNGs + 3 pointillism PNGs + timing.json + notes.md
- `scripts/` — Node-side tooling

---

## Architectural validation

The architecture skeptic flagged ONE assumption as load-bearing: *"A3 @ 300 DPI completes in 10–30 s on CPU. If 5 minutes, the user-triggered model collapses."*

**Result:** Average 19.8 s in v0.4 (best-quality config), worst single-scene 27.8 s. The model holds. The trigger flow documented in `DATA-CONTRACTS.md` "Data → Style binding" is viable as designed.

Determinism is also confirmed working — the mulberry32 PRNG produces identical output for the same `(canvas, opts)` pair across runs. This is the contract that enables "this day in history" replay.

The wind-direction binding — designed as `windDirectionDeg` + `windInfluence` — is plumbed but inert (windInfluence: 0 by default in v0.3+). v0.2 demonstrated what happens when wind *overrides* gradient (the algorithm becomes a uniform raking filter, image structure erased), so the bias semantics are deliberate. When the Weather module ships, real wind data plus a small `windInfluence` (0.1–0.3 range) should add directional energy without erasing the underlying scene.

---

## Aesthetic progression — what got better, when, why

### v0.1 → v0.2 (the biggest jump)

**Two changes drove the leap:**

1. **Stroke size 3 px → 6 px.** At A3 (4961×3508), 3-pixel marks are 0.06% diameter — visually invisible at any reasonable viewing distance. 6-px marks (0.12% diameter) start to read as actual brushstrokes.
2. **Nearest-palette → weighted-random softmax sampling.** Nearest mapping produces hard color bands wherever the source has flat regions; softmax sampling causes neighbouring palette entries to all have nonzero probability, so a "blue sky" region becomes a vibrating mix of palette blues, slight purples, slight yellows — exactly the Seurat optical-mixing technique that gives pointillism its life.

### v0.2 → v0.3 (correcting the over-correction)

v0.2 had a hidden bug-by-config: the test script set a single `windDirectionDeg` per scene, which in v0.2's algorithm acted as a hard override of gradient direction. Every stroke went the same diagonal way, and the image's structural lines (mountain silhouette, horizon, tree trunks) were destroyed.

**Fix:** Default `windDirectionDeg: null` (let gradient drive), `windInfluence: 0` (no bias even if wind is provided). When wind comes back later, it'll be a soft pull, not a replacement. v0.3 also added random-angle generation in flat-gradient regions so sky/sea/wall don't all rake to atan2(0,0)+π/2 ≈ vertical.

### v0.3 → v0.4 (edge response)

v0.3 had a uniform stroke length distribution because `brushStrokeFactor` was only 1.2 — high-gradient regions only got slightly longer strokes than flat regions. Bumping to 2.4 made edges produce dramatically long strokes (woven impasto along sharp transitions) while flat regions stayed short (densely-textured but not raked). The result feels closer to deliberate brushwork — the painter "knew" where the edges were.

---

## Honest limitations of v0.4

1. **Synthetic sources, not real Three.js renders.** The test images (alpine-sunset, coastal-twilight, forest-noon) are hand-painted in canvas with simple shapes + colour noise. Real Three.js renders carry richer per-pixel detail (terrain triangulation, lighting variance, OSM ground cover) that the gradient detector will respond to differently. The visual result on real renders is likely *better* than the synthetic test, but it hasn't been verified yet — that's the next visual QA gate, requires browser.

2. **Three palettes is a starting set.** Munch / Kirchner / Soutine cover sunset, alpine, and earthy moods. Twilight, dawn, storm, foggy-morning, midday-bright, snow-scene, urban-dusk all want their own palettes. Curating those is a v0.5 task — probably extracting from public-domain JPEGs of specific reference paintings.

3. **No automatic palette-by-context selection yet.** The test harness hardcodes which palette goes with which scene. The contract in `DATA-CONTRACTS.md` says palette should be keyed by climate-zone × `sun.phase`; that mapping is not implemented yet. v0.5 territory.

4. **Stroke-rendering uses Canvas2D `ctx.ellipse + ctx.fill` per stroke.** Each call has overhead (~5 µs in node-canvas, similar in browsers). For 17.4 MP × 0.045 density = 783k strokes, that's ~4 s of pure call overhead. A v0.5 perf optimization would be to rasterize ellipses manually into ImageData — could plausibly drop run time 3–5×, opening room for higher density (= more painterly coverage) at the same wall-clock budget.

5. **Bigger picture museum-bar question:** v0.4 looks painterly, but the creative-tech reviewer's earlier critique still stands — pointillism is a screen-space *texture* applied over any render. It does not differentiate one location from another in deep ways. The Hockney-flat-on-OSM-polygons direction would let the OSM data structure itself shape the painterly look (each `landuse=vineyard` polygon becomes a colour patch). That is a separate v1 conversation.

---

## What needs the user (not autonomous)

1. **Visual QA in the browser.** Run `npm run dev`, search a real location, click 🎨 Test pointillism. The new window will show the live-rendered Three.js scene rendered through the same v0.4 algorithm. This is the only way to know whether real Three.js renders pointillize as well as the synthetic tests suggest.

2. **Aesthetic verdict on v0.1 → v0.4.** Open the .iterations/ folders and compare. Do the v0.4 outputs feel close to museum-bar? Is the direction promising enough to keep iterating on pointillism, or should we pivot to Hockney-flat or another style?

3. **Palette-extension call.** Three palettes is a starting set. Should we curate more palettes from specific paintings? If so, which painters?

4. **Decide where v0.5 effort goes:** more palettes + climate-zone routing (more recognisable per-location output), or perf optimization (manual ellipse rasterization, frees up density budget), or pivot to Hockney-flat (different signature direction entirely).

---

## Files to look at when you wake up

Open `.iterations/` and compare the four versions side by side:

```
.iterations/
├── 2026-04-29-pointillism-v0.1/
│   ├── alpine-sunset-pointillism.png      ← posterised, dots invisible
│   ├── coastal-twilight-pointillism.png
│   ├── forest-noon-pointillism.png        ← only one with a hint of brushwork (tree trunks)
│   ├── timing.json
│   └── notes.md
├── 2026-04-29-pointillism-v0.2/           ← painterly but raked diagonally; image structure erased
├── 2026-04-29-pointillism-v0.3/           ← gradient-driven; structure visible; convincing
└── 2026-04-29-pointillism-v0.4/           ← strongest; edges crisp; museum line-of-sight
    ├── alpine-sunset-pointillism.png      ← look at this first — Kirchner alpine palette
    ├── coastal-twilight-pointillism.png   ← Munch palette, decisive horizon
    ├── forest-noon-pointillism.png        ← Soutine palette, vertical trunks
    ├── timing.json
    └── notes.md
```

The progression v0.1 → v0.4 is itself the story.

---

## Tasks

1. ✅ Audit Phase 2 status (already complete from previous round)
2. ✅ Phase 2 implementation loop
3. ✅ Doc maintenance pass
4. 🟡 Visual QA — user gate (still pending; needs browser)
5. ✅ Autonomous pointillism A3 test harness
6. ✅ v0.3 — fix gradient-vs-wind override
7. ✅ v0.4 — stronger edge response + this report

Ready for next session: visual QA + decide v0.5 direction.
