// Ground polygon → painter underpainting renderer.
// Called from applyPointillism before the median-blur step (so the blur
// softens the polygon edges into the rest of the painting).
//
// Per-polygon recipe:
//   1. project outer + inner rings to canvas space (near-plane clipped)
//   2. fill outer with a vertical gradient in the polygon's tag colour:
//      lighter (toward white) at the higher edge, darker (toward black) at
//      the lower edge — atmospheric depth heuristic
//   3. punch holes by re-filling each inner ring with the source-canvas pixels
//      under it (so we don't replace inner content with a flat colour)
//   4. tint the overlaid region by sun.phase (warm/cool/desat, small magnitudes)

import { GROUND_COVER_COLOURS, GROUND_COVER_PRIORITY } from '../config.js';
import { createProjector } from './projection.js';

// Painter category priority — lower number = drawn LATER = on top.
// Where polygons of different categories overlap geometrically, this
// breaks the tie before the screen-area-DESC tie-breaker runs.
//
// Why this order:
//   - forest is the most "specific natural cover" signal (a forest patch
//     inside a residential or farmland area should always read as forest).
//   - beach / sand is similarly specific (beaches matter visually even
//     when small).
//   - urban built environment beats farmland (a village inside a field
//     should be visible).
//   - farmland is the residual / default cultivated cover.
//
// Within a category, the existing "small details on top of broad fills"
// rule is preserved by sorting by screen-area DESC (big drawn first,
// small drawn last). So a small farmland polygon inside a big farmland
// polygon still wins, and a small forest polygon inside a big forest
// polygon still wins.
//
// Cross-category, the priority promotes the more-specific signal even
// when it has a larger projected area. This is the regression case
// the foreground-polygon-projection diagnosis surfaced: a forest
// polygon overlapping smaller farmland polygons used to be drawn
// first (bigger area) and shadowed by farmland drawn last; now forest
// wins regardless.
//
// `water` is omitted because waterPainter owns it end-to-end (the
// `category === 'water'` skip below). Categories not in this map fall
// back to priority 99 — drawn earliest, easiest to override.
const CATEGORY_PAINT_PRIORITY = {
  forest:   1,
  beach:    2,
  urban:    3,
  farmland: 4,
};

// Sun-phase tint: small RGB shifts applied as a global composite over the
// freshly-drawn polygons. Magnitudes deliberately gentle so water still reads
// as water — the painter is meant to *suggest* warmth, not stage a sunset.
//
//   - day            no tint
//   - goldenHour     +R, =G, -B  (warm bias)
//   - sunset         +R, +G, -B  (warmer; pushes toward orange)
//   - civilTwilight  -R, =G, +B  (cool bias)
//   - night          heavy desat + cool
const SUN_PHASE_TINT = {
  day:           { rgb: [  0,   0,   0], desat: 0.0, alpha: 0.0 },
  goldenHour:    { rgb: [ 28,   8, -22], desat: 0.0, alpha: 0.18 },
  sunset:        { rgb: [ 38,  18, -28], desat: 0.0, alpha: 0.22 },
  civilTwilight: { rgb: [-18,  -8,  18], desat: 0.10, alpha: 0.20 },
  night:         { rgb: [-36, -22,  10], desat: 0.55, alpha: 0.45 },
};

function resolvePolygonColour(tags) {
  let bestColour = null;
  let bestPriority = Infinity;
  for (const [key, value] of Object.entries(tags)) {
    const colour = GROUND_COVER_COLOURS[`${key}=${value}`];
    if (colour === undefined) continue;
    const priority = GROUND_COVER_PRIORITY[key] ?? 99;
    if (priority < bestPriority) {
      bestPriority = priority;
      bestColour = colour;
    }
  }
  return bestColour;
}

function hexToRgb(hex) {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

// Brighten a triple toward white (factor 0..1)
function lighten([r, g, b], f) {
  return [
    Math.round(r + (255 - r) * f),
    Math.round(g + (255 - g) * f),
    Math.round(b + (255 - b) * f),
  ];
}

// Darken a triple toward black (factor 0..1)
function darken([r, g, b], f) {
  return [
    Math.round(r * (1 - f)),
    Math.round(g * (1 - f)),
    Math.round(b * (1 - f)),
  ];
}

function rgbCss([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

// Trace a closed ring into the context's current path. Used by `ctx.fill`
// and `ctx.clip` callers below — both happen inside ctx.save/restore pairs
// so we don't pollute the caller's path. We avoid Path2D here because
// node-canvas (used by the headless test scripts) doesn't expose it as a
// global; ctx.beginPath + moveTo/lineTo is the cross-environment path.
function tracePath(ctx, ring) {
  ctx.moveTo(ring[0].sx, ring[0].sy);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].sx, ring[i].sy);
  ctx.closePath();
}

// Bounding box of an array of {sx, sy} points.
function ringBBox(ring) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.sy < minY) minY = p.sy;
    if (p.sy > maxY) maxY = p.sy;
  }
  return { minY, maxY };
}

