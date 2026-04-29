/**
 * Singleton heightmap populated by TerrainBuilder.build().
 * All callers use getHeightAt / getHeightAtWorld after isReady() === true.
 */

let _data = null; // { heights: Float32Array, width, height, bounds, origin }

function bilinear(data, width, height, u, v) {
  const cu = Math.max(0, Math.min(1, u));
  const cv = Math.max(0, Math.min(1, v));
  const px = cu * (width - 1);
  const py = cv * (height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = px - x0;
  const fy = py - y0;

  const h00 = data[y0 * width + x0];
  const h10 = data[y0 * width + x1];
  const h01 = data[y1 * width + x0];
  const h11 = data[y1 * width + x1];

  return h00 * (1 - fx) * (1 - fy) +
         h10 * fx * (1 - fy) +
         h01 * (1 - fx) * fy +
         h11 * fx * fy;
}

export const HeightSampler = {
  /** Called by TerrainBuilder after building the heightmap. */
  populate(heights, width, height, bounds, origin) {
    _data = { heights, width, height, bounds, origin };
  },

  isReady() {
    return _data !== null;
  },

  /** @returns {number} metres above sea level (≥ 0) */
  getHeightAt(lat, lon) {
    if (!_data) return 0;
    const { bounds, width, height, heights } = _data;
    const u = (lon - bounds.west) / (bounds.east - bounds.west);
    const v = (bounds.north - lat) / (bounds.north - bounds.south);
    return Math.max(0, bilinear(heights, width, height, u, v));
  },

  /** @returns {number} metres above sea level from world XZ coords */
  getHeightAtWorld(x, z) {
    if (!_data) return 0;
    const { origin } = _data;
    // Invert lonLatToLocal: x=dLon*R*cos(lat), z=-dLat*R
    const EARTH_R = 6378137;
    const dLat = -z / EARTH_R * 180 / Math.PI;
    const dLon = x / (EARTH_R * Math.cos(origin.lat * Math.PI / 180)) * 180 / Math.PI;
    return HeightSampler.getHeightAt(origin.lat + dLat, origin.lon + dLon);
  },

  getMinMax() {
    if (!_data) return { min: 0, max: 0 };
    let min = Infinity, max = -Infinity;
    for (const h of _data.heights) {
      if (h < min) min = h;
      if (h > max) max = h;
    }
    return { min, max };
  },

  clear() {
    _data = null;
  },
};
