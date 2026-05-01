// Refactor-parity probe for the underpainting-preview PR.
// Runs applyPointillism on a fixed source + fixed snapshot + fixed seed and
// hashes the resulting PNG. Same Snapshot in → same painting out is the
// determinism contract; this probe enforces it across the underpainting
// extraction refactor.
//
// Usage:
//   node scripts/parity-probe.js
//
// Captures: SHA-256 of the output PNG buffer + stroke/canopy/landmark counts.
// The hash should be identical before and after the renderUnderpainting
// extraction. Any drift means the refactor changed semantics — STOP.

import { createCanvas } from 'canvas';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { applyPointillism } from '../src/style/Pointillism.js';

// Use the v1.4 expressionist preset — the museum-bar baseline. The probe
// covers the bindings-on path (canopy + landmark + ground polygons all
// active) and is therefore the strictest parity check for the refactor.
const W = 1600;
const H = 1133;          // ~A3-landscape aspect, smaller for fast iteration
const LAT0 = 48.0;
const LON0 = 8.0;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);

function ll(eM, sM) {
  return { lat: LAT0 - sM / M_PER_DEG_LAT, lon: LON0 + eM / M_PER_DEG_LON };
}

function rectPoly(eM, sM, wM, dM, tags, category) {
  const half = wM / 2, hd = dM / 2;
  const corners = [
    [eM - hd, sM - half], [eM + hd, sM - half],
    [eM + hd, sM + half], [eM - hd, sM + half],
  ];
  return { tags, category, outer: corners.map(([e, s]) => ll(e, s)), inners: [] };
}

function makeSourceDeterministic(w, h) {
  // No Math.random — every byte must be reproducible across runs.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // sky-over-land base
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#cdd9e8');
  sky.addColorStop(0.6, '#e0c8a4');
  sky.addColorStop(1, '#9c7560');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);
  const ground = ctx.createLinearGradient(0, h * 0.55, 0, h);
  ground.addColorStop(0, '#7a8a55');
  ground.addColorStop(1, '#3e4a2a');
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  // deterministic colour rectangles
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = 'hsl(' + (i * 11 % 360) + ',45%,35%)';
    ctx.fillRect((i * 31) % w, ((i * 17) % h) | 0, 60, 60);
  }
  return c;
}

// FOV is 60° → half-cross-track at depth d ≈ d × tan(30°) = d × 0.577.
// Polygons sized to comfortably fit inside the cone so canopy actually fires.
const ground = {
  osmFeatures: [
    // Foreground forest (200–600 m), cross-track ±150 m — well inside FOV.
    rectPoly(400, -180, 800, 200, { natural: 'wood' }, 'forest'),
    rectPoly(400, 180, 800, 200, { landuse: 'forest' }, 'forest'),
    // Mid-distance large forest (700–1300 m), cross-track ±300 m.
    rectPoly(1000, 0, 600, 600, { natural: 'wood' }, 'forest'),
    // A small urban tile in the middle, for a non-forest polygon
    rectPoly(900, 0, 100, 100, { landuse: 'residential' }, 'urban'),
  ],
  landmarks: [
    { category: 'church', name: 'St Heinrich', lat: ll(900, 0).lat, lon: ll(900, 0).lon, heightM: 28 },
    { category: 'tower', name: 'Aussichtsturm', lat: ll(1200, 100).lat, lon: ll(1200, 100).lon, heightM: 40 },
    { category: 'monument', name: 'War Memorial', lat: ll(700, -30).lat, lon: ll(700, -30).lon, heightM: 12 },
  ],
};

const bindings = {
  sun: { phase: 'goldenHour' },
  timestamp: new Date('2026-05-01T18:30:00Z'),
  location: { lat: LAT0, lon: LON0 },
  viewpoint: {
    location: { lat: LAT0, lon: LON0 },
    azimuthDeg: 90,
    elevationDeg: -2,
    fovDeg: 60,
    eyeHeightM: 1.7,
    cameraWorldY: 1.7,
    groundY: 0,
  },
  ground,
};

(async () => {
  const src = makeSourceDeterministic(W, H);
  const t0 = performance.now();
  const { canvas, timing } = await applyPointillism(src, {
    createCanvas,
    bindings,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    brushWidthMm: 1.2,
    brushStrokeFactor: 2.0,
    density: 0.03,
    applyMedianUnderpaint: false,
    seed: 0xDEADBEEF,
    // Disable the Phase 5 atmospheric post-passes so the parity check
    // measures the rest of the engine in isolation. The atmospheric
    // depth PR (haze + bloom + grain) is a NEW feature; the parity hash
    // by definition changes when the new passes run. The contract is
    // that with `atmosphericsEnabled: false`, the output is byte-identical
    // to pre-atmospheric-depth.
    atmosphericsEnabled: false,
  });
  const wallMs = +(performance.now() - t0).toFixed(1);
  const buf = canvas.toBuffer('image/png');
  const hash = createHash('sha256').update(buf).digest('hex');

  console.log('PARITY PROBE');
  console.log('  canvas       :', W, 'x', H);
  console.log('  png bytes    :', buf.length);
  console.log('  sha256       :', hash);
  console.log('  strokes      :', timing.strokeCount);
  console.log('  canopy dabs  :', timing.canopyDabCount);
  console.log('  landmarks    :', timing.landmarkDrawnCount);
  console.log('  ground polys :', timing.groundPolygonCount);
  console.log('  total ms     :', timing.totalMs, '(wall', wallMs, ')');
})();
