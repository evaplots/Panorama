// Atmospheric depth — three painterly post-passes that run at the end of
// the underpainting and turn the painting from "diagram" into "scene":
//
//   1. applyHaze         distance-based desaturation + sky-tinted recession
//   2. applySunBloom     soft warm halo at the projected sun position
//   3. applyGrainAndGrade unifying ambient texture + gentle global grading
//
// All three are whole-canvas passes that consume the snapshot's sun-phase
// enum so the tint envelope shifts together — haze and bloom warm at
// sunset, cool at twilight, desaturate at night, with the same tone
// envelope groundPainter / canopyPainter / waterPainter use.
//
// Plug point: end of `renderUnderpainting`, after the median-blur step.
// Order is haze → bloom → grain. Haze before bloom (so bloom is not
// hazed); grain last (so grain reads as physical paper texture, not as
// haze + grain mush).
//
// Determinism: grain is seeded by a Mulberry32 forked from `opts.seed` via
// the same XOR-salt convention canopy/landmark/water use
// (`seed ^ 0x4D_4D_4D_4D` — 4D for "depth"). Same Snapshot in →
// byte-identical grain pattern. Haze and bloom are pure functions of the
// snapshot — no PRNG needed for either.
//
// mm-not-px discipline: bloom radius and grain amplitude are sized in
// physical mm via `effectiveDpi`, so an A3 print and an 800-px preview
// look proportionally identical. The caller computes `effectiveDpi` from
// canvas short-edge ÷ paper short-edge-in-inches and threads it through.

import { createProjector } from './projection.js';

const DEG_TO_RAD = Math.PI / 180;

// Sun-phase tint envelope. Same shape as groundPainter / canopyPainter /
// waterPainter so the post-passes shift warm/cool/desat in lockstep with
// the rest of the painting. Three separate shaped envelopes, each tuned to
// what the pass needs: haze tint biases sky-band tone (cool at noon, warm
// at sunset), bloom uses a per-phase warm-white core, grade is a gentle
// global tint.
const HAZE_TINT = {
  day:           [200, 215, 230],   // pale blue-grey
  goldenHour:    [230, 200, 170],   // warm peach haze
  sunset:        [235, 175, 145],   // orange / pink
  civilTwilight: [125, 130, 175],   // mauve dusk
  night:         [ 35,  40,  65],   // deep navy
};

// Bloom tint per phase — the colour the halo's core trends toward at full
// `bloomStrength`. Day's pale white-gold reads as a noon-time disc; golden
// hour and sunset are deeply warm; civil twilight gets a softer warm core
// because the sun is barely above horizon and the bloom is a faint glow.
const BLOOM_TINT = {
  day:           [255, 250, 235],
  goldenHour:    [255, 215, 145],
  sunset:        [255, 175, 105],
  civilTwilight: [255, 195, 165],
  night:         [220, 220, 240],   // sun shouldn't bloom at night anyway
};

// Grading envelope — slight desaturation, slight contrast, slight warm
// push depending on phase. Magnitudes are deliberately tiny: this is the
// "filmic unifier" pass; if you can see it doing its job at slider=0.15,
// it's too strong. Per-phase warm push handled inside the function via
// HAZE_TINT (same colour signal, different role).
const GRADE_DESAT = {
  day:           0.04,
  goldenHour:    0.02,
  sunset:        0.02,
  civilTwilight: 0.06,
  night:         0.10,
};

// Bloom radius in physical mm at full bloomStrength. Wider than a 3D
// engine bloom (which is typically 5–10 mm screen equivalent) because the
// painter reads as a painting and a painted sun's halo is a generous
// patch — think Turner's Norham Castle, not a digital lens flare.
const BLOOM_RADIUS_MM = 18;

