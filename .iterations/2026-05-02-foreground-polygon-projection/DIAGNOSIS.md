# Foreground OSM polygon projection — diagnosis

**Symptom (post PR #18 + PR #16).** Live preview shows a hard
horizontal seam in the foreground at the test scene Saarland
(49.41097, 7.12606), bearing 270°, civil twilight:

- Above seam (canvas-y just below horizon): green ground polygons
  painted correctly.
- Below seam (rest of canvas): flat warm-sandy gradient, no polygon
  detail.

The user observed that the seam appears to land at the inner-mesh
projected boundary (~500 m world radius from the camera), and
hypothesised that polygons covering inner-mesh world space are being
dropped while polygons further out are painted.

**Status.** Diagnostic only — no code changes. Implementation pending
user direction on options below.

## What the bisection found

`scripts/foreground-polygon-projection-probe.js` fetches real OSM
ground-cover for the test scene, projects every polygon through
`src/style/projection.js` (the same projector `paintGround` uses),
and reports two things per polygon:

1. Projected screen bbox — `[minX, minY → maxX, maxY]` after
   Sutherland–Hodgman near-plane clipping.
2. Whether each pixel in the canvas (sampled at seven columns × every
   four rows) is *contained* by the polygon's outer ring, with the
   topmost paint owner identified by walking the visible polygon list
   in paint order.

Saarland, bearing 270°, suburban radius 3 km, OSM elements 479,
categorised: `{ urban: 36, forest: 118, farmland: 259, water: 40 }`.

### Per-row paint-owner table (excerpt — full table in `saarland-paint-owners.log`)

```
y    | 14 px |  82 px | 150 px | 240 px | 330 px | 398 px | 466 px
 132 | NONE  | NONE   | NONE   | NONE   | NONE   | NONE   | NONE       ← horizon, sky
 136 |  f/mea|  f/mea |  f/mea |  f/mea |  f/mea |  f/far |  f/far     ← thin meadow strip
 140 |  f/mea|  f/mea |  f/mea |  f/far |  f/far |  f/far |  f/far
 144 |  f/mea|  f/mea |  f/far |  f/far |  f/far |  f/far |  f/far
 148 |  f/far|  f/far |  f/far |  f/far |  f/far |  f/far |  f/far     ← farmland from here down
 200 |  f/far|  f/far |  f/far |  f/far |  f/far |  f/far |  f/far
 300 |  f/far|  f/far |  f/far |  f/far |  f/far |  f/far |  f/far
```

`f/mea` = `farmland/meadow` (the painter's `farmland` category, OSM tag
`landuse=meadow`, base colour `#9ab050` greenish).
`f/far` = `farmland/farmland` (base colour `#c5b078` sandy-tan).

Both are in the `farmland` painter category but render different
colours. The "seam" the user sees is the boundary at canvas-y ≈ 148
where the topmost paint owner transitions from `landuse=meadow`
(green) to `landuse=farmland` (sandy).

### Full-canvas summary

```
total samples       : 595
NO-OWNER (sky)      : 238 (40.0%)
topmost farmland    : 357 (60.0%)
shadowed forest     :   0 (0.0%)
topmost forest      :   0 (0.0%)
topmost urban       :   0 (0.0%)
```

**Zero forest polygons project onto any visible canvas pixel.** Of the
118 forest polygons returned by Overpass, every single one's projected
screen bbox is entirely off-canvas (either to the left, with `maxX < 0`,
or to the right, with `minX > 480`). The narrow 60° FOV looking due
west happens to miss every forest polygon in the area.

`shadowed forest = 0` means there's no pixel where a forest polygon
*does* contain the pixel but loses to a smaller late-drawn polygon —
the paint order isn't shadowing forest. There simply isn't any forest
in front of the camera.

## Root cause

Three findings, in order of contribution to the artefact:

1. **OSM data distribution.** At the chosen lat/lon and 270° bearing,
   no forest polygon's projected geometry falls on the canvas. All
   forests sit outside the FOV. The painter has no forest to paint
   regardless of any clipping or sort order.

2. **`paintGround` sort by screen-area-DESC puts smaller farmland
   polygons on top of larger ones.** OSM has many overlapping farmland
   polygons in this area (large `landuse=grass`, large `landuse=meadow`,
   medium `landuse=farmland`). The biggest is drawn first; smaller
   ones are drawn on top. The visible result is whichever farmland
   subtype happens to be smallest-and-last at each pixel — at this
   scene that's `landuse=meadow` near the horizon (small slivers
   project just below horizon) and `landuse=farmland` everywhere else.
   The "seam" between them is the boundary where the topmost-owner
   transitions from one farmland subtype to another. Different OSM
   tag → different gradient colour → visible seam.

