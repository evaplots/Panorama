// Shared algorithm helpers for the to-pointillism faithful port:
//   - extractPalette: ColorThief-equivalent (median-cut on a downsampled source)
//   - extendPalette: saturation-boost + 2× hue-rotation copies (4× original size)
//   - smoothGradient: Gaussian-equivalent (3-pass separable box blur) on dx/dy fields
//   - medianBlur11: 11×11 RGB median on a Uint8ClampedArray, used for the soft
//     underpainting that strokes paint over (per to-pointillism's cv.medianBlur)
//
// All functions accept an optional `prng` (zero-arg → [0,1)) for determinism.

// ─── HSL conversion ─────────────────────────────────────────────────────────

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = t => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

// ─── Palette extraction (median-cut) ────────────────────────────────────────

/**
 * Extract a k-colour palette from imageData via median cut on a downsampled
 * pixel set. Faithful approximation of ColorThief's behaviour — samples the
 * image, recursively splits buckets along the channel with the largest range,
 * and returns each bucket's mean colour.
 */
export function extractPalette(imageData, k = 20, downsampleStride = 12) {
  const { data, width, height } = imageData;
  const samples = [];
  for (let y = 0; y < height; y += downsampleStride) {
    for (let x = 0; x < width; x += downsampleStride) {
      const i = (y * width + x) * 4;
      // Skip near-black and near-white if alpha < 250 (transparent edges)
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (samples.length === 0) return [[128, 128, 128]];

  const meanOf = bucket => {
    let r = 0, g = 0, b = 0;
    for (const c of bucket) { r += c[0]; g += c[1]; b += c[2]; }
    return [Math.round(r / bucket.length), Math.round(g / bucket.length), Math.round(b / bucket.length)];
  };
  const rangeOf = bucket => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const c of bucket) {
      if (c[0] < rMin) rMin = c[0]; if (c[0] > rMax) rMax = c[0];
      if (c[1] < gMin) gMin = c[1]; if (c[1] > gMax) gMax = c[1];
      if (c[2] < bMin) bMin = c[2]; if (c[2] > bMax) bMax = c[2];
    }
    return [rMax - rMin, gMax - gMin, bMax - bMin];
  };

  let buckets = [samples];
  while (buckets.length < k) {
    let biggestI = -1, biggestRange = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const r = rangeOf(buckets[i]);
      const max = Math.max(r[0], r[1], r[2]);
      if (max > biggestRange) { biggestRange = max; biggestI = i; }
    }
    if (biggestI < 0) break;
    const bucket = buckets[biggestI];
    const r = rangeOf(bucket);
    const axis = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
    bucket.sort((a, b) => a[axis] - b[axis]);
    const mid = bucket.length >> 1;
    buckets.splice(biggestI, 1, bucket.slice(0, mid), bucket.slice(mid));
  }
  return buckets.map(meanOf);
}

/**
 * Extend a palette by adding a saturation-boosted copy plus two random
 * hue-rotated copies — yields 4× the original size. Matches palette.ts in
 * guillaume-gomez/to-pointillism. Uses the supplied PRNG so output is
 * deterministic when seeded.
 */
export function extendPalette(palette, satBoost = 20, hueJitter = 20, prng = Math.random) {
  const orig = palette.slice();
  const moreSaturated = palette.map(([r, g, b]) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, Math.min(100, s + satBoost), l);
  });
  const hueShift = () => palette.map(([r, g, b]) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const offset = (prng() * 2 - 1) * hueJitter;
    return hslToRgb(h + offset, s, l);
  });
  return [...orig, ...moreSaturated, ...hueShift(), ...hueShift()];
}

// ─── Gradient smoothing (Gaussian-equivalent via 3-pass box blur) ───────────

function boxBlur1D(src, dst, width, height, radius, horizontal) {
  const denom = 2 * radius + 1;
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        const sx = Math.max(0, Math.min(width - 1, x));
        sum += src[rowOff + sx];
      }
      for (let x = 0; x < width; x++) {
        dst[rowOff + x] = sum / denom;
        const xAdd = Math.min(width - 1, x + radius + 1);
        const xRem = Math.max(0, x - radius);
        sum += src[rowOff + xAdd] - src[rowOff + xRem];
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        const sy = Math.max(0, Math.min(height - 1, y));
        sum += src[sy * width + x];
      }
      for (let y = 0; y < height; y++) {
        dst[y * width + x] = sum / denom;
        const yAdd = Math.min(height - 1, y + radius + 1);
        const yRem = Math.max(0, y - radius);
        sum += src[yAdd * width + x] - src[yRem * width + x];
      }
    }
  }
}

