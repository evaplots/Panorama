// Preview-vs-full agreement probe.
//
// Renders the SAME snapshot at preview size (480 × 340) and at A3 landscape
// (4961 × 3508), downsamples the A3 underpainting to preview size with
// good-quality resampling, then computes per-channel mean absolute pixel
// error against the preview render.
//
// The preview should be a faithful low-res version of the full underpainting:
// same canopy density per area, same landmarks projected at the same
// fractional positions, same sun-phase tint. Per-pixel byte equality is
// not expected (resampling kernels differ, sub-pixel coordinates round
// differently), but mean absolute error per channel should be small enough
// that the preview is honest about what the full paint will produce.
//
// Heuristic pass criterion: mean absolute error per channel < 14
// (~5.5 % of 255). Above that, the preview is structurally different from
// the full underpainting in a way that would mislead curation — e.g.
// canopy density not scaling with area, landmarks falling in wrong
// positions, or sun tint applied at different magnitudes.
//
// Run: node scripts/preview-agreement-probe.js

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUnderpainting } from '../src/style/underpainting.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PREVIEW_W = 480;
const PREVIEW_H = 340;
const FULL_W = 4961;
const FULL_H = 3508;

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

function makeLandmark(category, eM, sM, name, heightM) {
  const { lat, lon } = ll(eM, sM);
  return { category, lat, lon, name, heightM };
}

// Same source recipe at both resolutions, identical RNG-free build.
function makeSource(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
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
  return c;
}

function buildScene() {
  // Forest + a small townscape so canopy + landmarks both fire on both
  // resolutions. Polygons sized to project well inside a 60° FOV at the
  // chosen depths.
  return {
    osmFeatures: [
      rectPoly(400, -180, 800, 200, { natural: 'wood' }, 'forest'),
      rectPoly(400, 180, 800, 200, { landuse: 'forest' }, 'forest'),
      rectPoly(1000, 0, 600, 600, { natural: 'wood' }, 'forest'),
    ],
    landmarks: [
      makeLandmark('church', 900, 0, 'St Heinrich', 28),
      makeLandmark('tower', 1200, 100, 'Aussichtsturm', 40),
      makeLandmark('monument', 700, -30, 'War Memorial', 12),
    ],
  };
}

function buildBindings(ground) {
  return {
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
}

// Quality downscale: node-canvas's drawImage(big, 0, 0, smallW, smallH)
// uses bilinear interpolation. For the agreement diff we want better than
// nearest-neighbour but bilinear is enough at the 10× scale ratio here.
function downscale(big, w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // imageSmoothingQuality is supported on browser canvas; node-canvas
  // ignores it but still does bilinear under the hood.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(big, 0, 0, w, h);
  return c;
}

function meanAbsoluteError(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error('mismatched dims');
  }
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < da.length; i += 4) {
    sum += Math.abs(da[i] - db[i]);
    sum += Math.abs(da[i + 1] - db[i + 1]);
    sum += Math.abs(da[i + 2] - db[i + 2]);
    n += 3;
  }
  return sum / n;
}

const PASS_BAR_MAE = 14;

(async () => {
  console.log('Preview-vs-full agreement probe');
  console.log(`Preview: ${PREVIEW_W}×${PREVIEW_H}, Full: ${FULL_W}×${FULL_H}`);
  console.log(`Pass bar: mean |Δ| per channel < ${PASS_BAR_MAE}`);

  const ground = buildScene();
  const bindings = buildBindings(ground);

  // PREVIEW
  const prevSrc = makeSource(PREVIEW_W, PREVIEW_H);
  const prev = await renderUnderpainting(prevSrc, {
    createCanvas, bindings,
    targetPaperSize: 'A3', targetOrientation: 'landscape',
    softenEdges: true, seed: 0xDEADBEEF,
  });
  console.log('  preview rendered:', PREVIEW_W, '×', PREVIEW_H,
    `(canopy ${prev.timing.canopyDabCount}, marks ${prev.timing.landmarkDrawnCount})`);

  // FULL
  const fullSrc = makeSource(FULL_W, FULL_H);
  const full = await renderUnderpainting(fullSrc, {
    createCanvas, bindings,
    targetPaperSize: 'A3', targetOrientation: 'landscape',
    softenEdges: true, seed: 0xDEADBEEF,
  });
  console.log('  full rendered   :', FULL_W, '×', FULL_H,
    `(canopy ${full.timing.canopyDabCount}, marks ${full.timing.landmarkDrawnCount})`);

  // Downsample full to preview dims.
  const fullDown = downscale(full.canvas, PREVIEW_W, PREVIEW_H);
  const mae = meanAbsoluteError(prev.canvas, fullDown);
  console.log('  mean absolute error per channel:', mae.toFixed(2));

  const verdict = mae < PASS_BAR_MAE ? 'PASS' : 'FAIL';
  console.log('  verdict:', verdict);

  // Save outputs for visual diff.
  const outDir = path.join(ROOT, '.iterations', '2026-05-01-preview-agreement');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'preview.png'), prev.canvas.toBuffer('image/png'));
  fs.writeFileSync(path.join(outDir, 'full-down.png'), fullDown.toBuffer('image/png'));
  // Also save full A3 as a thumb (downscaled to 1200) so the user can eyeball.
  const thumb = downscale(full.canvas, 1200, Math.round(1200 * FULL_H / FULL_W));
  fs.writeFileSync(path.join(outDir, 'full-thumb.png'), thumb.toBuffer('image/png'));
  console.log('  outputs:', path.relative(ROOT, outDir));

  process.exit(verdict === 'PASS' ? 0 : 2);
})();
