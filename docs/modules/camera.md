# Module: Camera & Composition

**Owner role:** 📸 Camera & Composition Engineer
**Phase introduced:** Phase 1 (basic), Phase 2 (ground-aware + walk mode), Phase 5 (smart scenic default)
**Files:**
- `src/camera/CameraController.js`
- `src/camera/ScenicDefault.js`

---

## Purpose

The camera is the user's eyes. This module decides:

- Where the eyes are (lat/lon → world coordinates, eye height above ground)
- Where they look (azimuth, elevation, FOV)
- How they move when the user drags or walks
- What "default view" to suggest for a new location

The camera operates in two modes:

- **Orbit mode** (default) — the user is anchored at the chosen location and drags to look around. The camera position is fixed; only its rotation changes. This is the simplest mode and what Phase 1 ships with.
- **Walk mode** (Phase 2+) — the user moves freely through the scene at human walking speed. WASD or arrow keys translate position; mouse drag rotates view. The camera always follows the terrain at eye height, so going up a hill the camera rises and in a valley it descends. Useful for finding the perfect composition by exploring on foot.

---

## Public API

```js
// CameraController.js
export const CameraController = {
  init(canvas: HTMLCanvasElement): THREE.PerspectiveCamera
  placeAt(location: Location, eyeHeight: number): void
  lookAt(azimuthDeg: number, elevationDeg: number): void
  setFOV(degrees: number): void
  setMode(mode: 'orbit' | 'walk'): void          // Phase 2+
  getMode(): 'orbit' | 'walk'                     // Phase 2+
  resetToOrigin(): void                           // Phase 2+: snap walker back to chosen location
  update(deltaSeconds: number): void              // called every frame from render loop
  getCamera(): THREE.PerspectiveCamera
  getViewpoint(): Viewpoint                       // current state (for export & UI)
};

// ScenicDefault.js
export const ScenicDefault = {
  suggest(location: Location, time: TimeSpec): {azimuth: number, elevation: number}
};
```

The `update()` signature changes in Phase 2 to take `deltaSeconds` (time since last frame). Walking mode needs this to move at consistent speed regardless of frame rate. Phase 1 implementations can ignore the parameter.

---

## Camera setup

Three.js `PerspectiveCamera`:

```js
const aspect = canvas.clientWidth / canvas.clientHeight;
const camera = new THREE.PerspectiveCamera(
  fovVerticalFromHorizontal(60, aspect),  // 60° horizontal
  aspect,
  0.1,                                     // near plane
  200000                                   // far plane (200km, matches alpine preset)
);
```

**FOV note:** Three.js wants vertical FOV. We expose horizontal FOV in the UI (more intuitive) and convert:

```js
const fovV = 2 * Math.atan(Math.tan(degToRad(fovH) / 2) / aspect) * (180 / Math.PI);
```

**Far plane warning:** at 200 000 units, depth precision is awful unless near plane is also large. We use 0.1 for now; Phase 4 may adopt logarithmic depth buffer (`logarithmicDepthBuffer: true` in renderer) for better far-plane precision.

---

## Eye placement

When `placeAt(location, eyeHeight)` is called:

```js
function placeAt(location, eyeHeight) {
  // Camera is at scene origin (0, eyeHeight + groundHeight, 0)
  // because the scene is centred on the user's location.
  const groundY = HeightSampler.getHeightAt(location.lat, location.lon);
  camera.position.set(0, groundY + eyeHeight, 0);
}
```

The scene origin is always the user's location at sea level. The camera sits above origin by `groundY + eyeHeight`.

In Phase 1 (no HeightSampler ready), `groundY` defaults to 0, which means the camera floats — fine until terrain is implemented. Phase 2's first task is wiring this up.

---

## Walk mode (Phase 2+)

Walk mode lets the user explore the scene on foot at human walking speed. It's the main interactive change in Phase 2 and the natural way to find a good viewpoint for a sunset photo.

### Conceptual model

The camera has a **ground anchor** (a horizontal X/Z position on the terrain) and an **eye height** (1.7 m by default). The actual camera Y-coordinate is `HeightSampler.getHeightAtWorld(anchor.x, anchor.z) + eyeHeight`.

In orbit mode the ground anchor is fixed at the chosen location and never moves. In walk mode the anchor translates based on input, and Y follows the terrain *every frame*.

### Implementation checklist (READ THIS — Phase 2 testing showed walk mode silently failing)

