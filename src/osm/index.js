import * as THREE from 'three';
import { GroundCoverBuilder } from './GroundCoverBuilder.js';
import { BuildingsBuilder } from './BuildingsBuilder.js';
import { VegetationBuilder } from './VegetationBuilder.js';

function emptyGroup(name) {
  const g = new THREE.Group(); g.name = name; return g;
}

/**
 * Top-level OSM orchestrator. Returns a group containing four named sub-groups
 * — only those built in the current phase are populated, the rest are empty
 * placeholders so SceneManager doesn't have to know which phase is active.
 *
 * Phase 1.5: groundCover
 * Phase 2:   groundCover, buildings
 */
export const OSMFeatureBuilder = {
  /**
   * @param {{lat, lon}} location
   * @param {object} preset
   * @returns {Promise<THREE.Group>}
   */
  async build(location, preset) {
    const root = new THREE.Group();
    root.name = 'osmFeatures';

    const [groundCover, buildings] = await Promise.all([
      GroundCoverBuilder.build(location, preset).catch(err => {
        console.warn('[OSMFeatureBuilder] groundCover failed:', err);
        return emptyGroup('groundCover');
      }),
      BuildingsBuilder.build(location, preset).catch(err => {
        console.warn('[OSMFeatureBuilder] buildings failed:', err);
        return emptyGroup('buildings');
      }),
    ]);

    const vegetation = await VegetationBuilder.build(location, preset);
    const landmarks = emptyGroup('landmarks');

    root.add(groundCover, buildings, vegetation, landmarks);
    return root;
  },
};
