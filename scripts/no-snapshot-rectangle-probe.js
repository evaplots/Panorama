// Diagnostic probe for the no-Snapshot foreground-rectangle artefact.
// Reproduces the case the user described: app open, no location selected,
// no Snapshot, no OSM data — preview panel still shows a desaturated grey
// rectangle below the horizon.
//
// We render four variants on a flat-colour source canvas (no terrain, no
// sky — just a uniform mid-grey, the cleanest possible "no scene" input)
// to bisect which pass paints the rectangle:
//
//   no-snapshot.png             full pipeline, bindings=null
//   no-snapshot-no-haze.png     skip haze
//   no-snapshot-no-bloom.png    skip bloom (via bloomStrength=0)
//   no-snapshot-no-grain.png    skip grain (via grainAmount=0)
//   no-snapshot-no-atmospherics.png   skip the whole orchestrator
//   no-snapshot-bindings-only-skipped.png  bindings=null + atmospherics off
//
// Run: node scripts/no-snapshot-rectangle-probe.js

import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUnderpainting } from '../src/style/underpainting.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.iterations', '2026-05-02-no-snapshot');

const W = 480;
const H = 340;

function makeFlatSource() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a6478';
  ctx.fillRect(0, 0, W, H);
  return c;
}

async function variant(label, opts) {
  const source = makeFlatSource();
  const { canvas, timing } = await renderUnderpainting(source, {
    bindings: null,
    softenEdges: false,
    seed: 0xC0FFEE,
    targetPaperSize: 'A3',
    targetOrientation: 'landscape',
    createCanvas,
    ...opts,
  });
  fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), canvas.toBuffer('image/png'));
  return { label, timing };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('━━━ no-Snapshot foreground rectangle probe ━━━');
  console.log(`source: ${W}×${H} flat #5a6478, bindings=null\n`);

  const results = [];
  results.push(await variant('full', {}));
  results.push(await variant('no-haze', { hazeStrength: 0 }));
  results.push(await variant('no-bloom', { bloomStrength: 0 }));
  results.push(await variant('no-grain', { grainAmount: 0 }));
  results.push(await variant('no-atmospherics', { atmosphericsEnabled: false }));

  for (const r of results) {
    console.log(
      `${r.label.padEnd(18)} ` +
      `hazedPixels=${(r.timing.hazedPixels ?? 0).toString().padStart(7)} ` +
      `bloomFired=${r.timing.bloomFired ?? false} ` +
      `hazeMs=${(r.timing.hazeMs ?? 0).toString().padStart(5)} ` +
      `bloomMs=${(r.timing.bloomMs ?? 0).toString().padStart(5)} ` +
      `grainMs=${(r.timing.grainMs ?? 0).toString().padStart(5)}`
    );
  }
  console.log(`\nsaved: ${path.relative(ROOT, OUT_DIR)}`);
})();
