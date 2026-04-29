import { Cache } from './Cache.js';
import { APIS } from '../config.js';

// Nominatim hard limit: 1 req/s
class RateLimiter {
  constructor(rps) {
    this.minInterval = 1000 / rps;
    this.last = 0;
  }
  async wait() {
    const now = Date.now();
    const delay = Math.max(0, this.last + this.minInterval - now);
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    this.last = Date.now();
  }
}
const limiter = new RateLimiter(1);

function normalise(q) {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function nominatimFetch(url) {
  await limiter.wait();
  const res = await fetch(url, {
    headers: { 'User-Agent': APIS.userAgent, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

export const Geocoder = {
  /**
   * @param {string} query
   * @returns {Promise<Array<{lat, lon, displayName, type}>>}
   */
  async search(query) {
    const key = `geocode:${normalise(query)}`;
    const cached = await Cache.get(key);
    if (cached) return cached;

    const url = `${APIS.nominatim}/search?` + new URLSearchParams({
      q: query,
      format: 'json',
      limit: '5',
      addressdetails: '1',
    });

    let raw;
    try {
      raw = await nominatimFetch(url);
    } catch {
      // Try reformatted
      const url2 = `${APIS.nominatim}/search?` + new URLSearchParams({
        q: query.trim(),
        format: 'json',
        limit: '5',
      });
      raw = await nominatimFetch(url2);
    }

    const results = raw.map(r => ({
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      displayName: r.display_name,
      type: r.type,
    }));

    await Cache.set(key, results, 7 * 86400e3);
    return results;
  },

  /**
   * @returns {Promise<{displayName: string}>}
   */
  async reverse(lat, lon) {
    const key = `geocode:rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = await Cache.get(key);
    if (cached) return cached;

    const url = `${APIS.nominatim}/reverse?` + new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'json',
    });

    const raw = await nominatimFetch(url);
    const result = { displayName: raw.display_name ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    await Cache.set(key, result, 7 * 86400e3);
    return result;
  },
};