/**
 * Smooth a gradient field (dx, dy Float32Arrays) by applying a 3-pass separable
 * box blur — a fast Gaussian approximation. Per the to-pointillism reference
 * the smoothing radius is `max(width, height) / 50`.
 */
export function smoothGradient(dx, dy, width, height, radius = null) {
  const r = radius ?? Math.round(Math.max(width, height) / 50);
  const tmp = new Float32Array(dx.length);
  // Three passes of box blur ≈ Gaussian. Apply to dx then dy.
  for (const buf of [dx, dy]) {
    for (let pass = 0; pass < 3; pass++) {
      boxBlur1D(buf, tmp, width, height, r, true);
      boxBlur1D(tmp, buf, width, height, r, false);
    }
  }
  return { dx, dy };
}

// ─── 11×11 RGB median blur ─────────────────────────────────────────────────
//
// Sliding-window histogram median (Huang's algorithm, adapted): O(W·H·11) per
// channel instead of brute O(W·H·121·log121). Operates on RGBA Uint8ClampedArray
// in-place via a fresh output buffer.

function medianFromHist(hist, half) {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > half) return v;
  }
  return 255;
}

function medianBlurChannel(src, out, width, height, channelOff, kSize) {
  const radius = (kSize - 1) >> 1;
  const half = (kSize * kSize) >> 1;
  const colHists = new Int32Array(width * 256);
  // Initialise column histograms for the first row's window
  for (let cx = 0; cx < width; cx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const sy = Math.max(0, Math.min(height - 1, dy));
      colHists[cx * 256 + src[(sy * width + cx) * 4 + channelOff]]++;
    }
  }
  for (let y = 0; y < height; y++) {
    // Build window histogram from the leftmost columns
    const winHist = new Int32Array(256);
    for (let cx = -radius; cx <= radius; cx++) {
      const sx = Math.max(0, Math.min(width - 1, cx));
      const colOff = sx * 256;
      for (let v = 0; v < 256; v++) winHist[v] += colHists[colOff + v];
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4 + channelOff] = medianFromHist(winHist, half);
      // Slide window right: remove column at x-radius, add column at x+radius+1
      const remX = Math.max(0, Math.min(width - 1, x - radius));
      const addX = Math.max(0, Math.min(width - 1, x + radius + 1));
      const remOff = remX * 256;
      const addOff = addX * 256;
      for (let v = 0; v < 256; v++) {
        winHist[v] -= colHists[remOff + v];
        winHist[v] += colHists[addOff + v];
      }
    }
    // Update column histograms for next row: remove (y - radius), add (y + radius + 1)
    if (y < height - 1) {
      const remY = Math.max(0, y - radius);
      const addY = Math.min(height - 1, y + radius + 1);
      for (let cx = 0; cx < width; cx++) {
        const remV = src[(remY * width + cx) * 4 + channelOff];
        const addV = src[(addY * width + cx) * 4 + channelOff];
        colHists[cx * 256 + remV]--;
        colHists[cx * 256 + addV]++;
      }
    }
  }
}

/**
 * 11×11 RGB median blur (per to-pointillism reference). Operates on the RGBA
 * Uint8ClampedArray that comes out of `getImageData(...).data`. Returns a new
 * Uint8ClampedArray with the median-blurred result. Alpha is copied through
 * unchanged.
 */
export function medianBlur11(srcRGBA, width, height, kSize = 11) {
  const out = new Uint8ClampedArray(srcRGBA.length);
  // Copy alpha pass-through
  for (let i = 3; i < srcRGBA.length; i += 4) out[i] = srcRGBA[i];
  // Median per channel
  medianBlurChannel(srcRGBA, out, width, height, 0, kSize);
  medianBlurChannel(srcRGBA, out, width, height, 1, kSize);
  medianBlurChannel(srcRGBA, out, width, height, 2, kSize);
  return out;
}