If pressing W does nothing, one of these is wrong. Verify each before declaring walk mode "done":

1. **Keyboard listeners are attached to `window`, not the canvas.** Canvas elements don't receive keyboard events unless explicitly focused with `tabindex`. Use `window.addEventListener('keydown', ...)` and `window.addEventListener('keyup', ...)`.

2. **The `keydown` handler updates `walkState.keys` regardless of mode.** Don't gate keydown on `mode === 'walk'` — that creates a race when the user toggles mode while holding W. Track keys always; consume them in `update()` only when mode is walk.

3. **`SceneManager.tick()` passes `dt` to `CameraController.update(dt)`.** Compute `dt = (now - lastFrameTime) / 1000` in seconds. Without `dt`, velocity multiplies by undefined → NaN → camera doesn't move.

4. **State path matches.** The mode lives at `state.viewpoint.mode`, not `state.mode` or `state.cameraMode`. Read and write the same path.

5. **Window-blur handler resets all keys.** Add `window.addEventListener('blur', () => walkState.keys = { ... all false })`. Without this, alt-tabbing while walking leaves W "stuck down" and the camera drifts forever.

6. **One-time debug logs to confirm wiring.** Add (and keep until verified):
   ```js
   window.addEventListener('keydown', e => {
     if (e.key === 'w') console.log('[CameraController] W keydown, mode=', mode);
   });
   ```
   If you don't see this log when pressing W, the listener isn't attached. If you see it but the camera doesn't move, the issue is downstream (mode check, dt, anchor update, or HeightSampler).

7. **Pointer lock is requested ONLY on user gesture.** Calling `canvas.requestPointerLock()` outside a click handler throws `SecurityError: Pointer lock cannot be acquired immediately after the user has exited the lock`. Hook it to a click listener on the canvas, not to mode change or any programmatic event.

8. **Walk mode does not require pointer lock.** Movement (WASD) must work even if pointer lock failed. Pointer lock is for *mouse-look comfort*; the keys should work regardless.

### Sub-checklist — "W keydown fires but camera doesn't move" (Phase 2 follow-up bug)

This was observed in testing: the debug log printed `[CameraController] W keydown, mode= walk` correctly, but the camera barely moved (a couple of metres total over many key presses). All eight items above checked out, so the bug is downstream. Verify each:

**A. The `keyup` event handler exists and clears the corresponding key.**
```js
window.addEventListener('keyup', e => {
  if (e.key === 'w' || e.key === 'ArrowUp')    walkState.keys.w = false;
  if (e.key === 's' || e.key === 'ArrowDown')  walkState.keys.s = false;
  if (e.key === 'a' || e.key === 'ArrowLeft')  walkState.keys.a = false;
  if (e.key === 'd' || e.key === 'ArrowRight') walkState.keys.d = false;
  if (e.key === 'Shift') walkState.keys.shift = false;
});
```
Without keyup, the key fires once via the OS auto-repeat, then keydown stops firing. Camera moves one frame and stops.

**B. Key-name case is consistent.** `e.key` returns lowercase letters when no modifier, uppercase when Shift is held. Always compare to lowercase OR normalise:
```js
const k = e.key.toLowerCase();   // do this once at the top
if (k === 'w') walkState.keys.w = true;
```
A common bug: writing `walkState.keys[e.key]` directly. When Shift is held, `e.key === 'W'`, and you set `walkState.keys.W = true` — a different property than `walkState.keys.w`, which the update loop reads. Camera doesn't move because `walkState.keys.w` is still false.

**C. Velocity persists across frames.** The walk update should *modify* `walkState.velocity`, not replace it with a fresh Vector3 each frame:
```js
// WRONG — recreates a zeroed vector each frame
const velocity = new THREE.Vector3();
velocity.lerp(desired, accel);
walkState.anchor.x += velocity.x * dt;

// RIGHT — modifies existing velocity in-place
walkState.velocity.lerp(desired, accel);
walkState.anchor.x += walkState.velocity.x * dt;
```

**D. `dt` is non-zero and reasonable.** Add a debug log inside `update`:
```js
if (mode === 'walk') {
  if (dt === undefined || dt === 0) console.warn('[Camera] dt is zero/undefined!');
  if (dt > 0.1) console.warn('[Camera] dt unusually large:', dt);
}
```
Expected `dt` is ~0.016 (60fps) to ~0.033 (30fps). If you see `dt: 0`, SceneManager isn't computing the time delta. If you see `dt: 1700000000` (a millisecond timestamp), SceneManager is passing the absolute time instead of the delta.

