// Regression guard for the foreground-polygon-sort fix.
//
// Bug class: when a forest polygon overlaps a smaller farmland polygon,
// the previous area-DESC sort drew forest first (bigger area) and
// farmland last (on top), which hid forest under farmland. This broke
// any scene where forest happened to overlap smaller landuse polygons
// in OSM. See:
// `.iterations/2026-05-02-foreground-polygon-projection/DIAGNOSIS.md`.
//
// Fix: paintGround now sorts by category priority FIRST (forest > beach
// > urban > farmland), then by area DESC within priority. Cross-
// category overlaps now favour the more-specific signal (forest beats
// farmland regardless of size).
//
// What this probe tests:
//   1. Hand-crafted scene with one BIG forest polygon and one SMALL
//      farmland polygon overlapping it. The pixel inside the overlap
//      region must be FOREST-coloured, not farmland.
//   2. Hand-crafted scene with one BIG farmland polygon and one SMALL
//      meadow polygon nested inside (same category). The meadow must
//      win on top — the same-category "small details survive on top
//      of broad fills" rule must still hold.
//   3. Hand-crafted scene with one BIG forest, one SMALL farmland,
//      one EVEN-SMALLER urban polygon all overlapping. Topmost owner
//      at each region's centre is correct: forest in forest-only area,
//      forest in forest+farmland overlap, urban in forest+urban
//      overlap (urban < forest priority). (Verifies the priority
//      ordering: forest [1] < urban [3] < farmland [4].)
//
// Run: node scripts/foreground-polygon-sort-probe.js
// Exit: 0 = PASS, 2 = FAIL.

import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { paintGround } from '../src/style/groundPainter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.iterations', '2026-05-02-foreground-polygon-sort');

const W = 480;
const H = 340;

// Camera at origin looking south at -10°. Polygons placed in front
// (south, +Z direction) at flat groundY. Eye height 1.7 m. Horizon
// projects to canvas-y ≈ 97; canvas-y 250–300 ≈ 8–10 m world distance
// from camera at this tilt.
const PROJECTION_CTX = {
  originLat: 45.0,
  originLon: 6.0,
  azimuthDeg: 180,
  elevationDeg: -10,
  fovDeg: 60,
  cameraWorldY: 1.7,
  groundY: 0,
  canvasWidth: W,
  canvasHeight: H,
};

const M_PER_DEG_LAT = 111320;

// Place a square polygon centred at (centreSouthM, centreEastM) metres
// from camera, with `sideM` side length. Returns an `osmFeature` shaped
// like what snapshot.js produces (lat/lon outer ring + category +
// tags).
function squarePolygon(centreSouthM, centreEastM, sideM, tags, category) {
  const halfS = sideM / 2;
  const halfE = sideM / 2;
  const corners = [
    [centreEastM - halfE, centreSouthM - halfS],
    [centreEastM + halfE, centreSouthM - halfS],
    [centreEastM + halfE, centreSouthM + halfS],
    [centreEastM - halfE, centreSouthM + halfS],
  ];
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(PROJECTION_CTX.originLat * Math.PI / 180);
  return {
    tags,
    category,
    outer: corners.map(([eastM, southM]) => ({
      lat: PROJECTION_CTX.originLat - southM / M_PER_DEG_LAT,
      lon: PROJECTION_CTX.originLon + eastM / mPerDegLon,
    })),
    inners: [],
  };
}

function makeSource() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  // Distinct sky / ground source so any unpainted pixel is identifiable.
  ctx.fillStyle = '#000000';                     // pure black background
  ctx.fillRect(0, 0, W, H);
  return c;
}

function pixelAt(canvas, x, y) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

// Distance between two RGB triples (Euclidean in RGB cube).
function rgbDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function nearestCategoryByPixel(rgb) {
  // The painter applies a vertical lighten/darken gradient to each
  // polygon's base colour, so a sampled pixel is somewhere in the
  // [lighten(0.20), darken(0.30)] band of its category's base hex.
  // We just look for whichever base hex is closest in RGB.
  const candidates = [
    { name: 'forest',   rgb: [0x3a, 0x55, 0x38] },   // natural=wood / landuse=forest
    { name: 'beach',    rgb: [0xe8, 0xd8, 0xa8] },   // natural=beach
    { name: 'urban',    rgb: [0xb0, 0xa8, 0x9a] },   // landuse=residential
    { name: 'farmland', rgb: [0xc5, 0xb0, 0x78] },   // landuse=farmland
    { name: 'meadow',   rgb: [0x9a, 0xb0, 0x50] },   // landuse=meadow (farmland category)
    { name: 'source',   rgb: [0x00, 0x00, 0x00] },   // unpainted black source
  ];
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = rgbDist(rgb, c.rgb);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best.name;
}

