import { toGrayscale, computeScharr } from './gradient.js';
import {
  extractPalette,
  extendPalette as extendPaletteFn,
  smoothGradient,
} from './algorithm.js';
import { renderUnderpainting } from './underpainting.js';

// ISO A-series short-edge in mm. The "short edge" is the same regardless of
// orientation — A3 is 297×420 mm, so portrait short = landscape short = 297.
const PAPER_SHORT_EDGE_MM = { A4: 210, A3: 297, A2: 420 };
const MM_PER_INCH = 25.4;

/**
 * Effective DPI implied by rendering this canvas at the chosen paper size.
 * Used so that brushWidthMm × effectiveDpi / 25.4 yields a stroke that
 * represents the same physical mark on the eventual print, regardless of
 * the canvas's pixel resolution.
 *
 * @param {number} canvasWidth   pixels
 * @param {number} canvasHeight  pixels
 * @param {'A4'|'A3'|'A2'} paperSize
 * @param {'portrait'|'landscape'} _orientation  accepted for API symmetry;
 *        the short-edge-in-mm is orientation-invariant for ISO A-series, so
 *        this argument doesn't change the result. min(w,h) handles whichever
 *        dimension is short on the canvas.
 * @returns {number} effective DPI
 */
export function computeEffectiveDpi(canvasWidth, canvasHeight, paperSize, _orientation) {
  const paperShortMm = PAPER_SHORT_EDGE_MM[paperSize];
  if (!paperShortMm) {
    throw new Error(`computeEffectiveDpi: unknown paperSize "${paperSize}"`);
  }
  const paperShortIn = paperShortMm / MM_PER_INCH;
  const canvasShortPx = Math.min(canvasWidth, canvasHeight);
  return canvasShortPx / paperShortIn;
}

// Default canvas factory — used in browsers. Node tests inject their own via opts.createCanvas
// (e.g. node-canvas's createCanvas), keeping this module environment-agnostic.
function browserCreateCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

