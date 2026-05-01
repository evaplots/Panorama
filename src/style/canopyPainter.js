// Painterly canopy stipple over forest / wood polygons.
// Called from applyPointillism between paintGround and the median-blur
// underpainting step, so the median softens canopy dab edges into the rest
// of the painting and the strokes downstream sample from canopy-textured
// foliage rather than flat dark green.
//
// Per-polygon recipe:
//   1. Filter bindings.ground.osmFeatures to forest category polygons.
//   2. Project the outer ring (skipping inners — small-area holes inside a
//      forest don't change canopy texture meaningfully and the per-dab
//      hit-test already handles ring containment).
//   3. Compute screen-area-driven dab count and a tight bbox.
//   4. Rejection-sample dab centres inside the polygon (point-in-polygon
//      using the standard ray-cast algorithm) until the target count is
//      reached or rejection budget is exhausted.
//   5. Each dab: small ellipse (mm-physical width), green hue varied per
//      dab, opacity ~0.5 so dabs blend into ground colour rather than
//      replacing it.
//   6. Sun-phase tint reused from groundPainter (warm/cool/desat envelope).
//
// PRNG: callers pass in a Mulberry32 instance (or compatible () → number in
// [0, 1)). Same instance, same input → same canopy. The Pointillism call
// site seeds it from `opts.seed` (the same value that drives stroke
// placement) so a paint of the same Snapshot reproduces bit-for-bit.

import { createProjector } from './projection.js';

// Shared sun-phase tint envelope. Mirrors SUN_PHASE_TINT in groundPainter.js
// so canopy darkens at twilight / night the same way ground does. Kept as a
// local copy rather than imported because groundPainter doesn't export it
// and adding an export to a different module to satisfy this one would be
// the kind of cross-cutting edit the painter is supposed to avoid.
const SUN_PHASE_TINT = {
  day:           { rgb: [  0,   0,   0], desat: 0.0, alpha: 0.0 },
  goldenHour:    { rgb: [ 28,   8, -22], desat: 0.0, alpha: 0.18 },
  sunset:        { rgb: [ 38,  18, -28], desat: 0.0, alpha: 0.22 },
  civilTwilight: { rgb: [-18,  -8,  18], desat: 0.10, alpha: 0.20 },
  night:         { rgb: [-36, -22,  10], desat: 0.55, alpha: 0.45 },
};

// Canopy palette — three foliage greens to give per-dab variation. Tuned to
// the same dark-green family GROUND_COVER_COLOURS uses for forest/wood
// (#3a5538) so the canopy reads as "this same forest, with texture", not
// "different vegetation overlaid".
const CANOPY_GREENS = [
  [0x2e, 0x46, 0x2c],  // shadow green
  [0x3a, 0x55, 0x38],  // base green (matches groundCover forest fill)
  [0x4e, 0x6a, 0x44],  // highlight green
];

// Default density: dabs per 1000 px² of polygon bbox area, before rejection.
// 0.45 reads as faint canopy speckle in the perf-probe outputs; tunable up
// (1.0–1.5) for more visible texture once browser visual-QA gives a steer.
// Holding at the conservative default to keep the museum-bar 22–26 s A3
// budget intact — the painter call itself is <10 ms regardless, but a
// stipple-dense underpainting biases the stroke pass to longer ellipses
// (every dab edge raises gradient magnitude), and that's where the cost
// actually lives.
const DEFAULT_DAB_DENSITY = 0.45;

// Cap dab count per polygon so a single huge forest polygon (e.g. a Black
// Forest extent at osmRadius=5000) doesn't blow the perf budget. Most
// natural forests are split into many smaller polygons by OSM mapping
// granularity; a hard cap protects against the long-tail single-polygon case.
const MAX_DABS_PER_POLYGON = 8000;

// Rejection-sampler budget: max attempts = target × this multiplier.
// 4× is comfortable for convex-ish polygons; thin/concave shapes use more
// of the budget. We accept slightly fewer dabs in pathological shapes
// rather than spinning forever.
const REJECTION_BUDGET_MULT = 4;

function ringBBox(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.sx < minX) minX = p.sx;
    if (p.sx > maxX) maxX = p.sx;
    if (p.sy < minY) minY = p.sy;
    if (p.sy > maxY) maxY = p.sy;
  }
  return { minX, maxX, minY, maxY };
}

// Point-in-polygon via the standard ray-cast (even-odd) test. Operates on
// {sx, sy} pixel-space rings; a horizontal ray to the right of (px, py)
// intersects each edge an odd number of times iff the point is inside.
function pointInRing(ring, px, py) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].sx, yi = ring[i].sy;
    const xj = ring[j].sx, yj = ring[j].sy;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Brighten/darken an RGB triple toward white/black by factor f ∈ [0..1].
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

