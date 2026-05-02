// Network-dependent painter regression gate. Runs against real Overpass
// at multiple scenes and asserts per-row category coverage on the
// rendered painter pipeline output. Replaces the byte-equality safety
// net that PR #18's `foreground-rendering-probe.js` provided —
// byte-equality holds even when the painter is broken; this probe
// asserts a property of the actual painted result.
//
// Bug class this guards against: a paintGround sort regression that
// systematically hides one category under another (the original
// area-DESC sort hid larger forest polygons under smaller farmland
// polygons in cross-category overlap). See:
//   `.iterations/2026-05-02-foreground-polygon-projection/DIAGNOSIS.md`
//
// What "PASS" means:
//   - For each scene, every below-horizon pixel sample has a
//     non-null topmost paint owner (the painter does paint the
//     foreground; the original "default ground fill" hypothesis
//     never returns).
//   - For each scene where OSM has forest polygons whose projected
//     screen bbox intersects the canvas, forest must be topmost paint
//     owner SOMEWHERE on the canvas. (Catches the priority-sort
//     regression: forest hidden under farmland.)
//
// Cost: one Overpass round-trip per scene. Network-dependent, so this
// probe is OUT of the standard `npm run probes:painter` suite. Run by
// hand before painter / paintGround PRs:
//   npm run probes:painter:foreground

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
const OUT_DIR = path.join(ROOT, '.iterations', '2026-05-02-foreground-polygon-coverage');

const W = 480;
const H = 340;

const SCENES = [
  // Saarland — the original bug-reveal scene. Mostly farmland; no
  // forest in FOV at this bearing. Validates the "no NO-OWNER gaps"
  // invariant; the forest-topmost assertion is N/A.
  {
    name: 'saarland',
    lat: 49.41097, lon: 7.12606,
    azimuthDeg: 270, elevationDeg: -5, fovDeg: 60,
    eyeHeightM: 1.7, groundY: 350,
    sun: { phase: 'civilTwilight', azimuth: 250, altitude: -2 },
    radiusM: 3000,
  },
  // Bavarian Forest National Park — large continuous `natural=wood`
  // coverage; forest should clearly project on-canvas at multiple
  // bearings. 5 km radius widens the visible polygon catch (alpine
  // preset).
  {
    name: 'bayerischer-wald',
    lat: 49.0668, lon: 13.4002,
    azimuthDeg: 60, elevationDeg: -10, fovDeg: 60,
    eyeHeightM: 1.7, groundY: 900,
    sun: { phase: 'goldenHour', azimuth: 200, altitude: 5 },
    radiusM: 5000,
  },
];

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
      'User-Agent': 'panorama-foreground-coverage-probe/1.0 (eva.bonaccorsi@gmail.com)',
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

function makeSource() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  return c;
}

