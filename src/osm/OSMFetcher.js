// Phase 2 fix: Overpass etiquette is non-negotiable.
// Read docs/modules/data-layer.md before touching this file.

import { Cache } from '../data/Cache.js';
import {
  APIS,
  OVERPASS_TILE_SIZE_M,
  OVERPASS_QUERY_TIMEOUT_S,
  OVERPASS_BACKOFF_429_MS,
  OVERPASS_MAX_429_RETRIES,
  OVERPASS_SPLIT_ON_504,
} from '../config.js';

const OVERPASS_TTL_MS = 7 * 86400e3; // 7 days
const M_PER_DEG_LAT = 111320;
const MAX_SPLIT_DEPTH = 2;          // 1 km → 500 m → 250 m at most

// One combined Overpass query per tile. All builders filter the result client-side.
// Using one query (instead of one per feature type) halves request volume.
const combinedQuery = (s, w, n, e) => `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
(
  way["natural"~"water|wood|sand|beach|bare_rock|scree|grassland|wetland|glacier|heath"](${s},${w},${n},${e});
  relation["natural"~"water|wood|sand|beach|bare_rock|scree|grassland|wetland|glacier|heath"](${s},${w},${n},${e});
  way["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|commercial|industrial|cemetery|recreation_ground|allotments|brownfield"](${s},${w},${n},${e});
  relation["landuse"~"forest|grass|meadow|farmland|orchard|vineyard|residential|commercial|industrial|cemetery|recreation_ground|allotments|brownfield"](${s},${w},${n},${e});
  way["waterway"="riverbank"](${s},${w},${n},${e});
  way["leisure"~"park|garden|pitch|golf_course"](${s},${w},${n},${e});
  way["building"](${s},${w},${n},${e});
  relation["building"](${s},${w},${n},${e});
  way["man_made"~"tower|chimney|lighthouse"](${s},${w},${n},${e});
  way["historic"~"castle|monument|memorial"](${s},${w},${n},${e});
  way["amenity"="place_of_worship"](${s},${w},${n},${e});
  node["natural"="tree"](${s},${w},${n},${e});
);
out geom;`;

// Global serial queue: ONE Overpass request at a time, ever, across the whole app.
// Anything more parallel will get the IP rate-limited within minutes.
class SerialQueue {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const r = this.tail.then(() => fn());
    this.tail = r.catch(() => {});
    return r;
  }
}
const overpassQueue = new SerialQueue();

const ENDPOINTS = APIS.overpass;
// Rotate which mirror we hit first per session so traffic spreads across mirrors.
const _endpointStart = Math.floor(Math.random() * ENDPOINTS.length);
const endpointAt = (offset) => ENDPOINTS[(_endpointStart + offset) % ENDPOINTS.length];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * POST a query. Tries each mirror; honours 429 with 5/15/45 s backoff;
 * marks 504 errors so the caller can split the tile instead of retrying.
 */
function reportOverpass(status, url) {
  const dbg = (typeof window !== 'undefined') && window.__panoramaDebug;
  if (!dbg) return;
  const host = (() => { try { return new URL(url).host.split('.')[0]; } catch { return url; } })();
  dbg.lastOverpass = `${status} (${host})`;
}

