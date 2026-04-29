// Build a museum-pitch hero image: 3×2 grid of the strongest pointillism outputs
// across all iterations. Each cell is captioned with painter + scene + iteration.
//
// Output: .iterations/2026-04-29-best-of-gallery/best-of-6.png at A3 (4961×3508).
// Run: node scripts/build-gallery.js

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ITER = path.join(ROOT, '.iterations');

const A3_W = 4961;
const A3_H = 3508;
const COLS = 3;
const ROWS = 2;
const CAPTION_HEIGHT = 92;
const PADDING = 18;

const PICKS = [
  {
    src: '2026-04-29-pointillism-v0.8/storm-seascape-pointillism.png',
    title: 'Nolde — storm seascape',
    sub: 'curated palette, blood-orange horizon over violet sea',
  },
  {
    src: '2026-04-29-pointillism-v1.3-expressionist-comp/alpine-sunset__marc-symbolic-pointillism.png',
    title: 'Marc — primary symbolism',
    sub: 'Der Blaue Reiter palette, expressionist mode',
  },
  {
    src: '2026-04-29-pointillism-v0.8/mountain-twilight-pointillism.png',
    title: 'Whistler — alpine nocturne',
    sub: 'whisper-quiet tonal study, gold on blue',
  },
  {
    src: '2026-04-29-pointillism-v1.0-impasto-all/forest-noon-pointillism.png',
    title: 'Soutine — gestural forest',
    sub: 'impasto mode, vertical trunks woven into earth',
  },
  {
    src: '2026-04-29-pointillism-v0.8/coastal-twilight-pointillism.png',
    title: 'Munch — anxious twilight',
    sub: 'complementary tensions, decisive horizon',
  },
  {
    src: '2026-04-29-pointillism-v1.3-expressionist-comp/alpine-sunset__turner-fog-pointillism.png',
    title: 'Turner — fog and atmosphere',
    sub: 'cream and pink dissolving into haze',
  },
];

async function main() {
  const outDir = path.join(ITER, '2026-04-29-best-of-gallery');
  fs.mkdirSync(outDir, { recursive: true });

  const canvas = createCanvas(A3_W, A3_H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#141014';
  ctx.fillRect(0, 0, A3_W, A3_H);

  const cellW = (A3_W - (COLS + 1) * PADDING) / COLS;
  const cellH = (A3_H - (ROWS + 1) * PADDING) / ROWS;
  const imgH = cellH - CAPTION_HEIGHT;

  for (let i = 0; i < PICKS.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PADDING + col * (cellW + PADDING);
    const y = PADDING + row * (cellH + PADDING);

    const pick = PICKS[i];
    const srcPath = path.join(ITER, pick.src);
    if (!fs.existsSync(srcPath)) {
      console.warn(`MISSING: ${srcPath}`);
      continue;
    }
    const img = await loadImage(srcPath);
    // Cover-fit the image into the cell rectangle
    const scale = Math.max(cellW / img.width, imgH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const dx = x + (cellW - drawW) / 2;
    const dy = y + (imgH - drawH) / 2;
    // Clip to cell so the cover-fit doesn't bleed
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, imgH);
    ctx.clip();
    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.restore();

    // Caption strip
    const capY = y + imgH;
    ctx.fillStyle = '#1d181c';
    ctx.fillRect(x, capY, cellW, CAPTION_HEIGHT);
    ctx.fillStyle = '#f3eee6';
    ctx.font = 'bold 30px serif';
    ctx.textBaseline = 'top';
    ctx.fillText(pick.title, x + 18, capY + 14);
    ctx.fillStyle = '#a89e8d';
    ctx.font = '22px serif';
    ctx.fillText(pick.sub, x + 18, capY + 50);

    console.log(`  cell ${i + 1}/${PICKS.length}: ${pick.title}`);
  }

  // Header strip overlaid on top edge
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, A3_W, 94);
  ctx.fillStyle = '#f3eee6';
  ctx.font = 'italic 36px serif';
  ctx.textBaseline = 'top';
  ctx.fillText(
    'Panorama — pointillism iteration gallery, Phase 2.5',
    PADDING + 4,
    24,
  );

  const outPath = path.join(outDir, 'best-of-6.png');
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`\nWrote ${outPath}`);
  console.log(`Resolution: ${A3_W}×${A3_H} (A3 @ 300 DPI)`);
}

main().catch(e => { console.error(e); process.exit(1); });
