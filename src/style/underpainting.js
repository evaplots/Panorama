// Underpainting renderer — every step that runs BEFORE the pointillism
// stroke pass. Extracted from Pointillism.js so it can run independently
// for the live UnderpaintingPreviewPanel without paying the multi-second
// cost of palette / gradient / strokes.
//
// What this owns:
//   1. Allocate a working copy of the source canvas (so the input isn't
//      mutated)
//   2. paintGround   — broad colour fills from OSM ground-cover polygons
//   3. paintCanopy   — stippled canopy over forest / wood polygons (PR #12)
//   4. paintLandmarks — silhouette marks for towers / churches / etc (PR #12)
//   5. Optional 11×11 median-blur softening (controlled by `softenEdges`,
//      default true) — same step Pointillism uses to give the stroke pass
//      cleanly bounded colour masses to bite into
//
// What this does NOT own:
//   - ColorThief / palette extraction
//   - Scharr / Gaussian gradient field
//   - Weighted-random palette sampling
//   - Stroke pass
//
// Determinism contract: the canopy and landmark painters fork their PRNGs
// from `opts.seed` via the same XOR salts Pointillism uses
// (canopy: seed^0xC4_C4_C4_C4, landmarks: seed^0x14_14_14_14). Same
// sourceCanvas + same opts → same output canvas, byte-identical.

import { paintGround } from './groundPainter.js';
import { paintWater } from './waterPainter.js';
import { paintCanopy } from './canopyPainter.js';
import { paintLandmarks } from './landmarkPainter.js';
import { medianBlur11 } from './algorithm.js';
import { applyAtmospherics } from './atmosphericPasses.js';

// Inline copy of `computeEffectiveDpi` from Pointillism.js — kept local to
// avoid the circular import that would otherwise arise (Pointillism imports
// renderUnderpainting from this module). The formula is short enough that
// duplication is cheaper than a third shared module; both copies derive
// effective DPI as canvas-short-edge / paper-short-edge-in-inches.
const PAPER_SHORT_EDGE_MM = { A4: 210, A3: 297, A2: 420 };
function computeEffectiveDpi(canvasWidth, canvasHeight, paperSize) {
  const paperShortMm = PAPER_SHORT_EDGE_MM[paperSize];
  if (!paperShortMm) {
    throw new Error(`renderUnderpainting: unknown paperSize "${paperSize}"`);
  }
  return Math.min(canvasWidth, canvasHeight) / (paperShortMm / 25.4);
}

const DEFAULTS = {
  bindings: null,
  brushWidthMm: 0.7,
  targetPaperSize: 'A3',
  targetOrientation: 'portrait',
  dpi: null,
  softenEdges: true,           // median-blur soften after the painters
  medianKernel: 'auto',        // 'auto' scales 11 × shortEdge / 3508 (A3 ref);
                               // an explicit odd integer pins it (Pointillism
                               // pins 11 to preserve byte parity at A3).
  seed: 0xC0FFEE,
  // Water painter knobs — surfaced through PainterParamsPanel as
  // state.painter.water.*. Defaults match the panel defaults so an
  // untouched panel matches the engine baseline.
  waterReflectionStrength: 0.6,
  waterSunGlitterEnabled: true,
  waterRippleDensity: 0.4,
  // Atmospheric depth knobs (Phase 5 polish) — three painterly post-passes
  // that run after the median-blur softening: haze, sun bloom, grain +
  // grading. Surfaced through PainterParamsPanel as state.painter.atmospherics.*.
  // Defaults match the panel defaults; `atmosphericsEnabled: false` skips the
  // entire orchestrator and produces byte-identical output to pre-PR for
  // regression testing.
  atmosphericsEnabled: true,
  hazeStrength: 0.5,
  bloomStrength: 0.4,
  grainAmount: 0.15,
};

// Auto-kernel scaling: the 11×11 reference was tuned for A3 short edge
// (3508 px). Scale linearly with the canvas short edge so a 480-px-tall
// preview gets a ~1.5 kernel (floor 3) instead of an A3-sized 11×11
// that would smear small landmarks into mush. Always returns odd ≥ 3.
function autoMedianKernel(canvasShortEdge) {
  const A3_SHORT_PX = 3508;
  const scaled = 11 * canvasShortEdge / A3_SHORT_PX;
  let k = Math.max(3, Math.round(scaled));
  if (k % 2 === 0) k += 1;
  return k;
}

