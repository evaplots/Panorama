// Preview-speed probe — measures renderUnderpainting at the live-preview
// canvas size (480 × 340) on three representative scenes. The brief's
// pass bar is < 200 ms steady-state, ideally < 100 ms.
//
// Three scenes mirror the canopy/landmark perf probe:
//   forest   — Heavy forest cover (Black Forest analogue)
//   city     — Landmark-rich urban (Florence/Manhattan analogue)
//   combo    — Both at once
//
// Run: node scripts/preview-speed-probe.js

import { createCanvas } from 'canvas';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUnderpainting } from '../src/style/underpainting.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const W = 480;
const H = 340;          // A3 landscape aspect at the panel cap

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

function makeSource(w, h) {
  // Mirror the WebGL snapshot at preview size: a sky-over-land base.
  // No Math.random — keep the source byte-stable so timing variance is the
  // only differential factor across runs.
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

function buildForestScene() {
  return {
    osmFeatures: [
      rectPoly(400, -180, 800, 200, { natural: 'wood' }, 'forest'),
      rectPoly(400, 180, 800, 200, { landuse: 'forest' }, 'forest'),
      rectPoly(1000, 0, 600, 600, { natural: 'wood' }, 'forest'),
      rectPoly(2000, -400, 2200, 800, { landuse: 'forest' }, 'forest'),
      rectPoly(2000, 400, 2200, 800, { landuse: 'forest' }, 'forest'),
      rectPoly(900, 0, 100, 100, { landuse: 'residential' }, 'urban'),
    ],
    landmarks: [
      makeLandmark('church', 900, 0, 'St Heinrich', 28),
      makeLandmark('tower', 1200, 100, 'Aussichtsturm', 40),
      makeLandmark('monument', 700, -30, 'War Memorial', 12),
    ],
  };
}

function buildCityScene() {
  const landmarks = [];
  for (let i = 0; i < 15; i++) {
    landmarks.push(makeLandmark('church', 300 + (i % 5) * 60, -100 + Math.floor(i / 5) * 50,
      `Church ${i}`, 25 + (i % 3) * 10));
  }
  for (let i = 0; i < 8; i++) {
    landmarks.push(makeLandmark('tower', 600 + i * 60, -200 + (i % 2) * 400,
      `Tower ${i}`, 60 + (i % 3) * 40));
  }
  for (let i = 0; i < 4; i++) {
    landmarks.push(makeLandmark('monument', 250 + i * 50, 60, `Monument ${i}`, 15));
  }
  landmarks.push(makeLandmark('castle', 1200, -300, 'Castello', 35));
  for (let i = 0; i < 6; i++) {
    landmarks.push(makeLandmark('attraction', 350 + i * 70, -50 + i * 20, `Attraction ${i}`, 18));
  }
  return {
    osmFeatures: [
      rectPoly(600, 0, 1000, 1000, { landuse: 'residential' }, 'urban'),
      rectPoly(1200, -400, 600, 500, { landuse: 'commercial' }, 'urban'),
    ],
    landmarks,
  };
}

function buildComboScene() {
  const f = buildForestScene();
  const c = buildCityScene();
  return {
    osmFeatures: [...f.osmFeatures, ...c.osmFeatures],
    landmarks: [...f.landmarks, ...c.landmarks],
  };
}

const SCENES = { forest: buildForestScene, city: buildCityScene, combo: buildComboScene };

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

const PASS_BAR_MS = 200;
const STAR_BAR_MS = 100;

async function runOne(name, sceneBuilder, runs = 6) {
  const ground = sceneBuilder();
  const source = makeSource(W, H);
  const bindings = buildBindings(ground);

  // Warm one (JIT, allocator) before measuring.
  await renderUnderpainting(source, {
    createCanvas, bindings,
    targetPaperSize: 'A3', targetOrientation: 'landscape',
    softenEdges: true, seed: 0xC0FFEE ^ name.length,
  });

  const samples = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = await renderUnderpainting(source, {
      createCanvas, bindings,
      targetPaperSize: 'A3', targetOrientation: 'landscape',
      softenEdges: true, seed: 0xC0FFEE ^ name.length,
    });
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const min = samples[0];
  const max = samples[samples.length - 1];
  const verdict = median < STAR_BAR_MS ? '★ PASS' : (median < PASS_BAR_MS ? 'PASS' : 'FAIL');
  console.log(
    `  ${name.padEnd(8)} ` +
    `median=${median.toFixed(1)}ms min=${min.toFixed(1)} max=${max.toFixed(1)}  ` +
    `[paint=${last.timing.paintMs}ms median-blur=${last.timing.medianMs}ms] ` +
    `dabs=${last.timing.canopyDabCount} marks=${last.timing.landmarkDrawnCount}  ${verdict}`
  );
  // Save the preview output for visual sanity check.
  const outDir = path.join(ROOT, '.iterations', '2026-05-01-preview-speed');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.png`), last.canvas.toBuffer('image/png'));
  return { name, median, min, max };
}

(async () => {
  console.log('Preview-speed probe');
  console.log(`Canvas: ${W} × ${H} (A3 landscape preview cap)`);
  console.log(`Pass: median < ${PASS_BAR_MS} ms (★ < ${STAR_BAR_MS} ms)`);
  console.log('--- 6 samples per scene, plus a warmup ---');

  const results = [];
  for (const name of Object.keys(SCENES)) {
    results.push(await runOne(name, SCENES[name]));
  }

  console.log('\nSummary');
  let allPass = true;
  for (const r of results) {
    const verdict = r.median < STAR_BAR_MS ? '★ PASS' : (r.median < PASS_BAR_MS ? 'PASS' : 'FAIL');
    if (verdict === 'FAIL') allPass = false;
    console.log(`  ${r.name.padEnd(8)}  median=${r.median.toFixed(1)} ms  ${verdict}`);
  }
  console.log(allPass ? '\nALL PASS' : '\nFAIL — surface to user before continuing');
  process.exit(allPass ? 0 : 2);
})();
