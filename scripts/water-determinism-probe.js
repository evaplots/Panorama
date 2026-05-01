// Determinism probe — same Snapshot in → byte-identical water region out.
// Renders the same coastal scene twice with identical seeds and compares
// PNG buffers byte-for-byte. The water region is exercised by the perf-
// probe scene (the same coastal cliff lake) so this also verifies that
// waterPainter's PRNG fork keeps stroke pass deterministic.

import { createCanvas } from 'canvas';
import crypto from 'node:crypto';
import { renderUnderpainting } from '../src/style/underpainting.js';

const W = 1200, H = 850;
const OBSERVER_LAT = 43.6, OBSERVER_LON = 7.2;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(OBSERVER_LAT * Math.PI / 180);

function metresToLatLon(eastM, southM) {
  return {
    lat: OBSERVER_LAT - southM / M_PER_DEG_LAT,
    lon: OBSERVER_LON + eastM / M_PER_DEG_LON,
  };
}

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
    tags, category,
    outer: corners.map(([e, s]) => metresToLatLon(e, s)),
    inners: [],
  };
}

function makeSourceCanvas() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, '#f5d7a0');
  sky.addColorStop(1, '#c08060');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.55);
  ctx.fillStyle = '#5a5040';
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
  return c;
}

const ground = {
  osmFeatures: [
    rectPolygon(0, 2200, 8000, 4000, { 'natural': 'water' }, 'water'),
    rectPolygon(0, 100, 6000, 100, { 'natural': 'beach' }, 'beach'),
    rectPolygon(-2500, 1500, 3000, 2500, { 'natural': 'wood' }, 'forest'),
  ],
  landmarks: [],
};

const bindings = {
  sun: { phase: 'goldenHour', azimuth: 180, altitude: 5 },
  timestamp: new Date('2026-05-01T18:30:00Z'),
  location: { lat: OBSERVER_LAT, lon: OBSERVER_LON },
  viewpoint: {
    location: { lat: OBSERVER_LAT, lon: OBSERVER_LON },
    azimuthDeg: 180, elevationDeg: -12, fovDeg: 60,
    eyeHeightM: 80, cameraWorldY: 80, groundY: 0,
  },
  ground,
};

async function once() {
  const source = makeSourceCanvas();
  const result = await renderUnderpainting(source, {
    bindings,
    brushWidthMm: 0.7,
    targetPaperSize: 'A3', targetOrientation: 'landscape',
    seed: 0xC0FFEE,
    softenEdges: false,
    waterReflectionStrength: 0.6,
    waterSunGlitterEnabled: true,
    waterRippleDensity: 0.4,
    createCanvas,
  });
  const buf = result.canvas.toBuffer('image/png');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

(async () => {
  const a = await once();
  const b = await once();
  console.log(`run 1 sha256: ${a}`);
  console.log(`run 2 sha256: ${b}`);
  if (a === b) {
    console.log('PASS — water region byte-identical across two paints');
    process.exit(0);
  } else {
    console.log('FAIL — determinism broken');
    process.exit(2);
  }
})();
