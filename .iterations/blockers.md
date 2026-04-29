# Blockers — items that genuinely need user input

Format: dated entry per blocker. Director appends here when autonomous progress
runs out of room and a human call is needed.

---

## 2026-04-29 — "Floating buildings" — need test location/screenshot

**What user reported:** "Fix floating buildings" appears in the autonomous loop's
prompt. No specifics given.

**What I investigated:**

- `src/osm/BuildingsBuilder.js:198-207` — anchoring uses `minH` (lowest vertex
  ground height across the footprint) with a 5cm `BASE_INSET_M` to defeat
  z-fighting. Logic looks correct: base = minH − 0.05 m, top = minH + buildingHeight.
- `src/terrain/HeightSampler.js:9-10` — bilinear interpolator clamps `u`, `v`
  to [0, 1], meaning queries outside loaded terrain extent silently return the
  terrain-edge height. Buildings near the OSM-radius perimeter could be
  anchored to the wrong height (terrain ends ~75km out by default; OSM data
  caps at 5km, so this is normally fine, but city-edge tests at the perimeter
  could trip it).
- On sloped terrain: min-height anchoring buries the up-slope corners. From
  the down-slope viewing direction this can read as "the building is floating
  on the high side" (because the visible ground around the down-slope corner
  is below the apparent base of the building from that angle). This is a
  perception artefact of the min-anchoring strategy, not a code bug.

**What I tried as a defensive hedge:** bumped `BASE_INSET_M` from `0.05` (5cm)
to `0.30` (30cm) in BuildingsBuilder.js. This is wider than typical DEM
interpolation noise (~10cm at AWS Terrain RGB resolution at zoom 13) and
won't be visible to a user since 30cm vanishes into the wall thickness, but
it would absorb genuine floating from interpolation drift. If the bug was
that simple, it's now masked.

**What I need from the user:**

1. The location they tested (lat/lon, or place name).
2. A screenshot showing the floating, ideally with the camera position visible.
3. Any console output from the test (BuildingsBuilder logs stats per build).

**Decision needed:** if the issue persists after the inset hedge, we need to
choose between:

- **(A)** Per-vertex anchoring of the building base — each base vertex sits at
  its own ground height. Visually faithful on slopes but breaks the "rectangular
  footprint" assumption and complicates side-wall geometry.
- **(B)** Tilted-base anchoring — flat base, but rotated to follow the slope.
  Realistic for small buildings, breaks for big footprints over varied terrain.
- **(C)** Excavation skirt — keep min-anchoring but add a darker "foundation"
  ring around the building's footprint up to the local ground height. Hides
  the buried-corner issue without changing geometry. Cheapest by far.

Recommendation: (C) when the user confirms the issue, after we see what they
actually saw.

**Until I hear back:** moving on. Floating-buildings is parked behind the
defensive inset hedge.

---

## 2026-04-29 03:28 — Cloud routine (/schedule) blocked: PANORAMA isn't on GitHub

**What user requested:** an hourly cloud routine ("Phase 2.5 Director — hourly")
as a laptop-closed fallback to the in-session /loop. Cloud routines run in
Anthropic-hosted CCR environments and clone from a `git_repository.url` —
they have no way to access `D:\claude-projects\PANORAMA` on the user's local
machine.

**What I checked:** `git rev-parse --is-inside-work-tree` returned
"not a git repository". PANORAMA is local-only. No `.git/` directory, no
remote configured, no GitHub URL.

**Options for the user:**

- **(A)** Push PANORAMA to GitHub. Either the user runs the auth themselves
  (`gh repo create`, `git init && git push`) or grants me an auth path I
  don't currently have. After that, /schedule can target the GitHub URL.
- **(B)** Create the cloud routine WITHOUT a `sources` entry. The agent runs
  but has no codebase to work on — effectively useless for this project.
- **(C)** Skip /schedule for now; rely only on the in-session /loop (job
  `0acf8fd4`, every 30 min while Claude Code is open). When the laptop
  closes, work pauses; resumes when the user returns.

**Decision needed:** which path. Recommendation is (A) — getting PANORAMA
onto GitHub also enables version control, PR-based iteration, and external
collaboration. But it's a meaningful one-time setup the user should drive.

**Until I hear back:** /schedule is not created. /loop continues to fire
every 30 min in this session.

**Update 2026-04-29 03:39:** User created the GitHub repo at
`https://github.com/evaplots/Panorama.git`. Local repo initialised, first
commit `b884d54` ready. Push from CLI is hanging on Git Credential Manager
auth popup (background bash can't surface the popup). Workaround: user runs
`!git push -u origin main --force-with-lease` interactively in this session,
authenticates once, push lands, then routine creation can proceed. Blocker
downgraded from "no GitHub repo" to "transient auth step in progress".
