import * as THREE from 'three';
// Phase 3 stub
export const VegetationBuilder = {
  async build(_location, _lodConfig) {
    const g = new THREE.Group();
    g.name = 'vegetation';
    return g;
  },
};
