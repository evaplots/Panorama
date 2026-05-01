import * as THREE from 'three';
import { OSMFetcher } from './OSMFetcher.js';

/**
 * Top-level OSM orchestrator.
 *
 * As of the chore that removed 3D OSM rendering, this no longer constructs any
 * Three.js geometry. The painter consumes OSM polygons directly via
 * `OSMFetcher.peekGroundCover` (V2 Step 4); the only reason this still runs at
 * scene-rebuild time is to **warm the OSMFetcher tile cache** so that the
 * painter's cache-only peek finds something to render after `scene:ready` fires.
 *
 * The previous Phase 1.5 / Phase 2 builders (GroundCoverBuilder,
 * BuildingsBuilder, VegetationBuilder) and the LODManager were deleted in this
 * commit. If 3D ground or building rendering is ever wanted again, see the
 * P3 entry in REQUIREMENTS-CHECKLIST.md for the git SHA they last lived on.
 */
export const OSMFeatureBuilder = {
  /**
   * @param {{lat, lon}} location
   * @param {object} preset
   * @returns {Promise<THREE.Group>}  empty group, named 'osmFeatures', kept
   *   so SceneManager's add/dispose flow doesn't need a special case.
   */
  async build(location, preset) {
    try {
      // Awaited deliberately — by the time scene:ready fires, the cache must
      // be warm so the next paint's peek finds polygons. Errors are logged
      // but don't fail the rebuild; a paint without polygons is still useful.
      await OSMFetcher.fetchGroundCover(location, preset);
    } catch (err) {
      console.warn('[OSMFeatureBuilder] cache warm failed:', err);
    }
    const root = new THREE.Group();
    root.name = 'osmFeatures';
    return root;
  },
};
