# Panorama — exhibition statement

> Painted landscapes generated from real Earth data, where the algorithm
> has been taught to read each scene through the eyes of a different
> early-twentieth-century master.

---

## The work

**Panorama** is a generative landscape painter. Given a place (latitude /
longitude), a moment (date, time, weather), and a viewing direction, it
fetches the actual elevation of the terrain, the actual sun position, and
(in future phases) the actual meteorology and astronomy for that exact
instant — then renders the scene as a painting whose every brushstroke is
oriented by the underlying image gradient and whose palette is borrowed,
deliberately, from a specific painter.

The technical inheritance is from an open-source pointillism algorithm
(`guillaume-gomez/to-pointillism`): Scharr-gradient orientation, 11×11
median underpainting, weighted-random palette sampling that produces
Seurat's optical-mixing vibration. Our modifications are surgical: stroke
width is specified as a physical measurement (millimetres) rather than
pixels, so a print at any resolution carries the same visual texture; the
default palette is extracted from the source via median-cut, but a curated
palette of nine painters can be opted into per render; brush length scales
with local image-gradient magnitude, so edges of mountains and horizons
become decisive long impasto, while skies and water — areas of low
gradient — settle into denser short marks.

The result is not a filter applied to a photograph. It is an instrument
for asking a question the photograph cannot answer: what would *this
specific place at this specific moment* look like in the visual language
of a painter who never saw it? Every plate that follows is one answer.

---

## Plates

### I. *Sturm* — storm seascape, after Nolde

A heavy sky bands of violet and gold, cut horizontally by a tear of warm
horizon light. Slashing whites over a deep teal sea, foam streaks gestured
in low-saturation diagonals that read as falling rain. The Nolde palette —
raw violets, blood-orange horizons, ocean-deep teals — translated into
gradient-aligned brush marks across a synthesised stormy seascape.
Reference: Emil Nolde, North Sea seascapes (c. 1909–1924).

### II. *Battersea, Imagined* — urban dusk, after Whistler

Building silhouettes at twilight, deep-blue night sky, the only structural
warmth in the frame the bright golden rectangles of lit windows above a
foreground of cool blue-on-grey wet-pavement reflections. Whistler's
nocturne palette — gold-leaf accents on blue-grey grounds — applied to a
city that exists nowhere and could be any quiet capital at the blue hour.
Reference: J. M. Whistler, Nocturne in Black and Gold: The Falling
Rocket; Nocturne: Battersea Bridge (c. 1872–1875).

### III. *Alpine Vibration* — alpine sunset, after Kirchner

Mountain silhouettes against an ultramarine sky shot through with
cadmium-yellow and orange. The Kirchner Davos vocabulary — cool-warm
complementary tensions, the Brücke flatness of Alpine forms — laid down
as gradient-aligned strokes across a synthesised sunset alpine scene.
Reference: Ernst Ludwig Kirchner, Davos and Swiss alpine paintings
(c. 1917–1934).

### IV. *Snow Storm* — whiteout blizzard, after Turner

A near-monochromatic field of cream and pale grey, with the only structural
darkness a dissolving blue-grey treeline at mid-frame. Falling snow as
warm-cool flecks distributed across the sky. Turner's late atmospheric
vocabulary — luminous whites and creams dissolving into faint pinks — on
a synthesised whiteout. The painting that gives the plate its title is
Turner's own *Snow Storm: Steam-Boat off a Harbour's Mouth*, but the
spiritual reference is *Hannibal Crossing the Alps*.
Reference: J. M. W. Turner, late seascapes and storm paintings
(c. 1812–1842).

### V. *Red Walls* — desert canyon, after Marc

A red-rock canyon split by light: bright orange-red sunlit cliff face on
the right, deep blue-purple shadow wall on the left, a sky shattered into
a mosaic of saturated complementaries — yellow, cobalt, green, violet.
Marc's Der Blaue Reiter symbolism — primary colours used as emotional
register rather than naturalistic record — applied to the warm-cool drama
of a sunlit canyon. Reference: Franz Marc, *Yellow Cow* (1911), *Tower of
Blue Horses* (1913), *Fate of the Animals* (1913).

### VI. *Anxious Twilight* — coastal twilight, after Munch

Horizon line cutting decisively between a charged sky of yellow-and-pink
nervous tension and a cool sea below. The Munch palette — vivid
complementaries, the colour register of *Sunset* and the *Karl Johan*
works — applied to a synthesised coastal scene. The result reads not as
description of weather but as description of *feeling about* weather.
Reference: Edvard Munch, sunset and twilight works (c. 1885–1908).

---

## Provenance and intent

Each plate is rendered at A3 @ 300 DPI (4961×3508 px), print-ready. The
algorithm is deterministic — given the same source and the same seed, the
output is identical — which means each plate is reproducible at any future
date. The palette key, brush settings, and source descriptor for each plate
are recorded in the project's iteration log (`.iterations/`).

The plates above are six chosen from a corpus of **nine geographic scene
types × nine painter palettes — all eighty-one combinations have been
rendered**, and a single A3 contact sheet showing the entire matrix lives
at `exhibition/matrix-9x9.png` (web-resolution JPEG at
`exhibition/web/matrix-9x9.jpg`). The matrix is the project's
"thoroughness statement": each row reads as one geography rendered through
nine painters, each column as one painter's voice carried across nine very
different geographies. The six selected plates above represent the
strongest individual examples; the matrix itself argues for the work's
generative nature at full scope.

The next phase introduces real meteorology (Open-Meteo API) and real
astronomy (NOAA SWPC, offline Hipparcos catalogue) as data inputs, so
that wind direction can shape brushstroke angle and lunar phase can shape
night-palette warmth — extending the basic argument that *real-world
data, properly observed, can be the painter's reference*.
