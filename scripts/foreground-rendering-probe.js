// Diagnostic probe for the foreground gradient-band artefact.
// User's report: live preview at Chamonix (location selected) shows a
// soft greyish-mauve gradient band in the bottom 30–40 % of the canvas,
// between the terrain silhouette and the canvas bottom edge.
//
// User's hypothesis: the terrain mesh doesn't reach close enough to the
// camera, leaving an empty (or sparsely-rendered) foreground region. The
// haze pass then tints that empty region.
//
// What this probe does:
//   1. Pulls real Chamonix OSM data (5 km radius — alpine preset).
//   2. Synthesises a WebGL-like source canvas with three regions:
//        - Sky gradient (upper ~40 %, above horizon)
//        - Mesh silhouette band (10–15 %, dark brown / green near horizon)
//        - Foreground trapezoid (lower 30–40 %, flat brown — the
//          mesh's near-camera triangle, which is one geometrically
//          uniform interpolated triangle since the mesh's nearest
//          vertices are 29–58 m from the camera at TERRAIN_MESH_SEGMENTS=512
//          and PHASE1_TERRAIN_CAP_M=15000)
//   3. Renders the painter pipeline through renderUnderpainting and
//      reports, for each pass, how many pixels it writes into the
//      bottom-30 % strip of the canvas. Pass-disabled bisection:
//        full              all passes on
//        no-paintGround    bindings.ground.osmFeatures emptied
//        no-paintWater     waterReflectionStrength=0, sunGlitterEnabled=false, rippleDensity=0
//        no-paintCanopy    forest polygons stripped from osmFeatures
//        no-median         softenEdges=false
//        no-haze           hazeStrength=0
//        no-bloom          bloomStrength=0
//        no-grain          grainAmount=0
//        no-atmospherics   atmosphericsEnabled=false
//
// We diff each variant against `no-atmospherics + no-paintGround + no-paintCanopy`
// (the "source-only" baseline) to count per-pass pixel writes in the
// bottom-30 % strip. Whichever variant *removes* the bottom-30 % writes
// is the pass that's painting the foreground.
//
// Run: node scripts/foreground-rendering-probe.js

import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUnderpainting } from '../src/style/underpainting.js';
import { categorise } from '../src/style/categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.iterations', '2026-05-02-foreground-rendering');

// Match the live preview panel's typical landscape A3 size (480×340).
const W = 480;
const H = 340;

// Two scenes — same camera, same location, different sun phase.
// Phase shapes the haze tint, which is what the user described as
// "greyish-mauve" (consistent with HAZE_TINT.civilTwilight = [125, 130, 175]).
const SCENES = [
  {
    name: 'chamonix-goldenHour',
    lat: 45.91103, lon: 6.79561,
    azimuthDeg: 180, elevationDeg: -5, fovDeg: 60,
    eyeHeightM: 1.7, groundY: 1035,
    sun: { phase: 'goldenHour', azimuth: 200, altitude: 8 },
    sourcePhase: 'goldenHour',
  },
  {
    name: 'chamonix-civilTwilight',
    lat: 45.91103, lon: 6.79561,
    azimuthDeg: 180, elevationDeg: -5, fovDeg: 60,
    eyeHeightM: 1.7, groundY: 1035,
    sun: { phase: 'civilTwilight', azimuth: 200, altitude: -2 },
    sourcePhase: 'civilTwilight',
  },
];

const RADIUS_M = 2000;       // app default (suburban) — narrower polygon coverage
const M_PER_DEG_LAT = 111320;

function bboxAround(loc, radiusM) {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.cos(loc.lat * Math.PI / 180));
  return {
    south: loc.lat - dLat,
    north: loc.lat + dLat,
    west: loc.lon - dLon,
    east: loc.lon + dLon,
  };
}

function buildQuery(s, w, n, e) {
  return `[out:json][timeout:60];
(
  way["natural"~"water|wood|sand|beach|bare_rock|scree|grassland|wetland|glacier|heath"](${s},${w},${n},${e});
  relation["natural"~"water|wood|sand|beach|bare_rock|scree|grassland|wetland|glacier|heath"](${s},${w},${n},${e});
  way["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|commercial|industrial|cemetery|recreation_ground|allotments|brownfield"](${s},${w},${n},${e});
  relation["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|commercial|industrial|cemetery|recreation_ground|allotments|brownfield"](${s},${w},${n},${e});
  way["waterway"="riverbank"](${s},${w},${n},${e});
  way["leisure"~"park|garden|pitch|golf_course"](${s},${w},${n},${e});
);
out geom;`;
}

