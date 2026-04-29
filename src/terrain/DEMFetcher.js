import { Cache } from '../data/Cache.js';
import { APIS } from '../config.js';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchBuffer(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(2 ** attempt * 1000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(2 ** attempt * 500);
    }
  }
}

/**
 * Decodes a terrarium-encoded PNG buffer to Float32Array of heights.
 * height = R*256 + G + B/256 - 32768
 */
async function decodeTerrarium(buffer) {
  const blob = new Blob([buffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);

  const heights = new Float32Array(w * h);
  for (let i = 0; i < heights.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    heights[i] = r * 256 + g + b / 256 - 32768;
  }
  return { heights, width: w, height: h };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {Promise<{heights: Float32Array, width: number, height: number}>}
 */
export async function fetchTile(x, y, z) {
  const key = `dem:${z}/${x}/${y}`;
  return Cache.dedupe(key, async () => {
    const cached = await Cache.get(key);
    if (cached) return cached;

    const url = `${APIS.awsTerrain}/${z}/${x}/${y}.png`;
    const buffer = await fetchBuffer(url);
    const tile = await decodeTerrarium(buffer);
    await Cache.set(key, tile, 30 * 86400e3);
    return tile;
  });
}