**E. The forward axis is computed every frame, not cached.** As the user looks around, `forwardAxis` changes. If it's computed once at module load, walking always goes the same direction regardless of facing.

**F. Anchor updates write to the same object the camera reads from.** Verify by logging:
```js
console.log('[Camera] anchor', walkState.anchor.x, walkState.anchor.z);
console.log('[Camera] camera.position', camera.position.x, camera.position.z);
```
After an update tick they should differ by exactly the eye offset (zero in X/Z). If `walkState.anchor` advances but `camera.position` doesn't, the assignment `camera.position.set(...)` is missing or being overwritten elsewhere.

**G. Walk distance counter and actual camera position are computed from the same source.** The "Walked: 2 m" readout in the UI should derive from `walkState.anchor`. If the counter increments but the camera doesn't move, two different "anchor" values exist somewhere — find and unify.

**H. No higher-priority code is resetting the camera.** Search the codebase for `camera.position.set(` — there should be exactly two call sites: `placeAt()` (orbit mode entry) and the walk-update path. Anything else (rebuild flow, mode toggle, scene:ready handler) overwriting position every frame will keep yanking the walker home.

### Internal state

```js
const walkState = {
  anchor: new THREE.Vector3(0, 0, 0),   // X and Z used; Y is recomputed each frame
  velocity: new THREE.Vector3(),         // current velocity in m/s (for smoothing)
  keys: { w: false, a: false, s: false, d: false, shift: false },
};
```

### Movement rules

- **W / ↑** — walk forward in the camera's current azimuth direction.
- **S / ↓** — walk backward.
- **A / ←** — strafe left.
- **D / →** — strafe right.
- **Shift (held)** — walk faster (jog speed).
- **Q / E** — (optional) raise/lower eye height for crouch and "tall person" perspectives. Skip in initial Phase 2 build.

Forward direction is the camera's azimuth projected onto the horizontal plane — vertical look angle does NOT affect walk direction. Looking up at the sky and pressing W still walks horizontally forward, not into the air.

### Speed

Defined in `src/config.js`:

```js
export const WALK_SPEED_MS = 1.4;          // m/s, normal walking pace
export const JOG_SPEED_MS = 4.0;           // with Shift held
export const ACCELERATION_MS2 = 8.0;       // ramp up/down so movement isn't snappy
```

Real-world averages: 1.4 m/s walking, 4 m/s jogging. We use these because the goal is "this is what the photo would look like from a vantage point you could walk to" — not a flight simulator.

### The update loop (walk mode)

```js
function update(dt) {
  if (mode === 'walk') {
    // 1. Compute desired velocity from input
    const targetSpeed = walkState.keys.shift ? JOG_SPEED_MS : WALK_SPEED_MS;
    const forwardAxis = getForwardHorizontal();   // unit vector in XZ
    const rightAxis = getRightHorizontal();
    const desired = new THREE.Vector3();
    if (walkState.keys.w) desired.add(forwardAxis);
    if (walkState.keys.s) desired.sub(forwardAxis);
    if (walkState.keys.d) desired.add(rightAxis);
    if (walkState.keys.a) desired.sub(rightAxis);
    if (desired.lengthSq() > 0) desired.normalize().multiplyScalar(targetSpeed);

    // 2. Smoothly accelerate toward desired velocity
    const accel = ACCELERATION_MS2 * dt;
    walkState.velocity.lerp(desired, Math.min(1, accel));

    // 3. Translate anchor on the horizontal plane
    walkState.anchor.x += walkState.velocity.x * dt;
    walkState.anchor.z += walkState.velocity.z * dt;

    // 4. Sample terrain and set camera Y
    const groundY = HeightSampler.getHeightAtWorld(walkState.anchor.x, walkState.anchor.z);
    camera.position.set(walkState.anchor.x, groundY + eyeHeight, walkState.anchor.z);
  }
  // Orbit mode: position is set in placeAt() and doesn't change here.
}
```

### Bounds

The walker should not be able to leave the terrain. Two safeguards:

