// Build "process plates" — A3 portrait composites showing the synthetic
// source on top and the painted result on bottom for each of the six
// EXHIBITION.md plates. Useful for talks / making-of / explanation contexts
// where the algorithm-in-action is the point, not just the final painting.
//
// Output: exhibition/process/<plate>-process.png (one per plate).
// Run: node scripts/build-process-plates.js

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ITER = path.join(ROOT, '.iterations');

// A3 portrait: short side × long side
const W = 3508;
const H = 4961;
const PAD = 30;
const HEADER_H = 130;
const LABEL_H = 70;
const CAPTION_H = 200;

const PLATES = [
  {
    file: 'plate-i-sturm',
    title: 'I. Sturm — storm seascape, after Nolde',
    caption: 'Heavy violet sky cut by a tear of warm horizon light. Slashing whites over a deep teal sea. The Nolde palette translated into gradient-aligned brush marks.',
    sourceDir: '2026-04-29-pointillism-v1.8-7scene-expressionist',
    sourceFile: 'storm-seascape-source.png',
    paintedFile: 'storm-seascape-pointillism.png',
  },
  {
    file: 'plate-ii-battersea-imagined',
    title: 'II. Battersea, Imagined — urban dusk, after Whistler',
    caption: 'Building silhouettes at twilight, the only structural warmth the bright golden rectangles of lit windows above wet-pavement reflections. Whistler\'s nocturne palette applied to a city that exists nowhere.',
    sourceDir: '2026-04-29-pointillism-v1.8-7scene-expressionist',
    sourceFile: 'urban-dusk-source.png',
    paintedFile: 'urban-dusk-pointillism.png',
  },
  {
    file: 'plate-iii-alpine-vibration',
    title: 'III. Alpine Vibration — alpine sunset, after Kirchner',
    caption: 'Mountain silhouettes against ultramarine shot through with cadmium-yellow and orange. The Kirchner Davos vocabulary — cool-warm complementary tensions, the Brücke flatness of Alpine forms — laid as gradient-aligned strokes.',
    sourceDir: '2026-04-29-pointillism-v1.8-7scene-expressionist',
    sourceFile: 'alpine-sunset-source.png',
    paintedFile: 'alpine-sunset-pointillism.png',
  },
  {
    file: 'plate-iv-snow-storm',
    title: 'IV. Snow Storm — whiteout blizzard, after Turner',
    caption: 'Near-monochromatic field of cream and pale grey, only structural darkness a dissolving treeline. Turner\'s late atmospheric vocabulary on a synthesised whiteout. Spiritual reference: Hannibal Crossing the Alps.',
    sourceDir: '2026-04-29-pointillism-v1.9-snow-blizzard',
    sourceFile: 'snow-blizzard-source.png',
    paintedFile: 'snow-blizzard-pointillism.png',
  },
  {
    file: 'plate-v-red-walls',
    title: 'V. Red Walls — desert canyon, after Marc',
    caption: 'Bright orange-red sunlit cliff opposite deep blue-purple shadow wall, sky a mosaic of saturated complementaries. Der Blaue Reiter primary symbolism applied to canyon geometry.',
    sourceDir: '2026-04-29-pointillism-v1.10-canyon',
    sourceFile: 'canyon-source.png',
    paintedFile: 'canyon-pointillism.png',
  },
  {
    file: 'plate-vi-anxious-twilight',
    title: 'VI. Anxious Twilight — coastal twilight, after Munch',
    caption: 'Horizon line cutting decisively between a charged sky of yellow-and-pink nervous tension and a cool sea below. The Munch palette — vivid complementaries, Karl-Johan colour register — applied as description of feeling about weather.',
    sourceDir: '2026-04-29-pointillism-v1.8-7scene-expressionist',
    sourceFile: 'coastal-twilight-source.png',
    paintedFile: 'coastal-twilight-pointillism.png',
  },
];

async function main() {
  const outDir = path.join(ROOT, 'exhibition', 'process');
  fs.mkdirSync(outDir, { recursive: true });

  // Cell calculations: each cell preserves source's 4961×3508 ratio (~1.414).
  // Available height for both cells: H - HEADER_H - 2×LABEL_H - CAPTION_H - 5×PAD
  const availH = H - HEADER_H - 2 * LABEL_H - CAPTION_H - 5 * PAD;
  const cellH = Math.floor(availH / 2);
  const cellW = Math.min(W - 2 * PAD, Math.round(cellH * 4961 / 3508));
  // (cellW will be the limiting dimension — A3 portrait is 3508 wide, original is 4961)

  for (const plate of PLATES) {
    const srcPath = path.join(ITER, plate.sourceDir, plate.sourceFile);
    const paintPath = path.join(ITER, plate.sourceDir, plate.paintedFile);
    if (!fs.existsSync(srcPath) || !fs.existsSync(paintPath)) {
      console.warn(`Skip ${plate.file}: missing ${srcPath} or ${paintPath}`);
      continue;
    }
    const srcImg = await loadImage(srcPath);
    const paintImg = await loadImage(paintPath);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#141014';
    ctx.fillRect(0, 0, W, H);

    // Header strip
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = '#f3eee6';
    ctx.font = 'italic 36px serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Panorama — process plate', PAD + 4, 28);
    ctx.fillStyle = '#a89e8d';
    ctx.font = '24px serif';
    ctx.fillText(plate.title, PAD + 4, 76);

    // Layout cells centered horizontally
    const cellX = Math.round((W - cellW) / 2);
    let y = HEADER_H + PAD;

    // Source label
    ctx.fillStyle = '#a89e8d';
    ctx.font = 'small-caps 28px serif';
    ctx.fillText('Source — synthetic landscape', cellX, y + 14);
    y += LABEL_H;
    // Source image
    ctx.drawImage(srcImg, cellX, y, cellW, cellH);
    y += cellH + PAD;

    // Painted label
    ctx.fillStyle = '#a89e8d';
    ctx.font = 'small-caps 28px serif';
    ctx.fillText('Painted — pointillism v1.4 (curated palette, 1.2 mm strokes)', cellX, y + 14);
    y += LABEL_H;
    // Painted image
    ctx.drawImage(paintImg, cellX, y, cellW, cellH);
    y += cellH + PAD;

    // Caption strip — soft text wrap by word break
    ctx.fillStyle = '#1d181c';
    ctx.fillRect(PAD, y, W - 2 * PAD, CAPTION_H);
    ctx.fillStyle = '#f3eee6';
    ctx.font = '26px serif';
    const captionMaxWidth = W - 2 * PAD - 60;
    const words = plate.caption.split(/\s+/);
    let line = '';
    let lineY = y + 30;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const testWidth = ctx.measureText(test).width;
      if (testWidth > captionMaxWidth && line) {
        ctx.fillText(line, PAD + 30, lineY);
        line = word;
        lineY += 38;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, PAD + 30, lineY);

    const outPath = path.join(outDir, `${plate.file}-process.png`);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`  wrote ${path.relative(ROOT, outPath)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