async function postOverpass(query) {
  let attempt429 = 0;

  while (true) {
    let lastErr = null;
    let saw429 = false;
    let saw504 = false;

    // One pass over the mirror list per attempt
    for (let i = 0; i < ENDPOINTS.length; i++) {
      const url = endpointAt(i);
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: query,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        });

        if (res.status === 429) { saw429 = true; lastErr = new Error('429'); reportOverpass('429', url); continue; }
        if (res.status === 504) { saw504 = true; lastErr = new Error('504'); reportOverpass('504', url); continue; }
        if (!res.ok)             { lastErr = new Error(`HTTP ${res.status}`); reportOverpass(`${res.status}`, url); continue; }

        reportOverpass('200 OK', url);
        return await res.json();
      } catch (err) {
        lastErr = err;
        reportOverpass('NET ERR', url);
        // Try next mirror on network error
      }
    }

    // All mirrors exhausted for this attempt.
    if (saw504 && !saw429) {
      // Pure 504 — query is too heavy. Signal caller to split the tile.
      const e = new Error('Overpass 504 (query too heavy)');
      e.is504 = true;
      throw e;
    }
    if (saw429) {
      if (attempt429 >= OVERPASS_MAX_429_RETRIES) {
        throw new Error('Overpass rate-limited (all mirrors 429 after retries)');
      }
      const wait = OVERPASS_BACKOFF_429_MS[attempt429]
        ?? OVERPASS_BACKOFF_429_MS[OVERPASS_BACKOFF_429_MS.length - 1];
      attempt429++;
      console.warn(`[OSMFetcher] 429 on all mirrors; backing off ${wait}ms (attempt ${attempt429})`);
      await sleep(wait);
      continue;
    }
    throw lastErr ?? new Error('Overpass: all mirrors failed');
  }
}

function tileKey(s, w, n, e) {
  return `osm:tile:${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
}

/**
 * Fetch ONE Overpass tile. Cache hit short-circuits the network entirely.
 * On 504, splits the tile into 4 sub-tiles and recurses (capped depth).
 */
async function fetchTile(s, w, n, e, splitDepth = 0) {
  const key = tileKey(s, w, n, e);
  return Cache.dedupe(key, async () => {
    const cached = await Cache.get(key);
    if (cached) return cached;

    try {
      const json = await overpassQueue.run(() => postOverpass(combinedQuery(s, w, n, e)));
      await Cache.set(key, json, OVERPASS_TTL_MS);
      return json;
    } catch (err) {
      if (err.is504 && OVERPASS_SPLIT_ON_504 && splitDepth < MAX_SPLIT_DEPTH) {
        // Split bbox into 4 sub-tiles. Each recurses serially through the queue.
        const midLat = (s + n) / 2;
        const midLon = (w + e) / 2;
        const sub = [
          [s, w, midLat, midLon],
          [s, midLon, midLat, e],
          [midLat, w, n, midLon],
          [midLat, midLon, n, e],
        ];
        const merged = { elements: [] };
        for (const [ss, ww, nn, ee] of sub) {
          try {
            const r = await fetchTile(ss, ww, nn, ee, splitDepth + 1);
            for (const el of r.elements ?? []) merged.elements.push(el);
          } catch (subErr) {
            console.warn('[OSMFetcher] sub-tile failed:', subErr.message);
          }
        }
        await Cache.set(key, merged, OVERPASS_TTL_MS);
        return merged;
      }
      throw err;
    }
  });
}

function bboxAround(location, radiusM) {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.cos(location.lat * Math.PI / 180));
  return {
    south: location.lat - dLat,
    north: location.lat + dLat,
    west:  location.lon - dLon,
    east:  location.lon + dLon,
  };
}

function splitBbox(south, west, north, east, lat) {
  const dLatTile = OVERPASS_TILE_SIZE_M / M_PER_DEG_LAT;
  const dLonTile = OVERPASS_TILE_SIZE_M / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180));
  const tiles = [];
  for (let s = south; s < north; s += dLatTile) {
    const n = Math.min(north, s + dLatTile);
    for (let w = west; w < east; w += dLonTile) {
      const e = Math.min(east, w + dLonTile);
      tiles.push([s, w, n, e]);
    }
  }
  return tiles;
}

/**
 * Read ONE tile from cache without ever issuing a network request. Returns
 * `null` if the tile isn't cached yet. Skips the `Cache.dedupe` coalescer on
 * purpose — we don't want to await an in-flight scene-rebuild fetch; we want
 * "what's in cache *right now*". A null return is a signal to the painter to
 * leave that tile's polygons out of this paint.
 */
async function peekTile(s, w, n, e) {
  const key = tileKey(s, w, n, e);
  return (await Cache.get(key)) ?? null;
}

/** Same as fetchTilesForArea but cache-only — never triggers Overpass. */
async function peekTilesForArea(location, preset) {
  const radius = Math.min(preset.osmRadius, 5000);
  const { south, west, north, east } = bboxAround(location, radius);
  const tiles = splitBbox(south, west, north, east, location.lat);

  const results = await Promise.all(
    tiles.map(([s, w, n, e]) => peekTile(s, w, n, e))
  );

  const seen = new Set();
  const merged = [];
  for (const r of results) {
    if (!r?.elements) continue;
    for (const el of r.elements) {
      const id = `${el.type}:${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(el);
    }
  }
  return merged;
}

