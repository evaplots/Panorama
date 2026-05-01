// V2 Step 5c — TerrainPanel. Single "Mountain verticality" slider →
// state.terrain.yExaggeration. Commits on `change` (slider release) so
// dragging doesn't fire a flurry of rebuilds. SceneManager listens to
// `terrainOption:changed` and rebuilds when a location is set.
//
// "Mountain horizontal scale" from the original generative_panorama.html
// is intentionally not ported — distorting real DEM in XY breaks lat/lon
// distances and the painter's pinhole projection.

import { state } from '../state.js';

const MIN_VERTICALITY = 0.3;
const MAX_VERTICALITY = 3.0;

export function createTerrainPanel(parentEl) {
  const section = document.createElement('div');
  section.className = 'pano-section pano-terrain-section';
  section.innerHTML = '<h3>Terrain</h3>';
  parentEl.appendChild(section);

  const row = document.createElement('label');
  row.className = 'pano-terrain-row';

  const label = document.createElement('span');
  label.className = 'pano-terrain-label';
  label.textContent = 'Verticality';
  row.appendChild(label);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(MIN_VERTICALITY);
  input.max = String(MAX_VERTICALITY);
  input.step = '0.05';
  input.value = String(state.get('terrain.yExaggeration'));
  row.appendChild(input);

  const readout = document.createElement('span');
  readout.className = 'pano-terrain-readout';
  readout.textContent = `${Number(input.value).toFixed(2)}×`;
  row.appendChild(readout);

  // Live readout while dragging. Don't commit to state until release —
  // a rebuild per intermediate slider value would thrash the DEM/heightmap
  // pipeline even though tiles are cached.
  input.addEventListener('input', () => {
    readout.textContent = `${Number(input.value).toFixed(2)}×`;
  });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    state.set('terrain.yExaggeration', v);
    // Dedicated event — `terrain:changed` would also fire from state.set
    // since 'terrain' is a top-level block, but downstream listeners (e.g.
    // SceneManager) need a stable name and the explicit event keeps the
    // contract self-documenting in DATA-CONTRACTS.
    state.emit('terrainOption:changed', null);
  });

  section.appendChild(row);

  return {
    destroy() { section.remove(); },
  };
}
