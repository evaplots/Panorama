// Diagnostic probe for the foreground-polygon-projection seam.
//
// User report (post PR #18 + PR #16):
//   Live preview shows a hard horizontal seam in the foreground at
//   ~500 m world radius. Above seam: green ground polygons. Below
//   seam: flat warm-sandy gradient, no polygon detail.
//
// What this probe answers:
//   1. Per-polygon screen bbox + screen area + paint order at the test
//      scene (Saarland, bearing 270°). Reveals which polygons project
//      where on the canvas.
//   2. For each canvas-y row in the bottom 60 %, which polygon (if any)
//      is the topmost paint owner — i.e. whose colour ends up visible.
//   3. Per-polygon "covers the bottom 30 %" boolean (does this polygon's
//      projected screen bbox extend below y = H × 0.70?).
//   4. Source of the warm-sandy gradient: which polygon's tag colour
//      matches the user's description, and is it the topmost paint
//      owner there?
//
// Output: .iterations/2026-05-02-foreground-polygon-projection/
//   saarland-projection.log    — per-polygon detail
//   saarland-paint-owners.log  — per-row topmost-painter table
//   saarland-full.png          — full painter render at bearing 270°
//
// Run: node scripts/foreground-polygon-projection-probe.js

import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUnderpainting } from '../src/style/underpainting.js';
import { categorise } from '../src/style/categories.js';
import { createProjector } from '../src/style/projection.js';
import { GROUND_COVER_COLOURS, GROUND_COVER_PRIORITY } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.iterations', '2026-05-02-foreground-polygon-projection');

const W = 480;
const H = 340;

const SCENE = {
  name: 'saarland',
  lat: 49.41097,
  lon: 7.12606,
  azimuthDeg: 270,
  elevationDeg: -5,
  fovDeg: 60,
  eyeHeightM: 1.7,
  groundY: 350,
  sun: { phase: 'civilTwilight', azimuth: 250, altitude: -2 },
};

const RADIUS_M = 3000;          // suburban preset
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
      'User-Agent': 'panorama-foreground-poly-probe/1.0 (eva.bonaccorsi@gmail.com)',
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