/**
 * Render painterly canopy dabs over forest / wood polygons in `bindings.ground.osmFeatures`.
 * Mutates the canvas backing `ctx`. No-ops if there are no forest polygons.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./projection.js').ProjectionContext} projectionCtx
 * @param {{osmFeatures: Array}} ground
 * @param {{phase: string}} [sun]
 * @param {Object} [opts]
 * @param {() => number} [opts.rand]               PRNG () → [0,1). Defaults to Math.random (NOT deterministic).
 * @param {number}      [opts.dabDensity]          Dabs per 1000 px² of bbox (default 0.45).
 * @param {number}      [opts.brushThicknessPx]    Dab minor radius in pixels. Defaults to 4 (caller usually passes the same brushThicknessPx the stroke pass uses, so canopy texture matches stroke density).
 * @returns {{polygonCount: number, dabCount: number}}
 */
export function paintCanopy(ctx, projectionCtx, ground, sun, opts = {}) {
  const features = ground?.osmFeatures;
  if (!Array.isArray(features) || features.length === 0) {
    return { polygonCount: 0, dabCount: 0 };
  }

  const rand = opts.rand ?? Math.random;
  const dabDensity = opts.dabDensity ?? DEFAULT_DAB_DENSITY;
  const baseDabRadius = Math.max(2, Math.round(opts.brushThicknessPx ?? 4));

  const { canvasWidth: W, canvasHeight: H, groundY } = projectionCtx;
  const projector = createProjector(projectionCtx);

  // Collect projected forest rings.
  const projected = [];
  for (const f of features) {
    if (f.category !== 'forest') continue;
    const outer = projector.projectRing(f.outer, groundY);
    if (!outer) continue;
    projected.push(outer);
  }
  if (!projected.length) return { polygonCount: 0, dabCount: 0 };

  let totalDabs = 0;

  ctx.save();
  ctx.globalAlpha = 0.55;
  // Clip to the canvas — projected polygons can extend off-screen and we
  // don't want bbox sampling to waste attempts on off-canvas pixels. The
  // canvas itself acts as the implicit second clip.

  for (const ring of projected) {
    const bb = ringBBox(ring);
    // Screen-clip the bbox so off-canvas area doesn't inflate the dab budget.
    const cx0 = Math.max(0, bb.minX);
    const cx1 = Math.min(W, bb.maxX);
    const cy0 = Math.max(0, bb.minY);
    const cy1 = Math.min(H, bb.maxY);
    const bboxW = cx1 - cx0;
    const bboxH = cy1 - cy0;
    if (bboxW <= 1 || bboxH <= 1) continue;

    const targetDabs = Math.min(
      MAX_DABS_PER_POLYGON,
      Math.max(1, Math.round((bboxW * bboxH / 1000) * dabDensity)),
    );
    const budget = targetDabs * REJECTION_BUDGET_MULT;

    let placed = 0;
    let attempts = 0;
    while (placed < targetDabs && attempts < budget) {
      attempts++;
      const px = cx0 + rand() * bboxW;
      const py = cy0 + rand() * bboxH;
      if (!pointInRing(ring, px, py)) continue;

      // Pick a green from the canopy palette and jitter it slightly so dabs
      // don't quantise into three flat clusters.
      const greenIdx = rand() < 0.40 ? 0 : (rand() < 0.55 ? 1 : 2);
      const green = CANOPY_GREENS[greenIdx];
      const jitter = (rand() - 0.5) * 0.18;
      const [r, g, b] = adjust(green, jitter);
      ctx.fillStyle = `rgb(${r},${g},${b})`;

      // Slightly elliptical, random angle — flat round dots read as
      // pollen rather than canopy. Minor radius == base; major radius
      // 1.0–1.6× base so the eye reads it as foliage.
      const minor = baseDabRadius * (0.85 + rand() * 0.30);
      const major = minor * (1.0 + rand() * 0.6);
      const angle = rand() * Math.PI * 2;

      ctx.beginPath();
      ctx.ellipse(px, py, major, minor, angle, 0, Math.PI * 2);
      ctx.fill();
      placed++;
    }
    totalDabs += placed;
  }

  // Sun-phase tint over the canopy band only — clipped to the union of
  // forest polygons so sky / non-forest pixels stay untouched. Same envelope
  // as groundPainter; canopy darkens proportionally when the ground does.
  // Path2D is avoided here because node-canvas (used by the headless test
  // scripts) doesn't expose it as a global; ctx.beginPath + moveTo/lineTo
  // is the cross-environment path.
  const tint = SUN_PHASE_TINT[sun?.phase] ?? SUN_PHASE_TINT.day;
  if (tint.alpha > 0 && totalDabs > 0) {
    ctx.save();
    ctx.beginPath();
    for (const ring of projected) {
      ctx.moveTo(ring[0].sx, ring[0].sy);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].sx, ring[i].sy);
      ctx.closePath();
    }
    ctx.clip('evenodd');
    if (tint.desat > 0) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(127,127,127,${tint.desat})`;
      ctx.fillRect(0, 0, W, H);
    }
    const [tr, tg, tb] = tint.rgb;
    const r = Math.max(0, Math.min(255, 127 + tr));
    const g = Math.max(0, Math.min(255, 127 + tg));
    const b = Math.max(0, Math.min(255, 127 + tb));
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = `rgba(${r},${g},${b},${tint.alpha * 0.7})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  ctx.restore();
  return { polygonCount: projected.length, dabCount: totalDabs };
}