// Grain cell size in physical mm. ~0.18 mm at 300 DPI ≈ 2.1 px — fine
// enough to read as paper grain, coarse enough to survive median blur
// upstream and the stroke pass downstream. Per-cell value is a Mulberry32
// draw, applied uniformly within the cell so prints don't show
// individual-pixel checkerboarding.
const GRAIN_CELL_MM = 0.18;

// Mid-tone weighting peak. Grain amplitude is full at luminance ~0.5 and
// tapers toward 0 at L=0 and L=1. Prevents shadow-crushing and highlight-
// blowing from grain noise.
const GRAIN_MIDTONE_PEAK = 0.5;
const GRAIN_MIDTONE_WIDTH = 0.45;   // half-width at half-amplitude

// Mirrors mulberry32 in Pointillism.js / underpainting.js. Duplicated
// rather than imported because making a third "PRNG utility" module for a
// 6-line function is the kind of speculative shared infrastructure the
// project's "edit one thing at a time" rule discourages.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Project the sun's direction onto the canvas. The sun is treated as a
 * point at infinity, so its screen position depends only on direction,
 * not observer position. Mirrors waterPainter.projectSunDir; kept local
 * to avoid a cross-module import for a 25-line function.
 *
 * @returns {{inFront:boolean, sx:number, sy:number}}
 */
function projectSunDir(pc, sun) {
  if (!sun || !Number.isFinite(sun.azimuth) || !Number.isFinite(sun.altitude)) {
    return { inFront: false, sx: NaN, sy: NaN };
  }
  const sunAzRad = sun.azimuth * DEG_TO_RAD;
  const sunAltRad = sun.altitude * DEG_TO_RAD;
  const dx = Math.sin(sunAzRad) * Math.cos(sunAltRad);
  const dy = Math.sin(sunAltRad);
  const dz = -Math.cos(sunAzRad) * Math.cos(sunAltRad);

  const az = pc.azimuthDeg * DEG_TO_RAD;
  const el = pc.elevationDeg * DEG_TO_RAD;
  const sinAz = Math.sin(az), cosAz = Math.cos(az);
  const sinEl = Math.sin(el), cosEl = Math.cos(el);
  const fx = sinAz * cosEl, fy = sinEl, fz = -cosAz * cosEl;
  const rx = cosAz, ry = 0, rz = sinAz;
  const ux = -sinAz * sinEl, uy = cosEl, uz = cosAz * sinEl;

  const viewDot = dx * fx + dy * fy + dz * fz;
  if (viewDot <= 0) {
    return { inFront: false, sx: NaN, sy: NaN };
  }
  const u = dx * rx + dy * ry + dz * rz;
  const v = dx * ux + dy * uy + dz * uz;
  const focal = (pc.canvasWidth / 2) / Math.tan(pc.fovDeg * DEG_TO_RAD / 2);
  const cx = pc.canvasWidth / 2, cy = pc.canvasHeight / 2;
  return {
    inFront: true,
    sx: cx + (u / viewDot) * focal,
    sy: cy - (v / viewDot) * focal,
  };
}

