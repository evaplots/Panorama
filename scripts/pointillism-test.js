// Headless A3 perf + visual test for Phase 2.5 pointillism.
//
// Generates synthetic landscape source images at A3 @ 300 DPI (4961×3508 px),
// runs the pointillism transform with curated expressionist palettes, saves
// source + output PNGs to .iterations/<run>/, and writes timing.json + notes.
//
// Run: node scripts/pointillism-test.js [version]
// Default version: v0.2.

import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { applyPointillism } from '../src/style/Pointillism.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const A3_W = 4961;
const A3_H = 3508;

const VERSION = process.argv[2] || 'v0.2';

// Load curated expressionist palettes.
const palettes = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/style/palettes.json'), 'utf8'),
);

function makeAlpineSunset(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
  sky.addColorStop(0, '#f4d29a');
  sky.addColorStop(0.3, '#e6886a');
  sky.addColorStop(0.6, '#a64f6e');
  sky.addColorStop(1.0, '#3e2848');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(60, 50, 70, 0.7)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  for (let x = 0; x <= w; x += w / 30) {
    const y = h * (0.6 + 0.04 * Math.sin(x * 0.0007));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#1a1828';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  const peaks = [
    [w * 0.05, 0.80], [w * 0.18, 0.62], [w * 0.28, 0.74],
    [w * 0.42, 0.56], [w * 0.55, 0.71], [w * 0.68, 0.50],
    [w * 0.82, 0.68], [w * 0.95, 0.58],
  ];
  for (const [px, py] of peaks) ctx.lineTo(px, h * py);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Add per-pixel colour noise so flat regions have gradient texture
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0},${0.06 + Math.random() * 0.08})`;
    ctx.beginPath();
    ctx.arc(x, y, 30 + Math.random() * 100, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function makeCoastalTwilight(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#c4d8e6');
  sky.addColorStop(0.5, '#5e6a8a');
  sky.addColorStop(1, '#1f2440');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);

  const sea = ctx.createLinearGradient(0, h * 0.55, 0, h);
  sea.addColorStop(0, '#1f2845');
  sea.addColorStop(0.4, '#0f1830');
  sea.addColorStop(1, '#080d20');
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  ctx.fillStyle = 'rgba(255, 220, 180, 0.15)';
  ctx.fillRect(0, h * 0.545, w, h * 0.012);

  ctx.fillStyle = '#101830';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.58);
  ctx.lineTo(0, h);
  ctx.lineTo(w * 0.22, h);
  ctx.quadraticCurveTo(w * 0.18, h * 0.65, w * 0.05, h * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w, h * 0.58);
  ctx.lineTo(w, h);
  ctx.lineTo(w * 0.78, h);
  ctx.quadraticCurveTo(w * 0.82, h * 0.62, w * 0.95, h * 0.55);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * w;
    const y = h * 0.55 + Math.random() * h * 0.4;
    const len = 20 + Math.random() * 80;
    ctx.fillStyle = `rgba(120,140,180,${0.05 + Math.random() * 0.10})`;
    ctx.fillRect(x, y, len, 2);
  }
  return c;
}

function makeForestNoon(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.4);
  sky.addColorStop(0, '#a4c8e0');
  sky.addColorStop(1, '#dfe9d8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.4);

  ctx.fillStyle = '#3a5230';
  ctx.fillRect(0, h * 0.38, w, h * 0.05);
  ctx.fillStyle = '#2c4422';
  ctx.fillRect(0, h * 0.43, w, h * 0.25);

  const floor = ctx.createLinearGradient(0, h * 0.68, 0, h);
  floor.addColorStop(0, '#3e3220');
  floor.addColorStop(1, '#5a4830');
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * 0.68, w, h * 0.32);

  for (let i = 0; i < 70; i++) {
    const x = Math.random() * w;
    const yTop = h * (0.43 + Math.random() * 0.25);
    const trunkH = h * (0.15 + Math.random() * 0.25);
    const trunkW = 8 + Math.random() * 30;
    ctx.fillStyle = `rgb(${30 + Math.random() * 40}, ${20 + Math.random() * 30}, ${10 + Math.random() * 20})`;
    ctx.fillRect(x - trunkW / 2, yTop, trunkW, trunkH);
  }

  for (let i = 0; i < 600; i++) {
    const x = Math.random() * w;
    const y = h * (0.4 + Math.random() * 0.3);
    ctx.fillStyle = `rgba(${40 + Math.random() * 60}, ${70 + Math.random() * 50}, ${30 + Math.random() * 30}, 0.5)`;
    ctx.beginPath();
    ctx.arc(x, y, 30 + Math.random() * 80, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function makeStormSeascape(w, h) {
  // Dramatic stormy sea, low menacing sky, breaking wave crests.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Sky: heavy clouds with one tear of warm light
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0.0, '#3a3848');
  sky.addColorStop(0.4, '#504050');
  sky.addColorStop(0.55, '#a86848');
  sky.addColorStop(0.7, '#604055');
  sky.addColorStop(1.0, '#2a2838');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);

  // Sea: deep teal-violet roll
  const sea = ctx.createLinearGradient(0, h * 0.55, 0, h);
  sea.addColorStop(0, '#2a3050');
  sea.addColorStop(0.5, '#101830');
  sea.addColorStop(1, '#050810');
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  // Wave crests as horizontal foam streaks
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * w;
    const y = h * (0.56 + Math.random() * 0.40);
    const len = 40 + Math.random() * 200;
    const a = 0.10 + Math.random() * 0.25;
    ctx.fillStyle = `rgba(220, 215, 230, ${a})`;
    ctx.fillRect(x, y, len, 2 + Math.random() * 4);
  }
  // Diagonal rain hatching
  ctx.strokeStyle = 'rgba(180, 190, 210, 0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 30, y + 90);
    ctx.stroke();
  }
  return c;
}

function makeMountainTwilight(w, h) {
  // Cool blue-hour mountain, near-monochromatic, faint warmth on snow tops.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0.0, '#1c2440');
  sky.addColorStop(0.5, '#404a68');
  sky.addColorStop(1.0, '#5a647c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);

  // Distant range
  ctx.fillStyle = '#28304a';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.50);
  for (let x = 0; x <= w; x += w / 25) {
    const y = h * (0.48 + 0.05 * Math.sin(x * 0.0008 + 1.3));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.55);
  ctx.lineTo(0, h * 0.55);
  ctx.closePath();
  ctx.fill();

  // Closer range with pale snow caps
  const peaks = [
    [w * 0.05, 0.62, 0.40], [w * 0.18, 0.55, 0.32], [w * 0.30, 0.66, 0.45],
    [w * 0.45, 0.52, 0.30], [w * 0.58, 0.62, 0.42], [w * 0.72, 0.49, 0.28],
    [w * 0.86, 0.61, 0.40], [w * 0.97, 0.55, 0.34],
  ];
  ctx.fillStyle = '#1a2030';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.70);
  for (const [px, py] of peaks) ctx.lineTo(px, h * py);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Snow tops with the faintest warm tone
  ctx.fillStyle = 'rgba(220, 200, 175, 0.45)';
  for (const [px, py, snowY] of peaks) {
    ctx.beginPath();
    ctx.moveTo(px - 80, h * (py + 0.04));
    ctx.lineTo(px, h * py);
    ctx.lineTo(px + 80, h * (py + 0.04));
    ctx.closePath();
    ctx.fill();
  }

  // Foreground valley shadow
  const fog = ctx.createLinearGradient(0, h * 0.78, 0, h);
  fog.addColorStop(0, 'rgba(40, 50, 70, 0.0)');
  fog.addColorStop(1, 'rgba(20, 25, 40, 0.7)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  return c;
}

function makeUrbanDusk(w, h) {
  // City silhouette at twilight — warm sky, dark building stack with lit windows.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Sky: warm gold-orange at horizon dissolving to deep purple-blue at top
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
  sky.addColorStop(0, '#1c2240');
  sky.addColorStop(0.5, '#704868');
  sky.addColorStop(0.85, '#d88058');
  sky.addColorStop(1, '#e8a058');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.65);

  // Distant sun glow on horizon
  const sunGrad = ctx.createRadialGradient(w * 0.35, h * 0.62, 0, w * 0.35, h * 0.62, w * 0.25);
  sunGrad.addColorStop(0, 'rgba(255, 220, 150, 0.65)');
  sunGrad.addColorStop(1, 'rgba(255, 220, 150, 0)');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, h * 0.4, w, h * 0.35);

  // Cityscape: stack of building rectangles forming a skyline
  // Heights vary; some have visible window grids
  const baseLine = h * 0.65;
  const buildings = [];
  let cx = 0;
  while (cx < w) {
    const bw = 80 + Math.random() * 320;
    const bh = h * (0.10 + Math.random() * 0.30);
    buildings.push({ x: cx, w: bw, h: bh });
    cx += bw + Math.random() * 30;
  }
  for (const b of buildings) {
    const top = baseLine - b.h;
    // Building body — darken with slight variation
    const tone = 24 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${tone},${tone + 5},${tone + 18})`;
    ctx.fillRect(b.x, top, b.w, b.h);
    // Window grid: small lit warm rectangles, sparse
    const cols = Math.max(2, Math.floor(b.w / 22));
    const rows = Math.max(2, Math.floor(b.h / 28));
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        if (Math.random() < 0.42) {
          const wx = b.x + 6 + cc * (b.w - 12) / cols;
          const wy = top + 8 + r * (b.h - 16) / rows;
          const wsize = 4 + Math.random() * 4;
          const warmth = 200 + Math.floor(Math.random() * 55);
          ctx.fillStyle = `rgba(${warmth},${warmth - 50},${100 + Math.floor(Math.random() * 60)},0.85)`;
          ctx.fillRect(wx, wy, wsize, wsize * 0.6);
        }
      }
    }
  }

  // Foreground street / haze
  const fgGrad = ctx.createLinearGradient(0, h * 0.65, 0, h);
  fgGrad.addColorStop(0, '#1a1825');
  fgGrad.addColorStop(1, '#2a2030');
  ctx.fillStyle = fgGrad;
  ctx.fillRect(0, h * 0.65, w, h * 0.35);
  // Reflection streaks (wet pavement)
  for (let i = 0; i < 30; i++) {
    const sx = Math.random() * w;
    const len = 60 + Math.random() * 220;
    const sy = h * 0.78 + Math.random() * h * 0.18;
    ctx.fillStyle = `rgba(${180 + Math.random() * 60},${130 + Math.random() * 40},${80 + Math.random() * 40},${0.06 + Math.random() * 0.10})`;
    ctx.fillRect(sx, sy, len, 2 + Math.random() * 3);
  }
  return c;
}

