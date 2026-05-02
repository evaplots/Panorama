import * as THREE from 'three';
import { fetchTile } from './DEMFetcher.js';
import { HeightSampler } from './HeightSampler.js';
import { TileMath } from '../data/TileMath.js';
import {
  DEM_TILE_ZOOM,
  PHASE1_TERRAIN_CAP_M,
  TERRAIN_MESH_SEGMENTS,
  TERRAIN_INNER_MESH_RADIUS_M,
  TERRAIN_INNER_MESH_SEGMENTS,
} from '../config.js';
import { state } from '../state.js';

/** Clamp terrain radius to Phase 1 cap (single-zoom mesh). */
function effectiveRadius(radiusM) {
  return Math.min(radiusM, PHASE1_TERRAIN_CAP_M);
}

function elevationColor(h, color) {
  const hC = Math.max(0, h);
  if (h <= 0) {
    color.setRGB(0.10, 0.30, 0.65);
  } else if (hC < 500) {
    const t = hC / 500;
    color.setRGB(0.18 + t * 0.20, 0.48 + t * 0.05, 0.12);
  } else if (hC < 1500) {
    const t = (hC - 500) / 1000;
    color.setRGB(0.38 + t * 0.22, 0.45 - t * 0.28, 0.10);
  } else if (hC < 2500) {
    const t = (hC - 1500) / 1000;
    color.setRGB(0.60 + t * 0.22, 0.17 + t * 0.33, 0.10 + t * 0.40);
  } else {
    color.setRGB(0.88, 0.88, 0.93);
  }
}

/**
 * @param {{lat, lon}} location
 * @param {number} radiusMetres
 * @returns {Promise<THREE.Group>}
 */
