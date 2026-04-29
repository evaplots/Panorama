// Build web-resolution JPEG thumbnails of the six exhibition plates.
// Original PNGs are 12-14 MB each (A3 @ 300 DPI). Web/email needs 200-500 KB.
// Scaled to 1500 px on the long edge, JPEG quality 0.85, saved to exhibition/web/.
//
// Run: node scripts/build-thumbnails.js

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET_LONG_EDGE = 1500;
const QUALITY = 0.85;

async function main() {
  const exDir = path.join(ROOT, 'exhibition');
  const webDir = path.join(exDir, 'web');
  fs.mkdirSync(webDir, { recursive: true });

  // All top-level PNGs in exhibition/ (the six print-ready plates).
  const plates = fs.readdirSync(exDir)
    .filter(f => f.endsWith('.png') && fs.statSync(path.join(exDir, f)).isFile());

  let totalIn = 0, totalOut = 0;
  for (const file of plates) {
    const inPath = path.join(exDir, file);
    const outPath = path.join(webDir, file.replace(/\.png$/, '.jpg'));
    const img = await loadImage(inPath);
    const longSide = Math.max(img.width, img.height);
    const scale = Math.min(1, TARGET_LONG_EDGE / longSide);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const buf = canvas.toBuffer('image/jpeg', { quality: QUALITY });
    fs.writeFileSync(outPath, buf);
    const inSize = fs.statSync(inPath).size;
    const outSize = buf.length;
    totalIn += inSize;
    totalOut += outSize;
    console.log(`  ${file} → ${path.basename(outPath)}: ${(inSize / 1e6).toFixed(1)} MB → ${(outSize / 1e3).toFixed(0)} KB`);
  }
  console.log(`\nTotal: ${(totalIn / 1e6).toFixed(0)} MB → ${(totalOut / 1e6).toFixed(2)} MB (${((1 - totalOut / totalIn) * 100).toFixed(1)}% smaller)`);
}

main().catch(e => { console.error(e); process.exit(1); });
