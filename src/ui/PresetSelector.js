import { PRESETS } from '../config.js';
import { state } from '../state.js';

const LABELS = {
  urban: 'Urban (5 km)',
  suburban: 'Suburban (15 km)',
  open: 'Open (40 km)',
  alpine: 'Alpine (100 km)',
};

export function createPresetSelector(container) {
  const root = document.createElement('div');
  root.className = 'pano-section';

  const h = document.createElement('h3');
  h.textContent = 'Radius preset';
  root.appendChild(h);

  const currentPreset = state.get('preset');

  Object.keys(PRESETS).forEach(name => {
    const label = document.createElement('label');
    label.className = 'pano-preset-row';
    label.innerHTML = `
      <input type="radio" name="pano-preset" value="${name}" ${name === currentPreset ? 'checked' : ''} />
      ${LABELS[name] ?? name}
    `;
    root.appendChild(label);
  });

  // Custom row
  const customLabel = document.createElement('label');
  customLabel.className = 'pano-preset-row';
  customLabel.innerHTML = `<input type="radio" name="pano-preset" value="custom" /> Custom`;
  root.appendChild(customLabel);

  const customWrap = document.createElement('div');
  customWrap.className = 'pano-custom-km';
  customWrap.style.display = 'none';
  customWrap.innerHTML = `<input type="number" min="1" max="500" placeholder="km" /> km radius`;
  root.appendChild(customWrap);

  const customInput = customWrap.querySelector('input');

  root.addEventListener('change', e => {
    const radio = e.target.closest('input[type=radio]');
    if (!radio) return;
    const val = radio.value;
    customWrap.style.display = val === 'custom' ? 'flex' : 'none';
    if (val !== 'custom') {
      state.set('preset', val);
    }
  });

  customInput.addEventListener('change', () => {
    const km = parseFloat(customInput.value);
    if (km > 0) {
      state.set('preset', 'custom');
      state.set('customRadius', km * 1000);
    }
  });

  container.appendChild(root);

  return () => { container.removeChild(root); };
}