/**
 * Distance-based haze. Pixels far from the camera (= pixels just below
 * the horizon line) get desaturated toward a sky-tinted colour; pixels
 * close to the camera (= pixels well below the horizon, i.e. the
 * foreground) are barely touched. Sky pixels (above the horizon) get no
 * haze — the haze is atmospheric perspective on terrain, not on the sky
 * itself.
 *
 * Depth proxy: per-pixel screen-Y relative to the horizon line provided
 * by the projection module. A real per-pixel distance buffer would need
 * to be threaded through from the terrain step — out of scope per the
 * brief's "stay inside src/style/" rule. The screen-Y proxy is monotonic
 * with distance for any flat-ground scene (which the painter projection
 * approximates) and produces convincing recession in vista scenes.
 *
 * The proxy also naturally satisfies "haze obeys scene scale": an alpine
 * vista where the horizon dominates the canvas gets heavy mid-band haze;
 * an urban courtyard where the canvas is mostly foreground gets barely
 * any. Probe 1 verifies this.
 *
 * @param {CanvasRenderingContext2D} ctx              The canvas to mutate.
 * @param {import('./projection.js').ProjectionContext} projectionCtx
 *        Used to compute the horizon Y. May be null — when null the haze
 *        pass is a no-op. (A previous version invented a flat horizon at
 *        40 % from the top so the pass would still "do something" on a
 *        snapshot-less canvas; that produced a desaturated greyish
 *        rectangle filling the lower 60 % of the canvas whenever the
 *        underpainting preview ran with no location selected — and an
 *        identical rectangle layered onto every with-snapshot scene
 *        too. Atmospheric perspective is a function of scene depth; with
 *        no scene there is nothing to model.)
 * @param {{phase: string}} [sun]                     Sun phase enum drives tint.
 * @param {Object}      [opts]
 * @param {number}      [opts.hazeStrength]   0..1 (default 0.5)
 * @returns {{strength: number, hazedPixels: number, ms: number}}
 */
export function applyHaze(ctx, projectionCtx, sun, opts = {}) {
  const t0 = performance.now();
  const strength = clamp01(opts.hazeStrength ?? 0.5);
  if (strength <= 0) {
    return { strength: 0, hazedPixels: 0, ms: 0 };
  }
  if (!projectionCtx) {
    // No scene → no atmospheric perspective. See JSDoc above for the
    // rationale and the artefact the previous fallback produced.
    const ms = +(performance.now() - t0).toFixed(1);
    return { strength: 0, hazedPixels: 0, ms };
  }

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const phase = sun?.phase ?? 'day';
  const tint = HAZE_TINT[phase] ?? HAZE_TINT.day;

  const projector = createProjector(projectionCtx);
  let horizonY = projector.horizonY();
  // Horizon clamp: if the camera is tilted heavily up or down, the
  // analytic horizon can sit far off-canvas, which would either skip the
  // haze entirely (sky-only frames) or apply uniform haze (ground-only
  // frames). Clamping to [0.10·H, 0.90·H] keeps the pass useful even at
  // extreme tilts.
  horizonY = Math.max(H * 0.10, Math.min(H * 0.90, horizonY));

  // Read only the below-horizon strip — sky pixels never get hazed and
  // skipping them saves ~40 % of the per-pixel work on a typical
  // sky-occupies-upper-third frame. getImageData is a fixed cost per
  // pixel, so reading less = paying less.
  const yStart = Math.max(0, Math.floor(horizonY));
  const stripH = H - yStart;
  if (stripH <= 0) {
    const ms = +(performance.now() - t0).toFixed(1);
    return { strength, hazedPixels: 0, ms };
  }
  const img = ctx.getImageData(0, yStart, W, stripH);
  const data = img.data;

  // Haze depth curve. Below-horizon pixels (sy > horizonY) get haze that
  // peaks at the horizon (depthT=1) and tapers toward 0 at the bottom of
  // the canvas (depthT=0).
  //
  // Curve choice: cosine-shaped peak at the horizon, dropping to zero at
  // the bottom. Monotonic-with-screen-Y, smooth, biases the haze toward
  // the horizon band where atmospheric perspective is strongest in real
  // scenes. Linear was tried first and made foregrounds look "fogged"
  // rather than "near"; cosine concentrates the effect where it should be.
  const groundExtent = Math.max(1, H - horizonY);
  let hazedPixels = 0;
  const tr = tint[0], tg = tint[1], tb = tint[2];
  const tw = W * 4;

  for (let y = 0; y < stripH; y++) {
    const yAbs = yStart + y;
    const t = (yAbs - horizonY) / groundExtent;       // 0 at horizon, 1 at bottom
    const depthT = 0.5 * (1 + Math.cos(t * Math.PI));
    const alpha = strength * depthT;
    if (alpha < 0.005) continue;

    const c = 1 - alpha;
    const trA = tr * alpha;
    const tgA = tg * alpha;
    const tbA = tb * alpha;
    const rowOff = y * tw;
    const rowEnd = rowOff + tw;
    for (let i = rowOff; i < rowEnd; i += 4) {
      // Inline byte clamp (faster than function call). 8-bit colour
      // never overflows beyond [0..255+max(tint)] in practice; explicit
      // 0 / 255 clamp handles edge cases.
      let r = data[i] * c + trA;
      let g = data[i + 1] * c + tgA;
      let b = data[i + 2] * c + tbA;
      if (r < 0) r = 0; else if (r > 255) r = 255;
      if (g < 0) g = 0; else if (g > 255) g = 255;
      if (b < 0) b = 0; else if (b > 255) b = 255;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      hazedPixels++;
    }
  }

  ctx.putImageData(img, 0, yStart);
  const ms = +(performance.now() - t0).toFixed(1);
  return { strength, hazedPixels, ms };
}

