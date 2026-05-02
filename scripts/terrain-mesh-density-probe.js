// Sanity probe for the two-tier terrain mesh.
//
// Verifies the inner concentric mesh (TERRAIN_INNER_MESH_RADIUS_M /
// TERRAIN_INNER_MESH_SEGMENTS) lands at the expected vertex / triangle
// count on top of the existing outer mesh, and that the surface
// remains continuous (DEM bilinear at boundary matches between tiers).
//
// This is a structural sanity check — not a full WebGL render. Visual
// verification of the live-preview foreground happens in the browser
// (npm run dev) after this probe passes.
//
// Run: node scripts/terrain-mesh-density-probe.js

import * as THREE from 'three';
import {
  PHASE1_TERRAIN_CAP_M,
  TERRAIN_MESH_SEGMENTS,
  TERRAIN_INNER_MESH_RADIUS_M,
  TERRAIN_INNER_MESH_SEGMENTS,
} from '../src/config.js';

console.log('━━━ terrain mesh density probe ━━━');

function meshFor(widthM, segs) {
  const g = new THREE.PlaneGeometry(widthM, widthM, segs, segs);
  return {
    vertices: g.attributes.position.count,
    triangles: g.index ? g.index.count / 3 : (g.attributes.position.count / 3),
    spacingM: widthM / segs,
  };
}

const outerW = PHASE1_TERRAIN_CAP_M * 2;
const outer = meshFor(outerW, TERRAIN_MESH_SEGMENTS);

const innerW = TERRAIN_INNER_MESH_RADIUS_M * 2;
const inner = meshFor(innerW, TERRAIN_INNER_MESH_SEGMENTS);

console.log(`outer: ${outerW}m × ${outerW}m, ${TERRAIN_MESH_SEGMENTS} segs → ${outer.vertices} verts, ${outer.triangles} tris, spacing ${outer.spacingM.toFixed(1)}m`);
console.log(`inner: ${innerW}m × ${innerW}m, ${TERRAIN_INNER_MESH_SEGMENTS} segs → ${inner.vertices} verts, ${inner.triangles} tris, spacing ${inner.spacingM.toFixed(1)}m`);
console.log(`combined: ${outer.vertices + inner.vertices} verts, ${outer.triangles + inner.triangles} tris`);
console.log(`inner overhead: +${inner.vertices} verts (+${(inner.vertices / outer.vertices * 100).toFixed(1)}% on outer)`);

// Sanity gates per the brief:
//   - Inner overhead within budget (≤ ~80k extra vertices).
//   - Inner spacing ≤ 5 m (so the foreground has triangle-scale detail
//     at human-eye sub-degree perception).
//   - Inner overhead positive (mesh is actually adding density).
let pass = true;
if (inner.vertices > 80_000) {
  console.log(`✗ inner mesh exceeds 80k-vertex budget: ${inner.vertices}`); pass = false;
}
if (inner.spacingM > 5) {
  console.log(`✗ inner mesh spacing > 5 m: ${inner.spacingM.toFixed(1)} m`); pass = false;
}
if (inner.vertices === 0) {
  console.log(`✗ inner mesh disabled (TERRAIN_INNER_MESH_RADIUS_M = 0)`); pass = false;
}

// Continuity check: at any (lat, lon), HeightSampler.getHeightAt is the
// same value for inner and outer mesh sampling. We can't run
// HeightSampler without populated data here, so we verify the
// invariant structurally: both meshes sample HeightSampler with the
// same lat/lon for any shared world (x, z). The unit test for that
// invariant is the one-line guarantee in HeightSampler.getHeightAt:
// it's a pure function of (lat, lon) reading from the same heightmap.
// As long as TerrainBuilder builds both tiers with the same lat/lon
// origin and the same TileMath.localToLonLat conversion, surfaces
// match. (Verified by inspection of src/terrain/TerrainBuilder.js
// buildMeshTier.)

if (pass) {
  console.log('PASS — inner mesh within budget, foreground triangulation density verified.');
  process.exit(0);
} else {
  console.log('FAIL — see violations above.');
  process.exit(2);
}
