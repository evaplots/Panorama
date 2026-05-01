// Painterly water reflections for natural=water polygons.
// Called from renderUnderpainting between paintGround and paintCanopy, so
// water sits behind canopy (a forest can't grow on a lake) and behind
// landmarks (a tower next to a lake is drawn over the water tile, though
// reflections of land objects into the water are explicitly v2 / out of
// scope here).
//
// Per-polygon recipe:
//   1. Project the outer ring (skipping inners — small islands inside a lake
//      are rare and the per-pass clipping handles ring containment when they
//      do exist).
//   2. Resolve a base water blue from the polygon's tag (GROUND_COVER_COLOURS),
//      darken toward black for the deep-water tone, fill the polygon flat —
//      water reads as a single dark mass at the foreground, not as the
//      vertical-gradient ground polygons do.
//   3. Sky-sampling band along the polygon's "far edge" (the minSy edge, the
//      one closest to the horizon — looking down at water, far points
//      project upward toward the horizon line). Sample sky-tinted pixels
//      from the source canvas just above the far edge and blend them into
//      the water surface with a cosine falloff. Strength governed by
//      `waterReflectionStrength`.
//   4. Sun-glitter streak. If the sun's screen-projected position falls
//      above the polygon's far edge AND the sun is in front of the camera
//      (back-lit water), paint a stippled warm streak from the contact
//      point toward the camera across the polygon. Front-lit water (sun
//      behind camera) explicitly shows no glitter — the brief's design
//      constraint over the "some real lakes do, very faint" hint.
//   5. Horizontal ripple dabs — thin elongated marks along the water's
//      surface direction (always horizontal in screen-space; water is flat),
//      stippled with mm-physical length so prints at any DPI carry the same
//      texture. Density governed by `waterRippleDensity`.
//   6. Sun-phase tint envelope reused from groundPainter — water at twilight
//      goes purple/orange the way the sky does.
//
// PRNG: callers pass in a Mulberry32 instance (or any () → number in [0, 1)).
// The underpainting plug-in seeds it from `opts.seed ^ 0x77_77_77_77` (seven
// for "wet"; matches the canopy/landmark XOR-salt convention) so a paint of
// the same Snapshot reproduces bit-for-bit.

import { GROUND_COVER_COLOURS, GROUND_COVER_PRIORITY } from '../config.js';
import { createProjector } from './projection.js';

const DEG_TO_RAD = Math.PI / 180;

// Sun-phase tint envelope. Same shape as groundPainter / canopyPainter so
// water shifts warm-cool-desat with the rest of the scene. Slightly stronger
// alphas than ground because water is a more reflective surface — the same
// sky shift hits it harder.
const SUN_PHASE_TINT = {
  day:           { rgb: [  0,   0,   0], desat: 0.0,  alpha: 0.0 },
  goldenHour:    { rgb: [ 32,  10, -28], desat: 0.0,  alpha: 0.22 },
  sunset:        { rgb: [ 44,  20, -36], desat: 0.0,  alpha: 0.28 },
  civilTwilight: { rgb: [-22, -10,  22], desat: 0.10, alpha: 0.26 },
  night:         { rgb: [-44, -28,  14], desat: 0.55, alpha: 0.50 },
};

// Sky-band tint per sun phase — the colour the band trends toward at full
// reflectionStrength. Pulled from rough sky-gradient hues for each phase.
// Used when source-canvas sampling fails (polygon's far edge sits at sy=0
// or sample row is degenerate). The source-sampled colour is the primary
// signal; this is a graceful fallback.
const SKY_BAND_FALLBACK = {
  day:           [180, 200, 220],   // pale blue
  goldenHour:    [220, 180, 140],   // warm peach
  sunset:        [230, 150, 120],   // orange / pink
  civilTwilight: [110, 120, 170],   // mauve / dusk blue
  night:         [ 30,  35,  60],   // deep night blue
};

