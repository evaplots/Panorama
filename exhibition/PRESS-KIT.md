# Panorama — press kit

A press-friendly summary of the project for journalists, applications,
catalogue notes, or any single-doc share where one file needs to convey
*what this is, what it looks like, and how it works*.

---

## In one sentence

> **Panorama** generates painterly landscape artwork from real-world data,
> where the algorithm has been taught to read each scene through the eyes
> of a different early-twentieth-century master — Nolde's storms,
> Whistler's nocturnes, Marc's primary symbolism, Turner's atmospheric
> dissolution, and others.

## In one paragraph

Panorama is a generative landscape painter. Given a place (latitude /
longitude), a moment (date, time, weather), and a viewing direction, it
fetches the actual elevation of the terrain and the actual sun position
for that exact instant, then renders the scene as a painting. Every
brushstroke is oriented by the underlying image's gradient; the palette
is borrowed, deliberately, from a specific painter — nine curated palettes
extracted from reference works span sunset (Munch), alpine cool (Kirchner),
gestural earth (Soutine), nocturne (Whistler), atmospheric haze (Turner),
primary symbolism (Marc), storm (Nolde), ornamental gold (Klimt), and
sun-drenched (Macke). The result is not a filter applied to a photograph;
it is an instrument for asking what *this specific place at this specific
moment* would have looked like in the visual language of a painter who
never saw it.

## Six exhibit plates

Curated portfolio of six prints, each A3 @ 300 DPI, ready to hang. Wall
labels in [`../EXHIBITION.md`](../EXHIBITION.md). Print files in
`exhibition/`; web previews (~400 KB JPEG each) in `exhibition/web/`;
process plates (source-and-painted side-by-side) in `exhibition/process/`.
A 3×2 contact sheet of all six plates lives at
`exhibition/exhibition-contact-sheet.png`.

| Plate | Title | Painter | Scene |
|------|------|---------|------|
| I    | *Sturm* | Emil Nolde | storm seascape |
| II   | *Battersea, Imagined* | J. M. Whistler | urban dusk |
| III  | *Alpine Vibration* | E. L. Kirchner | alpine sunset |
| IV   | *Snow Storm* | J. M. W. Turner | whiteout blizzard |
| V    | *Red Walls* | Franz Marc | desert canyon |
| VI   | *Anxious Twilight* | Edvard Munch | coastal twilight |

## Technical fact sheet

| Aspect | Value |
|--------|-------|
| **Output format** | A3 (297 × 420 mm) at 300 DPI = 4961 × 3508 px |
| **Stroke width** | Physical 1.2 mm (rendered at 14 px at 300 DPI) — independent of export resolution |
| **Algorithm lineage** | Pointillism port from open-source `guillaume-gomez/to-pointillism` (TypeScript / OpenCV.js / ColorThief). Modifications: physical-mm stroke width, gradient-driven length variation, opt-in curated painter palettes alongside default source extraction, sliding-histogram median (Huang's algorithm) for perf, three-pass separable box blur as Gaussian-equivalent gradient smoothing |
| **Pipeline** | Source → median-cut palette extraction (or curated override) → optional saturation+hue palette extension → Scharr gradient → Gaussian-equivalent smoothing → 11×11 RGB median underpainting → weighted-random palette sampling per stroke → gradient-aligned elongated-ellipse strokes |
| **Determinism** | Same source + same seed + same opts = identical output, every time. Mulberry32 PRNG, no live state reads during transform. |
| **Render time** | ~22 seconds per A3 print on commodity Node-canvas at default v1.4 settings |
| **Tech stack** | Vanilla JavaScript (ES2022 modules), Three.js for the live scene render, vanilla-JS pointillism port, no proprietary deps |
| **Data sources (current)** | Free-tier APIs only: AWS Terrain Tiles (DEM), Nominatim (geocoding), SunCalc (solar position), Overpass (OSM features) |
| **Data sources (planned)** | Open-Meteo (weather → wind direction shapes brushstroke angle), NOAA SWPC (Kp index → aurora), Hipparcos (offline star catalogue) |
| **License / availability** | Source code on GitHub at <https://github.com/evaplots/Panorama> |

## How it differs from a Photoshop filter

The crucial distinction: Panorama is **not** a post-process applied to a
photograph. The scene is generated from data — terrain elevation, sun
azimuth — and the painter's palette is curated to that scene by a human
choice, not extracted automatically from the source. A "filter" produces
the same effect on any image; Panorama produces a different painting
*per painter × per scene × per moment*, with the algorithm structuring
each one through gradient-aligned brushwork that responds to the
underlying form.

The output is reproducible, archivable, citation-able. Same coordinates,
same date, same painter — the same painting, every time.

## What's next

- **Real meteorology** (Open-Meteo) so wind direction shapes brushstroke
  angle and cloud cover modulates desaturation.
- **Real astronomy** (NOAA SWPC, offline Hipparcos) for night palettes,
  moon phase, aurora visibility.
- **Real OSM features** (buildings, vegetation) so urban scenes carry
  genuine structural fidelity to specific places.
- **Open invitation**: collaborations welcome — particularly with
  curators thinking about climate-as-data, astronomy-as-data, or
  generative-art-as-citizen-science.

## Press contact

The project is by Eva Bonaccorsi. Press, exhibition enquiries, and
collaboration proposals via the email in the GitHub repository.