function makeDesertNoon(w, h) {
  // Desert dune landscape under harsh midday sun.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Sky: pale bleached white-blue at top, hot peach near horizon
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#9bbac8');
  sky.addColorStop(0.6, '#dcd0b8');
  sky.addColorStop(1, '#f0c498');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);

  // Distant heat-shimmer haze layer on horizon
  ctx.fillStyle = 'rgba(255, 220, 170, 0.30)';
  ctx.fillRect(0, h * 0.50, w, h * 0.06);

  // Far dunes — light-warm beige
  ctx.fillStyle = '#d4a070';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.58);
  for (let x = 0; x <= w; x += w / 30) {
    const y = h * (0.56 + 0.025 * Math.sin(x * 0.0009 + 0.7));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.65);
  ctx.lineTo(0, h * 0.65);
  ctx.closePath();
  ctx.fill();

  // Mid dunes — warm sand
  ctx.fillStyle = '#c08858';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.68);
  for (let x = 0; x <= w; x += w / 20) {
    const y = h * (0.66 + 0.04 * Math.sin(x * 0.0014 + 1.5));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.78);
  ctx.lineTo(0, h * 0.78);
  ctx.closePath();
  ctx.fill();

  // Foreground dune with strong shadow side
  ctx.fillStyle = '#a06840';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.82);
  for (let x = 0; x <= w; x += w / 14) {
    const y = h * (0.80 + 0.06 * Math.sin(x * 0.0019 + 2.1));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Ripple texture across foreground
  ctx.strokeStyle = 'rgba(180, 130, 80, 0.16)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 200; i++) {
    const sx = Math.random() * w;
    const sy = h * 0.80 + Math.random() * h * 0.20;
    const len = 30 + Math.random() * 80;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + len * 0.3, sy - 4, sx + len * 0.7, sy + 4, sx + len, sy);
    ctx.stroke();
  }
  // Shadow side highlights
  for (let i = 0; i < 80; i++) {
    const sx = Math.random() * w;
    const sy = h * (0.66 + Math.random() * 0.30);
    ctx.fillStyle = `rgba(60, 35, 25, ${0.05 + Math.random() * 0.10})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 30 + Math.random() * 80, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function makeSnowBlizzard(w, h) {
  // Whiteout in a snow storm — almost-monochrome high-key whites and pale greys
  // with hints of slate and frozen blue. Diffuse forms, falling snow streaks,
  // a barely-visible distant peak. Designed to pair with Turner's atmospheric
  // fog/storm palette.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Sky: pale grey-white whiteout
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, '#dfe4ea');
  sky.addColorStop(0.5, '#eaedf0');
  sky.addColorStop(1, '#f4f3f1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.7);

  // Distant mountain mass dissolving into haze — barely visible
  ctx.fillStyle = 'rgba(150, 158, 168, 0.55)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.65);
  for (let x = 0; x <= w; x += w / 40) {
    const y = h * (0.62 + 0.04 * Math.sin(x * 0.001 + 0.5));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.7);
  ctx.lineTo(0, h * 0.7);
  ctx.closePath();
  ctx.fill();

  // Pine-tree silhouettes, even more diffuse, on the foreground line
  ctx.fillStyle = 'rgba(80, 95, 110, 0.45)';
  for (let i = 0; i < 18; i++) {
    const tx = w * (i / 17) + (Math.random() - 0.5) * w * 0.04;
    const ty = h * 0.78;
    const th = h * (0.06 + Math.random() * 0.08);
    const tw = th * 0.4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - tw / 2, ty + th);
    ctx.lineTo(tx + tw / 2, ty + th);
    ctx.closePath();
    ctx.fill();
  }

  // Foreground snow plain — high-key with slight cool tint
  const ground = ctx.createLinearGradient(0, h * 0.78, 0, h);
  ground.addColorStop(0, '#e9edf3');
  ground.addColorStop(1, '#d5d9df');
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);

  // Falling snow: lots of soft white streaks at varied angles
  for (let i = 0; i < 1800; i++) {
    const sx = Math.random() * w;
    const sy = Math.random() * h;
    const len = 12 + Math.random() * 28;
    const angle = -Math.PI * 0.32 + (Math.random() - 0.5) * 0.18;
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.30 + Math.random() * 0.50})`;
    ctx.lineWidth = 1 + Math.random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx, sy + dy);
    ctx.stroke();
  }
  // A few darker ice-blue accents for depth
  for (let i = 0; i < 80; i++) {
    const sx = Math.random() * w;
    const sy = Math.random() * h * 0.85;
    ctx.fillStyle = `rgba(180, 200, 220, ${0.10 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 30 + Math.random() * 80, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function makeCanyon(w, h) {
  // Red-rock canyon with dramatic late-afternoon side light. Sun coming from
  // the right, casting long shadows across the canyon floor. Distant cliff
  // tier in atmospheric perspective; near walls in saturated red-orange.
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Sky: warm-pale near horizon, deeper above
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  sky.addColorStop(0, '#7a86a8');
  sky.addColorStop(0.6, '#c4a098');
  sky.addColorStop(1, '#e8c08a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.45);

  // Distant rim — soft red-violet in atmospheric perspective
  ctx.fillStyle = '#9a6868';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.42);
  for (let x = 0; x <= w; x += w / 25) {
    const y = h * (0.40 + 0.025 * Math.sin(x * 0.0011 + 0.4));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.50);
  ctx.lineTo(0, h * 0.50);
  ctx.closePath();
  ctx.fill();

  // Mid cliff — warmer terra-cotta
  ctx.fillStyle = '#c46838';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.55);
  // Carved step-shape canyon edge
  const midY = h * 0.55;
  ctx.lineTo(w * 0.10, midY - 60);
  ctx.lineTo(w * 0.20, midY - 30);
  ctx.lineTo(w * 0.32, midY - 80);
  ctx.lineTo(w * 0.45, midY - 40);
  ctx.lineTo(w * 0.55, midY - 70);
  ctx.lineTo(w * 0.70, midY - 30);
  ctx.lineTo(w * 0.82, midY - 60);
  ctx.lineTo(w * 0.95, midY - 40);
  ctx.lineTo(w, midY - 50);
  ctx.lineTo(w, h * 0.68);
  ctx.lineTo(0, h * 0.68);
  ctx.closePath();
  ctx.fill();

  // Near walls: bright sun-lit red-orange (right side) vs shadow side (left)
  // Right wall — sunlit
  ctx.fillStyle = '#e87838';
  ctx.beginPath();
  ctx.moveTo(w * 0.55, h * 0.65);
  ctx.lineTo(w, h * 0.50);
  ctx.lineTo(w, h);
  ctx.lineTo(w * 0.55, h);
  ctx.closePath();
  ctx.fill();
  // Left wall — shadow side
  ctx.fillStyle = '#6a3828';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.55);
  ctx.lineTo(w * 0.45, h * 0.70);
  ctx.lineTo(w * 0.45, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Canyon floor — dark red-brown with shadow gradient
  const floor = ctx.createLinearGradient(0, h * 0.78, 0, h);
  floor.addColorStop(0, '#5a3024');
  floor.addColorStop(1, '#382018');
  ctx.fillStyle = floor;
  ctx.fillRect(w * 0.30, h * 0.78, w * 0.40, h * 0.22);

  // Long diagonal shadow streaks from sun-side cliffs across the floor
  ctx.fillStyle = 'rgba(20, 10, 8, 0.45)';
  for (let i = 0; i < 8; i++) {
    const sx = w * (0.30 + i * 0.05);
    ctx.beginPath();
    ctx.moveTo(sx, h * 0.78);
    ctx.lineTo(sx + 80, h * 0.78);
    ctx.lineTo(sx - 60, h);
    ctx.lineTo(sx - 140, h);
    ctx.closePath();
    ctx.fill();
  }

  // Texture: sandstone striations on cliff walls
  ctx.strokeStyle = 'rgba(255, 200, 140, 0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 80; i++) {
    const sx = w * (0.55 + Math.random() * 0.45);
    const sy = h * (0.55 + Math.random() * 0.40);
    const len = 50 + Math.random() * 200;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + len, sy + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  // Shadow-side striations
  ctx.strokeStyle = 'rgba(180, 100, 60, 0.18)';
  for (let i = 0; i < 80; i++) {
    const sx = Math.random() * w * 0.45;
    const sy = h * (0.55 + Math.random() * 0.40);
    const len = 50 + Math.random() * 200;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + len, sy + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  return c;
}

// Standard scene-palette pairings. v1.10 adds canyon → Marc-symbolic (red rock
// + saturated sky pairs with Marc's primary-symbolism palette; Marc finally
// has a scene assignment, leaving only Klimt as palette-only).
const SCENES = [
  { name: 'alpine-sunset', factory: makeAlpineSunset, paletteKey: 'kirchner-alpine' },
  { name: 'coastal-twilight', factory: makeCoastalTwilight, paletteKey: 'munch-sunset' },
  { name: 'forest-noon', factory: makeForestNoon, paletteKey: 'soutine-landscape' },
  { name: 'storm-seascape', factory: makeStormSeascape, paletteKey: 'nolde-storm' },
  { name: 'mountain-twilight', factory: makeMountainTwilight, paletteKey: 'whistler-nocturne' },
  { name: 'urban-dusk', factory: makeUrbanDusk, paletteKey: 'whistler-nocturne' },
  { name: 'desert-noon', factory: makeDesertNoon, paletteKey: 'macke-tunisian' },
  { name: 'snow-blizzard', factory: makeSnowBlizzard, paletteKey: 'turner-fog' },
  { name: 'canyon', factory: makeCanyon, paletteKey: 'marc-symbolic' },
];

// v0.5 palette-comparison: ONE source scene, ALL palettes.
// Demonstrates that palette alone changes emotional content of the painting.
const COMPARISON_SCENE = { name: 'alpine-sunset', factory: makeAlpineSunset };

async function main() {
  const runDir = path.join(ROOT, '.iterations', `2026-04-29-pointillism-${VERSION}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\n=== Pointillism ${VERSION} — autonomous A3 test ===`);
  console.log(`Output dir: ${runDir}`);
  console.log(`Resolution: ${A3_W}×${A3_H} (${(A3_W * A3_H / 1e6).toFixed(2)} MP)\n`);

  // Comparison mode: ONE source × all palettes (demonstrates palette = signature).
  // Triggered by v0.5 (legacy), or by passing "compare" as the 2nd CLI arg, or by
  // any version label ending in "-comp".
  const compareArg = process.argv[3] === 'compare';
  const isComparison =
    VERSION === 'v0.5' || VERSION.endsWith('-comp') || compareArg;

  // Optional CLI flags:
  //   --density=0.10        → override DEFAULTS.density
  //   --brush-stroke=3.5    → override DEFAULTS.brushStrokeFactor (length per √magnitude)
  //   --width-mm=0.7        → override DEFAULTS.brushWidthMm (physical stroke width in mm)
  //   --dpi=300             → override DEFAULTS.dpi (used for mm → px conversion)
  //   --opacity=0.5         → override DEFAULTS.brushOpacity
  //   --temperature=20      → override DEFAULTS.paletteTemperature (lower = sharper palette)
  //   --filter=name1,name2  → only run scenes whose name contains one of these substrings
  //   --curated             → use the SCENES[i].paletteKey curated palette
  //                           (default v1.1+: extract from source via median-cut)
  //   --palette=KEY         → override curated palette for ALL scenes in this run
  //                           (e.g. --palette=whistler-nocturne). Implies --curated.
  //                           Output filenames get a __KEY suffix to distinguish.
  //   --no-median           → skip the 11×11 median underpainting (cheaper, less faithful)
  //   --no-smooth           → skip Gaussian gradient smoothing
  //   --no-extend           → skip palette saturation+hue extension
  const optsOverride = {};
  let sceneFilter = null;
  let useCurated = false;
  let paletteOverride = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--density=')) optsOverride.density = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--brush-stroke=')) optsOverride.brushStrokeFactor = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--width-mm=')) optsOverride.brushWidthMm = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--dpi=')) optsOverride.dpi = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--opacity=')) optsOverride.brushOpacity = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--temperature=')) optsOverride.paletteTemperature = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--filter=')) sceneFilter = arg.split('=')[1].split(',');
    if (arg === '--curated') useCurated = true;
    if (arg.startsWith('--palette=')) {
      paletteOverride = arg.split('=')[1];
      useCurated = true;
    }
    if (arg === '--no-median') optsOverride.applyMedianUnderpaint = false;
    if (arg === '--no-smooth') optsOverride.smoothGradientField = false;
    if (arg === '--no-extend') optsOverride.extendPalette = false;
    if (arg === '--manual-raster') optsOverride.manualRaster = true;
  }

  let runs = isComparison
    ? Object.keys(palettes).map(paletteKey => ({
        name: `${COMPARISON_SCENE.name}__${paletteKey}`,
        factory: COMPARISON_SCENE.factory,
        paletteKey,
      }))
    : SCENES;
  if (sceneFilter) {
    runs = runs.filter(r => sceneFilter.some(f => r.name.includes(f)));
  }

  const allTimings = [];

  for (const run of runs) {
    const { factory } = run;
    const effectiveKey = paletteOverride || run.paletteKey;
    const palette = palettes[effectiveKey];
    if (!palette) {
      console.warn(`Skipping ${run.name}: unknown palette key "${effectiveKey}"`);
      continue;
    }
    // Append palette suffix to scene name when override is active so filenames disambiguate.
    const name = paletteOverride ? `${run.name}__${effectiveKey}` : run.name;
    console.log(`--- ${name} (palette: ${palette.name}) ---`);

    const t0 = performance.now();
    const src = factory(A3_W, A3_H);
    const tSrc = performance.now();
    console.log(`  source generation: ${(tSrc - t0).toFixed(0)} ms`);

    const srcPath = path.join(runDir, `${name}-source.png`);
    fs.writeFileSync(srcPath, src.toBuffer('image/png'));

    const opts = {
      createCanvas,
      // No wind override in v0.3+ — strokes follow image gradient so
      // mountains, horizons, tree trunks become visible structural features.
      // Wind binding will return as a BIAS (windInfluence > 0) once real
      // weather data ships from the Weather module.
      seed: 0xC0FFEE ^ name.length,
      ...optsOverride,
    };
    // Default v1.1+: palette extracted from source via median-cut. The curated
    // painter palettes from src/style/palettes.json are opt-in via --curated.
    if (useCurated) {
      opts.palette = palette.colors;
    }
    const { canvas: stylized, timing } = await applyPointillism(src, opts);
    console.log(`  pointillism: ${timing.totalMs} ms ` +
      `(gradient ${timing.gradientMs}, ${timing.strokeCount.toLocaleString()} strokes ${timing.strokesMs} ms)`);

    const outPath = path.join(runDir, `${name}-pointillism.png`);
    fs.writeFileSync(outPath, stylized.toBuffer('image/png'));

    allTimings.push({
      scene: name,
      palette: palette.name,
      paletteRef: palette.reference,
      timing,
      sourcePath: path.relative(ROOT, srcPath),
      outputPath: path.relative(ROOT, outPath),
    });
    console.log('');
  }

  const summary = {
    version: VERSION,
    runAt: new Date().toISOString(),
    resolution: { width: A3_W, height: A3_H, megapixels: +(A3_W * A3_H / 1e6).toFixed(2) },
    nodeVersion: process.version,
    platform: process.platform,
    scenes: allTimings,
    averageTotalMs: +(allTimings.reduce((s, t) => s + t.timing.totalMs, 0) / allTimings.length).toFixed(0),
  };
  fs.writeFileSync(
    path.join(runDir, 'timing.json'),
    JSON.stringify(summary, null, 2),
  );

  const avgTotal = summary.averageTotalMs;
  const avgSec = avgTotal / 1000;
  let verdict;
  if (avgTotal < 30000) verdict = 'PASS — well within the 30s user-tolerance bar.';
  else if (avgTotal < 60000) verdict = 'BORDERLINE — under 60s but slow enough that a progress UI is mandatory.';
  else verdict = 'FAIL — over 60s. Replan: Web Worker, tiled, or sub-sample the grid more aggressively.';

  console.log(`=== SUMMARY ===`);
  console.log(`Average A3 transform: ${avgTotal} ms (${avgSec.toFixed(1)} s)`);
  console.log(`Verdict: ${verdict}\n`);

  const notes = `# Pointillism ${VERSION} — autonomous A3 test (${new Date().toISOString()})

## What this is

Headless A3 @ 300 DPI test of \`src/style/Pointillism.js\` (${VERSION}).
Three synthetic landscape source images, each rendered with a different
curated expressionist palette:

- **alpine-sunset** → ${SCENES[0].paletteKey} (${palettes[SCENES[0].paletteKey].reference})
- **coastal-twilight** → ${SCENES[1].paletteKey} (${palettes[SCENES[1].paletteKey].reference})
- **forest-noon** → ${SCENES[2].paletteKey} (${palettes[SCENES[2].paletteKey].reference})

## Verdict (perf)

**${verdict}**

Average over three scenes: ${avgTotal} ms (${avgSec.toFixed(1)} s).

## ${VERSION} algorithm changes (vs prior)

- Brush thickness 6 px (was 3 px in v0.1) — strokes actually read at A3
- brushStrokeFactor 1.8 (was 0.5) — stronger gradient-driven length variation
- brushOpacity 0.62 (was 0.85) — strokes layer like real paint
- density 0.04 (was 0.08) — fewer strokes, but each covers more area
- Weighted-random palette sampling via softmax (was nearest-colour) — produces the Seurat "vibration" effect; flat regions become mixed instead of solid bands

## Files

For each scene:
- \`<scene>-source.png\` — synthetic A3 input
- \`<scene>-pointillism.png\` — pointillism output
Plus \`timing.json\` for the perf breakdown.

## Caveats (still true after v0.2)

- Synthetic sources, not real Three.js renders. Real visual QA in-browser is still pending.
- Node-canvas perf is a proxy for browser perf.
- Wind-direction binding is a randomised stub per scene (no Weather module yet).
`;
  fs.writeFileSync(path.join(runDir, 'notes.md'), notes);
  console.log(`Notes written: ${path.join(runDir, 'notes.md')}\n`);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
