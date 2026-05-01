export const PRESETS = {
  urban: {
    name: 'urban',
    terrainRadius: 5000,
    osmRadius: 2000,
    lod: { near: 300, mid: 1000, far: 2000 },
  },
  suburban: {
    name: 'suburban',
    terrainRadius: 15000,
    osmRadius: 3000,
    lod: { near: 500, mid: 1500, far: 3000 },
  },
  open: {
    name: 'open',
    terrainRadius: 40000,
    osmRadius: 4000,
    lod: { near: 500, mid: 2000, far: 4000 },
  },
  alpine: {
    name: 'alpine',
    terrainRadius: 100000,
    osmRadius: 5000,
    lod: { near: 500, mid: 2000, far: 5000 },
  },
};

export const DEFAULT_PRESET = 'suburban';
export const EYE_HEIGHT_M = 1.7;
export const DEFAULT_FOV_DEG = 60;
export const DEFAULT_TILT_DEG = -5;

// Phase 2: walking mode
export const WALK_SPEED_MS = 1.4;
export const JOG_SPEED_MS = 4.0;
export const ACCELERATION_MS2 = 8.0;
export const WALK_Y_SMOOTHING_MS = 200;
export const WALK_HARD_BOUND_MARGIN_M = 100;

export const DEM_TILE_ZOOM = 12;
export const OSM_TILE_SIZE_M = 1000;

// Phase 1 cap: single-zoom mesh up to this radius
export const PHASE1_TERRAIN_CAP_M = 15000;
export const TERRAIN_MESH_SEGMENTS = 512;

export const SKY = {
  turbidity: 6,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
};

// Phase 1.5: ground cover colours by OSM tag.
// Single source of truth — never hardcode in builders. Tune by editing here.
// All values tuned to look right under sunset directional light.
export const GROUND_COVER_COLOURS = {
  'natural=water':        0x3b6ea5,
  'waterway=riverbank':   0x3b6ea5,
  'natural=beach':        0xe8d8a8,
  'natural=sand':         0xe8d8a8,
  'natural=bare_rock':    0x9a8b7a,
  'natural=scree':        0xa89a88,
  'natural=glacier':      0xe8eef2,
  'natural=wood':         0x3a5538,
  'landuse=forest':       0x3a5538,
  'natural=grassland':    0x7a9050,
  'natural=heath':        0x8a7a5a,
  'natural=wetland':      0x5a7868,
  'landuse=grass':        0x8aa55a,
  'landuse=meadow':       0x9ab050,
  'landuse=farmland':     0xc5b078,
  'landuse=orchard':      0x7a8a48,
  'landuse=vineyard':     0x8a6850,
  'landuse=residential':  0xb0a89a,
  'landuse=commercial':   0xa8a098,
  'landuse=industrial':   0x909088,
  'landuse=cemetery':     0x6a7050,
  'landuse=brownfield':   0x7a6a55,
  'leisure=park':         0x8aa55a,
  'leisure=garden':       0x8aa55a,
  'leisure=pitch':        0x7aa550,
  'leisure=golf_course':  0x7aa550,
};

// Tag priority — lower number = higher priority. Used when a polygon has
// multiple matching tags or when polygons overlap.
export const GROUND_COVER_PRIORITY = {
  natural:  1,
  waterway: 1,
  leisure:  2,
  landuse:  3,
};

export const GROUND_COVER_Z_OFFSET_M = 0.1;

export const EXPORT = {
  A3: { widthMm: 420, heightMm: 297 },
  A2: { widthMm: 594, heightMm: 420 },
  A1: { widthMm: 841, heightMm: 594 },
};
export const DEFAULT_EXPORT_DPI = 300;

// External API endpoints. Per CLAUDE.md rule 9, every URL here must be
// verified live (not trusted from memory) before commit, and re-verified
// when a phase ships. Last full audit: 2026-05-01.
//
//   Nominatim          — verified alive (status endpoint returns "OK")
//   Overpass-api.de    — verified alive (2 slots reported, current timestamp)
//   AWS Terrain Tiles  — verified alive (sample tile 0/0/0.png returns ~104 KB PNG)
//   Open-Meteo         — verified alive 2026-05-01 (forecast endpoint, browser CORS OK, no key)
//   Open-Meteo Archive — verified alive 2026-05-01 (HTTP 200 on /v1/archive
//                        with Berlin lat/lon for 2024-01-15; same JSON shape
//                        as forecast, no key, browser CORS OK)
//
// Future endpoints (not yet in code; documented in stub module docs):
//   eBird API v2       — verify before adding to wildlife module
//   xeno-canto API     — verify before adding to wildlife module
//   NOAA SWPC          — verify before adding to astronomy module
//
// kumi.systems and private.coffee Overpass mirrors had browser CORS failures
// during Phase 2 testing; kept removed until a verified browser-compatible
// mirror surfaces.
export const APIS = {
  nominatim: 'https://nominatim.openstreetmap.org',
  overpass: [
    'https://overpass-api.de/api/interpreter',
  ],
  awsTerrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  // Sister endpoint covering historical dates (forecast covers ~today − a few
  // days through ~16 days ahead; archive covers everything older). Same auth
  // (none), same JSON shape, but parameters are start_date/end_date (YYYY-MM-DD)
  // instead of start_hour/end_hour. WeatherFetcher routes between the two
  // based on whether the requested timestamp's UTC date is before today.
  openMeteoArchive: 'https://archive-api.open-meteo.com/v1/archive',
  userAgent: 'Panorama/1.0 (eva.bonaccorsi@gmail.com)',
};

// Phase 2 fix: Overpass etiquette (see docs/modules/data-layer.md).
// These are hard rules; never relax without re-reading that doc first.
export const OVERPASS_MAX_CONCURRENT = 1;          // serial only — never increase
export const OVERPASS_QUERY_TIMEOUT_S = 60;        // sent inside Overpass QL [timeout:N]
// Generous on purpose — see data-layer.md "Overpass etiquette".
// Aggressive retries extend the IP ban window, so we wait longer rather than retry sooner.
export const OVERPASS_BACKOFF_429_MS = [10000, 30000, 90000]; // wait before each retry
export const OVERPASS_MAX_429_RETRIES = 3;         // give up after this many
export const OVERPASS_TILE_SIZE_M = 1000;          // 1km × 1km bounding boxes
export const OVERPASS_SPLIT_ON_504 = true;         // split tile into 4 sub-tiles on 504