// Point-in-polygon test (ray casting), in screen space. Used to
// determine "the topmost polygon containing this canvas pixel" for the
// per-row paint-owner table.
function pointInRing(sx, sy, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].sx, yi = ring[i].sy;
    const xj = ring[j].sx, yj = ring[j].sy;
    const intersects = ((yi > sy) !== (yj > sy)) &&
      (sx < (xj - xi) * (sy - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
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

function makeWebglLikeSource() {
  // Saarland-ish: pale-mauve civil-twilight sky on top, dark horizon
  // strip, a flat WebGL-mesh-like "green countryside" trapezoid in the
  // foreground. The user said the 3D viewer's whole foreground is
  // green; this matches that.
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 132);
  sky.addColorStop(0.00, '#26284a');
  sky.addColorStop(0.55, '#604060');
  sky.addColorStop(1.00, '#3a4060');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 132);
  // Horizon strip
  ctx.fillStyle = '#3a4830';
  ctx.fillRect(0, 132, W, 12);
  // Foreground: WebGL elevation-coloured countryside green
  ctx.fillStyle = '#5a8050';
  ctx.fillRect(0, 144, W, H - 144);
  return c;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('━━━ foreground polygon projection probe — Saarland ━━━');
  console.log(`scene: lat=${SCENE.lat} lon=${SCENE.lon} azimuth=${SCENE.azimuthDeg}° elevation=${SCENE.elevationDeg}°`);
  console.log(`canvas: ${W}×${H}, radius ${RADIUS_M} m\n`);

  const { south, west, north, east } = bboxAround({ lat: SCENE.lat, lon: SCENE.lon }, RADIUS_M);
  const t0 = Date.now();
  const json = await fetchOverpass(buildQuery(south, west, north, east));
  console.log(`overpass: ${json.elements?.length ?? 0} elements (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

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
  console.log(`polygons by category: ${JSON.stringify(byCategory)}`);

  // ─── Project every polygon and log per-polygon details ───────────────
  const projectionCtx = {
    originLat: SCENE.lat,
    originLon: SCENE.lon,
    azimuthDeg: SCENE.azimuthDeg,
    elevationDeg: SCENE.elevationDeg,
    fovDeg: SCENE.fovDeg,
    cameraWorldY: SCENE.groundY + SCENE.eyeHeightM,
    groundY: SCENE.groundY,
    canvasWidth: W,
    canvasHeight: H,
  };
  const projector = createProjector(projectionCtx);

  // Project each polygon's outer ring and gather the per-polygon
  // record paintGround would build.
  const projected = [];
  for (const f of osmFeatures) {
    const colour = resolvePolygonColour(f.tags);
    if (colour == null) continue;
    const outer = projector.projectRing(f.outer, SCENE.groundY);
    if (!outer) {
      projected.push({
        category: f.category,
        tags: f.tags,
        colour,
        rejected: true,
        outer: null,
      });
      continue;
    }
    projected.push({
      category: f.category,
      tags: f.tags,
      colour,
      rejected: false,
      outer,
      bounds: ringScreenBounds(outer),
      area: ringScreenArea(outer),
    });
  }

  // Sort by screen-area DESC, same as paintGround does. Big first =
  // drawn first = bottom of paint stack. Small last = drawn last = top.
  const visible = projected.filter(p => !p.rejected);
  visible.sort((a, b) => b.area - a.area);

  const log = [];
  log.push(`# saarland — per-polygon projection log\n`);
  log.push(`# paint order: index 0 drawn first (bottom of stack), last index drawn last (on top).`);
  log.push(`# bottom-60% threshold: y >= ${Math.floor(H * 0.40)} (top 40 % is sky + horizon).`);
  log.push(`# horizon line for elevation=${SCENE.elevationDeg}°: y ≈ ${(H/2 + Math.tan(SCENE.elevationDeg * Math.PI / 180) * (W/2) / Math.tan(SCENE.fovDeg/2 * Math.PI / 180)).toFixed(0)}.\n`);
  log.push(`idx  cat       drawn         tag                              area    bbox(sx,sy)            covers-bottom-60%  baseHex`);
  log.push(`---  --------  ----          -------------------------------  ------  ---------------------  -----------------  -------`);

  for (let i = 0; i < visible.length; i++) {
    const p = visible[i];
    const b = p.bounds;
    const yMid = H * 0.40;
    const coversBottom = b.maxY > yMid;
    const tagShort = Object.entries(p.tags).filter(([k]) => ['natural','landuse','waterway','leisure'].includes(k))
      .map(([k,v]) => `${k}=${v}`).join(',').slice(0, 30);
    log.push(
      `${i.toString().padStart(3)}  ${p.category.padEnd(8)}  ${(i === visible.length - 1 ? 'top' : i === 0 ? 'bottom' : '').padEnd(7)}  ` +
      `${tagShort.padEnd(31)}  ${p.area.toFixed(0).padStart(6)}  ` +
      `[${b.minX.toFixed(0).padStart(6)},${b.minY.toFixed(0).padStart(5)}→${b.maxX.toFixed(0).padStart(6)},${b.maxY.toFixed(0).padStart(5)}]  ` +
      `${(coversBottom ? 'YES' : 'no').padEnd(17)}  #${p.colour.toString(16).padStart(6, '0')}`
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, `${SCENE.name}-projection.log`), log.join('\n') + '\n');
  console.log(`saved per-polygon log: ${SCENE.name}-projection.log`);

  // ─── Per-row topmost-paint-owner table ───────────────────────────────
  // For each canvas row through the whole canvas, sample seven columns
  // and walk the visible polygon list (in paint order) to find the LAST
  // polygon (top of stack) whose outer ring contains that pixel. That
  // polygon's colour is what shows up on the canvas at that pixel.
  // We also tally, separately, the count of polygons containing the
  // pixel — to see whether forest polygons sit UNDER the topmost
  // farmland (a paint-order shadowing question).
  const ownerLog = [];
  ownerLog.push(`# saarland — per-row topmost-paint-owner table (7 columns × full canvas)`);
  ownerLog.push(`# horizon line for elevation=${SCENE.elevationDeg}°: y ≈ 134.\n`);
  ownerLog.push(`y    | 14 px |  82 px | 150 px | 240 px | 330 px | 398 px | 466 px`);
  ownerLog.push(`---- | ----- | ------ | ------ | ------ | ------ | ------ | ------`);
  const cols = [14, 82, 150, 240, 330, 398, 466];
  let countNoOwner = 0, totalSamples = 0;
  let countByCategory = {};
  // Also track shadowed-forest pixels: pixel where a forest polygon
  // contains it but is NOT the topmost owner (i.e. covered by another
  // category drawn later).
  let shadowedForest = 0;
  for (let y = 0; y < H; y += 4) {
    const owners = cols.map(x => {
      let topmost = null;
      let containsForest = false;
      for (const p of visible) {                  // paint order: last visible polygon containing pixel wins
        const b = p.bounds;
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        if (pointInRing(x, y, p.outer)) {
          topmost = p;
          if (p.category === 'forest') containsForest = true;
        }
      }
      totalSamples++;
      if (!topmost) {
        countNoOwner++;
        return 'NONE';
      }
      countByCategory[topmost.category] = (countByCategory[topmost.category] ?? 0) + 1;
      if (containsForest && topmost.category !== 'forest') shadowedForest++;
      const tag = Object.entries(topmost.tags).find(([k]) => ['natural','landuse','waterway','leisure'].includes(k));
      const flag = (containsForest && topmost.category !== 'forest') ? '*' : ' ';
      const label = tag ? `${topmost.category[0]}/${tag[1]}`.slice(0, 5) : topmost.category.slice(0, 5);
      return `${flag}${label}`.padEnd(6);
    });
    ownerLog.push(`${y.toString().padStart(4)} | ${owners.join('| ')}`);
  }
  ownerLog.push(``);
  ownerLog.push(`* = pixel is contained by a forest polygon but the topmost paint owner is not forest (forest is shadowed by a smaller, later-drawn polygon).`);
  ownerLog.push(``);
  ownerLog.push(`summary across full-canvas samples:`);
  ownerLog.push(`  total samples       : ${totalSamples}`);
  ownerLog.push(`  NO-OWNER (sky)      : ${countNoOwner} (${(countNoOwner / totalSamples * 100).toFixed(1)}%)`);
  for (const [cat, n] of Object.entries(countByCategory).sort((a, b) => b[1] - a[1])) {
    ownerLog.push(`  topmost ${cat.padEnd(8)}    : ${n} (${(n / totalSamples * 100).toFixed(1)}%)`);
  }
  ownerLog.push(`  shadowed forest     : ${shadowedForest} (${(shadowedForest / totalSamples * 100).toFixed(1)}%) — pixels where a forest polygon is under but masked by a smaller later-drawn polygon`);
  fs.writeFileSync(path.join(OUT_DIR, `${SCENE.name}-paint-owners.log`), ownerLog.join('\n') + '\n');
  console.log(`saved paint-owner log: ${SCENE.name}-paint-owners.log`);

  console.log(`\nfull-canvas paint owners: NO-OWNER=${countNoOwner}/${totalSamples} (${(countNoOwner / totalSamples * 100).toFixed(1)}%)`);
  for (const [cat, n] of Object.entries(countByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  topmost ${cat.padEnd(8)}: ${n} (${(n / totalSamples * 100).toFixed(1)}%)`);
  }
  console.log(`  shadowed forest : ${shadowedForest} (${(shadowedForest / totalSamples * 100).toFixed(1)}%) — covered-by-forest-polygon pixels overdrawn by smaller later polygon`);

  // ─── Also render the actual painter pipeline for reference ───────────
  const source = makeWebglLikeSource();
  fs.writeFileSync(path.join(OUT_DIR, `${SCENE.name}-source.png`), source.toBuffer('image/png'));
  const result = await renderUnderpainting(source, {
    bindings: buildBindings(SCENE, osmFeatures),
    softenEdges: true,
    seed: 0xC0FFEE,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    createCanvas,
  });
  fs.writeFileSync(path.join(OUT_DIR, `${SCENE.name}-full.png`), result.canvas.toBuffer('image/png'));

  console.log(`\nsaved: ${path.relative(ROOT, OUT_DIR)}`);
})();
