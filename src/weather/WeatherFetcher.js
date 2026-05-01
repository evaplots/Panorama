// V2 Step 5 — Open-Meteo client. Mirrors src/osm/OSMFetcher.js's peek/fetch
// split: warm path (fetchWeather) writes the cache; paint-time path
// (peekWeather) reads cache only and never issues a network request.
//
// The cached value is the *mapped* WeatherSnapshot, not the raw API
// response — saves re-parsing the hourly arrays on every peek.

import { Cache } from '../data/Cache.js';
import { APIS } from '../config.js';

const WEATHER_TTL_MS = 3_600_000; // 1 h — same as the bucket size

const HOURLY_VARS = [
  'wind_direction_10m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'relative_humidity_2m',
  'surface_pressure',
  'temperature_2m',
  'precipitation',
  'weather_code',
].join(',');

/** Floor a timestamp to the start of its UTC hour. */
function floorToHourUTC(timestamp) {
  const d = new Date(timestamp);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** ISO-ish hour bucket label, e.g. "2026-05-01T14:00Z". Used in cache keys. */
function hourBucketISO(timestamp) {
  const d = floorToHourUTC(timestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:00Z`;
}

/** Open-Meteo forecast's start_hour/end_hour parameter format: "yyyy-mm-ddThh:mm" (UTC). */
function openMeteoHourParam(timestamp) {
  const d = floorToHourUTC(timestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:00`;
}

/** Open-Meteo archive's start_date/end_date parameter format: "yyyy-mm-dd" (UTC). */
function openMeteoDateParam(timestamp) {
  const d = floorToHourUTC(timestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function cacheKey(location, timestamp) {
  return `weather:${location.lat.toFixed(3)},${location.lon.toFixed(3)},${hourBucketISO(timestamp)}`;
}

/** UTC milliseconds at the start of today (00:00:00 UTC). */
function startOfTodayUTCms() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Predicate: archive endpoint covers the requested timestamp.
 *
 * Open-Meteo's forecast endpoint covers ~today − a few days through ~16 days
 * ahead; the archive covers everything strictly before today. The simplest
 * correct rule is: if the requested timestamp's UTC hour-bucket falls before
 * the start of today (UTC), use the archive — otherwise the forecast.
 */
function shouldUseArchive(timestamp) {
  return floorToHourUTC(timestamp).getTime() < startOfTodayUTCms();
}

function buildForecastUrl(location, timestamp) {
  const hour = openMeteoHourParam(timestamp);
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    hourly: HOURLY_VARS,
    wind_speed_unit: 'ms',
    timezone: 'UTC',
    start_hour: hour,
    end_hour: hour,
  });
  return `${APIS.openMeteo}?${params.toString()}`;
}

function buildArchiveUrl(location, timestamp) {
  const date = openMeteoDateParam(timestamp);
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    hourly: HOURLY_VARS,
    wind_speed_unit: 'ms',
    timezone: 'UTC',
    start_date: date,
    end_date: date,
  });
  return `${APIS.openMeteoArchive}?${params.toString()}`;
}

/**
 * Map the Open-Meteo hourly response into the WeatherSnapshot shape. The
 * forecast endpoint with start_hour=end_hour returns a single-element slice
 * (idx 0); the archive endpoint with start_date=end_date returns 24 entries
 * for the day, so we look up the row matching `bucketDate`'s UTC hour.
 */
function toSnapshot(json, bucketDate) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length === 0) {
    throw new Error('Open-Meteo response missing hourly data');
  }
  // Open-Meteo emits "YYYY-MM-DDTHH:MM" without a 'Z' when timezone=UTC.
  // bucketDate is the request's hour-bucket (also UTC), so compare on the
  // 13-char "YYYY-MM-DDTHH" prefix to find the right row.
  const targetPrefix = bucketDate.toISOString().slice(0, 13);
  let i = h.time.findIndex(t => typeof t === 'string' && t.startsWith(targetPrefix));
  if (i < 0) i = 0; // shouldn't happen with our tight start/end window, but be lenient
  return {
    wind: {
      directionDeg: h.wind_direction_10m?.[i] ?? null,
      speedMs:      h.wind_speed_10m?.[i]     ?? null,
      gustMs:       h.wind_gusts_10m?.[i]     ?? null,
    },
    cloudCover_pct:   h.cloud_cover?.[i]          ?? null,
    humidity_pct:     h.relative_humidity_2m?.[i] ?? null,
    pressure_hPa:     h.surface_pressure?.[i]     ?? null,
    temperature_C:    h.temperature_2m?.[i]       ?? null,
    precipitation_mmh: h.precipitation?.[i]       ?? null,
    weatherCode:      h.weather_code?.[i]         ?? null,
    timestamp: bucketDate,
  };
}

/**
 * Fetch the weather snapshot for `location` at the hour-bucket containing
 * `timestamp`. Cache hit short-circuits the network. Used only by the warm
 * path (SceneManager). Routed through `Cache.dedupe` so two warm triggers
 * inside one bucket coalesce into a single fetch.
 *
 * @param {{lat:number, lon:number}} location
 * @param {Date|number|string} timestamp
 * @returns {Promise<import('../style/Pointillism.js').WeatherSnapshot>}
 */
async function fetchWeather(location, timestamp) {
  const key = cacheKey(location, timestamp);
  return Cache.dedupe(key, async () => {
    const cached = await Cache.get(key);
    if (cached) return cached;

    // Forecast endpoint covers ~today − a few days through ~16 days ahead;
    // archive covers older. Cache key is endpoint-agnostic so a hit from
    // either endpoint is reusable.
    const url = shouldUseArchive(timestamp)
      ? buildArchiveUrl(location, timestamp)
      : buildForecastUrl(location, timestamp);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();

    const snapshot = toSnapshot(json, floorToHourUTC(timestamp));
    await Cache.set(key, snapshot, WEATHER_TTL_MS);
    return snapshot;
  });
}

/**
 * Cache-only read — never issues a network request, never blocks on an
 * in-flight warm fetch. Returns `null` on miss. Mirrors
 * `OSMFetcher.peekGroundCover`'s discipline: paint-time must not await
 * Open-Meteo, and the next paint after the warm lands picks up the data
 * automatically.
 *
 * @param {{lat:number, lon:number}} location
 * @param {Date|number|string} timestamp
 */
async function peekWeather(location, timestamp) {
  return (await Cache.get(cacheKey(location, timestamp))) ?? null;
}

export const WeatherFetcher = {
  fetchWeather,
  peekWeather,
  // Exposed for the SceneManager hour-bucket guard so the bucket logic stays
  // in one place rather than being re-implemented on the warm side.
  hourBucketISO,
};
