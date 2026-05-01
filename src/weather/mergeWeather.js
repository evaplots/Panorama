// V2 Step 5b — extracted helper, unchanged behaviour from its previous home
// in ControlsPanel.js. Lives next to WeatherFetcher.js so SceneManager (live
// 3D weather) and ControlsPanel (paint-time bindings) consume the exact same
// composition rule. The extraction is a pure refactor.

/**
 * Compose the effective WeatherSnapshot from a fetched snapshot (possibly
 * null) and the user's overrides (each field null = take fetched value;
 * a number = use the override). Returns:
 *   - undefined when both fetched is null AND every override is null
 *     (cold cache + untouched panel — consumers fall back to their
 *     no-weather path).
 *   - a WeatherSnapshot-shaped object when at least one source is present.
 *
 * Per-field rule: override wins if finite, else fetched value, else null.
 */
export function mergeWeather(fetched, overrides) {
  const o = overrides ?? {};
  const oWind = o.wind ?? {};
  const fWind = fetched?.wind ?? {};

  const pick = (override, fallback) =>
    Number.isFinite(override) ? override : (fallback ?? null);

  const merged = {
    wind: {
      directionDeg: pick(oWind.directionDeg, fWind.directionDeg),
      speedMs:      pick(oWind.speedMs,      fWind.speedMs),
      gustMs:       fWind.gustMs ?? null, // not user-overridable at v0
    },
    cloudCover_pct:    pick(o.cloudCover_pct,    fetched?.cloudCover_pct),
    humidity_pct:      pick(o.humidity_pct,      fetched?.humidity_pct),
    pressure_hPa:      fetched?.pressure_hPa ?? null, // not overridable at v0
    temperature_C:     pick(o.temperature_C,     fetched?.temperature_C),
    precipitation_mmh: pick(o.precipitation_mmh, fetched?.precipitation_mmh),
    weatherCode:       fetched?.weatherCode ?? null,
    timestamp:         fetched?.timestamp ?? null,
  };

  // Detect "fully empty" — all overridable fields null. Returning undefined
  // (not the empty-shaped object) keeps an optional `weather` field cleanly
  // absent under destructuring at consumer sites.
  const anyValue =
    Number.isFinite(merged.wind.directionDeg) ||
    Number.isFinite(merged.wind.speedMs) ||
    Number.isFinite(merged.cloudCover_pct) ||
    Number.isFinite(merged.humidity_pct) ||
    Number.isFinite(merged.precipitation_mmh) ||
    Number.isFinite(merged.temperature_C);
  return anyValue ? merged : undefined;
}
