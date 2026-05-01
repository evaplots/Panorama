// Risk-first perf probe for the V2 painterly vegetation/landmarks PR.
// Measures the new canopyPainter and landmarkPainter at A3 @ 300 DPI on
// representative synthetic scenes:
//
//   forest    Heavy forest cover (~5 large forest polygons + a town centre
//             so the landmark painter has something to draw too).
//             Mirrors a Black Forest / Sequoia extent.
//   city      Landmark-rich urban scene (15 churches + 8 towers + 4
//             monuments + 2 castles + 6 named attractions). Mirrors a
//             Florence / Manhattan / Rome.
//   combo     Both — worst case for the new painters in one scene.
//
// Pass criterion: total A3 render must stay under 28s (2s headroom under
// the 30s user-tolerance bar).
//
// Run: node scripts/canopy-landmark-perf-probe.js

import { createCanvas } from 'canvas';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPointillism } from '../src/style/Pointillism.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const A3_W = 4961;
const A3_H = 3508;

// Observer near 48° N (mid-Europe-ish; matches Black Forest / Florence
// roughly). Lat/lon and azimuth are arbitrary; what matters is that the
// synthetic polygons / landmarks land in front of the camera.
const OBSERVER_LAT = 48.0;
const OBSERVER_LON = 8.0;
const AZIMUTH_DEG = 90;       // looking east
const ELEVATION_DEG = -2;
const FOV_DEG = 60;
const EYE_HEIGHT_M = 1.7;
const GROUND_Y = 0;