export const TerrainBuilder = {
  async build(location, radiusMetres) {
    const radius = effectiveRadius(radiusMetres);
    const { lat, lon } = location;

    // Bounding box in degrees
    const mPerDeg = 111320;
    const dLat = radius / mPerDeg;
    const dLon = radius / (mPerDeg * Math.cos(lat * Math.PI / 180));

    const south = lat - dLat;
    const north = lat + dLat;
    const west = lon - dLon;
    const east = lon + dLon;

    const tiles = TileMath.tilesInBoundingBox(south, west, north, east, DEM_TILE_ZOOM);

    // Determine tile grid extents
    let minTX = Infinity, maxTX = -Infinity, minTY = Infinity, maxTY = -Infinity;
    for (const t of tiles) {
      minTX = Math.min(minTX, t.x); maxTX = Math.max(maxTX, t.x);
      minTY = Math.min(minTY, t.y); maxTY = Math.max(maxTY, t.y);
    }

    const gridW = maxTX - minTX + 1;
    const gridH = maxTY - minTY + 1;

    state.emit('scene:progress', { progress: 0.1 });

    // Fetch all tiles in parallel
    const tileResults = await Promise.all(
      tiles.map(t =>
        fetchTile(t.x, t.y, t.z)
          .catch(() => null) // Ignore individual failures
      )
    );

    state.emit('scene:progress', { progress: 0.5 });

    // Stitch tiles into one heightmap
    const TILE_PX = 256;
    const hmW = gridW * TILE_PX;
    const hmH = gridH * TILE_PX;
    const heightmap = new Float32Array(hmW * hmH);

    for (let i = 0; i < tiles.length; i++) {
      const td = tileResults[i];
      if (!td) continue;
      const col = tiles[i].x - minTX;
      const row = tiles[i].y - minTY;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          heightmap[(row * TILE_PX + py) * hmW + (col * TILE_PX + px)] =
            td.heights[py * td.width + px];
        }
      }
    }

    // Heightmap bounds from tile grid corners
    const nwCorner = TileMath.tileCornerLonLat(minTX, minTY, DEM_TILE_ZOOM);
    const seCorner = TileMath.tileCornerLonLat(maxTX + 1, maxTY + 1, DEM_TILE_ZOOM);
    const hmBounds = {
      north: nwCorner.lat,
      south: seCorner.lat,
      west: nwCorner.lon,
      east: seCorner.lon,
    };

    // V2 Step 5c — apply state.terrain.yExaggeration before HeightSampler is
    // populated so every downstream consumer (mesh vertices, camera ground
    // placement, painter projection, Precipitation respawn altitude) sees the
    // same scaled world. Default 1.0 = honest DEM, no behaviour change.
    const yExag = state.get('terrain.yExaggeration');
    if (Number.isFinite(yExag) && yExag !== 1.0) {
      for (let i = 0; i < heightmap.length; i++) heightmap[i] *= yExag;
    }

    HeightSampler.populate(heightmap, hmW, hmH, hmBounds, { lat, lon });

    const group = new THREE.Group();
    group.name = 'terrain';

    // ─── Outer mesh: full radius, coarse triangulation ──────────────────
    // 30 km × 30 km (with PHASE1_TERRAIN_CAP_M=15000) at 512 segments →
    // vertex spacing ~58.6 m. This covers the visible vista all the way
    // out to the horizon.
    const widthM = radius * 2;
    const heightM = radius * 2;
    group.add(buildMeshTier(widthM, heightM, TERRAIN_MESH_SEGMENTS, 'terrain.outer', lat, lon, false));

    // ─── Inner concentric mesh: ~500 m, fine triangulation ──────────────
    // The outer mesh's near-camera region is one ~58.6 m × 58.6 m triangle
    // pair, so everything from canvas-bottom (~3.5 m at -5° tilt) to
    // ~29 m (the nearest outer vertex) renders inside that one triangle
    // and the foreground reads as a flat-coloured trapezoid. The inner
    // mesh adds 256² triangles inside a 1 km × 1 km patch around the
    // chosen location (vertex spacing ~3.9 m), giving the same DEM-derived
    // surface real per-vertex variation in the camera's first ~500 m.
    //
    // World-anchored at (0, 0, 0) — same origin as the outer mesh — so it
    // is rebuilt only on `location:changed`. Walk-mode users beyond the
    // 500 m radius see foreground degrade back to the outer mesh; this
    // is a deliberate v1 trade-off for the project's compose-then-paint
    // flow. See `.iterations/2026-05-02-foreground-rendering/DIAGNOSIS.md`.
    //
    // polygonOffset on the inner material wins the depth test against
    // the outer mesh in the overlapping region without cutting a hole
    // in the outer mesh — both meshes sample HeightSampler so the
    // surface is continuous; the inner just has finer triangulation.
    if (TERRAIN_INNER_MESH_RADIUS_M > 0) {
      const innerWidthM = TERRAIN_INNER_MESH_RADIUS_M * 2;
      group.add(buildMeshTier(
        innerWidthM, innerWidthM,
        TERRAIN_INNER_MESH_SEGMENTS,
        'terrain.inner',
        lat, lon,
        true,    // polygonOffset
      ));
    }

    state.emit('scene:progress', { progress: 0.9 });
    return group;
  },
};

/**
 * Build one PlaneGeometry mesh tier sampling Y from HeightSampler at each
 * vertex. Pure helper used by both tiers — same elevation-colour ramp,
 * same lambert lighting, same DEM source. Difference is segment count
 * (and the inner tier sets polygonOffset so it wins the depth test
 * inside its overlap with the outer tier).
 *
 * @param {number} widthM    metres
 * @param {number} heightM   metres
 * @param {number} segs      segments per side
 * @param {string} name      group child name (used by tests / debug)
 * @param {number} lat       observer latitude (heightmap origin)
 * @param {number} lon       observer longitude
 * @param {boolean} polyOffset  true → push fragments toward camera in
 *        depth buffer, so the inner tier wins over the outer in the
 *        shared 0..radius_m region
 */
function buildMeshTier(widthM, heightM, segs, name, lat, lon, polyOffset) {
  const geometry = new THREE.PlaneGeometry(widthM, heightM, segs, segs);
  geometry.rotateX(-Math.PI / 2); // XY → XZ plane

  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);
  const col = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const wx = posAttr.getX(i);
    const wz = posAttr.getZ(i);
    const { lon: pLon, lat: pLat } = TileMath.localToLonLat(wx, wz, lon, lat);
    const h = HeightSampler.getHeightAt(pLat, pLon);
    posAttr.setY(i, h);
    elevationColor(h, col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  posAttr.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (polyOffset) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}