/**
 * Fetch ALL tiles covering the OSM radius and return de-duplicated raw elements.
 * Tiles are dispatched together but execute strictly serially via overpassQueue.
 */
async function fetchTilesForArea(location, preset) {
  const radius = Math.min(preset.osmRadius, 5000);
  const { south, west, north, east } = bboxAround(location, radius);
  const tiles = splitBbox(south, west, north, east, location.lat);

  const results = await Promise.all(
    tiles.map(([s, w, n, e]) =>
      fetchTile(s, w, n, e).catch(err => {
        console.warn('[OSMFetcher] tile failed:', err.message);
        return { elements: [] };
      })
    )
  );

  const seen = new Set();
  const merged = [];
  for (const r of results) {
    for (const el of r.elements ?? []) {
      const id = `${el.type}:${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(el);
    }
  }
  return merged;
}

/**
 * Convert OSM elements into a flat polygon list:
 *   { tags, outer: [{lat, lon}, ...], inners: [[{lat, lon}, ...], ...] }
 */
function elementsToPolygons(elements) {
  const polygons = [];
  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    if (el.type === 'way') {
      if (!Array.isArray(el.geometry) || el.geometry.length < 3) continue;
      polygons.push({ tags, outer: el.geometry, inners: [] });
    } else if (el.type === 'relation' && tags.type === 'multipolygon') {
      const outers = [], inners = [];
      for (const m of el.members ?? []) {
        if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
        if (m.role === 'outer')      outers.push(m.geometry);
        else if (m.role === 'inner') inners.push(m.geometry);
      }
      for (const outer of outers) {
        if (outer.length < 3) continue;
        polygons.push({ tags, outer, inners });
      }
    }
  }
  return polygons;
}

export const OSMFetcher = {
  /** Single-tile fetch, returns raw Overpass JSON. */
  fetchTile,

  /** All tiles for the OSM radius, returns flat de-duplicated raw elements. */
  fetchTilesForArea,

  /** Utility: turn raw OSM elements into the polygon shape builders consume. */
  elementsToPolygons,

  /**
   * Convenience: fetch + filter for ground-cover-relevant tags + convert.
   * Builders call this; under the hood it shares cached tiles with `fetchBuildings`.
   */
  async fetchGroundCover(location, preset) {
    const elements = await fetchTilesForArea(location, preset);
    const filtered = elements.filter(el =>
      el.tags && (el.tags.natural || el.tags.landuse || el.tags.leisure || el.tags.waterway)
    );
    return elementsToPolygons(filtered);
  },

  /**
   * Cache-only variant of `fetchGroundCover`. Never issues a network request;
   * never blocks on an in-flight Overpass call. Returns `[]` when nothing is
   * cached for this area yet (cold cache, or fetch still in flight). Designed
   * for the painter's snapshot-assembly path: paint-time should never be
   * gated on a 10–60 s Overpass round trip; the next paint after the scene
   * rebuild lands picks up the polygons automatically.
   */
  async peekGroundCover(location, preset) {
    const elements = await peekTilesForArea(location, preset);
    const filtered = elements.filter(el =>
      el.tags && (el.tags.natural || el.tags.landuse || el.tags.leisure || el.tags.waterway)
    );
    return elementsToPolygons(filtered);
  },

  /**
   * Convenience: fetch + filter for buildings + convert.
   * Shares cached tiles with `fetchGroundCover` (same combined query underneath).
   */
  async fetchBuildings(location, preset) {
    const elements = await fetchTilesForArea(location, preset);
    const filtered = elements.filter(el => el.tags?.building);
    return elementsToPolygons(filtered);
  },
};