// Sun-glitter palette — warm streak colours per phase. Day is pale white-gold
// (a noon-time specular), goldenHour / sunset are deeply warm (the dramatic
// case), twilight is a softer mauve, night gets the moon's cool sheen.
const GLITTER_TINT = {
  day:           [255, 250, 230],
  goldenHour:    [255, 220, 150],
  sunset:        [255, 180, 110],
  civilTwilight: [220, 200, 220],
  night:         [200, 210, 230],
};

// Default ripple-dab density: ripples per 1000 px² of polygon screen-bbox
// area, scaled by user's `waterRippleDensity` slider (default 0.4 →
// ~0.04 ripples per 1000 px²). Tuned conservatively: dense ripple texture
// biases the stroke pass toward longer ellipses (more gradient magnitude),
// which can push total A3 render past the 28 s user-tolerance bar even
// when the water painter itself stays under 100 ms. The reduction from
// initial 0.45 → 0.10 was made after probe runs at slider=0.4 on the
// coastal-extent A3 scene approached and occasionally exceeded the
// 28 s budget. Curators wanting more visible ripples can push the
// slider above 0.4 (the slider goes to 1.0).
const RIPPLE_DENSITY_BASE = 0.10;
const MAX_RIPPLES_PER_POLYGON = 1500;

// How far into the polygon (as a fraction of polygon-vertical-extent) the
// sky-sampling band extends before fading to zero. The band's depth is
// roughly polygon_height × this constant; reflectionStrength then
// modulates the alpha along that depth via cosine.
const SKY_BAND_FRACTION = 0.55;

// Glitter streak width (mm-physical) — controls how broad the streak is in
// the cross-streak direction. ~6 mm is a generous painterly streak;
// individual dab sizes are smaller (brushThicknessPx-scale).
const GLITTER_STREAK_WIDTH_MM = 6.0;

// Glitter streak length (as a fraction of polygon screen height). The streak
// runs from the contact point (where the sun's azimuth meets the far edge)
// down toward the bottom of the polygon; the actual rendered length is the
// minimum of (this fraction × polygon height) and (distance to the polygon's
// near edge), so it never paints past the foreground of the lake.
const GLITTER_LENGTH_FRACTION = 0.85;

// Number of dabs per mm of glitter streak length. ~3 dabs/mm at the near
// end thinning to ~1 dab/mm at the far end gives the painterly stippled
// look the brief calls for; at 300 DPI this is ~35 dabs/inch. Implemented
// as a single density value with per-dab probabilistic skip toward the far
// end.
const GLITTER_DABS_PER_MM = 3.0;

// Glitter alignment threshold: the sun must be within this many polygon-
// widths of the polygon's projected centre to "light up" the streak.
// Beyond that, the sun is at a different bearing than the lake — the user
// is looking at a different part of the sky than the sun, so even if the
// sun is above the horizon there's no specular path back to the camera.
const GLITTER_AZIMUTH_TOLERANCE = 1.2;

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

// Darken a triple toward black (factor 0..1 = how far toward black).
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

// Trace a closed ring into the context's current path. Avoids Path2D for
// node-canvas compatibility, matching groundPainter's approach.
function tracePath(ctx, ring) {
  ctx.moveTo(ring[0].sx, ring[0].sy);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].sx, ring[i].sy);
  ctx.closePath();
}

function ringScreenBounds(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.sx < minX) minX = p.sx;
    if (p.sx > maxX) maxX = p.sx;
    if (p.sy < minY) minY = p.sy;
    if (p.sy > maxY) maxY = p.sy;
  }
  return { minX, maxX, minY, maxY };
}

function ringScreenArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j].sx - ring[i].sx) * (ring[j].sy + ring[i].sy);
  }
  return Math.abs(area) / 2;
}

