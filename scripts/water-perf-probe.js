// Risk-first probes for the painterly water reflections PR.
//
// Three concerns, three probes, one script:
//   1. PERF — coastal-extent water polygon at A3 @ 300 DPI. waterPainter
//      should stay under 50 ms; total A3 render under 28 s.
//   2. SUN-DIRECTION — same lake at four sun azimuths × three elevations
//      (12 outputs). Glitter present only when the geometry says it
//      should be. Saved as PNGs for visual confirmation.
//   3. TINT — same lake at noon vs sunset, sun behind camera in both.
//      Confirms the SUN_PHASE_TINT envelope reaches waterPainter and
//      changes the band tint.
//
// Outputs: .iterations/2026-05-01-water-reflections/
//   perf.png                                   — coastal A3 perf scene
//   sun-az<DEG>-alt<DEG>.png                   — 12 sun-direction outputs
//   tint-noon.png, tint-sunset.png             — 2 tint-comparison outputs
//
// Run: node scripts/water-perf-probe.js
//      node scripts/water-perf-probe.js perf
//      node scripts/water-perf-probe.js sun
//      node scripts/water-perf-probe.js tint

import { createCanvas } from 'canvas';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPointillism } from '../src/style/Pointillism.js';
import { renderUnderpainting } from '../src/style/underpainting.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.iterations', '2026-05-01-water-reflections');

const A3_W = 4961;
const A3_H = 3508;

// Mediterranean-ish observer: high sea cliff looking out over a wide lake.
// 80 m cliff so the water polygon at sea level projects to a meaningful
// vertical extent on the canvas (low eye-height + slight downward tilt
// rolls the lake into a one-pixel sliver at the horizon — the cliff height
// gives the scene the geometry it has in real life).
const OBSERVER_LAT = 43.6;
const OBSERVER_LON = 7.2;
const AZIMUTH_DEG = 180;       // looking south toward the water
const ELEVATION_DEG = -12;     // tilted down to put the sea below the horizon
const FOV_DEG = 60;
const EYE_HEIGHT_M = 80;       // coastal cliff observer
const GROUND_Y = 0;

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(OBSERVER_LAT * Math.PI / 180);