// ─────────────────────────────────────────────────────────────────────────
// Synthetic source canvas — minimal sky-over-land, enough for the median
// blur and gradient pass to have something to bite into.
// ─────────────────────────────────────────────────────────────────────────
function makeSourceCanvas(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#cdd9e8');
  sky.addColorStop(0.6, '#e0c8a4');
  sky.addColorStop(1, '#9c7560');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);
  // Ground
  const ground = ctx.createLinearGradient(0, h * 0.55, 0, h);
  ground.addColorStop(0, '#7a8a55');
  ground.addColorStop(1, '#3e4a2a');
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  // Per-pixel noise so flat regions have gradient texture
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(${(Math.random()*255)|0},${(Math.random()*255)|0},${(Math.random()*255)|0},${0.04 + Math.random() * 0.06})`;
    ctx.beginPath();
    ctx.arc(x, y, 30 + Math.random() * 80, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────────
// Synthetic OSM polygons — wedges/rectangles in lat/lon space that sit
// in front of the observer at varying depths. The painter projects them
// onto the canvas using the same projection module the real flow uses.
// ─────────────────────────────────────────────────────────────────────────
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(OBSERVER_LAT * Math.PI / 180);

function metresToLatLon(eastM, southM) {
  return {
    lat: OBSERVER_LAT - southM / M_PER_DEG_LAT,
    lon: OBSERVER_LON + eastM / M_PER_DEG_LON,
  };
}

// Rectangular forest polygon in screen-space metres, centred at (eastM, southM)
// in front of the observer. Looking east (azimuth 90°), east = positive
// distance from observer. Width and depth are in metres.
function forestPolygon(centreEastM, centreSouthM, widthM, depthM, tags) {
  const half = (widthM / 2);
  const halfDepth = (depthM / 2);
  const corners = [
    [centreEastM - halfDepth, centreSouthM - half],
    [centreEastM + halfDepth, centreSouthM - half],
    [centreEastM + halfDepth, centreSouthM + half],
    [centreEastM - halfDepth, centreSouthM + half],
  ];
  return {
    tags,
    category: 'forest',
    outer: corners.map(([e, s]) => metresToLatLon(e, s)),
    inners: [],
  };
}

function urbanPolygon(centreEastM, centreSouthM, widthM, depthM, tags) {
  const p = forestPolygon(centreEastM, centreSouthM, widthM, depthM, tags);
  p.category = 'urban';
  return p;
}

// ─────────────────────────────────────────────────────────────────────────
// Synthetic landmarks — points scattered in front of observer.
// ─────────────────────────────────────────────────────────────────────────
function makeLandmark(category, eastM, southM, name, heightM) {
  const { lat, lon } = metresToLatLon(eastM, southM);
  return { category, lat, lon, name: name ?? null, heightM: heightM ?? null };
}

// ─────────────────────────────────────────────────────────────────────────
// Scenes
// ─────────────────────────────────────────────────────────────────────────

// Forest-heavy: 5 forest polygons of varying size and depth, plus a small
// urban inset and a smattering of landmarks (church spire, observation tower).
function buildForestScene() {
  return {
    osmFeatures: [
      // Foreground (200–600 m), dense forest cover on both sides
      forestPolygon(400, -800, 1200, 800, { 'natural': 'wood' }),
      forestPolygon(400,  800, 1200, 800, { 'landuse': 'forest' }),
      // Mid-distance forest band (800–1400 m)
      forestPolygon(1100, 0, 1500, 800, { 'natural': 'wood' }),
      // Far forest (1500–2500 m)
      forestPolygon(2000, -400, 2200, 800, { 'landuse': 'forest' }),
      forestPolygon(2000,  400, 2200, 800, { 'landuse': 'forest' }),
      // A small urban village at the foot of the forest
      urbanPolygon(900, 0, 200, 200, { 'landuse': 'residential' }),
    ],
    landmarks: [
      // The village church and an observation tower in the trees
      makeLandmark('church', 900, 0, 'St Heinrich', 28),
      makeLandmark('tower',  1200, 200, 'Aussichtsturm', 40),
      makeLandmark('monument', 880, -30, 'War Memorial', 12),
    ],
  };
}

// Landmark-rich city: 35 mixed landmarks scattered at depths 200–2000 m,
// plus a few urban polygons so the ground painter has something too.
function buildCityScene() {
  const landmarks = [];
  // Churches in a Florence-like cluster
  for (let i = 0; i < 15; i++) {
    const eastM = 300 + (i % 5) * 120;
    const southM = -200 + (Math.floor(i / 5)) * 100;
    landmarks.push(makeLandmark('church', eastM, southM, `Church ${i}`, 25 + (i % 3) * 10));
  }
  // Manhattan-style observation towers in a back row
  for (let i = 0; i < 8; i++) {
    landmarks.push(makeLandmark('tower', 800 + i * 80, -300 + (i % 2) * 600,
      `Tower ${i}`, 60 + (i % 3) * 40));
  }
  // Public monuments in the foreground
  for (let i = 0; i < 4; i++) {
    landmarks.push(makeLandmark('monument', 250 + i * 70, 80, `Monument ${i}`, 15));
  }
  // A castle on a hill at distance
  landmarks.push(makeLandmark('castle', 1500, -400, 'Castello', 35));
  landmarks.push(makeLandmark('castle', 1700, 400, 'Old Fort', 25));
  // Tourist attractions (named only — anonymous ones get filtered upstream)
  for (let i = 0; i < 6; i++) {
    landmarks.push(makeLandmark('attraction', 350 + i * 100, -100 + i * 30,
      `Attraction ${i}`, 18));
  }
  return {
    osmFeatures: [
      urbanPolygon(600, 0, 1200, 1200, { 'landuse': 'residential' }),
      urbanPolygon(1500, -500, 800, 600, { 'landuse': 'commercial' }),
    ],
    landmarks,
  };
}

// Combo: forest scene's polygons + city scene's landmarks. Worst case for
// the new painters running together.
function buildComboScene() {
  const forest = buildForestScene();
  const city = buildCityScene();
  return {
    osmFeatures: [...forest.osmFeatures, ...city.osmFeatures],
    landmarks: [...forest.landmarks, ...city.landmarks],
  };
}

const SCENES = {
  forest: buildForestScene,
  city:   buildCityScene,
  combo:  buildComboScene,
};

// ─────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────

function buildBindings(ground) {
  return {
    sun: { phase: 'goldenHour' },
    timestamp: new Date('2026-05-01T18:30:00Z'),
    location: { lat: OBSERVER_LAT, lon: OBSERVER_LON },
    viewpoint: {
      location: { lat: OBSERVER_LAT, lon: OBSERVER_LON },
      azimuthDeg: AZIMUTH_DEG,
      elevationDeg: ELEVATION_DEG,
      fovDeg: FOV_DEG,
      eyeHeightM: EYE_HEIGHT_M,
      cameraWorldY: GROUND_Y + EYE_HEIGHT_M,
      groundY: GROUND_Y,
    },
    ground,
  };
}

// v1.4 expressionist preset, the museum-bar baseline against which the
// 22-26s A3 budget in RELEASE-NOTES.md is measured. Mirrors the CLI flags
// `--curated --no-median --width-mm=1.2 --brush-stroke=2.0 --density=0.03`.
const V14_PRESET = {
  brushWidthMm: 1.2,
  brushStrokeFactor: 2.0,
  density: 0.03,
  applyMedianUnderpaint: false,
};

async function runScene(name, sceneBuilder, presetName = 'v1.4', presetOpts = V14_PRESET) {
  console.log(`\n━━━ ${name.padEnd(8)} (${presetName}) ━━━`);
  const ground = sceneBuilder();
  console.log(
    `  ground polygons : ${ground.osmFeatures.length}` +
    ` (forest: ${ground.osmFeatures.filter(f => f.category === 'forest').length})`
  );
  console.log(`  landmarks       : ${ground.landmarks.length}`);

  const source = makeSourceCanvas(A3_W, A3_H);
  const bindings = buildBindings(ground);

  const t0 = performance.now();
  const { canvas: out, timing } = await applyPointillism(source, {
    createCanvas,
    bindings,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    seed: 0xC0FFEE ^ name.length,
    ...presetOpts,
  });
  const wallMs = +(performance.now() - t0).toFixed(1);

  console.log(`  canopy dabs     : ${timing.canopyDabCount.toLocaleString()}` +
    `  (${timing.canopyMs} ms)`);
  console.log(`  landmarks drawn : ${timing.landmarkDrawnCount}` +
    `  (${timing.landmarkMs} ms)`);
  console.log(`  ground polygons : ${timing.groundPolygonCount}`);
  console.log(`  median blur     : ${timing.underpaintMs} ms`);
  console.log(`  gradient        : ${timing.gradientMs} ms`);
  console.log(`  stroke pass     : ${timing.strokesMs} ms`);
  console.log(`  ─────────`);
  console.log(`  TOTAL           : ${timing.totalMs} ms` +
    ` (${(timing.totalMs / 1000).toFixed(2)} s, wall ${(wallMs / 1000).toFixed(2)} s)`);

  // Save output for visual sanity check.
  const outDir = path.join(ROOT, '.iterations', '2026-05-01-canopy-landmark-perf');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${name}.png`);
  fs.writeFileSync(outPath, out.toBuffer('image/png'));
  console.log(`  saved           : ${path.relative(ROOT, outPath)}`);

  return { name, timing, wallMs };
}

