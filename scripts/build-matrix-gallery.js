// Build the 9-scene × 9-palette matrix as a single A3 landscape contact sheet.
// 81 cells of pointillism output, palette = column, scene = row.
// Top edge: painter palette names. Left edge: scene names.
// Cell sources are pulled from the v1.6 (alpine) and v1.12-matrix-* directories.
//
// Output: exhibition/matrix-9x9.png at A3 @ 300 DPI.
// Run: node scripts/build-matrix-gallery.js

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ITER = path.join(ROOT, '.iterations');

const W = 4961;
const H = 3508;
const TOP_LABEL = 110;
const LEFT_LABEL = 220;
const HEADER = 110;
const PAD = 8;

// Column palettes (left-to-right) — visual flow: warm to cool to neutral.
const PALETTES = [
  { key: 'munch-sunset',      label: 'Munch' },
  { key: 'nolde-storm',       label: 'Nolde' },
  { key: 'soutine-landscape', label: 'Soutine' },
  { key: 'kirchner-alpine',   label: 'Kirchner' },
  { key: 'marc-symbolic',     label: 'Marc' },
  { key: 'whistler-nocturne', label: 'Whistler' },
  { key: 'turner-fog',        label: 'Turner' },
  { key: 'klimt-golden',      label: 'Klimt' },
  { key: 'macke-tunisian',    label: 'Macke' },
];

// Row scenes (top-to-bottom) — visual flow: warm/sunset to cool/cold.
const SCENES = [
  { source: 'alpine-sunset',      dir: '2026-04-29-pointillism-v1.6-palette-comp',     label: 'Alpine sunset' },
  { source: 'coastal-twilight',   dir: '2026-04-29-pointillism-v1.12-matrix-coastal',  label: 'Coastal twilight' },
  { source: 'forest-noon',        dir: '2026-04-29-pointillism-v1.12-matrix-forest',   label: 'Forest noon' },
  { source: 'desert-noon',        dir: '2026-04-29-pointillism-v1.12-matrix-desert',   label: 'Desert noon' },
  { source: 'canyon',             dir: '2026-04-29-pointillism-v1.12-matrix-canyon',   label: 'Canyon' },
  { source: 'storm-seascape',     dir: '2026-04-29-pointillism-v1.12-matrix-storm',    label: 'Storm seascape' },
  { source: 'urban-dusk',         dir: '2026-04-29-pointillism-v1.12-matrix-urban',    label: 'Urban dusk' },
  { source: 'mountain-twilight',  dir: '2026-04-29-pointillism-v1.12-matrix-mountain', label: 'Mountain twilight' },
  { source: 'snow-blizzard',      dir: '2026-04-29-pointillism-v1.12-matrix-snow',     label: 'Snow blizzard' },
];

async function main() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e0c10';
  ctx.fillRect(0, 0, W, H);

  // Header strip
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, HEADER);
  ctx.fillStyle = '#f3eee6';
  ctx.font = 'italic 38px serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Panorama — 9 × 9 matrix: every scene, every painter', PAD + 12, 22);
  ctx.fillStyle = '#a89e8d';
  ctx.font = '22px serif';
  ctx.fillText('A3 @ 300 DPI · pointillism v1.4 expressionist · 1.2 mm strokes · curated palettes', PAD + 12, 70);

  // Column label band (palette names) — below header
  const matrixTop = HEADER + TOP_LABEL;
  const matrixLeft = LEFT_LABEL;
  const cellW = Math.floor((W - matrixLeft - 10 * PAD) / PALETTES.length);
  const cellH = Math.floor((H - matrixTop - 10 * PAD) / SCENES.length);

  ctx.fillStyle = '#1a161a';
  ctx.fillRect(matrixLeft, HEADER, W - matrixLeft, TOP_LABEL);
  ctx.fillStyle = '#dcd2c4';
  ctx.font = 'small-caps 26px serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (let c = 0; c < PALETTES.length; c++) {
    const x = matrixLeft + PAD + c * (cellW + PAD) + cellW / 2;
    ctx.fillText(PALETTES[c].label, x, HEADER + TOP_LABEL / 2);
  }

  // Row label band (scene names) — left of grid
  ctx.fillStyle = '#1a161a';
  ctx.fillRect(0, matrixTop, LEFT_LABEL, H - matrixTop);
  ctx.fillStyle = '#dcd2c4';
  ctx.font = 'small-caps 22px serif';
  ctx.textAlign = 'right';
  for (let r = 0; r < SCENES.length; r++) {
    const y = matrixTop + PAD + r * (cellH + PAD) + cellH / 2;
    ctx.fillText(SCENES[r].label, LEFT_LABEL - 12, y);
  }
  ctx.textAlign = 'start'; // reset
  ctx.textBaseline = 'top';

  // Cells: 9 × 9
  let cellsDrawn = 0;
  let cellsMissing = 0;
  for (let r = 0; r < SCENES.length; r++) {
    const scene = SCENES[r];
    for (let c = 0; c < PALETTES.length; c++) {
      const palette = PALETTES[c];
      const filename = `${scene.source}__${palette.key}-pointillism.png`;
      const filePath = path.join(ITER, scene.dir, filename);
      const x = matrixLeft + PAD + c * (cellW + PAD);
      const y = matrixTop + PAD + r * (cellH + PAD);
      if (!fs.existsSync(filePath)) {
        // Draw placeholder
        ctx.fillStyle = '#2a2226';
        ctx.fillRect(x, y, cellW, cellH);
        ctx.fillStyle = '#665c54';
        ctx.font = '16px serif';
        ctx.fillText('(missing)', x + 12, y + cellH / 2 - 8);
        cellsMissing++;
        continue;
      }
      const img = await loadImage(filePath);
      // Cover-fit
      const scale = Math.max(cellW / img.width, cellH / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const dx = x + (cellW - drawW) / 2;
      const dy = y + (cellH - drawH) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();
      cellsDrawn++;
    }
  }

  console.log(`Drew ${cellsDrawn}/${cellsDrawn + cellsMissing} cells (${cellsMissing} missing)`);

  const outDir = path.join(ROOT, 'exhibition');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'matrix-9x9.png');
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${W}×${H})`);
}

main().catch(e => { console.error(e); process.exit(1); });