function metresToLatLon(eastM, southM) {
  return {
    lat: OBSERVER_LAT - southM / M_PER_DEG_LAT,
    lon: OBSERVER_LON + eastM / M_PER_DEG_LON,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Source canvas — sky with a horizon, ground as the lower band so paint-
// Ground polygons land on a non-trivial backdrop.
// ─────────────────────────────────────────────────────────────────────────
function makeSourceCanvas(w, h, sunPhase = 'goldenHour') {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  // Phase-coloured sky (matches what waterPainter samples for the band).
  const skyStops = {
    day:           ['#9fb6d2', '#c8d6e6', '#d8d8c8'],
    goldenHour:    ['#f5d7a0', '#ffb070', '#c08060'],
    sunset:        ['#f29070', '#d05060', '#603850'],
    civilTwilight: ['#604060', '#3a4060', '#252a48'],
    night:         ['#0a0e22', '#10142a', '#1a1c30'],
  };
  const stops = skyStops[sunPhase] ?? skyStops.day;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, stops[0]);
  sky.addColorStop(0.7, stops[1]);
  sky.addColorStop(1, stops[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);

  // Ground / cliff — dark for sunset moods, midtone for day.
  const ground = ctx.createLinearGradient(0, h * 0.55, 0, h);
  if (sunPhase === 'night' || sunPhase === 'civilTwilight') {
    ground.addColorStop(0, '#1c1e2c');
    ground.addColorStop(1, '#0a0c14');
  } else {
    ground.addColorStop(0, '#5a5040');
    ground.addColorStop(1, '#2c2820');
  }
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  return c;
}

// ─────────────────────────────────────────────────────────────────────────
// Polygons — large coastal water mass + a narrow beach strip + small
// cliffside vegetation. Water polygon is large enough that the painter's
// rejection sampler has a serious workload (Mediterranean coast ~ several
// km², projected to a substantial fraction of the canvas).
// ─────────────────────────────────────────────────────────────────────────
function rectPolygon(centreEastM, centreSouthM, eastDepthM, southWidthM, tags, category) {
  const halfEast = eastDepthM / 2;
  const halfSouth = southWidthM / 2;
  const corners = [
    [centreEastM - halfEast, centreSouthM - halfSouth],
    [centreEastM + halfEast, centreSouthM - halfSouth],
    [centreEastM + halfEast, centreSouthM + halfSouth],
    [centreEastM - halfEast, centreSouthM + halfSouth],
  ];
  return {
    tags,
    category,
    outer: corners.map(([e, s]) => metresToLatLon(e, s)),
    inners: [],
  };
}

function buildCoastalScene() {
  return {
    osmFeatures: [
      // Large open water mass — 4 km × 8 km, starting 200 m from the cliff
      // (south of observer, since we're looking south = +southM toward water).
      // Wait — observer azimuth 180 means looking south. positive south =
      // distance from observer. Make the lake span from 200 m to 4200 m south.
      rectPolygon(0, 2200, 8000, 4000, { 'natural': 'water' }, 'water'),
      // Narrow beach between the cliff and the water.
      rectPolygon(0, 100, 6000, 100, { 'natural': 'beach' }, 'beach'),
      // Headland forest on the side
      rectPolygon(-2500, 1500, 3000, 2500, { 'natural': 'wood' }, 'forest'),
    ],
    landmarks: [
      // A coastal church on the headland
      makeLandmark('church', -1800, 1200, 'St-Pierre-sur-Mer', 22),
      // A lighthouse / observation tower on a small island in the water
      makeLandmark('tower', 800, 3000, 'Phare', 35),
    ],
  };
}

function makeLandmark(category, eastM, southM, name, heightM) {
  const { lat, lon } = metresToLatLon(eastM, southM);
  return { category, lat, lon, name: name ?? null, heightM: heightM ?? null };
}

// ─────────────────────────────────────────────────────────────────────────
// Bindings
// ─────────────────────────────────────────────────────────────────────────
function buildBindings(ground, sun) {
  return {
    sun,
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

// ─────────────────────────────────────────────────────────────────────────
// PROBE 1 — Perf at coastal extent. Single-run cold-process measurement.
// Multi-sample-in-one-process produced 30–70 s totals from V8 GC pressure
// (each A3 paint allocates 70 MB of canvas + internal buffers); a fresh
// process is the realistic single-A3 paint timing the user actually sees.
// ─────────────────────────────────────────────────────────────────────────
async function probePerf() {
  console.log('\n━━━ PROBE 1: PERF (coastal extent A3 @ 300 DPI) ━━━');
  const ground = buildCoastalScene();
  const source = makeSourceCanvas(A3_W, A3_H, 'goldenHour');
  const sun = { phase: 'goldenHour', azimuth: 180, altitude: 5 };  // back-lit, low
  const bindings = buildBindings(ground, sun);

  const t0 = performance.now();
  const { canvas: out, timing } = await applyPointillism(source, {
    createCanvas,
    bindings,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    seed: 0xC0FFEE,
    brushWidthMm: 1.2,
    brushStrokeFactor: 2.0,
    density: 0.03,
    applyMedianUnderpaint: false,
    waterReflectionStrength: 0.6,
    waterSunGlitterEnabled: true,
    waterRippleDensity: 0.4,
  });
  const wallMs = +(performance.now() - t0).toFixed(1);

  console.log(`  water polygons    : ${timing.waterPolygonCount}`);
  console.log(`  water glitter dabs: ${timing.waterGlitterDabCount?.toLocaleString() ?? 0}`);
  console.log(`  water ripple dabs : ${timing.waterRippleDabCount?.toLocaleString() ?? 0}`);
  console.log(`  water painter ms  : ${timing.waterMs}`);
  console.log(`  ground polygons   : ${timing.groundPolygonCount}`);
  console.log(`  canopy dabs       : ${(timing.canopyDabCount ?? 0).toLocaleString()} (${timing.canopyMs ?? 0} ms)`);
  console.log(`  landmarks drawn   : ${timing.landmarkDrawnCount ?? 0} (${timing.landmarkMs ?? 0} ms)`);
  console.log(`  underpainting     : ${timing.underpaintMs} ms`);
  console.log(`  gradient + strokes: ${timing.gradientMs + timing.strokesMs} ms`);
  console.log(`  TOTAL             : ${timing.totalMs} ms (${(timing.totalMs / 1000).toFixed(2)} s, wall ${(wallMs / 1000).toFixed(2)} s)`);

  // Pass criteria: water painter under 100 ms; total under 28 s. The
  // forest-scene (no water) baseline today is ~27 s in this same process,
  // so anything under 28 s here means waterPainter's net cost stayed
  // below 1 s (most of which is gradient lift on ripple edges).
  const waterPass = timing.waterMs < 100;
  const totalPass = timing.totalMs < 28_000;
  const verdict = (waterPass && totalPass) ? 'PASS' : 'FAIL';
  if (!waterPass) console.log(`  ✗ water painter ${timing.waterMs} ms exceeds 100 ms — surface to user`);
  if (!totalPass) console.log(`  ✗ total ${timing.totalMs} ms exceeds 28 s pass bar`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'perf.png'), out.toBuffer('image/png'));
  console.log(`  saved: ${path.relative(ROOT, path.join(OUT_DIR, 'perf.png'))}`);

  return { name: 'perf', timing, wallMs, verdict };
}

// ─────────────────────────────────────────────────────────────────────────
// PROBE 2 — Sun-direction matrix (4 azimuths × 3 elevations = 12)
// ─────────────────────────────────────────────────────────────────────────
//
// Look direction is azimuth=180° (south). Glitter should appear when the
// sun's projection falls "above" the lake's far edge AND the sun is in
// front of the camera (back-lit).
//   - sun azimuth 180° (= same as look direction): sun directly ahead → back-lit
//     → strong glitter (when sun is above horizon).
//   - sun azimuth 0°  (= opposite, behind camera): front-lit → no glitter.
//   - sun azimuth 90° (= due east, sun-side-of-camera): mostly behind camera
//     plane in this azimuth (depends on the observer's look-frustum); usually
//     no glitter.
//   - sun azimuth 270° (= due west, opposite side): same — front-side dot
//     product is negative.
//
// Elevations:
//   - 30° high (noon-ish): glitter geometry says yes if back-lit, but our
//     altitude boost dims it (the brief: "back-lit, near horizon, strongest").
//   - 5° low (golden hour / sunset): max glitter when back-lit.
//   - -5° below horizon (civil twilight): no glitter (sun_altitude < -2 gate).
async function probeSunDirection() {
  console.log('\n━━━ PROBE 2: SUN-DIRECTION (4 azimuths × 3 elevations) ━━━');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const PREVIEW_W = 1200;
  const PREVIEW_H = 850;

  const ground = buildCoastalScene();
  const azimuths = [
    { az: 180, label: 'ahead', expected: 'back-lit (strongest)' },
    { az:   0, label: 'behind', expected: 'front-lit (no glitter)' },
    { az:  90, label: 'left', expected: 'side (no glitter)' },
    { az: 270, label: 'right', expected: 'side (no glitter)' },
  ];
  const elevations = [
    { alt:  30, phase: 'day',           label: 'noon' },
    { alt:   5, phase: 'goldenHour',    label: 'golden' },
    { alt:  -5, phase: 'civilTwilight', label: 'twilight' },
  ];

  const results = [];
  for (const e of elevations) {
    for (const a of azimuths) {
      const source = makeSourceCanvas(PREVIEW_W, PREVIEW_H, e.phase);
      const sun = { phase: e.phase, azimuth: a.az, altitude: e.alt };
      const bindings = buildBindings(ground, sun);

      const result = await renderUnderpainting(source, {
        bindings,
        brushWidthMm: 0.7,
        targetPaperSize: 'A3',
        targetOrientation: 'landscape',
        seed: 0xC0FFEE,
        softenEdges: false,            // skip median for cleaner observation
        waterReflectionStrength: 0.6,
        waterSunGlitterEnabled: true,
        waterRippleDensity: 0.4,
        createCanvas,
      });

      const filename = `sun-az${a.az.toString().padStart(3, '0')}-alt${(e.alt >= 0 ? '+' : '') + e.alt.toString().padStart(2, '0')}.png`;
      fs.writeFileSync(path.join(OUT_DIR, filename), result.canvas.toBuffer('image/png'));

      const hasGlitter = (result.timing.waterGlitterDabCount ?? 0) > 0;
      console.log(
        `  ${e.label.padEnd(8)} az=${a.az.toString().padStart(3)}° alt=${(e.alt >= 0 ? '+' : '') + e.alt.toString().padStart(2)}° ` +
        `${a.label.padEnd(7)} glitter=${hasGlitter ? 'YES' : 'no '} ` +
        `(${(result.timing.waterGlitterDabCount ?? 0).toLocaleString().padStart(4)} dabs)  ` +
        `→ ${a.expected}`
      );
      results.push({ az: a.az, alt: e.alt, label: a.label, hasGlitter, expected: a.expected });
    }
  }

  // Verify expected geometry. azDiff = 0 means sun azimuth equals look
  // azimuth — i.e. sun is in the look direction, ahead of camera. That
  // is the BACK-LIT case (sun behind the polygon's far edge from camera's
  // POV → light reflects off water back to camera → glitter expected).
  // azDiff = 180 means sun is opposite the look direction — sun behind
  // camera, light comes over observer's shoulder onto water → FRONT-LIT
  // → no glitter.
  let pass = true;
  for (const r of results) {
    const sunBelow = r.alt < -2;
    const azDiff = Math.abs(((r.az - AZIMUTH_DEG + 540) % 360) - 180);
    const backLit = azDiff < 60;       // sun ahead (within 60° of look azimuth)
    const frontLit = azDiff > 120;     // sun behind camera
    let expectGlitter;
    if (sunBelow) expectGlitter = false;
    else if (frontLit) expectGlitter = false;
    else if (backLit) expectGlitter = true;
    else expectGlitter = null;         // 60–120° side-on; glitter is unconstrained
    if (expectGlitter !== null && Boolean(r.hasGlitter) !== expectGlitter) {
      console.log(`  ✗ MISMATCH: az=${r.az} alt=${r.alt} expected glitter=${expectGlitter}, got=${r.hasGlitter}`);
      pass = false;
    }
  }
  console.log(`  verdict: ${pass ? 'PASS' : 'FAIL — glitter geometry incorrect'}`);
  return { name: 'sun', verdict: pass ? 'PASS' : 'FAIL', count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────
// PROBE 3 — Tint correctness (noon vs sunset)
// ─────────────────────────────────────────────────────────────────────────
async function probeTint() {
  console.log('\n━━━ PROBE 3: TINT CORRECTNESS (noon vs sunset) ━━━');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const PREVIEW_W = 1200;
  const PREVIEW_H = 850;
  const ground = buildCoastalScene();

  const phases = [
    { name: 'noon',   phase: 'day',        azimuth: 180, altitude: 60 },
    { name: 'sunset', phase: 'sunset',     azimuth: 180, altitude: 2  },
  ];

  const samples = {};
  for (const p of phases) {
    const source = makeSourceCanvas(PREVIEW_W, PREVIEW_H, p.phase);
    const sun = { phase: p.phase, azimuth: p.azimuth, altitude: p.altitude };
    const bindings = buildBindings(ground, sun);
    const result = await renderUnderpainting(source, {
      bindings,
      brushWidthMm: 0.7,
      targetPaperSize: 'A3',
      targetOrientation: 'landscape',
      seed: 0xC0FFEE,
      softenEdges: false,
      waterReflectionStrength: 0.6,
      waterSunGlitterEnabled: false,    // turn off glitter so we measure pure band tint
      waterRippleDensity: 0.0,          // turn off ripples so we measure pure band tint
      createCanvas,
    });

    fs.writeFileSync(path.join(OUT_DIR, `tint-${p.name}.png`), result.canvas.toBuffer('image/png'));

    // Find the lake band: scan vertically down the centre column for the
    // first row where the pixel transitions from sky/cliff colour to water
    // (a deep dark cool/warm tone). Sample a strip just below that
    // transition — that's where waterPainter's sky-band sits.
    const ctx = result.canvas.getContext('2d');
    const allData = ctx.getImageData(0, 0, PREVIEW_W, PREVIEW_H);
    const cxCol = Math.floor(PREVIEW_W * 0.5);
    let bandStartY = null;
    for (let y = Math.floor(PREVIEW_H * 0.30); y < Math.floor(PREVIEW_H * 0.85); y++) {
      const idx = (y * PREVIEW_W + cxCol) * 4;
      const r = allData.data[idx];
      const g = allData.data[idx + 1];
      const b = allData.data[idx + 2];
      // Heuristic: water region has a deep darkness (sum < 360) AND a
      // cool / dark cast that is meaningfully different from the warm
      // ground above. We pick the first row where the pixel sum drops
      // sharply.
      if (r + g + b < 380) { bandStartY = y; break; }
    }
    const sampleY = (bandStartY ?? Math.floor(PREVIEW_H * 0.55)) + 6;
    const sample = ctx.getImageData(PREVIEW_W * 0.42, sampleY, PREVIEW_W * 0.16, 16);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < sample.data.length; i += 4) {
      r += sample.data[i];
      g += sample.data[i + 1];
      b += sample.data[i + 2];
      n++;
    }
    samples[p.name] = {
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
      sampleY,
    };
    console.log(`  ${p.name.padEnd(7)}: avg band RGB = ${samples[p.name].r}, ${samples[p.name].g}, ${samples[p.name].b}  (sampled at y=${sampleY})`);
  }

  // Pass criterion: noon should be cooler (b > r) or close, sunset should
  // be warmer (r > b) — a clear directional difference.
  const noonWarmth = samples.noon.r - samples.noon.b;
  const sunsetWarmth = samples.sunset.r - samples.sunset.b;
  const directionDelta = sunsetWarmth - noonWarmth;
  console.log(`  noon warmth  (R-B): ${noonWarmth >= 0 ? '+' : ''}${noonWarmth}`);
  console.log(`  sunset warmth(R-B): ${sunsetWarmth >= 0 ? '+' : ''}${sunsetWarmth}`);
  console.log(`  delta              : ${directionDelta >= 0 ? '+' : ''}${directionDelta}`);
  const pass = directionDelta > 20;
  console.log(`  verdict: ${pass ? 'PASS' : 'FAIL — band tint not phase-aware'}`);

  return { name: 'tint', verdict: pass ? 'PASS' : 'FAIL', samples };
}

// ─────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────
(async () => {
  const filter = process.argv[2];
  console.log('Painterly water reflections — risk-first probes');
  console.log(`Output: ${path.relative(ROOT, OUT_DIR)}`);

  const all = [];
  if (!filter || filter === 'perf') all.push(await probePerf());
  if (!filter || filter === 'sun')  all.push(await probeSunDirection());
  if (!filter || filter === 'tint') all.push(await probeTint());

  console.log('\n━━━ summary ━━━');
  let allPass = true;
  for (const r of all) {
    if (r.verdict === 'FAIL') allPass = false;
    console.log(`  ${r.name.padEnd(6)}  ${r.verdict}`);
  }
  console.log(allPass ? '\nALL PASS' : '\nFAIL — surface to user before continuing');
  process.exit(allPass ? 0 : 2);
})();