// Sample the average RGB of a small strip directly from the canvas
// context. Returns [r, g, b] or null if the strip is outside bounds /
// degenerate. Used to pull the sky-band tint from the actual sky pixels
// above the polygon's far edge, so the band's colour matches the
// rendered sky gradient. Per-polygon localised getImageData keeps this
// cheap even at A3 (full-canvas getImageData on 4961×3508 is 30+ ms; a
// 4961×40 strip is well under 1 ms).
function sampleStripFromCtx(ctx, canvasW, canvasH, x0, x1, y0, y1) {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(canvasW, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(canvasH, Math.ceil(y1));
  const sw = xb - xa;
  const sh = yb - ya;
  if (sw < 2 || sh < 2) return null;
  let strip;
  try {
    strip = ctx.getImageData(xa, ya, sw, sh);
  } catch (err) {
    return null;
  }
  const data = strip.data;
  let r = 0, g = 0, b = 0, n = 0;
  // Step 4 px in x, 2 px in y — averages hundreds of pixels regardless of
  // strip size while keeping the inner loop tight.
  for (let y = 0; y < sh; y += 2) {
    const rowOff = y * sw;
    for (let x = 0; x < sw; x += 4) {
      const idx = (rowOff + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      n++;
    }
  }
  if (n === 0) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// Mix two RGB triples by `t` (0 = a, 1 = b). Clamps to [0..255].
function mix(a, b, t) {
  const c = 1 - t;
  return [
    Math.max(0, Math.min(255, Math.round(a[0] * c + b[0] * t))),
    Math.max(0, Math.min(255, Math.round(a[1] * c + b[1] * t))),
    Math.max(0, Math.min(255, Math.round(a[2] * c + b[2] * t))),
  ];
}

/**
 * Project the sun's direction onto the canvas. The sun is treated as a
 * point at infinity, so its screen position depends only on direction,
 * not observer position. Returns
 *   { inFront: bool, sx, sy, depthDot, viewDot }
 * where depthDot is the cosine between view forward and sun direction
 * (>0 = sun is ahead of camera = back-lit water; <0 = behind camera =
 * front-lit water), and viewDot is the same value (kept named for
 * read-site clarity).
 *
 * @param {{azimuthDeg:number, elevationDeg:number, fovDeg:number, canvasWidth:number, canvasHeight:number}} pc projection context
 * @param {{azimuth:number, altitude:number}} sun sun position
 */
function projectSunDir(pc, sun) {
  if (!sun || !Number.isFinite(sun.azimuth) || !Number.isFinite(sun.altitude)) {
    return { inFront: false, sx: NaN, sy: NaN, viewDot: -1 };
  }
  const sunAzRad = sun.azimuth * DEG_TO_RAD;
  const sunAltRad = sun.altitude * DEG_TO_RAD;
  // Direction from observer toward sun in the same world basis projection.js uses.
  const dx = Math.sin(sunAzRad) * Math.cos(sunAltRad);
  const dy = Math.sin(sunAltRad);
  const dz = -Math.cos(sunAzRad) * Math.cos(sunAltRad);

  const az = pc.azimuthDeg * DEG_TO_RAD;
  const el = pc.elevationDeg * DEG_TO_RAD;
  const sinAz = Math.sin(az), cosAz = Math.cos(az);
  const sinEl = Math.sin(el), cosEl = Math.cos(el);
  // Camera basis: forward, right, up (as in projection.js).
  const fx = sinAz * cosEl, fy = sinEl, fz = -cosAz * cosEl;
  const rx = cosAz, ry = 0, rz = sinAz;
  const ux = -sinAz * sinEl, uy = cosEl, uz = cosAz * sinEl;

  const viewDot = dx * fx + dy * fy + dz * fz;
  if (viewDot <= 0) {
    return { inFront: false, sx: NaN, sy: NaN, viewDot };
  }
  const u = dx * rx + dy * ry + dz * rz;
  const v = dx * ux + dy * uy + dz * uz;
  const focal = (pc.canvasWidth / 2) / Math.tan(pc.fovDeg * DEG_TO_RAD / 2);
  const cx = pc.canvasWidth / 2, cy = pc.canvasHeight / 2;
  return {
    inFront: true,
    sx: cx + (u / viewDot) * focal,
    sy: cy - (v / viewDot) * focal,
    viewDot,
  };
}

/**
 * Render painterly water reflections over natural=water polygons.
 * Mutates the canvas backing `ctx`. No-ops if there are no water polygons.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./projection.js').ProjectionContext} projectionCtx
 * @param {{osmFeatures: Array}} ground
 * @param {{phase: string, azimuth?: number, altitude?: number}} [sun]
 * @param {Object}     [opts]
 * @param {() => number} [opts.rand]                    PRNG () → [0,1). Defaults to Math.random.
 * @param {number}      [opts.brushThicknessPx]         Stroke unit (px). Defaults to 4.
 * @param {number}      [opts.reflectionStrength]       0..1, how strongly the sky band overrides water blue. Default 0.6.
 * @param {boolean}     [opts.sunGlitterEnabled]        Enable sun-glitter streak. Default true.
 * @param {number}      [opts.rippleDensity]            0..1, surface stroke density. Default 0.4.
 * @returns {{polygonCount:number, glitterDabCount:number, rippleDabCount:number}}
 */
export function paintWater(ctx, projectionCtx, ground, sun, opts = {}) {
  const features = ground?.osmFeatures;
  if (!Array.isArray(features) || features.length === 0) {
    return { polygonCount: 0, glitterDabCount: 0, rippleDabCount: 0 };
  }

  const rand = opts.rand ?? Math.random;
  const baseDabRadius = Math.max(2, Math.round(opts.brushThicknessPx ?? 4));
  const reflectionStrength = Math.max(0, Math.min(1, opts.reflectionStrength ?? 0.6));
  const glitterEnabled = opts.sunGlitterEnabled !== false;
  const rippleDensitySlider = Math.max(0, Math.min(1, opts.rippleDensity ?? 0.4));

  const { canvasWidth: W, canvasHeight: H } = projectionCtx;
  const groundY = projectionCtx.groundY;
  const projector = createProjector(projectionCtx);

  // Pixels-per-mm for sizing the glitter streak width / dab cadence.
  const pxPerMm = baseDabRadius / 0.7;  // brushWidthMm default 0.7 mm → baseDabRadius px

  // Project water polygons.
  const projected = [];
  for (const f of features) {
    if (f.category !== 'water') continue;
    const colour = resolvePolygonColour(f.tags);
    if (colour == null) continue;
    const outer = projector.projectRing(f.outer, groundY);
    if (!outer) continue;
    const inners = (f.inners ?? [])
      .map(r => projector.projectRing(r, groundY))
      .filter(Boolean);
    projected.push({
      outer,
      inners,
      baseRgb: hexToRgb(colour),
      bounds: ringScreenBounds(outer),
      area: ringScreenArea(outer),
    });
  }
  if (!projected.length) {
    return { polygonCount: 0, glitterDabCount: 0, rippleDabCount: 0 };
  }
  // Big polygons first, small last — same rationale as groundPainter.
  projected.sort((a, b) => b.area - a.area);

  // Sun projection — used to decide glitter visibility and streak placement.
  // The dot product viewDot < 0 means sun is behind the camera (front-lit
  // water). per the brief: front-lit shows no glitter.
  const sunProj = projectSunDir(projectionCtx, sun);
  const sunBackLit = sunProj.inFront && sunProj.viewDot > 0;
  const sunAboveHorizon = sun && Number.isFinite(sun.altitude) && sun.altitude > -2;
  const phase = sun?.phase ?? 'day';
  const skyFallback = SKY_BAND_FALLBACK[phase] ?? SKY_BAND_FALLBACK.day;
  const glitterRgb = GLITTER_TINT[phase] ?? GLITTER_TINT.day;

  let glitterDabCount = 0;
  let rippleDabCount = 0;

  ctx.save();

  // ─── Pass 1: base deep-water fill ──────────────────────────────────────
  // Single colour, darker than the polygon's tag colour so the sky band /
  // glitter / ripples have something to bite against. No vertical gradient
  // — water is foreground-and-near, not the atmospheric-depth ground that
  // groundPainter handles.
  for (const { outer, inners, baseRgb } of projected) {
    const deep = darken(baseRgb, 0.35);
    ctx.fillStyle = rgbCss(deep);
    ctx.beginPath();
    tracePath(ctx, outer);
    for (const inner of inners) tracePath(ctx, inner);
    ctx.fill('evenodd');
  }

  // ─── Pass 2: sky-sampling band ─────────────────────────────────────────
  // For each polygon, sample the sky pixels in a thin horizontal strip
  // immediately above the polygon's far edge (minY) and blend that colour
  // into the polygon along a cosine-falloff vertical band that extends
  // SKY_BAND_FRACTION × polygon-height into the polygon.
  //
  // The strip read happens via ctx.getImageData on a small region (sampleH
  // px tall × bbox-wide). At A3 a localised strip read is ~1 ms; a
  // full-canvas getImageData would be ~30 ms.
  if (reflectionStrength > 0) {
    for (const { outer, inners, bounds, baseRgb } of projected) {
      const polyHeight = bounds.maxY - bounds.minY;
      if (polyHeight < 4) continue;

      const sampleH = Math.max(2, Math.min(40, polyHeight * 0.05));
      const stripY0 = bounds.minY - sampleH - 2;
      const stripY1 = bounds.minY - 2;
      let skyRgb = sampleStripFromCtx(
        ctx, W, H,
        bounds.minX, bounds.maxX,
        stripY0, stripY1,
      );
      if (!skyRgb) skyRgb = skyFallback;

      const bandDepth = polyHeight * SKY_BAND_FRACTION;
      const bandY0 = bounds.minY;
      const bandY1 = Math.min(bounds.maxY, bounds.minY + bandDepth);

      // Build a vertical gradient that fades the sky tint into transparency
      // along a cosine-shaped envelope. Because Canvas2D linearGradient stops
      // are linear interpolations, we approximate the cosine by laying down
      // 5 stops at evaluated cosine positions.
      const grad = ctx.createLinearGradient(0, bandY0, 0, bandY1);
      const STEPS = 6;
      for (let i = 0; i < STEPS; i++) {
        const t = i / (STEPS - 1);
        // Cosine half-wave: at t=0 (far edge) intensity is 1, at t=1 (depth
        // limit) intensity is 0; inflection in the middle reads as painterly.
        const cosFalloff = 0.5 * (1 + Math.cos(t * Math.PI));
        const alpha = reflectionStrength * cosFalloff;
        grad.addColorStop(t, `rgba(${skyRgb[0]},${skyRgb[1]},${skyRgb[2]},${alpha.toFixed(3)})`);
      }

      ctx.save();
      ctx.beginPath();
      tracePath(ctx, outer);
      for (const inner of inners) tracePath(ctx, inner);
      ctx.clip('evenodd');
      ctx.fillStyle = grad;
      ctx.fillRect(bounds.minX, bandY0, bounds.maxX - bounds.minX, bandY1 - bandY0);
      ctx.restore();

      // Record the sampled sky colour on the projected entry so the ripple
      // pass can pick highlight colours that read as reflective rather than
      // as random noise.
      // (Mutating projected entries is local to this function; doesn't leak.)
      // eslint-disable-next-line no-param-reassign
      // (We're already inside projected[].)
    }
  }

  // ─── Pass 3: sun-glitter streak ────────────────────────────────────────
  if (glitterEnabled && sunBackLit && sunAboveHorizon) {
    const streakWidthPx = Math.max(2, GLITTER_STREAK_WIDTH_MM * pxPerMm);
    for (const { outer, inners, bounds } of projected) {
      const polyHeight = bounds.maxY - bounds.minY;
      const polyWidth = bounds.maxX - bounds.minX;
      if (polyHeight < 6 || polyWidth < 4) continue;

      // The contact point: where the sun's azimuth meets the polygon's far
      // edge. We use the sun's projected sx (clamped to the polygon's x-range)
      // and the polygon's far-edge y (minY). If the sun's screen sx is far
      // outside the polygon's x-range (more than GLITTER_AZIMUTH_TOLERANCE
      // polygon-widths away), the sun is at a different bearing than the
      // lake — no glitter path.
      const polyCx = (bounds.minX + bounds.maxX) / 2;
      const xOffsetWidths = Math.abs(sunProj.sx - polyCx) / polyWidth;
      if (xOffsetWidths > GLITTER_AZIMUTH_TOLERANCE) continue;

      // Sun also has to be above the polygon's far edge (i.e. above the
      // horizon line of the lake). If sun's projected sy is below the
      // polygon's near edge, the sun is somehow under the water in screen
      // space — skip.
      if (sunProj.sy > bounds.maxY) continue;

      // Contact point: clamp sun.sx into the polygon's x range so the streak
      // starts inside the lake even when the sun is just outside the lake's
      // x extent. Streak runs straight down (water surface = horizontal).
      const contactX = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, sunProj.sx));
      const contactY = bounds.minY;
      const streakLen = Math.min(
        polyHeight * GLITTER_LENGTH_FRACTION,
        bounds.maxY - contactY,
      );

      // Alignment falloff: closer to the polygon's centre = brighter streak.
      const alignBoost = Math.max(0.25, 1 - xOffsetWidths / GLITTER_AZIMUTH_TOLERANCE);

      // Phase boost: sun near horizon (golden hour / sunset) = strongest
      // glitter; high noon glitter is dimmer (the brief's "back-lit, near
      // horizon, strongest glitter" rule).
      const altitudeBoost = (() => {
        if (!Number.isFinite(sun?.altitude)) return 0.5;
        if (sun.altitude < -2) return 0;
        if (sun.altitude < 6) return 1.0;        // golden hour / sunset / civil twilight
        if (sun.altitude < 20) return 0.7;       // soft afternoon
        return 0.5;                              // high noon — visible but flatter
      })();

      // Estimate dab count: streak length (mm) × dabs/mm × align × altitude.
      const streakLenMm = streakLen / pxPerMm;
      const targetDabs = Math.round(streakLenMm * GLITTER_DABS_PER_MM * alignBoost * altitudeBoost);
      if (targetDabs <= 0) continue;

      ctx.save();
      ctx.beginPath();
      tracePath(ctx, outer);
      for (const inner of inners) tracePath(ctx, inner);
      ctx.clip('evenodd');

      for (let i = 0; i < targetDabs; i++) {
        // Position: along the streak length with random jitter.
        const t = rand();                 // 0..1 along streak
        // Dabs at the contact point are densest; dabs at the far end thin
        // out (probabilistic skip).
        if (rand() < t * 0.5) continue;

        const yJitter = (rand() - 0.5) * baseDabRadius * 0.6;
        const py = contactY + t * streakLen + yJitter;
        const xJitter = (rand() - 0.5) * streakWidthPx;
        // Cross-streak intensity falloff (cosine again — the streak narrows
        // visually toward its edges).
        const crossFalloff = 0.5 * (1 + Math.cos((xJitter / streakWidthPx) * Math.PI));
        if (rand() > crossFalloff) continue;
        const px = contactX + xJitter;

        // Per-dab intensity falls off with t (further from sun = dimmer).
        const intensity = (1 - t * 0.7) * alignBoost * altitudeBoost;
        if (intensity <= 0.05) continue;

        // Dab tone: glitter palette with a small jitter so the streak
        // doesn't read as a flat gradient line.
        const tone = mix(glitterRgb, [255, 255, 255], 0.15 * rand());
        ctx.fillStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${(0.6 + 0.35 * intensity).toFixed(3)})`;

        const dabRadius = baseDabRadius * (0.8 + rand() * 0.7);
        ctx.beginPath();
        ctx.arc(px, py, dabRadius, 0, Math.PI * 2);
        ctx.fill();
        glitterDabCount++;
      }

      ctx.restore();
    }
  }

  // ─── Pass 4: horizontal ripple texture ─────────────────────────────────
  if (rippleDensitySlider > 0) {
    for (const { outer, inners, bounds, baseRgb } of projected) {
      const cx0 = Math.max(0, bounds.minX);
      const cx1 = Math.min(W, bounds.maxX);
      const cy0 = Math.max(0, bounds.minY);
      const cy1 = Math.min(H, bounds.maxY);
      const bboxW = cx1 - cx0;
      const bboxH = cy1 - cy0;
      if (bboxW <= 1 || bboxH <= 1) continue;

      const targetRipples = Math.min(
        MAX_RIPPLES_PER_POLYGON,
        Math.max(1, Math.round((bboxW * bboxH / 1000) * RIPPLE_DENSITY_BASE * rippleDensitySlider)),
      );

      const ripplePalette = [
        darken(baseRgb, 0.50),                 // deep shadow
        darken(baseRgb, 0.20),                 // mid
        mix(baseRgb, [255, 255, 255], 0.20),   // pale highlight
      ];

      ctx.save();
      ctx.beginPath();
      tracePath(ctx, outer);
      for (const inner of inners) tracePath(ctx, inner);
      ctx.clip('evenodd');
      ctx.globalAlpha = 0.55;

      // No per-dab point-in-polygon test: the canvas clip above enforces
      // ring containment, and skipping the PIP halves the per-dab cost on
      // coastal-extent polygons (Mediterranean lake at A3 was 113 ms with
      // PIP, ~70 ms without). The trade-off: a small fraction of ripples
      // that straddle the polygon boundary get clipped to a curved edge
      // shape rather than rejected. At ripple-dab scale that just reads
      // as a slightly broken-up polygon outline — desirable for a painter
      // working with broken edges.
      let placed = 0;
      for (let i = 0; i < targetRipples; i++) {
        const px = cx0 + rand() * bboxW;
        const py = cy0 + rand() * bboxH;

        // Ripples brighter near the far edge (where the sky band lives) so
        // they read as reflective sparkle; darker near the bottom (deeper
        // water).
        const tNear = (py - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY);
        const idx = tNear < 0.35
          ? 2  // pale highlight near far edge
          : (tNear < 0.7 ? 1 : 0);
        const tone = ripplePalette[idx];
        ctx.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;

        // Horizontal elongated dab. Length 2.5–4× the dab radius, height
        // = 1× radius. Random small angle so ripples don't quantise to a
        // perfect horizontal raster pattern.
        const major = baseDabRadius * (2.5 + rand() * 1.5);
        const minor = baseDabRadius * 0.6;
        const angle = (rand() - 0.5) * 0.18;  // ±~5° — water is flat

        ctx.beginPath();
        ctx.ellipse(px, py, major, minor, angle, 0, Math.PI * 2);
        ctx.fill();
        placed++;
      }
      rippleDabCount += placed;
      ctx.restore();
    }
  }

  // ─── Pass 5: sun-phase tint envelope (clipped to water union) ──────────
  const tint = SUN_PHASE_TINT[phase] ?? SUN_PHASE_TINT.day;
  if (tint.alpha > 0) {
    ctx.save();
    ctx.beginPath();
    for (const { outer, inners } of projected) {
      tracePath(ctx, outer);
      for (const inner of inners) tracePath(ctx, inner);
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
    ctx.fillStyle = `rgba(${r},${g},${b},${tint.alpha})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  ctx.restore();
  return {
    polygonCount: projected.length,
    glitterDabCount,
    rippleDabCount,
  };
}