1. **Soft bound** — clamp anchor X/Z to the radius defined by the current preset (e.g. 5 km for Urban). Going past the edge stops movement; the user gets visual feedback (the chosen-location marker is visible behind them).
2. **Hard bound** — if `HeightSampler.getHeightAtWorld()` returns the saturated edge value (the sampler clamps out-of-bounds queries — see the Terrain doc), undo the last position update.

### Returning home

`resetToOrigin()` snaps the walker back to the chosen location. UI surfaces this as a "↺ Reset position" button next to the mode toggle. Useful when the user has walked a long way and wants to start over.

### Mode switching

`setMode('walk')` keeps the current view direction; only translation behaviour changes. `setMode('orbit')` snaps the anchor back to the chosen location automatically (otherwise the user is "looking around from wherever they walked," which is confusing — orbit semantically means "from the chosen point").

The transition does NOT animate. Snap is intentional — animation hides where the camera went and feels gimmicky.

### Pointer lock (optional, recommended)

In walk mode, capturing the mouse via `canvas.requestPointerLock()` makes mouse-look feel natural (no edge-of-screen problem). Press `Esc` or click outside the canvas to release. Disable in orbit mode where the cursor needs to be free for UI.

This is the convention every first-person 3D tool uses — users will expect it.

### Performance note

`HeightSampler.getHeightAtWorld()` is called every frame in walk mode. It must be fast — a single bilinear lookup on the in-memory heightmap (described in the Terrain module). Don't accidentally make it async or hit a Promise; that would jitter the camera.

---

## Look direction

Internally we store `azimuth` (compass degrees) and `elevation` (pitch, degrees from horizontal). Conversion to a Three.js look-at vector:

```js
function lookAt(azimuthDeg, elevationDeg) {
  const az = degToRad(azimuthDeg);
  const el = degToRad(elevationDeg);
  // Compass to Three.js: azimuth=0 is north (+z toward viewer in our coords... wait)
  // Our convention: +X east, +Z south, +Y up.
  // So azimuth=0 (north) → look toward -Z.
  // azimuth=90 (east) → look toward +X.
  const dx = Math.sin(az) * Math.cos(el);
  const dy = Math.sin(el);
  const dz = -Math.cos(az) * Math.cos(el);
  camera.lookAt(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
}
```

Verify on first run with a compass overlay — easy to flip a sign and end up looking south when the UI says north.

---

## User input

### In both modes

- **Drag (left button or single touch):** rotates view. Horizontal drag → azimuth, vertical drag → elevation.
- **Wheel / pinch:** zoom (decreases FOV). Clamped 30°–90°.

Sensitivity: 0.2°/pixel feels right for FOV 60°. Scale with FOV (lower FOV = lower sensitivity, otherwise it's twitchy when zoomed). Elevation clamp: -85° to +85° (don't let users gimbal-lock straight up/down).

### Walk mode only (Phase 2+)

- **W / A / S / D** or **Arrow keys** — move forward / left / back / right at walking speed.
- **Shift (held)** — jog (faster).
- **Pointer lock** — clicking the canvas captures the mouse for natural look-around. Press `Esc` to release.

### Phase 5 ideas

- **Right-click drag in orbit mode:** pan eye position to neighbouring point. Probably overkill — restraint recommended given walk mode already exists.

After every input, emit `viewpoint:changed` so UI overlays (compass) can update.

---

## "Follow sun" mode

When `state.time.followSun` is true, the camera azimuth tracks the sun automatically as the time slider moves. This is set per-frame in `SceneManager.tick()`:

```js
if (state.time.followSun && state.sun) {
  CameraController.lookAt(state.sun.azimuth, currentElevation);
}
```

User dragging clears the flag automatically (we infer they want manual control). The UI shows a "Follow sun" toggle they can re-enable.

---

## Scenic default (Phase 1 minimal, Phase 5 smart)

### Phase 1 implementation

Trivial — face the sun, slight downward tilt:

```js
ScenicDefault.suggest(location, time) {
  const sun = SunCalculator.getSunPosition(time.timestamp, location.lat, location.lon);
  return { azimuth: sun.azimuth, elevation: -5 };
}
```

This works surprisingly well for most locations because sunset *is* the subject.

### Phase 5 implementation

Considers the terrain around the camera. Algorithm:

1. Sample heights along a ring at radius 10 km, every 5 degrees of azimuth (72 samples).
2. For each sample: compute "interest" = max height along that bearing within the ring, weighted by foreground content (taller foreground = higher interest).
3. Compute sun azimuth.
4. Score each candidate azimuth as: `0.6 * (cos(angle to sun) reweighted) + 0.4 * normalized_interest`.
5. Pick highest score.
6. Tilt slightly downward (-5°), more if foreground is high (mountain in the way → look up over it).