// Default canvas factory — used in browsers. Node tests inject their own
// via opts.createCanvas (e.g. node-canvas's createCanvas).
function browserCreateCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

// Mirrors mulberry32 in Pointillism.js. Duplicated rather than imported
// so renderUnderpainting can run without booting the stroke pass module.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the underpainting on top of `sourceCanvas`. Pure function — does
 * not mutate the input canvas; allocates and returns a new canvas with the
 * painter steps applied.
 *
 * @param {HTMLCanvasElement} sourceCanvas  Pre-painter base. Today: the WebGL
 *        snapshot from the 3D viewer (or a downscaled copy of it for the
 *        live preview). Future: a from-scratch canvas synthesised from the
 *        snapshot's sun + skyline + sky gradient (STRATEGY-V2 stage 1).
 * @param {Partial<typeof DEFAULTS>} opts
 * @returns {Promise<{canvas: HTMLCanvasElement, srcData: ImageData, timing: object}>}
 *   `canvas`   — the output canvas to draw strokes on (or to display in
 *                preview mode). When `softenEdges` is true this is the
 *                median-blurred version; otherwise it's a copy of the
 *                post-painter working canvas.
 *   `srcData`  — post-painter, pre-median ImageData. Pointillism reads its
 *                gradient field from this; the preview ignores it.
 *   `timing`   — per-step ms + counts (groundPolygonCount, canopyDabCount,
 *                landmarkDrawnCount, paintMs, medianMs).
 */