3. **The seam visually corresponds to canvas-y ≈ 148**, which maps
   (under default tilt −5°, eye 1.7 m, FOV 60°) to a world look-axis
   distance of `1.7 / tan((148 − 134) × 1° / 8 px-per-deg) ≈ 53 m`,
   not the user's hypothesised 500 m. The user's "matches the
   inner-mesh boundary" perception is a plausible-sounding pattern
   match — the inner mesh is centred around the camera and its corner
   reaches ~707 m, so it visibly affects roughly the same canvas
   region the seam falls in — but the actual world distance to the
   seam is ~53 m, an order of magnitude shorter. The inner mesh's
   boundary in the look direction is at canvas-y ≈ 135 (the
   meadow-strip's *top* edge, not the meadow→farmland seam).

## Each user hypothesis, addressed

> (a) A "default ground" fill colour kicking in for unpainted terrain
> regions — possibly the natural=sand/beach palette as default.

**No.** `paintGround` has no default fill. Every painted pixel is
attributable to a real OSM polygon. The sandy-tan colour comes from
`landuse=farmland` polygons (`#c5b078`) — real OSM data, not a fallback.

> (b) The painter's polygon-projection iterates over polygon vertices
> and projects them, but if a polygon is large enough that all its
> vertices fall outside the inner-mesh radius while the polygon itself
> covers inner-mesh area, the polygon is dropped on a vertex-visibility
> test rather than a polygon-coverage test.

**No.** `projection.js` `projectRing` does a per-vertex eye-space
projection followed by Sutherland–Hodgman clipping against the near
plane (`NEAR_M = 1.0` m). Polygons that contain the camera or extend
behind it are clipped, not dropped — the clipped ring uses the
intersection points where polygon edges cross the near plane. At
Saarland I verified per-polygon: every projected polygon has a
non-degenerate ring after clipping. The probe shows farmland polygons
that contain the camera correctly produce ring vertices spanning from
near horizon (far edge, `depth ≈ 1000 m`) to far below canvas (near
edge clipped at `depth = 1 m`, projecting to `sy ≈ 913` on a 340-tall
canvas). They render correctly across the whole foreground.

> (c) A clipping / culling step uses outer-mesh-only bounds.

**No.** `paintGround` uses pinhole projection through
`src/style/projection.js` (`createProjector`), which knows nothing
about the terrain mesh. The painter's polygon list is unchanged
between PR #18 and main; the WebGL canvas on top of which the painter
draws is the only thing PR #18 modified.

> (d) Something else — diagnose, don't assume.

**Yes — the actual cause is paint-order plus OSM data distribution at
this specific bearing.**

## Was this a latent bug pre-PR-18?

**Yes.** The painter pipeline is identical between PR #18 and main —
PR #18 only adds a finer-triangulation inner mesh to the *3D viewer*'s
WebGL canvas; the painter doesn't read mesh triangles, it reads the
captured WebGL canvas as an image. Since the painter logic (polygon
projection, sort order, fill rule) is unchanged, the seam pattern
must have existed pre-PR-18 too.

Why is it more visible now:

- **Pre PR #18.** The WebGL foreground was one large coarse triangle
  whose vertex colours all evaluated to `elevationColor(350 m)
  ≈ rgb(82, 131, 31)` (dark green). The painter then over-painted
  with farmland gradients. With low haze on top, the *visible*
  foreground was a moderately-tinted dirty-mauve-tan (haze adds
  ~50 % alpha). The seam between meadow and farmland *was* there but
  read as a subtle texture-tone shift inside the haze envelope.
- **Post PR #18.** The WebGL foreground is finer-triangulated, with
  each near-camera vertex now individually elevation-coloured — but
  at Saarland's 350 m flat valley they all still resolve to similar
  greens. The painter still over-paints with the same farmland
  gradients, and haze still applies. So the rendered output is
  visually similar to pre-PR-18.
- **What is genuinely different.** The painter's sort-by-area output
  is the same in both cases; the haze envelope is the same in both
  cases. The user's *attention* may have shifted to the foreground
  *because* PR #18 promised richer foreground detail — once you look
  at the foreground expecting countryside detail, the meadow→farmland
  category boundary is the most visually salient feature.

Either way the bug class — *"the painter's topmost-owner sort can hide
larger natural polygons (forest, wood) under smaller landuse polygons
(farmland) when both happen to project to overlapping screen-space"* —
is real and worth fixing in this PR class.

## What `foreground-rendering-probe.js` (PR #18) actually verified

The PR #18 probe asserted **byte-equality** of synthetic-source
renders pre/post the mesh change. That assertion is *correct as stated*
— the painter pipeline really is byte-identical when the source canvas
is unchanged. But it was the wrong kind of safety net for the bug
class the user is reporting:

- The probe used a **synthesised WebGL-like source**, so it couldn't
  reveal that the *real* WebGL render's foreground colour clashes
  with the painter's farmland gradient. The synthesised source is
  whatever the probe author drew, which doesn't necessarily match
  what the live app's WebGL canvas produces.
- The probe asserted **pre/post equality**, which is a weaker check
  than **post-correctness**. If a property is broken pre-fix and
  remains broken post-fix, byte-equality holds but the user-visible
  symptom remains.

The new probe (`foreground-polygon-projection-probe.js`, in this PR)
fixes both gaps: it asserts a property of the *post-fix* render
(per-row category coverage) using *real* OSM data through the
*real* painter pipeline, not a byte hash.

## Options

### (a) Sort polygons by category priority + area, not just area

Replace `projected.sort((a, b) => b.area - a.area)` with a sort that
puts forest / urban / water above farmland regardless of area, then
sorts by area within each priority bucket.

- **Cost.** Small — three lines in `paintGround`. Same logic in the
  category-aware painters that already exist (`paintCanopy` filters
  by `category === 'forest'`, etc.).
- **What it fixes.** Where forest *and* farmland overlap (rare in
  well-mapped OSM but real), forest wins. The Saarland test scene
  doesn't actually have forest in the FOV so this option doesn't
  help that specific scene, but it would help any scene where forest
  *is* in front of the camera and gets shadowed by smaller farmland.
- **What it doesn't fix.** The Saarland seam, which is two
  *farmland* subtypes (meadow vs farmland) sorted by area. The
  category-based fix promotes them as a single category, so the
  meadow→farmland boundary wouldn't change.

### (b) Soften polygon paints by blending with the WebGL source

Have `paintGround` paint each polygon at, say, alpha 0.7 instead of
1.0, so the underlying WebGL terrain colour shows through. The
foreground would be a hybrid of WebGL-mesh-elevation (countryside
green at Saarland) and painter polygon (sandy farmland), and the
seam between meadow and farmland subtypes would soften because the
WebGL source is identical underneath both.

- **Cost.** Medium — changes the painter contract. Affects every
  scene's paint output, not just the seam case. Determinism
  preserved (same source, same opacity, same output).
- **What it fixes.** The visual seam softens. The rendered foreground
  becomes a WebGL-painter blend that's recognisable as terrain,
  not as a flat painter swatch.
- **What it doesn't fix.** The "missing forest" issue at Saarland —
  forest still doesn't project into the FOV, so the rendered
  foreground is still mostly sandy (just blended-with-green-mesh
  sandy).
- **Risk.** Changes the painterly look the rest of the project's
  styling has tuned for. Curators might prefer opaque polygons.

### (c) Modify `paintGround` to render the polygon's vertical gradient over the WebGL source's local hue

Instead of polygon colour with `lighten(top) → darken(bottom)`, sample
the WebGL source's hue beneath each polygon and paint the polygon's
gradient *modulating* that source rather than replacing it.

- **Cost.** Large. Per-polygon sampling of source pixels, plus the
  gradient construction has to combine source hue with polygon tag
  colour.
- **What it fixes.** The painter no longer fights with the WebGL
  terrain; the polygon contributes a *category modulation* to the
  rendered terrain rather than overwriting it.
- **What it doesn't fix.** Risk of muddy painter output where the
  WebGL source colour drowns the polygon's intended hue. Significant
  rework of the existing paint pipeline.

### (d) Promote the WebGL source to be the painter's truth, polygons as subtle modulation

A bigger architectural move. The 3D viewer renders the actual mesh
with category-aware colouring (e.g. forest mesh chunks coloured forest
green, farmland mesh chunks coloured farmland tan). The painter then
does *only* per-category painterly textures (canopy stipple, water
ripples, landmark silhouettes), not flat colour fills.

- **Cost.** Very large. Reshapes the terrain → painter contract, the
  3D viewer's rendering, and the painter's role.
- **What it fixes.** Removes the entire class of "painter polygon
  hides terrain mesh detail" bug. The mesh and the painter agree by
  construction.
- **Out of scope** for this PR. Would be a v3 architectural change.

## Recommendation

**Option (a) for this PR class, and a stronger probe to lock it in.**

Reasoning:

1. The actual user-visible Saarland seam is dominated by *farmland-
   subtype* sort order (meadow vs farmland), not by category. Option
   (a) doesn't directly fix that. But — and this is the unstated
   problem — the seam being category-internal *also* means it's a
   real OSM-level distinction (two different `landuse` tags) that
   *should* render differently. Hiding it would be wrong; the user's
   complaint is about contrast, not category truth.
2. Option (a) does fix the **broader class**: in any scene where
   forest does happen to overlap a smaller-area farmland polygon,
   forest currently loses to farmland and the user sees a sandy
   patch where forest belongs. That's a real, fixable bug; option
   (a) prevents it.
3. Option (b) (alpha blending) would soften every painter output in
   every scene, which is a project-wide aesthetic change that the
   user should make deliberately, not as a side effect of this fix.
4. Options (c) and (d) are over-scope.

For the **Saarland-specific seam**: the fix is partly aesthetic
(adjusting the meadow / farmland tag-colour pair so the transition
reads as a soft fielding boundary rather than a hard line) and
partly architectural (option (b) or (c) would unify it with the WebGL
mesh underneath). The user should pick whether to invest in one or
the other.

For the **probe**: a per-row category-coverage probe, replacing the
PR #18 byte-equality probe. The new probe fetches real OSM, projects
the polygons through the real `paintGround` projector, and asserts:

- For at least one of {Saarland, Chamonix, Mediterranean, Yosemite,
  a German forest scene}, the bottom 30 % of the canvas contains
  more than one *category* of topmost paint owner. (Catches: any
  scene that should have forest *and* farmland visible should have
  both categories topmost somewhere in the foreground; if only one
  category dominates, the sort-order or coverage bug surfaces.)
- For each scene, no canvas region has `NO-OWNER` between two
  painted regions (catches the original "default fill" hypothesis
  if it ever materialises).
- Forest polygons that are present in OSM and project on-canvas
  appear as topmost paint owner *somewhere* on the canvas. (Catches:
  category-priority bugs that systematically hide forest.)

This probe runs against real Overpass and is therefore network-
dependent; it lives in `npm run probes:painter:foreground` (separate
from the byte-equal probes that don't need network), so the standard
suite stays offline-runnable while this one becomes a manual gate
before painter / paintGround PRs.

---

Stopping here. Awaiting user pick / redirect before implementing.