The 0.6/0.4 weights are tunable. They prioritise sun-facing but allow rotation toward an interesting peak if the sun-direction is dull (open horizon, no features).

---

## What this module does NOT do

- Doesn't own scene objects. Camera is a transform; nothing rides on it.
- Doesn't render. Asks Renderer to render with `getCamera()`.
- Doesn't decide eye height (that's a config constant).
- Doesn't load anything from network.

---

## How to extend

### Cinematic camera moves

For an animated time-lapse export (Phase 5+, way out of current scope): add `tween(targetViewpoint, durationMs)` that interpolates azimuth/elevation/FOV smoothly. Use easing.

### VR mode

`THREE.WebXRManager` integration. The PerspectiveCamera becomes a stereo pair. Out of scope, but the architecture allows it — VR is just two render passes per frame, both reading from this module.

### Multi-camera (split screen)

Adding a second camera (e.g. for picture-in-picture mini-map) means returning multiple cameras from this module. Would require a small refactor — `getCameras()` instead of `getCamera()`. Not recommended unless someone asks.

### Better drag inertia

Phase 5 polish. Track drag velocity, decay over ~500ms after release. Feels much better.

---

## Common pitfalls

- **Camera under terrain.** If `eyeHeight` is too small or the terrain is steep, vertices intersect the camera. The user sees through the ground. Solution: clamp `eyeHeight` minimum to 1.0 m, and run a "safety check" that raycasts down from camera and bumps up if needed.
- **FOV too wide → fisheye.** 90°+ horizontal FOV looks weird and exaggerates terrain. 50–70° feels natural. Default 60°.
- **Aspect ratio mismatches preview vs export.** This is the single most common user-confusion bug. Mitigation in Phase 4: render an A3 frame overlay in preview so the user composes for the print, not the screen.
- **Stale viewpoint after preset change.** If user changes preset (radius), camera is fine but far plane may now be wrong. `placeAt` should recompute the far plane based on radius.
- **Compass-to-Three.js sign errors.** Pick a convention, write it on the wall, never deviate. (Ours: +X east, +Z south, +Y up. Compass 0° = -Z direction.)

### Walk-mode specific

- **Movement coupled to look-elevation.** A common bug: pressing W moves the camera *along* its full 3D direction, including vertical. Looking up at the sky and pressing W flies the camera into the air. Fix: project forward direction onto the horizontal plane before moving.
- **Frame-rate-dependent speed.** If you forget `dt` in the velocity update, fast machines walk faster than slow ones. Always multiply by `dt`.
- **Camera popping on steep terrain.** When walking up a sudden cliff edge, the camera Y can jump several metres in one frame. Two options: smooth Y over a few frames (tradeoff: visual lag on real terrain changes), or simply forbid the walker from crossing such gradients. Soft option preferred — Phase 2 just smooths over 200ms.
- **Walker leaves the loaded terrain.** If the user walks past the radius, `HeightSampler` returns saturated edge values and the camera sits at constant Y over apparent terrain that ends. Either trigger a scene rebuild centred on the new position (expensive), or stop the walker at the boundary (simple — what we do).
- **Pointer lock surprises.** First-time users don't know `Esc` releases pointer lock. Show a brief on-screen hint the first time walk mode is entered.
- **Keys stuck in the down state.** If the user releases a key outside the canvas (e.g. switches tab while walking), the keyup event never fires and the walker keeps moving. Fix: `window.blur` event resets all key states.
- **Walking during scene rebuild.** If the user walks while ground cover or buildings are still loading, position updates correctly but new objects pop in around them. Acceptable; don't block input during rebuilds.

---

## Tests worth writing

- `lookAt(0, 0)` puts camera direction along -Z.
- `lookAt(90, 0)` puts camera direction along +X.
- Elevation clamp prevents gimbal lock.
- ScenicDefault returns a value within 90° of sun azimuth (Phase 1 sanity check).
- Walk-mode forward direction has zero Y component regardless of look elevation.
- Walking distance over time matches `WALK_SPEED_MS` within 5%.
- `setMode('orbit')` resets anchor to chosen location.
- `getHeightAtWorld` calls during walk update don't return undefined or NaN.