async function fetchOverpass(query) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'User-Agent': 'panorama-foreground-probe/1.0 (eva.bonaccorsi@gmail.com)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

function elementsToPolygons(elements) {
  const polygons = [];
  for (const el of elements) {
    if (!el.tags) continue;
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
      polygons.push({ tags: el.tags, outer: el.geometry, inners: [] });
    } else if (el.type === 'relation' && el.tags.type === 'multipolygon') {
      const outers = [], inners = [];
      for (const m of el.members ?? []) {
        if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
        if (m.role === 'outer') outers.push(m.geometry);
        else if (m.role === 'inner') inners.push(m.geometry);
      }
      for (const outer of outers) {
        if (outer.length >= 3) polygons.push({ tags: el.tags, outer, inners });
      }
    }
  }
  return polygons;
}

// Synthesise a WebGL-canvas-like source. Three vertical regions:
//   - 0..132   Sky (Three.js Sky shader at goldenHour — warm peach gradient)
//   - 132..210 Mesh silhouette band (terrain at varying distance, varied colour)
//   - 210..H   Foreground (one big mesh triangle: flat brown #6a4f1a)
//
// The horizon for elevation=-5° at 60° vertical-fov on a 340-tall canvas
// lands at canvas-y ≈ 132 (cy + tan(-5°)×focal). Below-horizon distances:
//   y=210  →  ~6 m from camera (well inside the camera's enclosing
//            mesh triangle, which spans 29.3 m radius)
//   y=339  →  ~3.5 m from camera (also inside the enclosing triangle)
// So the bottom ~40 % renders inside ONE interpolated mesh triangle,
// hence flat-colour. That's the situation the probe simulates.
const SKY_PALETTE = {
  goldenHour:    ['#5a82b8', '#a8bcd0', '#f5d7a0'],
  civilTwilight: ['#26284a', '#604060', '#3a4060'],
};

function makeWebglLikeSource(phase) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const stops = SKY_PALETTE[phase] ?? SKY_PALETTE.goldenHour;

  // Sky (above horizon) — phase-coloured gradient.
  const sky = ctx.createLinearGradient(0, 0, 0, 132);
  sky.addColorStop(0.00, stops[0]);
  sky.addColorStop(0.55, stops[1]);
  sky.addColorStop(1.00, stops[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 132);

  // Terrain silhouette band — varying elevations within the next ~80 px.
  const silhouette = ctx.createLinearGradient(0, 132, 0, 210);
  silhouette.addColorStop(0.00, '#5a4830');
  silhouette.addColorStop(1.00, '#4a3c20');
  ctx.fillStyle = silhouette;
  ctx.fillRect(0, 132, W, 78);

  // Foreground — flat-colour trapezoid representing the camera's enclosing
  // mesh triangle. Colour = elevationColor(1035 m) ≈ rgb(127, 76, 26).
  ctx.fillStyle = '#7f4c1a';
  ctx.fillRect(0, 210, W, H - 210);

  return c;
}

function buildBindings(scene, osmFeatures) {
  return {
    sun: scene.sun,
    timestamp: new Date('2026-05-02T18:30:00Z'),
    location: { lat: scene.lat, lon: scene.lon },
    viewpoint: {
      location: { lat: scene.lat, lon: scene.lon },
      azimuthDeg: scene.azimuthDeg,
      elevationDeg: scene.elevationDeg,
      fovDeg: scene.fovDeg,
      eyeHeightM: scene.eyeHeightM,
      cameraWorldY: scene.groundY + scene.eyeHeightM,
      groundY: scene.groundY,
    },
    ground: { osmFeatures, landmarks: [] },
  };
}

// Count pixels in the bottom 30 % of the canvas where (r,g,b) differs
// from the source by > tolerance per channel. Returns both an absolute
// count and an average per-channel delta over the strip.
function diffFromSource(ctx, source, tol = 4) {
  const sctx = source.getContext('2d');
  const yStart = Math.floor(H * 0.70);                  // bottom 30 %
  const stripH = H - yStart;
  const a = ctx.getImageData(0, yStart, W, stripH).data;
  const b = sctx.getImageData(0, yStart, W, stripH).data;
  let changed = 0, sumDR = 0, sumDG = 0, sumDB = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = a[i] - b[i];
    const dg = a[i + 1] - b[i + 1];
    const db = a[i + 2] - b[i + 2];
    if (Math.abs(dr) > tol || Math.abs(dg) > tol || Math.abs(db) > tol) {
      changed++;
    }
    sumDR += dr; sumDG += dg; sumDB += db;
  }
  const total = (a.length / 4);
  return {
    changedPx: changed,
    changedFrac: changed / total,
    avgDeltaR: +(sumDR / total).toFixed(2),
    avgDeltaG: +(sumDG / total).toFixed(2),
    avgDeltaB: +(sumDB / total).toFixed(2),
  };
}