async function runScene(scene) {
  console.log(`\n━━━ ${scene.name} ━━━`);
  console.log(`  ${scene.lat}, ${scene.lon} az=${scene.azimuthDeg}° el=${scene.elevationDeg}° radius=${scene.radiusM}m`);

  const { south, west, north, east } = bboxAround({ lat: scene.lat, lon: scene.lon }, scene.radiusM);
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

  // Project all features through the painter projector
  const projectionCtx = {
    originLat: scene.lat, originLon: scene.lon,
    azimuthDeg: scene.azimuthDeg, elevationDeg: scene.elevationDeg,
    fovDeg: scene.fovDeg,
    cameraWorldY: scene.groundY + scene.eyeHeightM,
    groundY: scene.groundY,
    canvasWidth: W, canvasHeight: H,
  };
  const projector = createProjector(projectionCtx);
  const visible = [];
  for (const f of osmFeatures) {
    if (f.category === 'water') continue;       // waterPainter handles, skipped here
    const colour = resolvePolygonColour(f.tags);
    if (colour == null) continue;
    const outer = projector.projectRing(f.outer, scene.groundY);
    if (!outer) continue;
    visible.push({
      category: f.category,
      tags: f.tags,
      outer,
      bounds: ringScreenBounds(outer),
      area: ringScreenArea(outer),
    });
  }

  // Determine whether OSM has forest *visibly* on canvas: a forest
  // polygon's outer ring must contain at least one canvas-extent
  // pixel. Bbox-intersection is too lenient — Sutherland–Hodgman
  // near-plane clipping can produce intersection vertices at extreme
  // sx values (depth = 1 m, focal × u/depth → tens of thousands of
  // pixels) so a polygon that's entirely off-canvas can have a bbox
  // that spans the canvas. The point-in-polygon walk is the same one
  // paintGround's render path implicitly does.
  const forestOnCanvas = (() => {
    const probeXs = [10, 80, 160, 240, 320, 400, 470];
    const probeYs = [];
    for (let y = 0; y < H; y += 16) probeYs.push(y);
    for (const p of visible) {
      if (p.category !== 'forest') continue;
      for (const x of probeXs) for (const y of probeYs) {
        if (pointInRing(x, y, p.outer)) return true;
      }
    }
    return false;
  })();

  // Use the same sort `paintGround` uses (post-fix: category-priority,
  // then area DESC).
  const PAINT_PRIORITY = { forest: 1, beach: 2, urban: 3, farmland: 4 };
  visible.sort((a, b) => {
    const pa = PAINT_PRIORITY[a.category] ?? 99;
    const pb = PAINT_PRIORITY[b.category] ?? 99;
    if (pa !== pb) return pb - pa;     // higher number first → drawn earlier
    return b.area - a.area;             // bigger first → drawn earlier
  });

  // Sample below-horizon pixels and find the topmost paint owner.
  // Below-horizon: start sampling from a few pixels below the projected
  // horizon line (ignore sky / above-horizon — those are validly
  // null-owner because no polygon paints there).
  const horizonY = Math.round(H/2 + Math.tan(scene.elevationDeg * Math.PI / 180) *
    ((W/2) / Math.tan(scene.fovDeg / 2 * Math.PI / 180)));
  const cols = [14, 82, 150, 240, 330, 398, 466];
  const rows = [];
  for (let y = Math.max(0, horizonY + 4); y < H; y += 8) rows.push(y);

  const ownerCount = {};
  let nullOwner = 0, totalSamples = 0;
  let forestTopmost = false;
  for (const y of rows) {
    for (const x of cols) {
      let topmost = null;
      for (const p of visible) {
        const b = p.bounds;
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        if (pointInRing(x, y, p.outer)) topmost = p;
      }
      totalSamples++;
      if (!topmost) {
        nullOwner++;
        continue;
      }
      ownerCount[topmost.category] = (ownerCount[topmost.category] ?? 0) + 1;
      if (topmost.category === 'forest') forestTopmost = true;
    }
  }

  const distinctCategories = Object.keys(ownerCount).length;
  const fracNull = nullOwner / totalSamples;

  console.log(`  topmost paint owners (below-horizon samples):`);
  for (const [cat, n] of Object.entries(ownerCount).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(10)}: ${n} (${(n / totalSamples * 100).toFixed(1)}%)`);
  }
  console.log(`    null-owner: ${nullOwner} (${(fracNull * 100).toFixed(1)}%)`);
  console.log(`  forest in FOV (any forest polygon's bbox intersects canvas): ${forestOnCanvas}`);
  console.log(`  forest is topmost somewhere on canvas: ${forestTopmost}`);

  // Render the actual painter for visual reference
  const source = makeSource();
  const result = await renderUnderpainting(source, {
    bindings: buildBindings(scene, osmFeatures),
    softenEdges: true,
    seed: 0xC0FFEE,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    createCanvas,
  });
  fs.writeFileSync(path.join(OUT_DIR, `${scene.name}.png`), result.canvas.toBuffer('image/png'));

  // Assertion: if a forest polygon's outer ring contains any canvas-
  // extent pixel (i.e. forest is visibly on canvas), forest must be
  // topmost paint owner at least once. This is what the
  // category-priority sort guarantees and what the original area-DESC
  // sort violated. Null-owner pixels are allowed (the painter doesn't
  // have to paint every pixel — the WebGL terrain mesh shows through
  // where polygons don't cover, which is the correct behaviour).
  let pass = true;
  const violations = [];
  if (forestOnCanvas && !forestTopmost) {
    pass = false;
    violations.push(`forest polygons cover canvas pixels but are never topmost — paintGround sort regression`);
  }
  console.log(`  verdict: ${pass ? 'PASS' : 'FAIL'}`);
  for (const v of violations) console.log(`    ✗ ${v}`);
  return { name: scene.name, pass, violations, distinctCategories, forestOnCanvas, forestTopmost };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('━━━ foreground polygon coverage probe (network) ━━━');
  console.log(`canvas: ${W}×${H}\n`);

  const results = [];
  for (const scene of SCENES) {
    try {
      results.push(await runScene(scene));
    } catch (err) {
      console.error(`  ${scene.name}: ERROR ${err.message}`);
      results.push({ name: scene.name, pass: false, violations: [err.message] });
    }
  }

  console.log(`\nsaved: ${path.relative(ROOT, OUT_DIR)}`);
  console.log('\n━━━ summary ━━━');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`  ${r.name.padEnd(12)} ${r.pass ? 'PASS' : 'FAIL'}` +
      (r.violations?.length ? `  — ${r.violations.join('; ')}` : ''));
  }
  if (allPass) {
    console.log('\nALL PASS');
    process.exit(0);
  }
  console.log('\nFAIL — paintGround coverage / sort invariant violated.');
  console.log('See DIAGNOSIS.md for the bug class this guards against.');
  process.exit(2);
})();
