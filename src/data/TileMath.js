const EARTH_R = 6378137; // WGS84 equatorial radius, metres

export const TileMath = {
  /** @returns {{x, y, z}} */
  lonLatToTile(lon, lat, zoom) {
    const n = 2 ** zoom;
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
    return { x, y, z: zoom };
  },

  /** Northwest corner of a tile */
  tileCornerLonLat(x, y, z) {
    const n = 2 ** z;
    const lon = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    return { lon, lat: latRad * 180 / Math.PI };
  },

  /** @returns {{north, south, east, west}} in degrees */
  tileBounds(x, y, z) {
    const nw = TileMath.tileCornerLonLat(x, y, z);
    const se = TileMath.tileCornerLonLat(x + 1, y + 1, z);
    return { north: nw.lat, south: se.lat, west: nw.lon, east: se.lon };
  },

  /**
   * Lat/lon → local scene XZ (metres from origin).
   * +X = east, +Z = south.
   */
  lonLatToLocal(lon, lat, originLon, originLat) {
    const dLat = (lat - originLat) * Math.PI / 180;
    const dLon = (lon - originLon) * Math.PI / 180;
    const x = dLon * EARTH_R * Math.cos(originLat * Math.PI / 180);
    const z = -dLat * EARTH_R;
    return { x, z };
  },

  localToLonLat(x, z, originLon, originLat) {
    const dLat = (-z / EARTH_R) * 180 / Math.PI;
    const dLon = (x / (EARTH_R * Math.cos(originLat * Math.PI / 180))) * 180 / Math.PI;
    return { lon: originLon + dLon, lat: originLat + dLat };
  },

  /** All tiles at zoom covering the given bbox. */
  tilesInBoundingBox(south, west, north, east, zoom) {
    const tl = TileMath.lonLatToTile(west, north, zoom);
    const br = TileMath.lonLatToTile(east, south, zoom);
    const tiles = [];
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        tiles.push({ x, y, z: zoom });
      }
    }
    return tiles;
  },
};
