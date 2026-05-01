// Painterly silhouette marks for landmarks (towers, churches, monuments,
// castles, named tourist attractions). Called from applyPointillism after
// paintGround and after paintCanopy, before the median-blur underpainting.
//
// "Always visible" semantics: every landmark whose centroid projects in
// front of the camera is drawn, regardless of polygon coverage in the
// ground layer. A church inside a forest tile that didn't return ground
// polygons still gets a silhouette. The painter degrades gracefully if
// the landmarks list is empty (cold cache) — same shape as paintGround.
//
// Per-landmark recipe:
//   1. Project (lat, lon, groundY) onto the canvas. Skip if behind camera.
//   2. Pick category-specific silhouette geometry and a base height from
//      the OSM `height` tag (when present) or a sane category default.
//   3. Convert the world-space height to pixels via the same focal-length
//      math the projector uses, so a 50 m tower at 800 m depth and a 100 m
//      tower at 1600 m depth come out the same pixel height — correct
//      perspective, not flat icons.
//   4. Draw the silhouette in a category-specific painted dark tone, with
//      a small RGB nudge per sun phase baked into the tone so landmarks
//      darken with the rest of the scene without a separate compositing pass.
//
// Determinism: the only stochastic element is per-landmark stroke jitter
// (width wobble, centerline offset) which is seeded by the caller's
// Mulberry32 PRNG. Same Snapshot in → same silhouettes out.

import { createProjector } from './projection.js';

// Sun-phase tone shifts: small RGB nudges baked into the silhouette base
// colour at draw time. Lighter than groundPainter's full tint envelope
// because the silhouettes are small and a clipped overlay-pass would
// double-tint pixels that ground/canopy already coloured. Keeping this
// per-stroke means landmarks darken with the rest of the scene without a
// separate compositing pass.
const SUN_PHASE_TONE_SHIFT = {
  day:           [  0,   0,   0],
  goldenHour:    [  6,   2,  -4],
  sunset:        [  8,   4,  -6],
  civilTwilight: [ -4,  -2,   4],
  night:         [-10,  -8,   2],
};

// Per-category default heights in metres — used when the landmark has no
// OSM `height` tag. Numbers are deliberately conservative archetypes, not
// "the largest example": a typical parish-church spire is ~25 m, a town
// monument ~10 m, a tower (radio / observation) ~35 m, a castle keep ~20 m.
// Tourist attractions vary wildly (the Eiffel Tower is one, but so is a
// view-bench), so the default is small and named landmarks effectively
// rely on tag-driven height to render large.
const DEFAULT_HEIGHT_M = {
  tower:      35,
  church:     25,
  monument:   10,
  castle:     20,
  attraction: 8,
};

// Per-category silhouette base colour. Painted dark tones, deliberately
// distinct so two landmarks of different types in the same scene don't
// merge visually after the median blur.
const CATEGORY_TONE = {
  tower:      [0x2a, 0x2c, 0x33],  // cool dark grey
  church:     [0x33, 0x2c, 0x28],  // warm dark brown
  monument:   [0x3a, 0x36, 0x30],  // stone grey
  castle:     [0x3c, 0x33, 0x2a],  // warm stone brown
  attraction: [0x33, 0x33, 0x33],  // neutral dark
};

// Width-to-height ratios (silhouette base width as a fraction of height).
// These shape the mark's archetype — towers are tall and thin, monuments
// chunky, churches medium-width with a top motif.
const ARCHETYPE = {
  tower:      { widthRatio: 0.10, taper: 0.85, topShape: 'plain' },
  church:     { widthRatio: 0.30, taper: 1.00, topShape: 'cross' },
  monument:   { widthRatio: 0.45, taper: 0.40, topShape: 'plain' },
  castle:     { widthRatio: 0.85, taper: 1.00, topShape: 'crenellation' },
  attraction: { widthRatio: 0.20, taper: 0.95, topShape: 'plain' },
};

// Categories the painter recognises. Anything else is dropped at the top
// of the loop (also serves as a hardening guard against future tag drift).
const KNOWN_CATEGORIES = new Set(Object.keys(ARCHETYPE));

function rgbCss(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }

// Lighten/darken helper, matches groundPainter / canopyPainter's adjust.
function adjust(rgb, factor) {
  if (factor >= 0) {
    return [
      Math.round(rgb[0] + (255 - rgb[0]) * factor),
      Math.round(rgb[1] + (255 - rgb[1]) * factor),
      Math.round(rgb[2] + (255 - rgb[2]) * factor),
    ];
  } else {
    const f = -factor;
    return [
      Math.round(rgb[0] * (1 - f)),
      Math.round(rgb[1] * (1 - f)),
      Math.round(rgb[2] * (1 - f)),
    ];
  }
}

// Convert a world-space metres height into a pixel height on the canvas at
// a given depth. Uses the same focal length the projector computes.
//
//   apparent_angle ≈ atan(heightM / depthM)
//   pixels         = focal × tan(angle) ≈ focal × heightM / depthM   (small-angle)
//
// We use the small-angle form because depths of interest (>50 m) make the
// approximation error <0.1% — well below the painted stroke jitter.
function metresToPixels(heightM, depthM, focal) {
  if (depthM <= 0) return 0;
  return focal * heightM / depthM;
}

