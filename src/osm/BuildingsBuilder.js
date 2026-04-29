import * as THREE from 'three';
import earcut from 'earcut';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OSMFetcher } from './OSMFetcher.js';
import { HeightSampler } from '../terrain/HeightSampler.js';
import { TileMath } from '../data/TileMath.js';

const BUILDING_COLOUR = 0xc8b8a0;       // light beige; refined per region in Phase 5
const BASE_INSET_M = 0.30;              // sink the base 30cm into ground; defeats z-fighting AND
                                         // absorbs DEM interpolation noise (~10cm at our zoom level).
                                         // Was 5cm; bumped 2026-04-29 as a hedge against reported
                                         // "floating buildings" without a confirmed root cause.

// Default building height (m) when no height/levels tag is present.
const DEFAULT_HEIGHTS_BY_TYPE = {
  house:        6,
  detached:     7,
  bungalow:     5,
  residential: 10,
  apartments:  15,
  terrace:      8,
  commercial:  12,
  retail:       8,
  office:      18,
  industrial:   8,
  warehouse:    8,
  garage:       3,
  garages:      3,
  hotel:       20,
  school:      10,
  university:  15,
  hospital:    18,
  church:      20,
  cathedral:   35,
  chapel:      12,
  mosque:      18,
  temple:      15,
  pagoda:      25,
  tower:       40,
  skyscraper:  80,
  hut:          3,
  shed:         3,
  kiosk:        3,
};
const FALLBACK_HEIGHT = 8;

function buildingHeight(tags) {
  if (tags.height) {
    const m = parseFloat(tags.height);
    if (Number.isFinite(m) && m > 1 && m < 500) return m;
  }
  if (tags['building:levels']) {
    const n = parseFloat(tags['building:levels']);
    if (Number.isFinite(n) && n > 0) return n * 3;
  }
  return DEFAULT_HEIGHTS_BY_TYPE[tags.building] ?? FALLBACK_HEIGHT;
}

/** Strip OSM's repeated last vertex; project ring to local XZ flat array. */
function projectRing(ring, originLon, originLat) {
  const n = ring.length;
  const closed = n >= 2 &&
    ring[0].lat === ring[n - 1].lat &&
    ring[0].lon === ring[n - 1].lon;
  const limit = closed ? n - 1 : n;
  const flat = new Array(limit * 2);
  for (let i = 0; i < limit; i++) {
    const { x, z } = TileMath.lonLatToLocal(ring[i].lon, ring[i].lat, originLon, originLat);
    flat[i * 2] = x;
    flat[i * 2 + 1] = z;
  }
  return flat;
}

/**
 * Build a single building's BufferGeometry: top face, bottom face, side walls.
 * Outer ring only — building inner courtyards are rare and are filled in for Phase 2.
 */
function buildingGeometry(outerXZ, baseY, topY) {
  if (outerXZ.length < 6) return null;
  const n = outerXZ.length / 2;

  // Triangulate the top face once; reuse for bottom (with reversed winding)
  let topIndices;
  try {
    topIndices = earcut(outerXZ, null, 2);
  } catch {
    return null;
  }
  if (!topIndices.length) return null;

  const positions = [];
  const normals = [];
  const indices = [];

  // Top face: y = topY, normal +Y
  const topOff = positions.length / 3;
  for (let i = 0; i < n; i++) {
    positions.push(outerXZ[i * 2], topY, outerXZ[i * 2 + 1]);
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < topIndices.length; i++) indices.push(topOff + topIndices[i]);

  // Bottom face: y = baseY, normal -Y, reversed winding
  const botOff = positions.length / 3;
  for (let i = 0; i < n; i++) {
    positions.push(outerXZ[i * 2], baseY, outerXZ[i * 2 + 1]);
    normals.push(0, -1, 0);
  }
  for (let i = topIndices.length - 3; i >= 0; i -= 3) {
    indices.push(botOff + topIndices[i], botOff + topIndices[i + 1], botOff + topIndices[i + 2]);
  }

  // Side walls: each edge becomes a quad with its outward normal.
  // Use DoubleSide on the material so winding direction is forgiving here.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = outerXZ[i * 2],     z0 = outerXZ[i * 2 + 1];
    const x1 = outerXZ[j * 2],     z1 = outerXZ[j * 2 + 1];

    const ex = x1 - x0;
    const ez = z1 - z0;
    const len = Math.hypot(ex, ez) || 1;
    const nx = ez / len;
    const nz = -ex / len;

    const wOff = positions.length / 3;
    positions.push(x0, baseY, z0); normals.push(nx, 0, nz);
    positions.push(x1, baseY, z1); normals.push(nx, 0, nz);
    positions.push(x1, topY,  z1); normals.push(nx, 0, nz);
    positions.push(x0, topY,  z0); normals.push(nx, 0, nz);

    indices.push(wOff, wOff + 1, wOff + 2);
    indices.push(wOff, wOff + 2, wOff + 3);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  geom.setIndex(indices);
  return geom;
}