const PASS_BAR_MS = 28000;

(async () => {
  const filter = process.argv[2];
  const names = filter ? [filter] : Object.keys(SCENES);

  console.log('Canopy + landmark painter perf probe');
  console.log(`Target: A3 landscape @ 300 DPI (${A3_W}×${A3_H} = ${(A3_W*A3_H/1e6).toFixed(2)} MP)`);
  console.log(`Pass bar: total < ${PASS_BAR_MS} ms`);

  const results = [];
  for (const name of names) {
    const builder = SCENES[name];
    if (!builder) {
      console.error(`Unknown scene "${name}". Choose one of: ${Object.keys(SCENES).join(', ')}`);
      process.exit(1);
    }
    results.push(await runScene(name, builder));
  }

  console.log('\n━━━ summary ━━━');
  let allPass = true;
  for (const r of results) {
    const verdict = r.timing.totalMs < PASS_BAR_MS ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') allPass = false;
    console.log(
      `  ${r.name.padEnd(8)}  ` +
      `total=${(r.timing.totalMs/1000).toFixed(2)}s  ` +
      `canopy=${r.timing.canopyMs}ms  ` +
      `landmarks=${r.timing.landmarkMs}ms  ` +
      `${verdict}`
    );
  }
  console.log(allPass ? '\nALL PASS' : '\nFAIL — surface to user before continuing');
  process.exit(allPass ? 0 : 2);
})();
