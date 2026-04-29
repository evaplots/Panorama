# Weather (stub)

**Status:** stub. Empty module created during the doc/architecture alignment pass; implementation deferred until after Phase 2.5 stylization ships.

**Purpose:** Real-world meteorology for the location/timestamp the user has chosen — clouds, rain, fog, rainbow, wind. Drives both visual sky/atmosphere effects and (most importantly) the data→style binding for painterly stylization (e.g. wind direction → brushstroke angle).

**Owned files (when implemented):**
- `src/weather/WeatherFetcher.js` — Open-Meteo client
- `src/weather/CloudLayer.js` — billboard or volumetric cloud rendering
- `src/weather/Precipitation.js` — rain/snow particle systems
- `src/weather/Atmospherics.js` — fog density, rainbow geometry

**Data source:** [Open-Meteo](https://open-meteo.com) — free, no auth, historical and forecast endpoints.

**Public API (to be defined):** TBD when the module is built. The contract should expose a single async `getWeather(lat, lon, timestamp)` returning a normalized `WeatherSnapshot` shape consumed by the stylization pipeline (see `DATA-CONTRACTS.md`).

**Phase:** Post-2.5. Wind is the highest-value field because it's the cleanest binding to brushstroke direction — when this module is built, wind should land first.
