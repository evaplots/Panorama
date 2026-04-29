// Build a museum-pitch hero image: 3×2 grid of strongest pointillism outputs.
// Two galleries available; pick via CLI:
//   node scripts/build-gallery.js best-of-mixed   (default — range across iterations)
//   node scripts/build-gallery.js v1.4-curation   (cohesive v1.4 sweet-spot picks)
//
// Each cell is captioned with painter + scene. Output is A3 @ 300 DPI.

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ITER = path.join(ROOT, '.iterations');

const A3_W = 4961;
const A3_H = 3508;
const PADDING = 18;

const GALLERIES = {
  // Best-of-mixed: shows the project's full range across iteration history.
  'best-of-mixed': {
    headline: 'Panorama — pointillism iteration gallery, Phase 2.5',
    picks: [
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
    ],
  },
  // The six EXHIBITION.md plates as a 3×2 contact sheet. Distinct from
  // best-of-mixed in that this gallery's selection mirrors EXHIBITION.md
  // exactly — same six picks, same six titles. Use this as the "one image
  // that summarises the curated portfolio submission" pitch image.
  'exhibition-six': {
    headline: 'Panorama — exhibition portfolio (six plates)',
    cols: 3,
    rows: 2,
    captionHeight: 92,
    picks: [
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/storm-seascape-pointillism.png',
        title: 'I. Sturm',
        sub: 'storm seascape, after Nolde',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/urban-dusk-pointillism.png',
        title: 'II. Battersea, Imagined',
        sub: 'urban dusk, after Whistler',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/alpine-sunset-pointillism.png',
        title: 'III. Alpine Vibration',
        sub: 'alpine sunset, after Kirchner',
      },
      {
        src: '2026-04-29-pointillism-v1.9-snow-blizzard/snow-blizzard-pointillism.png',
        title: 'IV. Snow Storm',
        sub: 'whiteout blizzard, after Turner',
      },
      {
        src: '2026-04-29-pointillism-v1.10-canyon/canyon-pointillism.png',
        title: 'V. Red Walls',
        sub: 'desert canyon, after Marc',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/coastal-twilight-pointillism.png',
        title: 'VI. Anxious Twilight',
        sub: 'coastal twilight, after Munch',
      },
    ],
  },
  // 3×3 nine-scene canon — every scene-paired output at v1.4 expressionist
  // settings, post canyon and snow-blizzard additions. Marc and Turner now
  // have scene assignments; only Klimt remains palette-only.
  // This is the canonical "every geography, every painter who got a scene"
  // image — cycle 19's update of the eight-scenes layout.
  'v1.4-nine-scenes': {
    headline: 'Panorama v1.4 — nine geographies, eight painters',
    cols: 3,
    rows: 3,
    captionHeight: 84,
    picks: [
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/alpine-sunset-pointillism.png',
        title: 'Kirchner — alpine sunset',
        sub: 'ultramarine vs cadmium tensions',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/coastal-twilight-pointillism.png',
        title: 'Munch — coastal twilight',
        sub: 'anxious yellow-vs-purple horizon',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/forest-noon-pointillism.png',
        title: 'Soutine — forest noon',
        sub: 'gestural earth, vertical trunks',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/storm-seascape-pointillism.png',
        title: 'Nolde — storm seascape',
        sub: 'blood-orange horizon over violet sea',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/mountain-twilight-pointillism.png',
        title: 'Whistler — mountain twilight',
        sub: 'whisper-quiet blue-hour with gold flecks',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/urban-dusk-pointillism.png',
        title: 'Whistler — urban dusk',
        sub: 'Battersea-style night, golden window glow',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/desert-noon-pointillism.png',
        title: 'Macke — desert noon',
        sub: 'sun-drenched Tunisian dunes',
      },
      {
        src: '2026-04-29-pointillism-v1.9-snow-blizzard/snow-blizzard-pointillism.png',
        title: 'Turner — snow blizzard',
        sub: 'whiteout dissolving into dark treeline',
      },
      {
        src: '2026-04-29-pointillism-v1.10-canyon/canyon-pointillism.png',
        title: 'Marc — red-rock canyon',
        sub: 'sunlit cliff vs shadowed wall, primary tensions',
      },
    ],
  },
  // 4×2 eight-cell scene-pairing showcase. Seven scene-paired outputs at v1.4
  // expressionist settings + one Marc-on-alpine cell to add the primary-tension
  // register that the seven scene pairings don't include. The most balanced
  // single-image demonstration of "different geographies, the right painter
  // for each, plus one brightness contrast."
  'v1.4-eight-scenes': {
    headline: 'Panorama v1.4 — seven geographies, one extra register',
    cols: 4,
    rows: 2,
    captionHeight: 84,
    picks: [
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/alpine-sunset-pointillism.png',
        title: 'Kirchner — alpine sunset',
        sub: 'ultramarine vs cadmium tensions',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/coastal-twilight-pointillism.png',
        title: 'Munch — coastal twilight',
        sub: 'anxious yellow-vs-purple horizon',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/forest-noon-pointillism.png',
        title: 'Soutine — forest noon',
        sub: 'gestural earth, vertical trunks',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/storm-seascape-pointillism.png',
        title: 'Nolde — storm seascape',
        sub: 'blood-orange horizon over violet sea',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/mountain-twilight-pointillism.png',
        title: 'Whistler — mountain twilight',
        sub: 'whisper-quiet blue-hour with gold flecks',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/urban-dusk-pointillism.png',
        title: 'Whistler — urban dusk',
        sub: 'Battersea-style night, golden window glow',
      },
      {
        src: '2026-04-29-pointillism-v1.8-7scene-expressionist/desert-noon-pointillism.png',
        title: 'Macke — desert noon',
        sub: 'sun-drenched Tunisian dunes',
      },
      {
        src: '2026-04-29-pointillism-v1.6-palette-comp/alpine-sunset__marc-symbolic-pointillism.png',
        title: 'Marc — primary symbolism',
        sub: 'Der Blaue Reiter on alpine source',
      },
    ],
  },
  // 3×3 nine-painter showcase using v1.4 settings on the alpine-sunset source
  // (one source × all 9 curated palettes — same algorithm, palette is the variable).
  'v1.4-nine-painters': {
    headline: 'Panorama v1.4 — nine painters, one source (Alpine sunset)',
    cols: 3,
    rows: 3,
    captionHeight: 84,
    picks: [
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__nolde-storm-pointillism.png',
        title: 'Nolde — storm',
        sub: 'blood-orange horizon over violet sea',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__munch-sunset-pointillism.png',
        title: 'Munch — anxious sunset',
        sub: 'complementary tensions, charged sky',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__kirchner-alpine-pointillism.png',
        title: 'Kirchner — alpine cool',
        sub: 'ultramarine vs cadmium tensions',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__soutine-landscape-pointillism.png',
        title: 'Soutine — gestural earth',
        sub: 'visceral umbers and sour greens',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__marc-symbolic-pointillism.png',
        title: 'Marc — primary symbolism',
        sub: 'Der Blaue Reiter saturated triad',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__whistler-nocturne-pointillism.png',
        title: 'Whistler — nocturne',
        sub: 'whisper-quiet gold on blue',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__turner-fog-pointillism.png',
        title: 'Turner — fog and atmosphere',
        sub: 'cream and pink dissolving into haze',
      },
      {
        src: '2026-04-29-pointillism-v1.6-palette-comp/alpine-sunset__klimt-golden-pointillism.png',
        title: 'Klimt — golden / ornamental',
        sub: 'gold leaf, jewel-tone emerald, rose',
      },
      {
        src: '2026-04-29-pointillism-v1.6-palette-comp/alpine-sunset__macke-tunisian-pointillism.png',
        title: 'Macke — Tunisian sun',
        sub: 'bright Mediterranean orange and blue',
      },
    ],
  },
  // v1.4 curation: the cohesive recommended-preset showcase.
  // Five from v1.4-mid-stroke + one Marc carryover from v1.3 (v1.4 doesn't have a Marc run yet).
  'v1.4-curation': {
    headline: 'Panorama v1.4 — five scenes, museum-bar at PASS perf',
    picks: [
      {
        src: '2026-04-29-pointillism-v1.4-mid-stroke/storm-seascape-pointillism.png',
        title: 'Nolde — storm seascape',
        sub: 'v1.4 sweet spot: 1.2 mm strokes, blood-orange horizon over violet sea',
      },
      {
        src: '2026-04-29-pointillism-v1.4-mid-stroke/coastal-twilight-pointillism.png',
        title: 'Munch — anxious twilight',
        sub: 'v1.4 sweet spot: complementary tensions, decisive horizon',
      },
      {
        src: '2026-04-29-pointillism-v1.4-mid-stroke/mountain-twilight-pointillism.png',
        title: 'Whistler — alpine nocturne',
        sub: 'v1.4 sweet spot: whisper-quiet, gold flecks on blue',
      },
      {
        src: '2026-04-29-pointillism-v1.4-mid-stroke/forest-noon-pointillism.png',
        title: 'Soutine — gestural forest',
        sub: 'v1.4 sweet spot: vertical trunks in textured earth',
      },
      {
        src: '2026-04-29-pointillism-v1.4-mid-stroke/alpine-sunset-pointillism.png',
        title: 'Kirchner — alpine cool',
        sub: 'v1.4 sweet spot: ultramarine vs cadmium tensions',
      },
      {
        src: '2026-04-29-pointillism-v1.5-palette-comp/alpine-sunset__marc-symbolic-pointillism.png',
        title: 'Marc — primary symbolism',
        sub: 'v1.4 settings: structured Der Blaue Reiter primaries',
      },
    ],
  },
};