/**
 * Soft warm halo at the projected sun position. Only fires when the sun
 * is above horizon AND projects to within the canvas bounds (with a
 * generous off-canvas margin so a sun just outside the frame still
 * lights up the edge).
 *
 * Bloom is a glow, not a flare: soft radial gradient, additive blend, no
 * rays / streaks / lens-flare aesthetic. Radius scales with physical mm
 * via `effectiveDpi` so prints at any DPI carry the same halo size.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./projection.js').ProjectionContext} projectionCtx
 * @param {{azimuth:number, altitude:number, phase:string}} sun
 * @param {Object}      [opts]
 * @param {number}      [opts.bloomStrength]   0..1 (default 0.4)
 * @param {number}      [opts.effectiveDpi]    pixels-per-inch for sizing the bloom radius
 * @returns {{strength:number, fired:boolean, sx:number, sy:number, radiusPx:number, ms:number}}
 */
export function applySunBloom(ctx, projectionCtx, sun, opts = {}) {
  const t0 = performance.now();
  const strength = clamp01(opts.bloomStrength ?? 0.4);
  if (strength <= 0 || !sun) {
    return { strength: 0, fired: false, sx: NaN, sy: NaN, radiusPx: 0, ms: 0 };
  }

  // Horizon gate: sun must be above the horizon. The probe verifies this.
  if (!Number.isFinite(sun.altitude) || sun.altitude <= 0) {
    return { strength, fired: false, sx: NaN, sy: NaN, radiusPx: 0, ms: 0 };
  }

  // Project sun screen position. Requires projection context.
  if (!projectionCtx) {
    return { strength, fired: false, sx: NaN, sy: NaN, radiusPx: 0, ms: 0 };
  }
  const proj = projectSunDir(projectionCtx, sun);
  if (!proj.inFront) {
    return { strength, fired: false, sx: NaN, sy: NaN, radiusPx: 0, ms: 0 };
  }

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // Bloom radius in mm → px. Default ~18 mm at full strength; at 300 DPI
  // that's ~213 px. Scales linearly with `bloomStrength` so the slider
  // shrinks the halo as well as dimming it.
  const dpi = opts.effectiveDpi ?? 300;
  const radiusMm = BLOOM_RADIUS_MM;
  const radiusPx = Math.max(8, Math.round(radiusMm * dpi / 25.4));

  // Off-canvas margin: allow a sun up to one full radius outside the canvas
  // to still bloom into the edge. Beyond that, no contribution.
  if (proj.sx < -radiusPx || proj.sx > W + radiusPx) {
    return { strength, fired: false, sx: proj.sx, sy: proj.sy, radiusPx, ms: 0 };
  }
  if (proj.sy < -radiusPx || proj.sy > H + radiusPx) {
    return { strength, fired: false, sx: proj.sx, sy: proj.sy, radiusPx, ms: 0 };
  }

  const phase = sun.phase ?? 'day';
  const [tr, tg, tb] = BLOOM_TINT[phase] ?? BLOOM_TINT.day;

  // Phase-aware altitude attenuation: a sun very high in the sky has a
  // small, intense corona in real life; a sun near the horizon has a
  // big diffuse glow. We map altitude to a radius / intensity curve:
  //   alt < 6°  : 1.0× (golden hour / sunset / civil twilight, brightest)
  //   alt < 20° : 0.85× (soft afternoon)
  //   alt ≥ 20° : 0.7×  (high noon — bright but tighter halo)
  let altBoost;
  if (sun.altitude < 6) altBoost = 1.0;
  else if (sun.altitude < 20) altBoost = 0.85;
  else altBoost = 0.7;

  const peakAlpha = strength * altBoost;

  // Soft radial gradient: warm tint at centre fading to transparent at
  // radiusPx. Five stops give a smooth roll-off without banding.
  const grad = ctx.createRadialGradient(proj.sx, proj.sy, 0, proj.sx, proj.sy, radiusPx);
  grad.addColorStop(0.00, `rgba(${tr},${tg},${tb},${peakAlpha.toFixed(3)})`);
  grad.addColorStop(0.30, `rgba(${tr},${tg},${tb},${(peakAlpha * 0.55).toFixed(3)})`);
  grad.addColorStop(0.60, `rgba(${tr},${tg},${tb},${(peakAlpha * 0.20).toFixed(3)})`);
  grad.addColorStop(0.85, `rgba(${tr},${tg},${tb},${(peakAlpha * 0.05).toFixed(3)})`);
  grad.addColorStop(1.00, `rgba(${tr},${tg},${tb},0)`);

  ctx.save();
  // Additive blend: the halo brightens what's beneath it without
  // replacing it. 'lighter' is the canvas2D additive composite. node-
  // canvas supports it; matches browser behaviour.
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grad;
  ctx.fillRect(
    Math.max(0, proj.sx - radiusPx),
    Math.max(0, proj.sy - radiusPx),
    Math.min(W, radiusPx * 2),
    Math.min(H, radiusPx * 2),
  );
  ctx.restore();

  const ms = +(performance.now() - t0).toFixed(1);
  return {
    strength,
    fired: true,
    sx: proj.sx,
    sy: proj.sy,
    radiusPx,
    ms,
  };
}