async function variant(scenePrefix, label, source, bindings, opts) {
  const result = await renderUnderpainting(source, {
    bindings,
    softenEdges: true,
    seed: 0xC0FFEE,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    createCanvas,
    ...opts,
  });
  const filename = `${scenePrefix}-${label}.png`;
  fs.writeFileSync(path.join(OUT_DIR, filename), result.canvas.toBuffer('image/png'));

  const ctx = result.canvas.getContext('2d');
  const diff = diffFromSource(ctx, source);
  return { label, timing: result.timing, diff };
}

function stripCategory(features, category) {
  return features.filter(f => f.category !== category);
}

async function runScene(scene) {
  console.log(`\n━━━ ${scene.name} (radius ${RADIUS_M} m, sun=${scene.sun.phase} alt=${scene.sun.altitude}°) ━━━`);

  const { south, west, north, east } = bboxAround({ lat: scene.lat, lon: scene.lon }, RADIUS_M);
  const t0 = Date.now();
  const json = await fetchOverpass(buildQuery(south, west, north, east));
  console.log(`  overpass: ${json.elements?.length ?? 0} elements (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const polygons = elementsToPolygons(json.elements ?? []);
  const osmFeatures = polygons
    .map(p => {
      const cat = categorise(p.tags);
      if (!cat) return null;
      return { tags: p.tags, category: cat, outer: p.outer, inners: p.inners };
    })
    .filter(Boolean);
  const byCategory = osmFeatures.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1; return acc;
  }, {});
  console.log(`  polygons by category: ${JSON.stringify(byCategory)}`);

  const source = makeWebglLikeSource(scene.sourcePhase);
  fs.writeFileSync(path.join(OUT_DIR, `${scene.name}-source.png`), source.toBuffer('image/png'));

  const bindings = buildBindings(scene, osmFeatures);
  const noPolygonsBindings = buildBindings(scene, []);
  const noForestBindings = buildBindings(scene, stripCategory(osmFeatures, 'forest'));

  const variants = [
    ['source-only',     source, noPolygonsBindings, { atmosphericsEnabled: false, softenEdges: false }],
    ['no-atmospherics', source, bindings,           { atmosphericsEnabled: false }],
    ['no-haze',         source, bindings,           { hazeStrength: 0 }],
    ['no-bloom',        source, bindings,           { bloomStrength: 0 }],
    ['no-grain',        source, bindings,           { grainAmount: 0 }],
    ['no-paintGround',  source, noPolygonsBindings, {}],
    ['no-paintCanopy',  source, noForestBindings,   {}],
    ['no-paintWater',   source, bindings,           { waterReflectionStrength: 0, waterSunGlitterEnabled: false, waterRippleDensity: 0 }],
    ['no-median',       source, bindings,           { softenEdges: false }],
    ['full',            source, bindings,           {}],
  ];

  console.log('\n  variant            bottom-30% pixel writes              avgΔR  avgΔG  avgΔB');
  console.log('  ------------------ -------------------------------       -----  -----  -----');
  const results = [];
  for (const [label, src, b, opts] of variants) {
    const r = await variant(scene.name, label, src, b, opts);
    results.push(r);
    const d = r.diff;
    console.log(
      `  ${label.padEnd(18)} ` +
      `${d.changedPx.toString().padStart(6)}/${(W * Math.floor(H * 0.30)).toString().padStart(6)} (${(d.changedFrac * 100).toFixed(1)}%)`.padEnd(38) +
      ` ${d.avgDeltaR.toString().padStart(6)} ${d.avgDeltaG.toString().padStart(6)} ${d.avgDeltaB.toString().padStart(6)}`
    );
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('━━━ foreground rendering probe ━━━');
  console.log(`canvas: ${W}×${H}\n`);

  for (const scene of SCENES) {
    await runScene(scene);
  }

  console.log(`\nsaved: ${path.relative(ROOT, OUT_DIR)}`);
})();