// Sort by screen-area, biggest first — small-area polygons render last so
// fine details survive on top of broad fills.
function ringScreenArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j].sx - ring[i].sx) * (ring[j].sy + ring[i].sy);
  }
  return Math.abs(area) / 2;
}

/**
 * Render the ground polygons of `bindings.ground.osmFeatures` over `ctx`.
 * Mutates the canvas backing `ctx`. No-ops if features list is missing or empty.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./projection.js').ProjectionContext} projectionCtx
 * @param {{osmFeatures: Array}} ground
 * @param {{phase: string}} [sun]
 */
export function paintGround(ctx, projectionCtx, ground, sun) {
  const features = ground?.osmFeatures;
  if (!Array.isArray(features) || features.length === 0) return 0;

  const { canvasWidth: W, canvasHeight: H, groundY } = projectionCtx;
  const projector = createProjector(projectionCtx);

  // Project everything first so we can sort the polygons before painting.
  // Water polygons are skipped here: waterPainter owns natural=water
  // category end-to-end (base fill + sky-sampling band + glitter + ripples)
  // because flat-blue overpaint would waste the deep-water tone the
  // reflection treatment wants. See src/style/waterPainter.js.
  const projected = [];
  for (const f of features) {
    if (f.category === 'water') continue;
    const colour = resolvePolygonColour(f.tags);
    if (colour == null) continue;
    const outer = projector.projectRing(f.outer, groundY);
    if (!outer) continue;
    const inners = (f.inners ?? [])
      .map(r => projector.projectRing(r, groundY))
      .filter(r => r);
    projected.push({
      outer,
      inners,
      colour,
      category: f.category,
      area: ringScreenArea(outer),
      paintPriority: CATEGORY_PAINT_PRIORITY[f.category] ?? 99,
    });
  }
  if (!projected.length) return 0;

  // Two-key sort:
  //   1. Lower paint priority drawn LATER (on top). Forest beats farmland
  //      on overlap regardless of area.
  //   2. Within priority, larger area drawn first (small details survive
  //      on top of broad fills) — preserves the existing rule for
  //      same-category polygon nesting.
  //
  // The sort comparator returns positive when `a` should be drawn AFTER
  // `b`. Higher priority value means drawn earlier (background); lower
  // priority value means drawn later (foreground).
  projected.sort((a, b) => {
    if (a.paintPriority !== b.paintPriority) {
      return b.paintPriority - a.paintPriority;   // higher number first → drawn earlier
    }
    return b.area - a.area;                       // bigger first → drawn earlier
  });

  ctx.save();
  for (const { outer, inners, colour } of projected) {
    const baseRgb = hexToRgb(colour);
    const { minY, maxY } = ringBBox(outer);

    // Outer ring + inner rings together as one path, with 'evenodd' fill
    // rule so inners cut holes in the outer fill in a single fill call.
    ctx.beginPath();
    tracePath(ctx, outer);
    for (const inner of inners) tracePath(ctx, inner);

    // Clamp gradient endpoints to canvas bounds — a polygon that extends well
    // off-screen would otherwise produce a near-flat gradient over the visible
    // slice. Clamping recovers the intended top-light/bottom-dark feel.
    const yTop = Math.max(0, minY);
    const yBot = Math.min(H, maxY);
    if (yBot - yTop < 1) {
      // Single-row polygon — just flat fill
      ctx.fillStyle = rgbCss(baseRgb);
      ctx.fill('evenodd');
      continue;
    }

    const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
    grad.addColorStop(0, rgbCss(lighten(baseRgb, 0.20)));
    grad.addColorStop(1, rgbCss(darken(baseRgb, 0.30)));

    ctx.fillStyle = grad;
    ctx.fill('evenodd');
  }

  // Sun-phase tint — applied as a single overlay clipped to the *union* of
  // all projected polygons, so sky / off-polygon pixels stay untouched.
  const tint = SUN_PHASE_TINT[sun?.phase] ?? SUN_PHASE_TINT.day;
  if (tint.alpha > 0) {
    ctx.save();
    ctx.beginPath();
    for (const { outer, inners } of projected) {
      tracePath(ctx, outer);
      for (const inner of inners) tracePath(ctx, inner);
    }
    ctx.clip('evenodd');

    // Desaturate first (mix toward grey) if night/twilight asks for it
    if (tint.desat > 0) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(127,127,127,${tint.desat})`;
      ctx.fillRect(0, 0, W, H);
    }
    // RGB shift overlay
    const [tr, tg, tb] = tint.rgb;
    const r = Math.max(0, Math.min(255, 127 + tr));
    const g = Math.max(0, Math.min(255, 127 + tg));
    const b = Math.max(0, Math.min(255, 127 + tb));
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = `rgba(${r},${g},${b},${tint.alpha})`;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  ctx.restore();
  return projected.length;
}