export async function renderUnderpainting(sourceCanvas, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const createCanvas = o.createCanvas || browserCreateCanvas;
  const { width, height } = sourceCanvas;

  const tStart = performance.now();

  // Working canvas: a copy of source that the painters mutate. We always
  // allocate it (even when bindings are null) so the output canvas is
  // independent of the input — the preview can hold onto it without the
  // 3D viewer's next frame overwriting the bitmap.
  const working = createCanvas(width, height);
  const wctx = working.getContext('2d');
  wctx.drawImage(sourceCanvas, 0, 0);

  let groundPolygonCount = 0;
  let waterPolygonCount = 0;
  let waterGlitterDabCount = 0;
  let waterRippleDabCount = 0;
  let waterMs = 0;
  let canopyDabCount = 0;
  let landmarkDrawnCount = 0;
  let canopyMs = 0;
  let landmarkMs = 0;

  // Effective DPI is needed by the painter's brushThicknessPx and by the
  // atmospherics post-passes (bloom radius, grain cell size — both
  // physically sized in mm). Compute once at the top so the post-pass
  // path doesn't recompute it.
  const effectiveDpi = o.dpi != null
    ? o.dpi
    : computeEffectiveDpi(width, height, o.targetPaperSize, o.targetOrientation);

  // Projection context is hoisted so the atmospherics path (haze depth,
  // sun bloom projection) can reuse it after the bindings-gated painter
  // block. Both the painter block and the atmospherics block read from
  // this; when bindings are absent, the painter block is skipped but
  // atmospherics still falls back gracefully (haze uses a default
  // horizon, bloom no-ops without sun data).
  let projectionCtx = null;
  if (o.bindings?.viewpoint && o.bindings.viewpoint.location) {
    const vp = o.bindings.viewpoint;
    projectionCtx = {
      originLat: vp.location.lat,
      originLon: vp.location.lon,
      azimuthDeg: vp.azimuthDeg,
      elevationDeg: vp.elevationDeg,
      fovDeg: vp.fovDeg,
      cameraWorldY: vp.cameraWorldY,
      groundY: vp.groundY,
      canvasWidth: width,
      canvasHeight: height,
    };
  }

  if (projectionCtx && o.bindings?.ground) {
    groundPolygonCount = paintGround(
      wctx, projectionCtx, o.bindings.ground, o.bindings.sun,
    );

    // Canopy / landmark / water painters all need the same brushThicknessPx
    // the stroke pass uses, so painted texture matches stroke density at
    // the chosen DPI. Same formula as Pointillism's stroke-pass setup.
    const brushThicknessPx = Math.max(
      1,
      Math.round(o.brushWidthMm * effectiveDpi / 25.4),
    );

    // Water before canopy because a forest can't grow on a lake; water
    // before landmarks because a tower on a lake reflects into the water
    // (out of scope for v1, but the order matters for v2). The water
    // painter samples the working canvas directly via per-polygon
    // localised getImageData strips for its sky-band tint — paintGround
    // skips water polygons, so the sky region above each water polygon
    // still holds the original sky pixels at this point in the pipeline.
    const tWater = performance.now();
    const waterResult = paintWater(
      wctx, projectionCtx, o.bindings.ground, o.bindings.sun,
      {
        rand: mulberry32(o.seed ^ 0x77_77_77_77),
        brushThicknessPx,
        reflectionStrength: o.waterReflectionStrength,
        sunGlitterEnabled: o.waterSunGlitterEnabled,
        rippleDensity: o.waterRippleDensity,
      },
    );
    waterMs = +(performance.now() - tWater).toFixed(1);
    waterPolygonCount = waterResult.polygonCount;
    waterGlitterDabCount = waterResult.glitterDabCount;
    waterRippleDabCount = waterResult.rippleDabCount;

    const tCanopy = performance.now();
    const canopyResult = paintCanopy(
      wctx, projectionCtx, o.bindings.ground, o.bindings.sun,
      { rand: mulberry32(o.seed ^ 0xC4_C4_C4_C4), brushThicknessPx },
    );
    canopyMs = +(performance.now() - tCanopy).toFixed(1);
    canopyDabCount = canopyResult.dabCount;

    const tLandmark = performance.now();
    const landmarkResult = paintLandmarks(
      wctx, projectionCtx, o.bindings.ground.landmarks, o.bindings.sun,
      { rand: mulberry32(o.seed ^ 0x14_14_14_14) },
    );
    landmarkMs = +(performance.now() - tLandmark).toFixed(1);
    landmarkDrawnCount = landmarkResult.drawnCount;
  }

  const tPaintEnd = performance.now();

  // srcData is a snapshot of the post-painter working canvas. Pointillism
  // reads its gradient field from this (NOT from the median-blurred output).
  const srcData = wctx.getImageData(0, 0, width, height);

  // Output canvas — what the stroke pass draws on, or what the preview
  // displays. Median blur softens painter edges into the rest of the
  // underpainting if softenEdges is on.
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  let medianMs = 0;
  let medianKernelUsed = 0;
  if (o.softenEdges) {
    const kernel = o.medianKernel === 'auto'
      ? autoMedianKernel(Math.min(width, height))
      : o.medianKernel;
    medianKernelUsed = kernel;
    const tMedian = performance.now();
    const medianRGBA = medianBlur11(srcData.data, width, height, kernel);
    const underData = ctx.createImageData(width, height);
    underData.data.set(medianRGBA);
    ctx.putImageData(underData, 0, 0);
    medianMs = +(performance.now() - tMedian).toFixed(1);
  } else {
    ctx.drawImage(working, 0, 0);
  }

  // ─── Atmospheric post-passes (Phase 5) ────────────────────────────────
  // Three painterly post-passes after the median blur: distance-based
  // haze, soft sun bloom, grain + global colour grading. Order is
  // haze → bloom → grain (haze before bloom so the bloom isn't hazed,
  // grain last so it reads as physical paper texture rather than as
  // blurred noise). When `atmosphericsEnabled` is false the orchestrator
  // is a no-op and the output is byte-identical to pre-PR.
  const atmosphericsResult = applyAtmospherics(
    ctx,
    projectionCtx,
    o.bindings?.sun,
    {
      enabled: o.atmosphericsEnabled,
      hazeStrength: o.hazeStrength,
      bloomStrength: o.bloomStrength,
      grainAmount: o.grainAmount,
      effectiveDpi,
      seed: o.seed,
      createCanvas,
    },
  );

  const totalMs = +(performance.now() - tStart).toFixed(1);

  return {
    canvas: out,
    srcData,
    timing: {
      groundPolygonCount,
      waterPolygonCount,
      waterGlitterDabCount,
      waterRippleDabCount,
      waterMs,
      canopyDabCount,
      canopyMs,
      landmarkDrawnCount,
      landmarkMs,
      paintMs: +(tPaintEnd - tStart).toFixed(1),
      medianMs,
      medianKernelUsed,
      atmosphericsEnabled: atmosphericsResult.enabled,
      hazeMs: atmosphericsResult.hazeMs,
      bloomMs: atmosphericsResult.bloomMs,
      grainMs: atmosphericsResult.grainMs,
      bloomFired: atmosphericsResult.bloomFired,
      hazedPixels: atmosphericsResult.hazedPixels,
      atmosphericsMs: atmosphericsResult.totalMs,
      underpaintMs: totalMs,
    },
  };
}