function runScene(label, features, samples) {
  const canvas = makeSource();
  const ctx = canvas.getContext('2d');
  paintGround(ctx, PROJECTION_CTX, { osmFeatures: features });
  fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), canvas.toBuffer('image/png'));

  const lines = [`# ${label}`];
  let pass = true;
  for (const s of samples) {
    const rgb = pixelAt(canvas, s.x, s.y);
    const cat = nearestCategoryByPixel(rgb);
    const ok = cat === s.expect;
    if (!ok) pass = false;
    lines.push(
      `  ${ok ? 'PASS' : 'FAIL'}  (${s.x},${s.y}) rgb=${rgb.join(',').padEnd(11)}  ` +
      `expect=${s.expect.padEnd(8)} got=${cat.padEnd(8)}  ${s.note ?? ''}`
    );
  }
  console.log(lines.join('\n'));
  return pass;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('━━━ foreground polygon sort probe ━━━\n');

  // ─── Scene 1: big forest covers small farmland (cross-category) ──
  //
  // BIG forest (200 m × 200 m centred 50 m south, contains camera at
  // its near edge — extends from south=−50 to south=150 m). After
  // Sutherland–Hodgman near-plane clip its projected screen-area is
  // dominant.
  // SMALL farmland (20 m × 20 m centred 30 m south — inside the
  // forest's world extent, projects to canvas-y ≈ 260–278).
  //
  // Pre-fix (area-DESC): forest drawn first (huge clipped area),
  // farmland drawn last on top (small) → sample inside farmland =
  // farmland colour.
  // Post-fix (category-priority): farmland (priority 4) drawn first,
  // forest (priority 1) drawn last on top → sample inside farmland =
  // forest colour.

  const scene1 = [
    squarePolygon(50, 0, 200, { 'natural': 'wood' },       'forest'),
    squarePolygon(30, 0, 20,  { 'landuse': 'farmland' },   'farmland'),
  ];
  console.log('# scene 1: big forest + small farmland inside (overlap)');
  const scene1Pass = runScene('scene1-big-forest-small-farmland', scene1, [
    { x: 240, y: 125, expect: 'forest', note: 'inside small farmland trapezoid AND big forest — forest must win cross-category' },
    { x: 240, y: 200, expect: 'forest', note: 'inside forest only (below farmland) — forest visible' },
  ]);

  // ─── Scene 2: same-category nesting (regression guard for old rule) ──
  //
  // BIG farmland (200 m × 200 m centred 50 m south).
  // SMALL meadow (20 m × 20 m centred 30 m south).
  //
  // Both farmland-category. Sort within priority by area-DESC: big
  // drawn first, small drawn last on top. The meadow wins inside its
  // region. This is the rule the original sort embodied; the fix must
  // preserve it for SAME-category nesting.

  const scene2 = [
    squarePolygon(50, 0, 200, { 'landuse': 'farmland' }, 'farmland'),
    squarePolygon(30, 0, 20,  { 'landuse': 'meadow' },   'farmland'),
  ];
  console.log('\n# scene 2: same-category nesting (meadow inside farmland)');
  const scene2Pass = runScene('scene2-meadow-inside-farmland', scene2, [
    { x: 240, y: 125, expect: 'meadow',   note: 'inside small meadow trapezoid AND big farmland — small same-cat wins on top' },
    { x: 240, y: 200, expect: 'farmland', note: 'inside big farmland, outside meadow — big farmland visible' },
  ]);

  // ─── Scene 3: urban beats farmland (cross-category) ──────────────────
  //
  // BIG urban (200 m × 200 m centred 50 m south).
  // SMALL farmland (20 m × 20 m centred 30 m south, inside urban).
  //
  // Pre-fix: big urban drawn first, small farmland drawn last on top
  // → at the overlap sample = farmland.
  // Post-fix: farmland (priority 4) drawn first, urban (priority 3)
  // drawn last on top → at the overlap sample = urban.
  // Verifies the priority ordering distinguishes urban from farmland
  // (not just forest from everything).

  const scene3 = [
    squarePolygon(50, 0, 200, { 'landuse': 'residential' }, 'urban'),
    squarePolygon(30, 0, 20,  { 'landuse': 'farmland' },    'farmland'),
  ];
  console.log('\n# scene 3: urban beats farmland (cross-category)');
  const scene3Pass = runScene('scene3-urban-beats-farmland', scene3, [
    { x: 240, y: 125, expect: 'urban',    note: 'inside both — urban wins (priority 3 < farmland priority 4)' },
    { x: 240, y: 200, expect: 'urban',    note: 'inside urban only (below farmland) — urban visible' },
  ]);

  console.log('\n━━━ summary ━━━');
  console.log(`  scene1 (forest > farmland) : ${scene1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`  scene2 (same-cat nesting)  : ${scene2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`  scene3 (three-way overlap) : ${scene3Pass ? 'PASS' : 'FAIL'}`);
  console.log(`\nsaved: ${path.relative(ROOT, OUT_DIR)}`);

  if (scene1Pass && scene2Pass && scene3Pass) {
    console.log('\nALL PASS');
    process.exit(0);
  }
  console.log('\nFAIL — paintGround sort regression detected.');
  console.log('See DIAGNOSIS.md for the bug class this guards against.');
  process.exit(2);
})();