export const BuildingsBuilder = {
  /**
   * @param {{lat, lon}} location
   * @param {{osmRadius: number, lod: object}} preset
   * @returns {Promise<THREE.Group>}
   */
  async build(location, preset) {
    const group = new THREE.Group();
    group.name = 'buildings';

    if (!HeightSampler.isReady()) {
      console.warn('[BuildingsBuilder] HeightSampler not ready, skipping');
      return group;
    }

    // ---- Step-3 diagnostic logging (osm-features.md "Buildings don't appear") ----
    // Count drops at every stage so we can pinpoint which gate is throwing buildings out.
    const stat = { polygons: 0, noBuildingTag: 0, ringTooShort: 0, beyondMid: 0,
                   nonFiniteHeight: 0, geomFailed: 0, kept: 0, near: 0, mid: 0 };

    let polygons;
    try {
      polygons = await OSMFetcher.fetchBuildings(location, preset);
    } catch (err) {
      console.warn('[BuildingsBuilder] fetch failed:', err);
      return group;
    }
    stat.polygons = polygons.length;
    console.log(`[BuildingsBuilder] fetched ${polygons.length} building polygons for`,
      `(${location.lat.toFixed(4)}, ${location.lon.toFixed(4)})`,
      `osmRadius=${preset.osmRadius}m`);
    if (!polygons.length) {
      console.warn('[BuildingsBuilder] zero polygons after fetch — see Step 1/2 in osm-features.md diagnostic');
      return group;
    }

    // LOD distances (m from chosen origin)
    const near = preset.lod?.near ?? 500;
    const mid  = preset.lod?.mid  ?? 1500;

    const geomsNear = [];
    const geomsMid = [];

    for (const poly of polygons) {
      if (!poly.tags?.building) { stat.noBuildingTag++; continue; }
      const outerXZ = projectRing(poly.outer, location.lon, location.lat);
      if (outerXZ.length < 6) { stat.ringTooShort++; continue; }

      // Centroid distance for LOD bucket
      let cx = 0, cz = 0;
      const n = outerXZ.length / 2;
      for (let i = 0; i < n; i++) { cx += outerXZ[i * 2]; cz += outerXZ[i * 2 + 1]; }
      cx /= n; cz /= n;
      const dist = Math.hypot(cx, cz);
      if (dist > mid) { stat.beyondMid++; continue; } // far zone: only landmarks (Phase 3) — drop

      // Min ground height across all outer-ring vertices = base
      let minH = Infinity;
      for (let i = 0; i < n; i++) {
        const h = HeightSampler.getHeightAtWorld(outerXZ[i * 2], outerXZ[i * 2 + 1]);
        if (h < minH) minH = h;
      }
      if (!Number.isFinite(minH)) { stat.nonFiniteHeight++; continue; }

      const h = buildingHeight(poly.tags);
      const baseY = minH - BASE_INSET_M;
      const topY  = minH + h;

      const geom = buildingGeometry(outerXZ, baseY, topY);
      if (!geom) { stat.geomFailed++; continue; }

      stat.kept++;
      if (dist <= near) { stat.near++; geomsNear.push(geom); }
      else              { stat.mid++;  geomsMid.push(geom); }
    }

    function attachMerged(geoms, name) {
      if (!geoms.length) return;
      const merged = mergeGeometries(geoms, false);
      // Free per-building geoms after merge
      for (const g of geoms) g.dispose();
      if (!merged) return;
      const mat = new THREE.MeshLambertMaterial({
        color: BUILDING_COLOUR,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = name;
      group.add(mesh);
    }

    attachMerged(geomsNear, 'buildings:near');
    attachMerged(geomsMid,  'buildings:mid');

    console.log('[BuildingsBuilder] stats:', stat,
      `→ group has ${group.children.length} child mesh(es)`);
    if (stat.kept === 0 && stat.polygons > 0) {
      console.warn('[BuildingsBuilder] all polygons dropped — every drop reason in stats above is a candidate. See Step 4 in osm-features.md.');
    }

    return group;
  },
};
