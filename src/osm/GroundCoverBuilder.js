import * as THREE from 'three';
import earcut from 'earcut';
import { OSMFetcher } from './OSMFetcher.js';
import { HeightSampler } from '../terrain/HeightSampler.js';
import { TileMath } from '../data/TileMath.js';
import {
  GROUND_COVER_COLOURS,
  GROUND_COVER_PRIORITY,
  GROUND_COVER_Z_OFFSET_M,
} from '../config.js';

/**
 * Pick the best colour for a polygon by walking its tags and choosing
 * the entry whose key has the highest priority in GROUND_COVER_PRIORITY.
 * Returns null if no tag matches.
 */
function resolveColour(tags) {
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

/** OSM closed ways repeat the first vertex as the last; strip the duplicate. */
function projectRing(ring, originLon, originLat) {
  const n = ring.length;
  const isClosed = n >= 2 &&
    ring[0].lat === ring[n - 1].lat &&
    ring[0].lon === ring[n - 1].lon;
  const limit = isClosed ? n - 1 : n;
  const flat = new Array(limit * 2);
  for (let i = 0; i < limit; i++) {
    const { x, z } = TileMath.lonLatToLocal(ring[i].lon, ring[i].lat, originLon, originLat);
    flat[i * 2] = x;
    flat[i * 2 + 1] = z;
  }
  return flat;
}

/** 2D polygon area for sorting (sign ignored). */
function polygonArea(flat) {
  let area = 0;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    area += (flat[j] - flat[i]) * (flat[i + 1] + flat[j + 1]);
  }
  return Math.abs(area) / 2;
}

/**
 * Run earcut on outer + inners. Returns `null` for self-intersecting / broken polys.
 */
function triangulate(outer, inners) {
  const verts = outer.slice();
  const holes = [];
  for (const inner of inners) {
    if (inner.length < 6) continue; // need at least 3 points
    holes.push(verts.length / 2);
    for (let i = 0; i < inner.length; i++) verts.push(inner[i]);
  }
  try {
    const indices = earcut(verts, holes.length ? holes : null, 2);
    if (!indices.length) return null;
    return { verts, indices };
  } catch {
    return null;
  }
}

export const GroundCoverBuilder = {
  /**
   * @param {{lat, lon}} location
   * @param {{osmRadius: number}} preset
   * @returns {Promise<THREE.Group>}
   */
  async build(location, preset) {
    const group = new THREE.Group();
    group.name = 'groundCover';

    if (!HeightSampler.isReady()) {
      console.warn('[GroundCoverBuilder] HeightSampler not ready, skipping');
      return group;
    }

    const polygons = await OSMFetcher.fetchGroundCover(location, preset);
    if (!polygons.length) return group;

    // Group polygons by resolved colour
    const byColour = new Map(); // colour → [{ outerXZ, innersXZ, area }]
    for (const poly of polygons) {
      const colour = resolveColour(poly.tags);
      if (colour === null) continue;
      const outerXZ = projectRing(poly.outer, location.lon, location.lat);
      if (outerXZ.length < 6) continue;
      const innersXZ = poly.inners.map(r => projectRing(r, location.lon, location.lat));
      const area = polygonArea(outerXZ);
      if (!byColour.has(colour)) byColour.set(colour, []);
      byColour.get(colour).push({ outerXZ, innersXZ, area });
    }

    const meshes = [];
    for (const [colour, polys] of byColour) {
      // Largest first inside a colour bucket — render order keeps small polygons visible
      polys.sort((a, b) => b.area - a.area);

      const positions = [];
      const indices = [];
      let vertOffset = 0;

      for (const { outerXZ, innersXZ } of polys) {
        const tri = triangulate(outerXZ, innersXZ);
        if (!tri) continue;
        const { verts, indices: triIdx } = tri;

        for (let i = 0; i < verts.length; i += 2) {
          const x = verts[i];
          const z = verts[i + 1];
          const y = HeightSampler.getHeightAtWorld(x, z) + GROUND_COVER_Z_OFFSET_M;
          positions.push(x, y, z);
        }
        for (let i = 0; i < triIdx.length; i++) indices.push(triIdx[i] + vertOffset);
        vertOffset += verts.length / 2;
      }

      if (!positions.length) continue;

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      const material = new THREE.MeshLambertMaterial({
        color: colour,
        side: THREE.DoubleSide,
        // Polygon offset is a belt-and-braces guard against z-fighting with terrain.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });

      const mesh = new THREE.Mesh(geom, material);
      mesh.userData.minArea = polys[polys.length - 1].area; // smallest in this colour
      meshes.push(mesh);
    }

    // Cross-colour render order: smaller-typical polygons drawn last → on top
    meshes.sort((a, b) => b.userData.minArea - a.userData.minArea);
    meshes.forEach((m, i) => { m.renderOrder = i; group.add(m); });

    return group;
  },
};
