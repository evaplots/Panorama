# Module: Scene Orchestrator

**Owner role:** 🎬 Scene Orchestrator
**Phase introduced:** Phase 1
**Files:**
- `src/scene/SceneManager.js`
- `src/scene/Renderer.js`

---

## Purpose

The orchestrator is the only module that knows about all the other modules. It wires them together, owns the Three.js scene graph and camera, and runs the render loop.

Other modules don't talk to each other — they talk to the orchestrator (or, for state changes, through the event bus). This keeps the dependency graph clean.

---

## Public API

```js
// src/scene/SceneManager.js
export const SceneManager = {
  init(canvas: HTMLCanvasElement): void
  rebuild(): Promise<void>     // rebuild from current state
  dispose(): void              // tear down (for tests / hot reload)
  getScene(): THREE.Scene
  getCamera(): THREE.Camera
  getRenderer(): THREE.WebGLRenderer
};
```

The `getXxx` accessors exist so the Export module can read the renderer/scene/camera. They're read-only by convention — Export must not mutate them except temporarily during `export()`.

---

## Responsibilities

1. **Initialise** Renderer, Sky, Camera, and (in later phases) attach builders' output to the scene.
2. **Listen for state changes** that should trigger a rebuild (`location:changed`, `preset:changed`).
3. **Run the render loop** at requestAnimationFrame frequency.
4. **Coordinate async builds** — when a rebuild is in progress, the old scene continues to render until the new one is ready, then atomically swap.
5. **Dispose old objects** properly (geometries, textures, materials) to avoid memory leaks.

---

## NOT responsibilities

- Doesn't fetch data. Builders do that.
- Doesn't compute sun position. Sky does that.
- Doesn't handle DOM events. UI does that, dispatching state changes.
- Doesn't do export. Export reads from us but operates independently.

---

## Internal structure

```
SceneManager
  ├── scene: THREE.Scene
  ├── camera: returned by CameraController.init()
  ├── renderer: returned by Renderer.init()
  ├── currentTerrainGroup: THREE.Group | null
  ├── currentOSMGroup: THREE.Group | null
  ├── rebuildTokenCounter: number     // for cancelling in-flight rebuilds
  └── methods: tick(), rebuild(), swapGroups(), dispose()

Renderer
  ├── webglRenderer: THREE.WebGLRenderer
  ├── handleResize()
  └── (optional Phase 5: post-processing pipeline)
```

---

## The render loop

Pseudocode:

```js
function tick() {
  requestAnimationFrame(tick);
  const now = Date.now();
  SkySystem.update(state.time.timestamp, state.location);
  CameraController.update();
  if (state.time.followSun && state.sun) {
    CameraController.lookAt(state.sun.azimuth, state.sun.altitude * 0.3);
  }
  renderer.render(scene, camera);
}
```

The loop runs unconditionally — even during a rebuild — so the user always sees something.

---

## Rebuild flow

When `location:changed` or `preset:changed` fires:

```js
async function rebuild() {
  const myToken = ++rebuildTokenCounter;
  state.set('scene.status', 'loading');

  try {
    const [newTerrain, newOSM] = await Promise.all([
      TerrainBuilder.build(state.location, preset.terrainRadius),
      OSMFeatureBuilder.build(state.location, preset),  // Phase 2+
    ]);

    // Cancellation check: did another rebuild start while we were waiting?
    if (myToken !== rebuildTokenCounter) {
      newTerrain && disposeGroup(newTerrain);
      newOSM && disposeGroup(newOSM);
      return;
    }

    swapGroups(newTerrain, newOSM);
    CameraController.placeAt(state.location, EYE_HEIGHT_M);
    state.set('scene.status', 'ready');
  } catch (err) {
    state.set('scene.status', 'error');
    state.emit('scene:error', { message: err.message });
  }
}
```

Note the `rebuildTokenCounter` pattern — it's how we cancel in-flight rebuilds when the user types another location before the previous one finished.

---

## Disposal

Three.js doesn't garbage-collect GPU resources. When swapping a group:

```js
function disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
    if (obj.material?.map) obj.material.map.dispose();
  });
  scene.remove(group);
}
```

Forgetting this turns the app into a memory leak after a few rebuilds.

---

## How to extend

### Adding a new builder (e.g. clouds in Phase 5)

1. Create `src/clouds/CloudsBuilder.js` with `build(location, time) → Promise<Group>`.
2. Add to the rebuild Promise.all.
3. Track the group so it gets disposed on next rebuild.

### Adding a new render pass (e.g. bloom)

1. This belongs to the Sky engineer, but they coordinate with you.
2. Renderer becomes a `THREE.EffectComposer`. The render loop calls `composer.render()` instead of `renderer.render()`.
3. All other modules' calls to `renderer` must keep working (they only read it, don't render through it directly except Export).

### Adding hot reload support

Vite gives you HMR for free for the UI module. For the scene, you'd add `import.meta.hot?.accept(() => SceneManager.dispose())` at the top of `SceneManager.js`. Phase 5 polish.

---

## Common pitfalls

- **Forgetting to dispose** old groups → GPU memory creeps up to 100% and the tab crashes.
- **Accessing builders directly** from the render loop. Don't. The render loop is sync; builders are async. Use cached results.
- **Swapping groups mid-frame** — fine in Three.js (it's queued), but if you also change the camera in the same frame, expect a single jumpy frame.
- **Multiple in-flight rebuilds** — without the token counter, an old slow rebuild can complete *after* a newer fast one and overwrite it.

---

## Tests worth writing (Phase 1)

- `disposeGroup` actually frees what it claims to (Three.js exposes `.userData.__disposed` if you set it).
- Cancellation token correctly aborts old rebuilds.
- Renderer correctly resizes on window resize without losing aspect ratio.