// Deterministic PRNG (mulberry32) — same seed = same painting (per the
// determinism contract in DATA-CONTRACTS.md "Data → Style binding").
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULTS = {
  // v1.1-faithful baseline. Restored fidelity to guillaume-gomez/to-pointillism:
  // ColorThief-equivalent palette extraction from the rendered scene by default,
  // saturation+hue-rotation palette extension, Gaussian gradient smoothing,
  // 11×11 median-blur underpainting. The v1.0 impasto defaults (curated palette
  // by default, no smoothing, no median underpainting) were a creative drift
  // away from the reference; restored 2026-04-29 per user redirect.

  // Stroke-width as a physical measurement. brushWidthMm × effectiveDpi / 25.4
  // gives the pixel value used as the ellipse minor radius. Default 0.7 mm.
  // Effective DPI is *derived* from the source canvas dimensions and the
  // chosen target paper size — see computeEffectiveDpi above. This keeps the
  // physical stroke width contract (0.7 mm on the eventual print) intact at
  // any canvas resolution, so a 1.91 MP screen preview produces visibly
  // smaller strokes than a 17.4 MP A3 export, exactly proportional to the
  // print they each represent.
  brushWidthMm: 0.7,        // physical width, default 0.7 mm (bounds 0.3–3.0)
  targetPaperSize: 'A3',    // 'A4' | 'A3' (default) | 'A2'
  targetOrientation: 'portrait', // 'portrait' (default) | 'landscape'
  dpi: null,                // explicit DPI override; null = derive from canvas + target

  density: 0.06,            // fraction of pixels that get a stroke; reference uses
                            // ~all pixels in random order (density 1.0) but for A3
                            // that's prohibitive — 0.06 keeps run time tractable
                            // while preserving the gradient-flow look.
  brushStrokeFactor: 1.0,   // major-axis multiplier per √(gradient magnitude),
                            // matches the reference's default stroke-elongation.
  brushOpacity: 0.85,       // matches the reference's default opacity
  paletteTemperature: 28,   // softmax temperature for weighted-random palette (lower = sharper)
  flatGradientThreshold: 8, // below this gradient magnitude, stroke angle becomes random
                            // (prevents sky/water/wall regions from all raking the same way)
  windDirectionDeg: null,   // null = let gradient drive; number = bias toward wind
  windInfluence: 0.0,       // 0..1 — when windDirectionDeg is set, how strongly it pulls
                            // strokes toward wind. Default 0; needs Weather module data.

  // Palette extracted from source via median-cut (ColorThief equivalent),
  // then extended with saturation-boost + 2× hue-rotation copies.
  paletteSize: 20,          // median-cut k-value
  extendPalette: true,      // apply saturation-boost + 2× hue-rotation extension
  paletteSatBoost: 20,      // saturation boost (HSL %) for extension
  paletteHueJitter: 20,     // hue rotation range (deg) for extension

  // Underpainting smoothing
  applyMedianUnderpaint: true,  // 11×11 median blur on source before painting
  medianKernel: 11,             // square kernel size; reference uses 11

  // Step 4: data-driven snapshot. When provided with `bindings.viewpoint` and
  // `bindings.ground.osmFeatures`, the painter projects OSM polygons onto the
  // source canvas before the median-blur underpainting step, giving the strokes
  // saturated, clearly-bounded category zones to sample from. See
  // src/style/groundPainter.js and DATA-CONTRACTS.md "GroundSnapshot".
  bindings: null,

  // Water painter knobs — surfaced by PainterParamsPanel as
  // state.painter.water.*. Defaults match the panel defaults so an
  // untouched panel matches the engine baseline.
  waterReflectionStrength: 0.6,
  waterSunGlitterEnabled: true,
  waterRippleDensity: 0.4,

  // Atmospheric depth post-passes (Phase 5 polish) — three painterly
  // post-passes that run after the median-blur softening: haze, sun
  // bloom, grain + global colour grading. Surfaced by PainterParamsPanel
  // as state.painter.atmospherics.*. Defaults match the panel defaults;
  // `atmosphericsEnabled: false` is the regression-guard path (skip the
  // orchestrator entirely → byte-identical to pre-PR).
  atmosphericsEnabled: true,
  hazeStrength: 0.5,
  bloomStrength: 0.4,
  grainAmount: 0.15,

  // Gradient smoothing
  smoothGradientField: true,    // Gaussian-equivalent smoothing on dx/dy
  // smoothing radius defaults to max(w,h)/50 per the reference; can override

  // Stroke rendering backend
  manualRaster: false,          // false → Canvas2D ctx.ellipse + ctx.fill (with AA)
                                // true  → manual hit-test rasterisation into ImageData
                                //         (no AA, but skips ctx.fillStyle/path overhead).
                                // Cycle 20 finding: manual is actually ~16% SLOWER
                                // than the Canvas2D path (node-canvas's native rasterizer
                                // beats pure JS for this workload). Visually identical
                                // at production density+opacity. Kept as opt-in for
                                // pixel-exact output; do not turn on for perf.

  seed: 0xC0FFEE,
};

/**
 * Apply pointillism to a canvas. Pure function: same source + same opts = same output.
 * Returns { canvas, timing } where timing breaks down the cost.
 *
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {Partial<typeof DEFAULTS>} opts
 */
