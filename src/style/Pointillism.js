import { toGrayscale, computeScharr } from './gradient.js';
import {
  extractPalette,
  extendPalette as extendPaletteFn,
  smoothGradient,
  medianBlur11,
} from './algorithm.js';

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

  // Stroke-width as a physical measurement. brushWidthMm × dpi / 25.4 gives
  // the pixel value used as the ellipse minor radius. Default 0.7 mm at 300 DPI
  // ≈ 8.27 px, matching the reference's empirical computeBrushThickness for A3.
  brushWidthMm: 0.7,        // physical width, default 0.7 mm (bounds 0.3–3.0)
  dpi: 300,                 // export DPI used to convert mm → px

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

  // Palette options. Default: extract from source via median-cut (ColorThief equivalent).
  //   palette: null            → extract from source (default)
  //   palette: [[r,g,b], ...]  → use the given palette directly
  //   (curated palettes from src/style/palettes.json must be loaded by the caller
  //    and passed via this opt — the algorithm itself is palettes-agnostic)
  palette: null,
  paletteSize: 20,          // ColorThief k-value for source extraction
  extendPalette: true,      // apply saturation-boost + 2× hue-rotation extension
  paletteSatBoost: 20,      // saturation boost (HSL %) for extension
  paletteHueJitter: 20,     // hue rotation range (deg) for extension

  // Underpainting smoothing
  applyMedianUnderpaint: true,  // 11×11 median blur on source before painting
  medianKernel: 11,             // square kernel size; reference uses 11

  // Gradient smoothing
  smoothGradientField: true,    // Gaussian-equivalent smoothing on dx/dy
  // smoothing radius defaults to max(w,h)/50 per the reference; can override

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

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, width, height);
  const tRead = performance.now();

  const createCanvas = o.createCanvas || browserCreateCanvas;
  const rand = mulberry32(o.seed);

  // ─── Palette: extract or accept ──────────────────────────────────────────
  let palette;
  if (Array.isArray(o.palette) && o.palette.length > 0) {
    palette = o.palette.map(c => [c[0], c[1], c[2]]);
  } else {
    palette = extractPalette(srcData, o.paletteSize);
  }
  if (o.extendPalette) {
    palette = extendPaletteFn(palette, o.paletteSatBoost, o.paletteHueJitter, rand);
  }
  const tPalette = performance.now();

  // ─── Median-blur underpainting ───────────────────────────────────────────
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  if (o.applyMedianUnderpaint) {
    const medianRGBA = medianBlur11(srcData.data, width, height, o.medianKernel);
    // ctx.createImageData works in both browser and node-canvas; the global
    // ImageData constructor is browser-only, so we route through ctx.
    const underData = ctx.createImageData(width, height);
    underData.data.set(medianRGBA);
    ctx.putImageData(underData, 0, 0);
  } else {
    ctx.drawImage(sourceCanvas, 0, 0);
  }
  const tUnder = performance.now();

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
  const brushThicknessPx = Math.max(
    1,
    Math.round(o.brushWidthMm * o.dpi / 25.4),
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

    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
    ctx.beginPath();
    ctx.ellipse(x, y, length, brushThicknessPx, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  const tEnd = performance.now();

  const timing = {
    readImageDataMs: +(tRead - t0).toFixed(1),
    paletteMs: +(tPalette - tRead).toFixed(1),
    underpaintMs: +(tUnder - tPalette).toFixed(1),
    grayscaleMs: +(tGray - tUnder).toFixed(1),
    gradientMs: +(tGrad - tGray).toFixed(1),
    strokesMs: +(tEnd - tGrad).toFixed(1),
    totalMs: +(tEnd - t0).toFixed(1),
    strokeCount,
    paletteSize: paletteLen,
    brushThicknessPx,
    megapixels: +(width * height / 1e6).toFixed(2),
  };
  timing.projectedA3Ms = +(timing.totalMs * 17.4 / timing.megapixels).toFixed(0);

  return { canvas: out, timing };
}