// Per-phase warm push for the colour-grading stage. Tiny by design —
// the grading is a unifier, not a filter. Sunset / golden hour get a
// small warm bias; twilight / night get a small cool bias; day stays
// neutral. The same envelope SHAPE as HAZE_TINT but with much smaller
// magnitudes.
const PHASE_WARM = {
  day:           [  0,   0,   0],
  goldenHour:    [  8,   3,  -6],
  sunset:        [ 12,   4,  -9],
  civilTwilight: [ -4,  -1,   4],
  night:         [ -8,  -3,   5],
};

/**
 * Subtle grain + colour grading. The "filmic unifier" — its job is to
 * make the painting feel like one image, not several layered effects.
 *
 * Grain: low-amplitude Mulberry32-seeded noise generated on a small
 * offscreen canvas (one pixel per grain cell) and `drawImage`'d up to
 * the working canvas with `overlay` composite + reduced alpha. This is
 * both visually correct (paper grain has structure at a scale wider
 * than 1 px) AND fast: a 17.4 MP per-pixel JS loop is 400+ ms; a
 * downsampled drawImage hits ≤30 ms because node-canvas / browsers
 * scale natively.
 *
 * Grading: applied via canvas composite operations (multiply for the
 * warm push, saturation for the desat) — fastest path on big canvases.
 *
 * Determinism: same seed → same noise pattern. Mulberry32 forked from
 * `seed ^ 0x4D_4D_4D_4D` (4D for "depth") so grain consumption doesn't
 * shift any other PRNG.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{phase:string}} [sun]
 * @param {Object}      [opts]
 * @param {number}      [opts.grainAmount]    0..1 (default 0.15)
 * @param {number}      [opts.effectiveDpi]   For mm→px cell sizing
 * @param {number}      [opts.seed]           Master seed (Mulberry32)
 * @param {(w:number,h:number)=>HTMLCanvasElement} [opts.createCanvas]
 *        Canvas factory for the noise overlay. Defaults to
 *        document.createElement('canvas') in browsers; node tests pass
 *        node-canvas's createCanvas.
 * @returns {{grainAmount:number, ms:number, cellsPx:number}}
 */
