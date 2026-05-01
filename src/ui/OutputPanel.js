// V2 Step 5c — OutputPanel. Paper size + orientation, bound to
// `state.export.format` and `state.export.orientation`. The painter reads
// these at trigger time in ControlsPanel's stylize handler — no other
// pipeline coupling.
//
// Pointillism's computeEffectiveDpi only knows A4 / A3 / A2, so the panel
// surfaces exactly those three (DATA-CONTRACTS v3.9 narrows ExportSpec.format
// to match).

import { state } from '../state.js';

const PAPER_OPTIONS = [
  { value: 'A4', label: 'A4' },
  { value: 'A3', label: 'A3' },
  { value: 'A2', label: 'A2' },
];

const ORIENTATION_OPTIONS = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait',  label: 'Portrait'  },
];

function makeRadioGroup(parent, name, options, statePath) {
  const wrap = document.createElement('div');
  wrap.className = 'pano-output-radiogroup';
  const current = state.get(statePath);

  for (const opt of options) {
    const label = document.createElement('label');
    label.className = 'pano-output-radio';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = opt.value;
    input.checked = opt.value === current;
    label.appendChild(input);

    const text = document.createElement('span');
    text.textContent = opt.label;
    label.appendChild(text);

    input.addEventListener('change', () => {
      if (input.checked) state.set(statePath, opt.value);
    });

    wrap.appendChild(label);
  }
  parent.appendChild(wrap);
}

export function createOutputPanel(parentEl) {
  const section = document.createElement('div');
  section.className = 'pano-section pano-output-section';
  section.innerHTML = '<h3>Output</h3>';
  parentEl.appendChild(section);

  const paperLabel = document.createElement('div');
  paperLabel.className = 'pano-output-sublabel';
  paperLabel.textContent = 'Paper size';
  section.appendChild(paperLabel);
  makeRadioGroup(section, `pano-paper-${Math.random().toString(36).slice(2, 7)}`,
    PAPER_OPTIONS, 'export.format');

  const orientLabel = document.createElement('div');
  orientLabel.className = 'pano-output-sublabel';
  orientLabel.textContent = 'Orientation';
  section.appendChild(orientLabel);
  makeRadioGroup(section, `pano-orient-${Math.random().toString(36).slice(2, 7)}`,
    ORIENTATION_OPTIONS, 'export.orientation');

  return {
    destroy() { section.remove(); },
  };
}