export async function applyPointillism(sourceCanvas, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { width, height } = sourceCanvas;
  const t0 = performance.now();

  const createCanvas = o.createCanvas || browserCreateCanvas;
  const rand = mulberry32(o.seed);

  // ─── Underpainting (delegate) ────────────────────────────────────────────
  // Working canvas + paintGround + paintCanopy + paintLandmarks + optional
  // median-blur softening. Lives in src/style/underpainting.js so the live
  // UnderpaintingPreviewPanel can run the same code path without paying the
  // multi-second cost of palette / gradient / strokes.
  //
  // Each painter forks its own Mulberry32 from `o.seed` via the same XOR
  // salts (canopy: seed^0xC4_C4_C4_C4, landmarks: seed^0x14_14_14_14) so
  // canopy / landmark consumption doesn't shift the stroke-pass `rand`
  // below. Byte-parity with pre-refactor output is enforced by
  // scripts/parity-probe.js.
  const { canvas: out, srcData, timing: underTiming } = await renderUnderpainting(
    sourceCanvas,
    {
      bindings: o.bindings,
      brushWidthMm: o.brushWidthMm,
      targetPaperSize: o.targetPaperSize,
      targetOrientation: o.targetOrientation,
      dpi: o.dpi,
      softenEdges: o.applyMedianUnderpaint,
      medianKernel: o.medianKernel,
      seed: o.seed,
      createCanvas,
      waterReflectionStrength: o.waterReflectionStrength,
      waterSunGlitterEnabled: o.waterSunGlitterEnabled,
      waterRippleDensity: o.waterRippleDensity,
      atmosphericsEnabled: o.atmosphericsEnabled,
      hazeStrength: o.hazeStrength,
      bloomStrength: o.bloomStrength,
      grainAmount: o.grainAmount,
    },
  );
  const ctx = out.getContext('2d');
  const tUnder = performance.now();

  // ─── Palette: extract or accept ──────────────────────────────────────────
  // Palette extraction reads from the *original* sourceCanvas, never the
  // polygon-baked working copy. When polygons cover meaningful canvas area,
  // their flat-gradient fills bias median-cut toward earth tones and starve
  // the sky band of warm/cool tones at stroke time — the painter then paints
  // sky pixels in earth colours. Underpainting + gradient still read from
  // the post-painter `srcData` returned by renderUnderpainting above, so
  // polygons still appear in the painted output.
  const paletteSourceData = sourceCanvas
    .getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, width, height);
  let palette = extractPalette(paletteSourceData, o.paletteSize);
  if (o.extendPalette) {
    palette = extendPaletteFn(palette, o.paletteSatBoost, o.paletteHueJitter, rand);
  }
  const tPalette = performance.now();

  // ─── Gradient: greyscale → Scharr → smooth ──────────────────────────────
  const gray = toGrayscale(srcData);
  const tGray = performance.now();
  let { dx, dy } = computeScharr(gray, width, height);
  if (o.smoothGradientField) {
    const r = o.gradientSmoothRadius ?? Math.round(Math.max(width, height) / 50);
    ({ dx, dy } = smoothGradient(dx, dy, width, height, r));
  }
  const tGrad = performance.now();

  // ─── Stroke pass ─────────────────────────────────────────────────────────
  // Resolve effective DPI. An explicit `dpi` opt overrides; otherwise we
  // derive from canvas short-edge ÷ target paper short-edge so the 0.7 mm
  // physical stroke contract holds at any source resolution.
  const effectiveDpi = o.dpi != null
    ? o.dpi
    : computeEffectiveDpi(width, height, o.targetPaperSize, o.targetOrientation);
  const brushThicknessPx = Math.max(
    1,
    Math.round(o.brushWidthMm * effectiveDpi / 25.4),
  );

  const strokeCount = Math.floor(width * height * o.density);
  const paletteLen = palette.length;
  const data = srcData.data;

  ctx.globalAlpha = o.brushOpacity;
  const windRad = o.windDirectionDeg !== null
    ? o.windDirectionDeg * Math.PI / 180
    : null;
  const windInfluence = Math.max(0, Math.min(1, o.windInfluence));
  const flatThreshold = o.flatGradientThreshold;

  const probs = new Float32Array(paletteLen);
  const temperature = o.paletteTemperature;

  // Manual rasterisation: pre-grab the canvas ImageData for in-place writes.
  // Skips Canvas2D's per-stroke fillStyle parsing and path setup — modest
  // perf win on large stroke counts. Trade-off: no anti-aliasing on ellipse
  // edges, but at this density + opacity, AA loss is barely perceptible.
  let manualBuf = null;
  let manualImageData = null;
  if (o.manualRaster) {
    manualImageData = ctx.getImageData(0, 0, width, height);
    manualBuf = manualImageData.data;
  }
  const opacity = o.brushOpacity;
  const inv = 1 - opacity;

  for (let s = 0; s < strokeCount; s++) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(rand() * height);
    const idx = y * width + x;
    const srcIdx = idx * 4;

    const r = data[srcIdx];
    const g = data[srcIdx + 1];
    const b = data[srcIdx + 2];

    // Weighted-random palette sampling — softmax over -distance/temperature.
    // Per to-pointillism reference: nearby palette colours all have nonzero
    // probability so flat regions vibrate rather than snap to one solid hue.
    let minD = Infinity;
    for (let p = 0; p < paletteLen; p++) {
      const pc = palette[p];
      const dr = pc[0] - r, dg = pc[1] - g, db = pc[2] - b;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      probs[p] = d;
      if (d < minD) minD = d;
    }
    let probSum = 0;
    for (let p = 0; p < paletteLen; p++) {
      const w = Math.exp(-(probs[p] - minD) / temperature);
      probs[p] = w;
      probSum += w;
    }
    let pick = rand() * probSum;
    let chosen = 0;
    for (let p = 0; p < paletteLen; p++) {
      pick -= probs[p];
      if (pick <= 0) { chosen = p; break; }
    }
    const [pr, pg, pb] = palette[chosen];

    const gxv = dx[idx];
    const gyv = dy[idx];
    const mag = Math.hypot(gxv, gyv);

    let angle;
    if (mag < flatThreshold) {
      angle = rand() * Math.PI * 2;
    } else {
      angle = Math.atan2(gyv, gxv) + Math.PI / 2;
      if (windRad !== null && windInfluence > 0) {
        let delta = windRad - angle;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        angle += delta * windInfluence;
      }
    }

    const length = brushThicknessPx + brushThicknessPx * o.brushStrokeFactor * Math.sqrt(mag);

    if (manualBuf) {
      // Manual rasterisation: rotated-ellipse hit test, alpha blend in place
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rxSq = length * length;
      const rySq = brushThicknessPx * brushThicknessPx;
      // Bounding box of the rotated ellipse
      const bboxW = Math.sqrt(rxSq * cosA * cosA + rySq * sinA * sinA);
      const bboxH = Math.sqrt(rxSq * sinA * sinA + rySq * cosA * cosA);
      const x0 = Math.max(0, Math.floor(x - bboxW));
      const x1 = Math.min(width - 1, Math.ceil(x + bboxW));
      const y0 = Math.max(0, Math.floor(y - bboxH));
      const y1 = Math.min(height - 1, Math.ceil(y + bboxH));
      const prScaled = pr * opacity;
      const pgScaled = pg * opacity;
      const pbScaled = pb * opacity;
      for (let py = y0; py <= y1; py++) {
        const dyScreen = py - y;
        const dySin = dyScreen * sinA;
        const dyCos = dyScreen * cosA;
        const rowOff = py * width;
        for (let px = x0; px <= x1; px++) {
          const dxScreen = px - x;
          const lx = dxScreen * cosA + dySin;
          const ly = -dxScreen * sinA + dyCos;
          if (lx * lx / rxSq + ly * ly / rySq <= 1) {
            const bidx = (rowOff + px) * 4;
            manualBuf[bidx]     = prScaled + manualBuf[bidx]     * inv;
            manualBuf[bidx + 1] = pgScaled + manualBuf[bidx + 1] * inv;
            manualBuf[bidx + 2] = pbScaled + manualBuf[bidx + 2] * inv;
          }
        }
      }
    } else {
      ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
      ctx.beginPath();
      ctx.ellipse(x, y, length, brushThicknessPx, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (manualBuf) {
    ctx.putImageData(manualImageData, 0, 0);
  }
  const tEnd = performance.now();

  const timing = {
    underpaintMs: +(tUnder - t0).toFixed(1),
    paletteMs: +(tPalette - tUnder).toFixed(1),
    grayscaleMs: +(tGray - tPalette).toFixed(1),
    gradientMs: +(tGrad - tGray).toFixed(1),
    strokesMs: +(tEnd - tGrad).toFixed(1),
    totalMs: +(tEnd - t0).toFixed(1),
    strokeCount,
    paletteSize: paletteLen,
    brushThicknessPx,
    effectiveDpi: +effectiveDpi.toFixed(1),
    targetPaperSize: o.targetPaperSize,
    targetOrientation: o.targetOrientation,
    megapixels: +(width * height / 1e6).toFixed(2),
    groundPolygonCount: underTiming.groundPolygonCount,
    waterPolygonCount: underTiming.waterPolygonCount,
    waterGlitterDabCount: underTiming.waterGlitterDabCount,
    waterRippleDabCount: underTiming.waterRippleDabCount,
    waterMs: underTiming.waterMs,
    canopyDabCount: underTiming.canopyDabCount,
    canopyMs: underTiming.canopyMs,
    landmarkDrawnCount: underTiming.landmarkDrawnCount,
    landmarkMs: underTiming.landmarkMs,
    medianMs: underTiming.medianMs,
    paintMs: underTiming.paintMs,
    atmosphericsEnabled: underTiming.atmosphericsEnabled,
    hazeMs: underTiming.hazeMs,
    bloomMs: underTiming.bloomMs,
    grainMs: underTiming.grainMs,
    bloomFired: underTiming.bloomFired,
    hazedPixels: underTiming.hazedPixels,
    atmosphericsMs: underTiming.atmosphericsMs,
  };
  timing.projectedA3Ms = +(timing.totalMs * 17.4 / timing.megapixels).toFixed(0);

  return { canvas: out, timing };
}