/**
 * Render painterly silhouettes for the landmarks in `bindings.ground.landmarks`.
 * Mutates the canvas backing `ctx`. No-ops if the list is missing or empty.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./projection.js').ProjectionContext} projectionCtx
 * @param {Array<{category:string, lat:number, lon:number, name?:string|null, heightM?:number|null}>} landmarks
 * @param {{phase: string}} [sun]
 * @param {Object} [opts]
 * @param {() => number} [opts.rand]   PRNG () → [0,1). Defaults to Math.random.
 * @returns {{landmarkCount: number, drawnCount: number}}
 */
export function paintLandmarks(ctx, projectionCtx, landmarks, sun, opts = {}) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    return { landmarkCount: 0, drawnCount: 0 };
  }

  const rand = opts.rand ?? Math.random;
  const { canvasWidth, groundY, fovDeg } = projectionCtx;
  const projector = createProjector(projectionCtx);
  // The projector closes over its own focal length; recompute it here for
  // metresToPixels because the projector doesn't expose it. Same formula
  // as projection.js → keep these two lines in sync if that ever changes.
  const focal = (canvasWidth / 2) / Math.tan(fovDeg * Math.PI / 360);

  // Project all landmarks first. Sort back-to-front so closer landmarks
  // overlap their distant neighbours, not the other way round.
  const projected = [];
  for (const lm of landmarks) {
    if (!KNOWN_CATEGORIES.has(lm.category)) continue;
    const p = projector.projectPoint(lm.lat, lm.lon, groundY);
    if (!Number.isFinite(p.sx) || p.depth <= 0) continue;
    projected.push({ lm, sx: p.sx, sy: p.sy, depth: p.depth });
  }
  if (!projected.length) {
    return { landmarkCount: landmarks.length, drawnCount: 0 };
  }
  projected.sort((a, b) => b.depth - a.depth);

  const phaseShift = SUN_PHASE_TONE_SHIFT[sun?.phase] ?? SUN_PHASE_TONE_SHIFT.day;
  function applyPhase([r, g, b]) {
    return [
      Math.max(0, Math.min(255, r + phaseShift[0])),
      Math.max(0, Math.min(255, g + phaseShift[1])),
      Math.max(0, Math.min(255, b + phaseShift[2])),
    ];
  }

  ctx.save();
  let drawn = 0;
  for (const { lm, sx, sy, depth } of projected) {
    const archetype = ARCHETYPE[lm.category];
    const tone = applyPhase(CATEGORY_TONE[lm.category]);

    const heightM = Number.isFinite(lm.heightM) && lm.heightM > 0
      ? lm.heightM
      : DEFAULT_HEIGHT_M[lm.category];
    const heightPx = metresToPixels(heightM, depth, focal);
    if (heightPx < 4) continue;  // below the median's smoothing scale, would disappear

    const baseW = heightPx * archetype.widthRatio;
    if (baseW < 1.5) continue;  // single-pixel-wide marks vanish

    // Centre x-jitter to avoid pixel-perfect verticals (would read as line art).
    const jitterX = (rand() - 0.5) * baseW * 0.08;
    const cx = sx + jitterX;
    const baseY = sy;
    const topY = sy - heightPx;

    // Shape: trapezoid with optional top decoration.
    // Width tapers from baseW at the bottom to baseW × archetype.taper at the top.
    const halfBase = baseW / 2;
    const halfTop = (baseW * archetype.taper) / 2;

    ctx.fillStyle = rgbCss(adjust(tone, -0.05 + rand() * 0.10));

    ctx.beginPath();
    ctx.moveTo(cx - halfBase, baseY);
    ctx.lineTo(cx + halfBase, baseY);
    ctx.lineTo(cx + halfTop, topY);
    ctx.lineTo(cx - halfTop, topY);
    ctx.closePath();
    ctx.fill();

    // Top decorations
    if (archetype.topShape === 'cross') {
      // Church cross: a small + shape above topY in a slightly lighter tone
      // so it reads against the dark roof.
      const crossH = heightPx * 0.18;
      const crossW = baseW * 0.28;
      const armT = Math.max(1.5, crossW * 0.20);
      ctx.fillStyle = rgbCss(adjust(tone, 0.10));
      // vertical bar
      ctx.fillRect(cx - armT / 2, topY - crossH, armT, crossH);
      // horizontal bar at ~30% from top of vertical
      ctx.fillRect(cx - crossW / 2, topY - crossH * 0.7, crossW, armT);
    } else if (archetype.topShape === 'crenellation') {
      // Castle crenellation: 3–5 small notches along the top edge.
      const notches = 4;
      const notchH = Math.max(2, heightPx * 0.08);
      const notchW = (baseW * archetype.taper) / (notches * 2 - 1);
      ctx.fillStyle = rgbCss(adjust(tone, 0.05));
      for (let i = 0; i < notches; i++) {
        const nx = cx - halfTop + i * notchW * 2;
        ctx.fillRect(nx, topY - notchH, notchW, notchH);
      }
    }

    drawn++;
  }
  ctx.restore();

  return { landmarkCount: landmarks.length, drawnCount: drawn };
}
