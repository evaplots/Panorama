# Astronomy (stub)

**Status:** stub. Empty module created during the doc/architecture alignment pass; implementation deferred until after Phase 2.5 stylization ships.

**Purpose:** Beyond-sun celestial state for the location/timestamp the user has chosen — stars, moon phase, constellations, aurora visibility. Today, Panorama only knows about the sun; this module is what unlocks night scenes.

**Owned files (when implemented):**
- `src/astronomy/Stars.js` — offline Hipparcos catalogue rendering (point cloud or instanced sprites)
- `src/astronomy/Moon.js` — moon position + phase + apparent size
- `src/astronomy/Constellations.js` — line geometry for the major IAU constellations
- `src/astronomy/Aurora.js` — Kp-driven aurora oval (NOAA SWPC API)

**Data sources:**
- Hipparcos catalogue (offline, bundled JSON) — public domain
- [NOAA SWPC](https://www.swpc.noaa.gov/) — Kp index for aurora probability

**Public API (to be defined):** TBD. Likely a single `getCelestialState(lat, lon, timestamp)` returning sun/moon/visible-stars/aurora-probability, complementing the existing `SkySystem`.

**Phase:** Post-2.5. Moon is the cheapest first deliverable; aurora is the most evocative.
