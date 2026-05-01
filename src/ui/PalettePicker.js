import palettes from '../style/palettes.json';
import { state } from '../state.js';

const AUTO_VALUE = 'auto';
const SWATCH_COUNT = 6;

function rgbCss([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

function buildSwatchStrip(colors) {
  const strip = document.createElement('span');
  strip.className = 'pano-palette-swatches';
  colors.slice(0, SWATCH_COUNT).forEach(c => {
    const sq = document.createElement('span');
    sq.className = 'pano-palette-swatch';
    sq.style.background = rgbCss(c);
    strip.appendChild(sq);
  });
  return strip;
}

export function createPalettePicker(parentEl) {
  const section = document.createElement('div');
  section.className = 'pano-section pano-palette-section';
  section.innerHTML = `<h3>Style — Palette</h3>`;
  parentEl.appendChild(section);

  const list = document.createElement('div');
  list.className = 'pano-palette-list';
  section.appendChild(list);

  const groupName = 'pano-palette-' + Math.random().toString(36).slice(2, 7);
  const initialPainter = state.get('style.painter') ?? AUTO_VALUE;

  const renderRow = (value, label, sublabel, colors) => {
    const row = document.createElement('label');
    row.className = 'pano-palette-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = value;
    radio.checked = value === initialPainter;
    row.appendChild(radio);

    const text = document.createElement('span');
    text.className = 'pano-palette-text';
    const nameEl = document.createElement('span');
    nameEl.className = 'pano-palette-name';
    nameEl.textContent = label;
    text.appendChild(nameEl);
    if (sublabel) {
      const sub = document.createElement('span');
      sub.className = 'pano-palette-sub';
      sub.textContent = sublabel;
      text.appendChild(sub);
    }
    if (colors) {
      text.appendChild(buildSwatchStrip(colors));
    }
    row.appendChild(text);

    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      if (value === AUTO_VALUE) {
        state.set('style.painter', AUTO_VALUE);
        state.set('style.paletteSource', 'colorthief');
      } else {
        state.set('style.painter', value);
        state.set('style.paletteSource', 'curated');
      }
    });

    list.appendChild(row);
  };

  // Auto (ColorThief) — listed first so it's visible without scrolling.
  renderRow(AUTO_VALUE, 'Auto (ColorThief)', 'Extracted from scene', null);

  // Curated palettes — read dynamically from palettes.json so adding a
  // palette to the JSON file is enough to surface it in the UI.
  for (const [slug, palette] of Object.entries(palettes)) {
    renderRow(slug, palette.name, null, palette.colors);
  }

  return {
    destroy() {
      section.remove();
    },
  };
}
