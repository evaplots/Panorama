# Style (stub)

**Status:** stub. Phase 2.5 target — the project's signature feature.

**Purpose:** Painterly stylization of the rendered scene. v0 is **pointillism**, invoked by an explicit user command after scene composition (not a real-time render mode). Style parameters are bound to real-world data: wind direction → brushstroke angle, wind speed → stroke length, etc. (See `DATA-CONTRACTS.md` for the binding.)

**Owned files (planned for v0):**
- `src/style/Pointillism.js` — single-pass CPU canvas transform; takes a rendered Three.js canvas, returns a stylized canvas
- `src/style/palettes.json` — curated painter-extracted palettes ("Cézanne Provence," "Monet Giverny," etc.) — alternative to ColorThief on the photoreal render
- `src/style/gradient.js` — Scharr gradient + Gaussian smoothing on a 2D canvas (vanilla JS, no OpenCV.js dep)

**Reference implementation:** [guillaume-gomez/to-pointillism](https://github.com/guillaume-gomez/to-pointillism) — algorithm summarised in the user's memory at `reference_pointillism_algorithm.md`. Tech: TypeScript + OpenCV.js + ColorThief; we port the algorithm without those deps.

**The 6-step pipeline (per the reference):**
1. Extract palette (curated JSON, NOT ColorThief on the render)
2. Greyscale + Scharr gradient (dx, dy)
3. Smooth gradient (Gaussian blur)
4. Median-blur the source as soft underpainting
5. Generate randomized grid of stroke centres
6. For each grid point, draw an elongated ellipse: angle = gradient + 90°, length = f(magnitude, wind speed), colour = weighted-random from palette, opacity = f(cloud cover)

**Public API (v0):**
```js
import { applyPointillism } from './style/Pointillism.js';
// `sourceCanvas` is the live Three.js render canvas
// `dataBindings` is a snapshot of the WeatherSnapshot, sky state, etc.
// (frozen at trigger time so the result is deterministic)
const stylizedCanvas = await applyPointillism(sourceCanvas, dataBindings, options);
```

**Triggering:** A button in `ControlsPanel.js` ("Transform → Pointillism"). Result becomes the input to `ExportPipeline.js`.

**Critical risk to validate before committing:** A3 @ 300 DPI is ~17.4 megapixels — 50× the typical input the reference repo handles. Prototype must measure runtime at full export resolution; if it's >60s the architecture replans (Web Worker, tiled, or accept-as-export-only-with-progress).

**Phase:** 2.5 (the v0 prototype). Future styles (Hockney-flat, Van Gogh) are post-v0 and pluggable behind the same trigger UI.
