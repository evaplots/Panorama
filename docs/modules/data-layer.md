# Module: Data Layer

**Owner role:** 🌐 Data Layer Engineer
**Phase introduced:** Phase 1, expanded each phase
**Files:**
- `src/data/Cache.js`
- `src/data/Geocoder.js`
- `src/data/TileMath.js`

---

## Purpose

Everything network-facing and stateless-utility: HTTP, caching, retries, geocoding, and the math that converts between lat/lon, tile coordinates, and local Three.js coordinates.

This is the bottom of the dependency graph. It depends on nothing inside Panorama. Every other module may use it.

---

## Public API

```js
// Cache.js
export const Cache = {
  get(key: string): Promise<any | null>
  set(key: string, value: any, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  size(): Promise<number>     // bytes used
};

// Geocoder.js
export const Geocoder = {
  search(query: string): Promise<Array<{lat, lon, displayName, type}>>
  reverse(lat: number, lon: number): Promise<{displayName: string}>
};

// TileMath.js — pure functions, no I/O
export const TileMath = {
  lonLatToTile(lon: number, lat: number, zoom: number): {x, y, z}
  tileBounds(x: number, y: number, z: number): {north, south, east, west}
  tileCornerLonLat(x: number, y: number, z: number): {lon, lat}
  lonLatToLocal(lon, lat, originLon, originLat): {x: number, z: number}
  localToLonLat(x, z, originLon, originLat): {lon, lat}
  tilesInBoundingBox(s, w, n, e, zoom): Array<{x, y, z}>
};
```

---

## Cache

### Strategy

Two-tier:

