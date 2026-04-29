import { toGrayscale, computeScharr } from './gradient.js';

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

// v0.2 seed palette — Munch-sunset by default. Curated palettes are loaded from
// src/style/palettes.json; pass opts.palette to override per render.
const SEED_PALETTE = [
  [255, 218, 120], [240, 158, 60], [220, 90, 70], [180, 50, 90],
  [120, 40, 100], [70, 50, 130], [40, 40, 80], [200, 220, 130],
  [120, 160, 80], [60, 100, 70], [240, 240, 220], [20, 20, 30],
];

const DEFAULTS = {
  density: 0.045,           // fraction of pixels that get a stroke
  brushThickness: 9,        // ellipse minor radius (px) — strokes need to read at A3
  brushStrokeFactor: 2.4,   // major-axis multiplier per √(gradient magnitude) — high so
                            // edges get dramatically long strokes and flat regions stay short
  brushOpacity: 0.58,       // strokes layer like real paint
  paletteTemperature: 28,   // softmax temperature for weighted-random palette (lower = sharper)
                            // tightened from 35 so each region settles into a more coherent hue
  flatGradientThreshold: 8, // below this gradient magnitude, stroke angle becomes random
                            // (prevents sky/water/wall regions from all raking the same way)
  windDirectionDeg: null,   // null = let gradient drive direction; number = bias toward wind
  windInfluence: 0.0,       // 0..1 — when windDirectionDeg is set, how strongly it pulls strokes
                            // toward wind direction. Default 0 because bias-not-override needs
                            // real wind data from Weather module to be meaningful.
  palette: SEED_PALETTE,
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

  // Soft underpainting: copy source as base, strokes overpaint.
  const createCanvas = o.createCanvas || browserCreateCanvas;
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const tCopy = performance.now();

  const gray = toGrayscale(srcData);
  const tGray = performance.now();
  const { dx, dy } = computeScharr(gray, width, height);
  const tGrad = performance.now();

  const strokeCount = Math.floor(width * height * o.density);
  const rand = mulberry32(o.seed);
  const palette = o.palette;
  const paletteLen = palette.length;
  const data = srcData.data;

  ctx.globalAlpha = o.brushOpacity;
  const windRad = o.windDirectionDeg !== null
    ? o.windDirectionDeg * Math.PI / 180
    : null;
  const windInfluence = Math.max(0, Math.min(1, o.windInfluence));
  const flatThreshold = o.flatGradientThreshold;

  // Pre-compute weighted-random palette probabilities scratch buffer.
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
    // This is the Seurat "vibration" effect: nearby palette colours all have
    // some probability, so a region settles into a mix rather than one flat hue.
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
      // Subtract minD before softmax to keep values numerically reasonable.
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

    // Stroke angle. In flat regions (low gradient), use a random angle so the
    // sky/sea/wall doesn't all rake the same way. In textured regions, follow
    // the gradient so edges (mountains, horizons, tree-trunks) read clearly.
    // If wind data is available, blend gradient with wind direction by `windInfluence`.
    let angle;
    if (mag < flatThreshold) {
      angle = rand() * Math.PI * 2;
    } else {
      angle = Math.atan2(gyv, gxv) + Math.PI / 2;
      if (windRad !== null && windInfluence > 0) {
        // Pull stroke toward wind direction. Use shortest-arc rotation so we
        // don't accidentally invert when angles wrap past ±π.
        let delta = windRad - angle;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        angle += delta * windInfluence;
      }
    }

    const length = o.brushThickness + o.brushThickness * o.brushStrokeFactor * Math.sqrt(mag);

    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
    ctx.beginPath();
    ctx.ellipse(x, y, length, o.brushThickness, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  const tEnd = performance.now();

  const timing = {
    readImageDataMs: +(tRead - t0).toFixed(1),
    copyUnderpaintingMs: +(tCopy - tRead).toFixed(1),
    grayscaleMs: +(tGray - tCopy).toFixed(1),
    gradientMs: +(tGrad - tGray).toFixed(1),
    strokesMs: +(tEnd - tGrad).toFixed(1),
    totalMs: +(tEnd - t0).toFixed(1),
    strokeCount,
    megapixels: +(width * height / 1e6).toFixed(2),
  };
  // Linear projection to A3 @ 300 DPI (4961×3508 = 17.4 MP).
  timing.projectedA3Ms = +(timing.totalMs * 17.4 / timing.megapixels).toFixed(0);

  return { canvas: out, timing };
}