const GALLERY_NAME = process.argv[2] || 'best-of-mixed';
const GALLERY = GALLERIES[GALLERY_NAME];
if (!GALLERY) {
  console.error(`Unknown gallery: ${GALLERY_NAME}. Options: ${Object.keys(GALLERIES).join(', ')}`);
  process.exit(1);
}
const PICKS = GALLERY.picks;

async function main() {
  const outDirName = GALLERY_NAME === 'best-of-mixed'
    ? '2026-04-29-best-of-gallery'
    : `2026-04-29-best-of-${GALLERY_NAME}`;
  const outDir = path.join(ITER, outDirName);
  fs.mkdirSync(outDir, { recursive: true });

  const COLS = GALLERY.cols ?? 3;
  const ROWS = GALLERY.rows ?? 2;
  const CAPTION_HEIGHT = GALLERY.captionHeight ?? 92;

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

    // Caption strip — font sizes scale slightly with caption height
    const capY = y + imgH;
    ctx.fillStyle = '#1d181c';
    ctx.fillRect(x, capY, cellW, CAPTION_HEIGHT);
    ctx.fillStyle = '#f3eee6';
    const titleSize = Math.max(20, Math.round(CAPTION_HEIGHT * 0.32));
    const subSize = Math.max(15, Math.round(CAPTION_HEIGHT * 0.24));
    ctx.font = `bold ${titleSize}px serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(pick.title, x + 18, capY + 12);
    ctx.fillStyle = '#a89e8d';
    ctx.font = `${subSize}px serif`;
    ctx.fillText(pick.sub, x + 18, capY + 16 + titleSize + 4);

    console.log(`  cell ${i + 1}/${PICKS.length}: ${pick.title}`);
  }

  // Header strip overlaid on top edge
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, A3_W, 94);
  ctx.fillStyle = '#f3eee6';
  ctx.font = 'italic 36px serif';
  ctx.textBaseline = 'top';
  ctx.fillText(GALLERY.headline, PADDING + 4, 24);

  const outPath = path.join(outDir, 'best-of-6.png');
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`\nWrote ${outPath}`);
  console.log(`Resolution: ${A3_W}×${A3_H} (A3 @ 300 DPI)`);
}

main().catch(e => { console.error(e); process.exit(1); });