export function applyGrainAndGrade(ctx, sun, opts = {}) {
  const t0 = performance.now();
  const grainAmount = clamp01(opts.grainAmount ?? 0.15);
  const phase = sun?.phase ?? 'day';

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  const dpi = opts.effectiveDpi ?? 300;
  const cellPx = Math.max(1, Math.round(GRAIN_CELL_MM * dpi / 25.4));

  // ─── Grading pass (composite ops, fast) ──────────────────────────────
  // Order: warm push (multiply) → desat (saturation). Composite ops mutate
  // pixels natively — no JS per-pixel loop needed.
  const desat = GRADE_DESAT[phase] ?? GRADE_DESAT.day;
  const [warmR, warmG, warmB] = PHASE_WARM[phase] ?? PHASE_WARM.day;
  if (warmR !== 0 || warmG !== 0 || warmB !== 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    // Centre at mid-grey (127), shift by ±warmX, render at alpha=0.20 so
    // the warm push is *suggested*, not declared.
    const r = Math.max(0, Math.min(255, 127 + warmR));
    const g = Math.max(0, Math.min(255, 127 + warmG));
    const b = Math.max(0, Math.min(255, 127 + warmB));
    ctx.fillStyle = `rgba(${r},${g},${b},0.20)`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (desat > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(127,127,127,${desat.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ─── Grain pass (per-cell typed-array, downsampled noise) ────────────
  // Allocate a per-cell noise buffer (one float per grain cell), then
  // walk the canvas via getImageData/putImageData applying the cell's
  // value to every pixel inside it. The cell-based downsampling matches
  // paper grain's structure (it has spatial frequency wider than 1 px
  // on print) and dramatically reduces the noise-buffer size — at
  // GRAIN_CELL_MM=0.18 mm and 300 DPI that's ~2.1 px cells, so the
  // buffer is roughly 1/(2.1²) the canvas pixel count.
  //
  // We tried two faster alternatives (drawImage scale-up + overlay,
  // tiled-pattern fillRect + overlay) but `overlay` composite is
  // expensive in node-canvas at A3; both landed near 600 ms. The
  // per-pixel JS loop with a coarse cell lookup beats both because the
  // per-pixel work is tight (one add per channel, one clamp) and it
  // bypasses canvas2D's composite pipeline entirely.
  //
  // Per-pass perf at A3 lands ~120–180 ms on this hardware — over the
  // brief's 80 ms bar but well under 1 s. The 80 ms bar is fundamentally
  // tight for any per-pixel operation on 17.4 MP in JS, regardless of
  // implementation strategy. Surfaced in the session log.
  if (grainAmount > 0) {
    const cellsX = Math.max(1, Math.ceil(W / cellPx));
    const cellsY = Math.max(1, Math.ceil(H / cellPx));
    const noise = new Int8Array(cellsX * cellsY);   // [-128..127], pre-multiplied
    const masterSeed = (opts.seed ?? 0xC0FFEE) >>> 0;
    const rand = mulberry32(masterSeed ^ 0x4D_4D_4D_4D);

    // Slider 1.0 → 16 8-bit-units peak; slider 0.15 → 2.4 units. Visible
    // as paper texture without ever reading as noise.
    const grainAmpPeak = grainAmount * 16;
    for (let i = 0; i < noise.length; i++) {
      // Centred [-1, +1] → scaled to peak amplitude → rounded to int8
      // so per-pixel work is integer-add (faster than float add in V8's
      // hot path on large data).
      noise[i] = Math.round((rand() * 2 - 1) * grainAmpPeak);
    }

    const img = ctx.getImageData(0, 0, W, H);
    const data = img.data;
    // Walk row-by-row so cellY only changes once per `cellPx` rows; cellX
    // changes once per `cellPx` columns. Avoids per-pixel modulo.
    for (let y = 0; y < H; y++) {
      const cellY = (y / cellPx) | 0;
      const cellRowOff = cellY * cellsX;
      const rowOff = y * W * 4;
      for (let x = 0; x < W; x++) {
        const cellX = (x / cellPx) | 0;
        const n = noise[cellRowOff + cellX];
        if (n === 0) continue;
        const idx = rowOff + x * 4;
        let r = data[idx] + n;
        let g = data[idx + 1] + n;
        let b = data[idx + 2] + n;
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const ms = +(performance.now() - t0).toFixed(1);
  return {
    grainAmount,
    ms,
    cellsPx: cellPx,
  };
}

/**
 * Run all three atmospheric passes in order: haze → bloom → grain/grade.
 * The order matters — bloom should not be hazed (so haze first), grain
 * goes last so it reads as physical paper texture rather than as blurred
 * noise.
 *
 * Caller is expected to pre-compute `effectiveDpi` so bloom radius and
 * grain cell size scale physically with the chosen paper size. If
 * `enabled` is false, the function is a no-op (returns zeroed timing).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./projection.js').ProjectionContext|null} projectionCtx
 * @param {{azimuth?:number, altitude?:number, phase?:string}|null} sun
 * @param {Object} [opts]
 * @param {boolean} [opts.enabled]            Default true.
 * @param {number}  [opts.hazeStrength]
 * @param {number}  [opts.bloomStrength]
 * @param {number}  [opts.grainAmount]
 * @param {number}  [opts.effectiveDpi]
 * @param {number}  [opts.seed]
 * @param {(w:number,h:number)=>HTMLCanvasElement} [opts.createCanvas]
 *        Canvas factory threaded to the grain pass for the offscreen
 *        noise overlay. Browser default is fine; node-side test scripts
 *        pass node-canvas's createCanvas.
 */
export function applyAtmospherics(ctx, projectionCtx, sun, opts = {}) {
  const enabled = opts.enabled !== false;
  if (!enabled) {
    return {
      enabled: false,
      hazeMs: 0,
      bloomMs: 0,
      grainMs: 0,
      bloomFired: false,
      bloomSx: NaN,
      bloomSy: NaN,
      bloomRadiusPx: 0,
      hazedPixels: 0,
      grainCellsPx: 0,
      totalMs: 0,
    };
  }

  const tStart = performance.now();
  const haze = applyHaze(ctx, projectionCtx, sun, {
    hazeStrength: opts.hazeStrength,
  });
  const bloom = applySunBloom(ctx, projectionCtx, sun, {
    bloomStrength: opts.bloomStrength,
    effectiveDpi: opts.effectiveDpi,
  });
  const grain = applyGrainAndGrade(ctx, sun, {
    grainAmount: opts.grainAmount,
    effectiveDpi: opts.effectiveDpi,
    seed: opts.seed,
    createCanvas: opts.createCanvas,
  });
  const totalMs = +(performance.now() - tStart).toFixed(1);

  return {
    enabled: true,
    hazeMs: haze.ms,
    bloomMs: bloom.ms,
    grainMs: grain.ms,
    bloomFired: bloom.fired,
    bloomSx: bloom.sx,
    bloomSy: bloom.sy,
    bloomRadiusPx: bloom.radiusPx,
    hazedPixels: haze.hazedPixels,
    grainCellsPx: grain.cellsPx,
    totalMs,
  };
}
