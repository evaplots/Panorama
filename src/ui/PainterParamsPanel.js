// V2 Step 5c — PainterParamsPanel. Seven slider rows + a seed button row.
//
// All sliders write to `state.painter.*` on `input` (live read-out updates
// while the user drags). The next call to applyPointillism reads from state
// at the call site in ControlsPanel.js — no per-slider event coupling.
//
// Wind tilt has special semantics: null = auto (PR #9 weather rule applies),
// a finite number = user override unconditional. A "↺" button next to the
// slider writes null back to restore auto.

import { state } from '../state.js';

const SLIDER_FIELDS = [
  { label: 'Pen size',          path: 'painter.brushWidthMm',       min: 0.3, max: 3.0,  step: 0.1,   unit: 'mm',  decimals: 1 },
  { label: 'Density',           path: 'painter.density',            min: 0.01, max: 0.20, step: 0.005, unit: '',   decimals: 3 },
  { label: 'Opacity',           path: 'painter.brushOpacity',       min: 0.50, max: 1.00, step: 0.01,  unit: '',   decimals: 2 },
  { label: 'Stroke length',     path: 'painter.brushStrokeFactor',  min: 0.3, max: 3.0,  step: 0.1,   unit: '×',   decimals: 1 },
  { label: 'Palette diversity', path: 'painter.paletteTemperature', min: 5,   max: 100,  step: 1,     unit: '',    decimals: 0 },
  { label: 'Palette colours',   path: 'painter.paletteSize',        min: 8,   max: 50,   step: 1,     unit: '',    decimals: 0 },
];

function fmt(value, decimals) {
  if (!Number.isFinite(value)) return '—';
  return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
}

function makeSlider(parent, field) {
  const row = document.createElement('label');
  row.className = 'pano-painter-row';

  const label = document.createElement('span');
  label.className = 'pano-painter-label';
  label.textContent = field.label;
  row.appendChild(label);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(field.min);
  input.max = String(field.max);
  input.step = String(field.step);
  input.value = String(state.get(field.path));
  row.appendChild(input);

  const readout = document.createElement('span');
  readout.className = 'pano-painter-readout';
  readout.textContent = fmt(Number(input.value), field.decimals) + (field.unit ? ` ${field.unit}` : '');
  row.appendChild(readout);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    state.set(field.path, v);
    readout.textContent = fmt(v, field.decimals) + (field.unit ? ` ${field.unit}` : '');
  });

  parent.appendChild(row);
}

function makeWindTiltRow(parent) {
  const row = document.createElement('div');
  row.className = 'pano-painter-row pano-painter-row-wind';

  const label = document.createElement('span');
  label.className = 'pano-painter-label';
  label.textContent = 'Wind tilt';
  row.appendChild(label);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.05';
  // Slider position only meaningful when a numeric override is set; when
  // auto, leave the thumb at the data-driven 0.4 mid-point as a visual
  // hint to the user that "auto" lands somewhere around there.
  const initialOverride = state.get('painter.windInfluenceOverride');
  input.value = Number.isFinite(initialOverride) ? String(initialOverride) : '0.4';
  row.appendChild(input);

  const readout = document.createElement('span');
  readout.className = 'pano-painter-readout';
  row.appendChild(readout);

  // Reset to auto.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'pano-painter-reset';
  resetBtn.title = 'Reset to auto (let weather drive wind tilt)';
  resetBtn.textContent = '↺';
  row.appendChild(resetBtn);

  function refresh() {
    const v = state.get('painter.windInfluenceOverride');
    if (Number.isFinite(v)) {
      readout.textContent = v.toFixed(2);
      readout.classList.remove('is-auto');
      input.value = String(v);
    } else {
      readout.textContent = 'auto';
      readout.classList.add('is-auto');
    }
  }

  input.addEventListener('input', () => {
    state.set('painter.windInfluenceOverride', Number(input.value));
    refresh();
  });
  resetBtn.addEventListener('click', () => {
    state.set('painter.windInfluenceOverride', null);
    refresh();
  });

  refresh();
  parent.appendChild(row);
}

function makeSeedRow(parent) {
  const row = document.createElement('div');
  row.className = 'pano-painter-seed-row';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pano-painter-seed-btn';
  btn.textContent = '🎲 New seed';
  row.appendChild(btn);

  const display = document.createElement('span');
  display.className = 'pano-painter-seed-display';
  display.textContent = formatSeed(state.get('painter.seed'));
  row.appendChild(display);

  btn.addEventListener('click', () => {
    const next = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
    state.set('painter.seed', next);
    display.textContent = formatSeed(next);
  });

  parent.appendChild(row);
}

function formatSeed(seed) {
  if (!Number.isFinite(seed)) return '—';
  // Hex zero-padded to 8 chars — matches mulberry32's effective domain
  // and reads tighter than a 10-digit decimal. A "good seed" picked
  // during curation is short enough to copy by eye.
  return '0x' + (seed >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export function createPainterParamsPanel(parentEl) {
  const section = document.createElement('div');
  section.className = 'pano-section pano-painter-section';
  section.innerHTML = '<h3>Painter</h3>';
  parentEl.appendChild(section);

  const list = document.createElement('div');
  list.className = 'pano-painter-list';
  section.appendChild(list);

  for (const field of SLIDER_FIELDS) makeSlider(list, field);
  makeWindTiltRow(list);
  makeSeedRow(section);

  return {
    destroy() { section.remove(); },
  };
}
