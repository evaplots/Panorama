# Wildlife (stub)

**Status:** stub. Aspirational / future phase. Created during the doc/architecture alignment pass to signal scope; implementation may be deferred indefinitely per the scope-realism review.

**Purpose:** Bring living things into the scene as procedural flocks and (optionally) ambient sound — bird species likely to be at this location on this date, their calls as a soundscape.

**Owned files (if implemented):**
- `src/wildlife/EBirdFetcher.js` — recent observations within radius (eBird API)
- `src/wildlife/XenoCantoFetcher.js` — bird-call audio clips per species
- `src/wildlife/Flocks.js` — procedural flock animation, instanced billboards
- `src/wildlife/Soundscape.js` — Web Audio mixing of bird calls

**Data sources:**
- [eBird](https://ebird.org/data/download) — sightings, requires free API key
- [xeno-canto](https://xeno-canto.org/) — bird-call recordings, CC-licensed

**Public API (to be defined):** TBD.

**Status note:** The scope-realism review flagged xeno-canto soundscape as "scope-creep theatre" — a static print doesn't need audio, the module is at risk of eating weeks for output that doesn't appear in the final image. Procedural flocks are more defensible (visible in the print, real eBird data). If this module ships at all, flocks ship and audio doesn't.
