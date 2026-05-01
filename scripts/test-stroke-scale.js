// Unit test for the stroke-scale fix in Pointillism.js.
// Run: node scripts/test-stroke-scale.js
//
// Verifies that effective DPI is derived from canvas dimensions + target
// paper size, so the 0.7 mm physical-stroke contract holds at any source
// resolution — the same as it did when DPI was hardcoded to 300 for A3.

import assert from 'node:assert/strict';
import { computeEffectiveDpi } from '../src/style/Pointillism.js';

const MM_PER_INCH = 25.4;
const BRUSH_WIDTH_MM = 0.7;

function brushThicknessPx(dpi) {
  return Math.max(1, Math.round(BRUSH_WIDTH_MM * dpi / MM_PER_INCH));
}

const cases = [
  // A3 native @ 300 DPI — the baseline that hardcoded dpi=300 used to assume.
  // Canvas short edge 3508 px, A3 short edge 297 mm = 11.6929 in →
  // 3508 / 11.6929 = 300.02 DPI → brush 0.7 × 300 / 25.4 = 8.27 → round 8.
  {
    label: 'A3 native — 3508×4961 portrait → 300 DPI / 8 px',
    canvas: [3508, 4961],
    paperSize: 'A3',
    orientation: 'portrait',
    expectedDpi: 300,
    expectedBrushPx: 8,
    dpiTolerance: 0.5,
  },

  // Screen-resolution preview at A3 target. Canvas 1600×1131, short edge
  // 1131 px / 11.6929 in = 96.7 DPI. Brush 0.7 × 96.7 / 25.4 = 2.67 → 3 px.
  // Note: the brief mentioned "~137 DPI / ~4 px" for this case, but those
  // numbers correspond to A4 portrait (see next case), not A3. The formula
  // canvasShortEdgePx / paperShortEdgeInches yields 96.75 for 1131 + A3.
  {
    label: 'Screen preview at A3 — 1600×1131 portrait → ~96.75 DPI / 3 px',
    canvas: [1600, 1131],
    paperSize: 'A3',
    orientation: 'portrait',
    expectedDpi: 96.75,
    expectedBrushPx: 3,
    dpiTolerance: 0.1,
  },

  // Same canvas at A4 target. A4 short edge 210 mm = 8.2677 in →
  // 1131 / 8.2677 = 136.8 DPI → brush 3.77 → 4 px. This is the regression
  // case whose numbers (137/4) were quoted in the v2-step3.5 brief.
  {
    label: 'Screen preview at A4 — 1600×1131 portrait → ~136.8 DPI / 4 px',
    canvas: [1600, 1131],
    paperSize: 'A4',
    orientation: 'portrait',
    expectedDpi: 136.8,
    expectedBrushPx: 4,
    dpiTolerance: 0.1,
  },

  // A2 native at 300 DPI — short edge 4961 / 16.5354 in = 300 DPI / 8 px.
  // Confirms the formula scales the same way for the A2 paper size.
  {
    label: 'A2 native — 4961×7016 portrait → 300 DPI / 8 px',
    canvas: [4961, 7016],
    paperSize: 'A2',
    orientation: 'portrait',
    expectedDpi: 300,
    expectedBrushPx: 8,
    dpiTolerance: 0.5,
  },

  // Landscape canvas: min(w,h) handles whichever dimension is short, so
  // the result matches the portrait equivalent for matching paper aspect.
  {
    label: 'A3 landscape canvas — 4961×3508 → 300 DPI / 8 px',
    canvas: [4961, 3508],
    paperSize: 'A3',
    orientation: 'landscape',
    expectedDpi: 300,
    expectedBrushPx: 8,
    dpiTolerance: 0.5,
  },
];

let failed = 0;
for (const c of cases) {
  const dpi = computeEffectiveDpi(c.canvas[0], c.canvas[1], c.paperSize, c.orientation);
  const brush = brushThicknessPx(dpi);
  try {
    assert.ok(
      Math.abs(dpi - c.expectedDpi) <= c.dpiTolerance,
      `DPI ${dpi.toFixed(2)} not within ${c.dpiTolerance} of ${c.expectedDpi}`,
    );
    assert.equal(brush, c.expectedBrushPx, `brush px ${brush} !== ${c.expectedBrushPx}`);
    console.log(`  PASS  ${c.label}  (DPI=${dpi.toFixed(2)}, brush=${brush})`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${c.label}  ${e.message}`);
  }
}

// Bad paper size should throw.
try {
  computeEffectiveDpi(1000, 1000, 'A1', 'portrait');
  console.error(`  FAIL  unknown paperSize should throw`);
  failed++;
} catch (_e) {
  console.log(`  PASS  unknown paperSize throws`);
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + 1} tests passed.`);