1. **In-memory** Map for hot data (current scene's tiles). Limited to ~200 MB; LRU eviction.
2. **IndexedDB** for persistence across sessions. Limited to browser's quota (typically multi-GB).

```js
// Pseudocode
async function get(key) {
  if (memCache.has(key)) {
    memCache.bump(key);          // LRU touch
    return memCache.get(key);
  }
  const fromDb = await idb.get(key);
  if (fromDb) {
    if (fromDb.expiresAt > Date.now()) {
      memCache.set(key, fromDb.value);
      return fromDb.value;
    }
    await idb.delete(key);       // expired
  }
  return null;
}
```

### Key conventions

After Phase 2's combined-query refactor, OSM tiles use a single key per bbox (not per feature type):

```
dem:{z}/{x}/{y}                    → DEM tile PNG → ArrayBuffer
osm:{z}/{x}/{y}                    → Overpass combined query result → JSON
geocode:{normalized-query}         → Nominatim result
tz:{rounded-lat},{rounded-lon}     → Timezone string from tz-lookup (Phase 2+)
```

Round lat/lon to 2 decimals for the timezone cache key — timezones don't change within ~1 km.

### TTLs

| Type            | TTL          | Rationale                                     |
| --------------- | ------------ | --------------------------------------------- |
| DEM tiles       | 30 days      | Terrain doesn't change                        |
| OSM tiles       | 7 days       | OSM updates regularly but slowly              |
| Geocode         | 7 days       | Place names stable                            |
| Timezone        | 365 days     | IANA timezone changes are very rare           |

### Compression

For OSM JSON results (often 10+ MB for dense urban tiles), compress before storing:

```js
const compressed = await new Response(
  new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
).arrayBuffer();
```

CompressionStream is supported in all modern browsers (2023+).

### Cache verification protocol (CRITICAL)

The cache must persist across page reloads. If it doesn't, every reload triggers fresh Overpass requests, the IP gets rate-limited, and the user sees a broken app. This was the dominant failure mode through Phases 1.5 and 2.

**Mandatory verification steps after any cache code change:**

1. Open DevTools → Application tab → IndexedDB → check that `panorama-cache` (or whatever name `Cache.js` uses) database exists and contains entries.
2. Load Rome at Urban (5km). Wait for ground cover and buildings to fully load.
3. Open DevTools → Network → filter `overpass` → clear log.
4. Reload the page.
5. **Expected: zero Overpass requests.** Everything served from cache.
6. If you see new Overpass requests, the cache is broken.

**Common failure modes the cache must defend against:**

- **Promise unwrapping in IndexedDB.** `idb.put(key, await fetch(...))` stores the Promise, not the value. Always `await` the fetch first, then put the resolved value.
- **Key normalisation drift.** `tile_x_y_z` vs `tile-x-y-z` vs `tile:x:y:z`. Pick one delimiter, define it as a constant, use it everywhere.
- **TTL accidentally zero.** A typo like `7 * 86400` (seconds) instead of `7 * 86400 * 1000` (ms) makes everything expire instantly.
- **Silent IndexedDB write failures.** IndexedDB writes can fail for quota or schema reasons without throwing. Wrap puts in try/catch with a `console.error` — silent failure is the worst kind.
- **Different keys for read and write.** A common bug: writing as `osm:rome` and reading as `osm:Rome` (case mismatch). Normalise once, use the normalised key everywhere.

**Debug helper (always-on, low-volume):**

```js
// At the top of Cache.js
const DEBUG_CACHE = true;   // set false after Phase 2 stabilises

async function get(key) {
  const result = await getInternal(key);
  if (DEBUG_CACHE) console.log(`[Cache] ${result ? 'HIT' : 'MISS'} ${key}`);
  return result;
}

async function set(key, value, ttl) {
  if (DEBUG_CACHE) console.log(`[Cache] WRITE ${key} (${JSON.stringify(value).length}b, ttl ${ttl}ms)`);
  return setInternal(key, value, ttl);
}
```

Reload after any cache change and read the console — the pattern HIT/HIT/HIT after the first MISS round confirms persistence works. A pattern of MISS/MISS/MISS on every reload is the bug.

---

## Geocoder

### Nominatim wrapper

```js
async function search(query) {
  const cached = await Cache.get(`geocode:${normalize(query)}`);
  if (cached) return cached;

  const url = `${APIS.nominatim}/search?` + new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    addressdetails: '1',
  });

  const results = await fetchWithRetry(url, {
    headers: { 'User-Agent': APIS.userAgent },
  });

  const normalized = results.map(r => ({
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name,
    type: r.type,
  }));

  await Cache.set(`geocode:${normalize(query)}`, normalized, 7 * 86400e3);
  return normalized;
}
```

### Rate limiting

Nominatim's terms: max 1 request per second from a single source. We implement a simple queue:

```js
class RateLimiter {
  constructor(rps) { this.minInterval = 1000 / rps; this.last = 0; }
  async wait() {
    const now = Date.now();
    const wait = Math.max(0, this.last + this.minInterval - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.last = Date.now();
  }
}
const nominatimLimiter = new RateLimiter(1);
```

All Nominatim calls go through `nominatimLimiter.wait()` first.

### User-Agent

Nominatim *requires* a meaningful User-Agent. Our `config.js` defines it; never use a generic one or the request gets blocked.

---

## Overpass etiquette (CRITICAL — read this before touching any OSM fetcher)

The public Overpass API at `overpass-api.de` is a **shared free service** with strict rate limits. Treating it like an unlimited resource will get your IP banned, often within minutes. The rules below are non-negotiable.

### Hard rules

These must all be true in the implementation. Violating any of them produced the rate-limit storm we saw during Phase 2 testing.

**1. Maximum 1 concurrent Overpass request, ever.**

Not 4. Not 2. **One.** A global queue serialises every Overpass call across the entire app. Ground cover queries, building queries, retries — all share one queue.

```js
class SerialQueue {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const result = this.tail.then(() => fn());
    this.tail = result.catch(() => {});  // don't break the chain on errors
    return result;
  }
}
export const overpassQueue = new SerialQueue();
```

Every Overpass fetch wraps in `overpassQueue.run(() => fetch(...))`. No exceptions.

**2. Honour 429 with mandatory backoff.**

When Overpass returns 429, **wait before retrying**. Use this exact backoff schedule:

| Attempt | Wait before retry |
| ------- | ----------------- |
| 1st 429 | 10 seconds        |
| 2nd 429 | 30 seconds        |
| 3rd 429 | 90 seconds        |
| 4th 429 | give up, surface error to user |

Do NOT retry immediately. Do NOT use `2 ** i * 1000` — too aggressive for Overpass.

**Important context:** the public `overpass-api.de` instance has flagged Panorama's development IP multiple times during testing. Any aggressive retry pattern compounds the problem because it extends the ban window. The 10/30/90 schedule is generous on purpose — better to wait once than to be banned for an hour.

**3. 504 Gateway Timeout = the query was too heavy.**

A 504 means Overpass rejected the query because it took too long. **Do not retry the same query** — the answer will be the same. Either:
- Split the bounding box into smaller tiles (halve each dimension) and retry as four separate queries
- Or give up and accept missing data for that tile

A retry without splitting just wastes a request.

**4. Cache before fetch, always.**

Every fetcher MUST check the cache first. If a tile is in cache, never hit the network. Verify caching works across page reloads — open DevTools Network, filter "overpass", reload, and confirm zero new requests for an already-loaded location.

If reloading triggers fresh fetches, the cache is broken. Common causes: IndexedDB write failing silently, key normalisation differing between read and write, TTL of 0 instead of intended `30 * 86400e3`.

**5. Combine queries per tile.**

A single Overpass query can return multiple feature types. Don't fire one query for ground cover and another for buildings on the same tile — combine them:

```
[out:json][timeout:60];
(
  way["building"](s,w,n,e);
  relation["building"](s,w,n,e);
  way["natural"](s,w,n,e);
  relation["natural"](s,w,n,e);
  way["landuse"](s,w,n,e);
  relation["landuse"](s,w,n,e);
  way["waterway"="riverbank"](s,w,n,e);
  way["leisure"~"park|garden|pitch|golf_course"](s,w,n,e);
);
out geom;
```

The fetcher returns a single response; the consumers (`GroundCoverBuilder`, `BuildingsBuilder`) filter the result for the tags they care about. This halves the number of requests.

**6. Increase per-query timeout.**

Set `[timeout:60]` (60 seconds) instead of the default 25. Combined queries are larger; 25s causes premature 504s. Worst case the query takes longer; that's preferable to a 504 retry storm.

**7. Endpoint fallbacks.**

`APIS.overpass` in `config.js` is an array of endpoints. The Overpass fetcher tries them in order. If the primary returns 429 or 504, the next is tried before giving up.

```js
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  // Local Docker Overpass goes here for development:
  // 'http://localhost:12345/api/interpreter',
];
```

**The reality of public Overpass mirrors in 2026:** historic mirrors (`overpass.kumi.systems`, `overpass.private.coffee`, `overpass.openstreetmap.fr`, etc.) frequently fail from the browser due to CORS issues or intermittent outages, even when the server itself is up. They produce `ERR_CONNECTION_REFUSED` in browser dev tools indistinguishable from a server outage. **Treat the public Overpass as a single endpoint** — `overpass-api.de` — that may go down or rate-limit you, with no real backup.

For any serious development or production use, the realistic answer is to run your own Overpass — see "Local Overpass via Docker" below.

### Soft rules (also do these)

**Pre-warm the cache for popular locations.** A future enhancement: a Node script that fetches OSM data for a curated list of cities and ships the results as static JSON in `public/preset-cache/`. The Cache module checks this before IndexedDB. Eliminates network entirely for common locations.

**Self-host Overpass for production.** If Panorama gets deployed publicly with significant traffic, run your own Overpass instance via Docker (instructions below). Public infrastructure will not tolerate a busy app sending traffic on behalf of many users.

**Show a friendly message when rate-limited.** When all retries fail, the UI should say something like *"OpenStreetMap is busy right now. Try again in a few minutes, or pick a smaller radius."* — not a generic error.

### Verifying you got it right

After implementing the above:

1. Open DevTools → Network → filter `overpass`
2. Load Rome at Urban (5 km)
3. You should see no more than ~5–15 Overpass requests over 1–2 minutes (depending on tile count), all with 200 status
4. Reload the page
5. You should see **zero** new Overpass requests — everything from cache
6. Switch to Suburban (15 km), same location
7. Some new requests (more area to cover), but no 429s

If you see 429s during normal use, one of the hard rules above is violated.

---

## Local Overpass via Docker (recommended for development)

The public Overpass infrastructure is unsuitable for any workflow with frequent reloads. After 30–60 minutes of testing your IP gets rate-limited; after a few hours it's banned for a longer cool-down period. The fix that solves this **permanently** is to run your own Overpass server locally. It costs nothing, takes ~30 minutes to set up, and eliminates network failures from your dev loop.

### What you get

- Unlimited queries, no rate limits, no 429s, ever.
- Sub-second response times (no transatlantic round-trip).
- Works offline once the database is built.
- Full OSM data for whatever region you import.

### What it costs

- ~10–30 GB disk per region (Italy: 12 GB, Germany: 22 GB, full planet: 200+ GB).
- One-time database build: 5–60 minutes depending on region size.
- ~2 GB RAM at runtime (idle) plus query memory.

### Setup (one-time)

Pick the region(s) you care about from <https://download.geofabrik.de>. For example, central Italy:

```bash
docker run -d \
  --name overpass-panorama \
  -p 12345:80 \
  -e OVERPASS_META=yes \
  -e OVERPASS_MODE=init \
  -e OVERPASS_PLANET_URL=https://download.geofabrik.de/europe/italy/centro-latest.osm.pbf \
  -v overpass-panorama-data:/db \
  wiktorn/overpass-api
```

The container downloads the .pbf and builds the database on first run. **Watch the logs**:

```bash
docker logs -f overpass-panorama
```

Wait until you see `Overpass API started`. For central Italy that's about 5 minutes; for all of Italy maybe 15.

### Wiring it up in Panorama

In `src/config.js`, add the local endpoint at the **start** of the `APIS.overpass` array:

```js
overpass: [
  'http://localhost:12345/api/interpreter',
  'https://overpass-api.de/api/interpreter',  // fallback if local is down
],
```

The serial queue tries them in order, so local hits succeed instantly and the public endpoint is only used if the container isn't running. You'll never see another 429 during development.

### Verifying

1. Open DevTools → Network → filter `interpreter`
2. Load Rome
3. Requests should go to `localhost:12345`, all returning 200, sub-second
4. Stop the container (`docker stop overpass-panorama`) and reload
5. Requests should fall back to `overpass-api.de` and possibly hit 429 (proving fallback works)

### Switching regions

Building Italy is fast. Building Europe is much slower. Recommended approach: one container per region, switch by stopping/starting:

```bash
docker stop overpass-panorama
docker run -d --name overpass-france -p 12345:80 \
  -e OVERPASS_PLANET_URL=https://download.geofabrik.de/europe/france-latest.osm.pbf \
  -v overpass-france-data:/db \
  wiktorn/overpass-api
```

Reuses the same port, so no config change in Panorama.

### Memory and disk hygiene

- Each region container has its own named Docker volume — they don't share data, but they don't conflict either.
- After `docker rm overpass-panorama`, the named volume `overpass-panorama-data` persists. Use `docker volume rm` to actually free the disk.
- For long-running setups, consider mounting `-v /path/on/host:/db` instead of named volumes for easier inspection.

### Production deployment

Same Docker image, deployed on whatever host serves your app. The container needs to be reachable from the user's browser, which means either:

- Host the Overpass container on the same domain as the app (CORS is automatic)
- Or configure CORS headers on a reverse proxy in front of the container

The wiktorn/overpass-api image does NOT add CORS headers by default. Use an nginx reverse proxy with `add_header 'Access-Control-Allow-Origin' '*'` (or the specific origin) to make it browser-accessible from a different domain.

---

## TileMath

Pure functions. No I/O, no state, easy to test.

### Slippy-map tile math

Standard formulas (search "OSM slippy map tilenames" for derivation):

```js
function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
  return { x, y, z: zoom };
}

function tileCornerLonLat(x, y, z) {
  const n = 2 ** z;
  const lon = x / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  return { lon, lat: latRad * 180 / Math.PI };
}
```

### Local projection

Convert lat/lon to Three.js scene coordinates around an origin:

```js
const EARTH_R = 6378137;       // metres (WGS84 equatorial radius)

function lonLatToLocal(lon, lat, originLon, originLat) {
  const dLat = (lat - originLat) * Math.PI / 180;
  const dLon = (lon - originLon) * Math.PI / 180;
  const x = dLon * EARTH_R * Math.cos(originLat * Math.PI / 180);  // east
  const z = -dLat * EARTH_R;                                         // south is +Z
  return { x, z };
}
```

This is an equirectangular projection scaled to metres at the origin's latitude. Accurate enough for radii under ~200 km. Beyond that, use a proper local tangent plane (ECEF).

### Bounding box → tile list

For Overpass tile splitting:

```js
function tilesInBoundingBox(south, west, north, east, zoom) {
  const tl = lonLatToTile(west, north, zoom);
  const br = lonLatToTile(east, south, zoom);
  const tiles = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) {
      tiles.push({ x, y, z: zoom });
    }
  }
  return tiles;
}
```

---

## Network utilities

`fetchWithRetry` is for **non-Overpass** APIs (Nominatim, AWS Terrain Tiles). For Overpass, use the dedicated path described in the Overpass etiquette section above — it has stricter rules.

```js
async function fetchWithRetry(url, options = {}, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        // Rate-limited — back off
        await sleep(2 ** i * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(2 ** i * 500);
    }
  }
}
```

Exponential backoff. Three attempts. Failure bubbles up to the caller, who decides how to surface it (typically `scene:error` with a friendly message).

---

## What this module does NOT do

- Doesn't know about Three.js. No `THREE.*` imports anywhere in `src/data/`.
- Doesn't decide *what* to fetch. Terrain decides DEM tiles; OSM decides Overpass queries. Data Layer just provides plumbing.
- Doesn't handle authentication. Free APIs only. If a paid API is added later, auth lives in a thin per-API wrapper, not the cache.
- Doesn't render or display anything.

---

## How to extend

### Add a new API source (e.g. Mapbox)

1. Create `src/data/MapboxFetcher.js` with a focused public API (e.g. `fetchTerrainTile(x, y, z) → ArrayBuffer`).
2. Use the same `Cache`, `fetchWithRetry`, rate limiter primitives.
3. API token from `config.js`.
4. Document in `DATA-CONTRACTS.md` if it adds new state fields (e.g. token validity).

### Persistent shared cache (multi-user deployment)

Move IndexedDB → server-side Redis behind an HTTP cache endpoint. Same key scheme. Out of scope for self-hosted single-user app.

### Pre-baked popular locations

For a deployed app, ship pre-baked tile bundles for top-20 sunset destinations. `Cache.get` returns them instantly. This is a build-time concern — write a Node script that runs the fetchers and dumps results to `public/preset-cache/`.

### IndexedDB quota management

When the cache exceeds 80% of quota, delete least-recently-accessed entries. `navigator.storage.estimate()` gives quota. Phase 5.

---

## Common pitfalls

- **Cache key normalisation.** `"Mont Blanc"` and `"mont blanc "` should hit the same cache entry. Always normalise (lowercase, trim, collapse spaces).
- **Storing huge values in IndexedDB.** Browsers have per-key size limits. Don't put a 100 MB tile in one key — split.
- **Race conditions.** If two callers simultaneously request the same uncached tile, both fetch. Add a "pending" map: if a fetch is in flight for key K, return its promise to the second caller.
- **CORS.** Nominatim and Overpass send proper CORS headers; AWS Terrain Tiles too. If you add a new API, check before assuming.
- **Browser private mode.** IndexedDB may be unavailable. Cache should gracefully degrade to memory-only — don't crash.
- **Clock skew.** TTLs use `Date.now()`. If user's clock is wrong, entries may expire weirdly. Acceptable trade-off; alternative is server-side caching.

---

## Tests worth writing

- TileMath round-trip: `lonLatToLocal` → `localToLonLat` returns input within 1 metre at < 50 km radius.
- Tile bounding box correctness for known lat/lon pairs.
- Cache returns null for missing keys (not throws).
- Cache evicts on TTL.
- RateLimiter actually limits to specified rate (timing test, allow 10% slack).
