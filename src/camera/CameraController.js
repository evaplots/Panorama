import * as THREE from 'three';
import { HeightSampler } from '../terrain/HeightSampler.js';
import {
  EYE_HEIGHT_M,
  DEFAULT_FOV_DEG,
  DEFAULT_TILT_DEG,
  WALK_SPEED_MS,
  JOG_SPEED_MS,
  ACCELERATION_MS2,
  WALK_Y_SMOOTHING_MS,
} from '../config.js';
import { state } from '../state.js';

let camera, canvasEl;
let _azimuth = 270;
let _elevation = DEFAULT_TILT_DEG;
let _fovH = DEFAULT_FOV_DEG;
let _eyeHeight = EYE_HEIGHT_M;
let _mode = 'orbit';
let _walkBoundRadius = Infinity;

// Orbit-mode dragging
let isDragging = false, lastX = 0, lastY = 0;

// Walk mode state
const walkState = {
  anchorX: 0, anchorZ: 0,
  velX: 0, velZ: 0,
  smoothedY: null,
  keys: { w: false, a: false, s: false, d: false, shift: false },
  pointerLocked: false,
};
let _lastWalkerEmit = 0;

function fovHToV(hFov, aspect) {
  return THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hFov) / 2) / aspect)
  );
}

function emitViewpointChanged() {
  state.emit('viewpoint:changed', {
    location: state.get('location'),
    eyeHeight: _eyeHeight,
    azimuth: _azimuth,
    elevation: _elevation,
    fov: _fovH,
    mode: _mode,
    anchor: { x: walkState.anchorX, z: walkState.anchorZ },
  });
}

function applyLookAt() {
  const az = THREE.MathUtils.degToRad(_azimuth);
  const el = THREE.MathUtils.degToRad(_elevation);
  const dx = Math.sin(az) * Math.cos(el);
  const dy = Math.sin(el);
  const dz = -Math.cos(az) * Math.cos(el);
  const p = camera.position;
  camera.lookAt(p.x + dx, p.y + dy, p.z + dz);
  camera.updateMatrixWorld();
  emitViewpointChanged();
}

function emitWalkerMoved() {
  const now = performance.now();
  if (now - _lastWalkerEmit < 250) return;  // throttle to 4 Hz
  _lastWalkerEmit = now;
  const dist = Math.hypot(walkState.anchorX, walkState.anchorZ);
  // Update viewpoint.anchor in state (also fires viewpoint:changed but at 4 Hz max)
  const vp = state.get('viewpoint');
  vp.anchor = { x: walkState.anchorX, z: walkState.anchorZ };
  state.emit('walker:moved', {
    anchor: { x: walkState.anchorX, z: walkState.anchorZ },
    distanceFromOriginM: dist,
  });
}

function setupOrbitDrag() {
  canvasEl.addEventListener('pointerdown', e => {
    if (_mode !== 'orbit' || e.button !== 0) return;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasEl.setPointerCapture(e.pointerId);
    state.set('time.followSun', false);
  });

  canvasEl.addEventListener('pointermove', e => {
    if (!isDragging || _mode !== 'orbit') return;
    const sens = 0.20 * (_fovH / DEFAULT_FOV_DEG);
    _azimuth = ((_azimuth + (e.clientX - lastX) * sens) + 360) % 360;
    _elevation = Math.max(-85, Math.min(85, _elevation - (e.clientY - lastY) * sens));
    lastX = e.clientX;
    lastY = e.clientY;
    applyLookAt();
  });

  canvasEl.addEventListener('pointerup', () => { isDragging = false; });
  canvasEl.addEventListener('pointercancel', () => { isDragging = false; });
}

function setupWheel() {
  canvasEl.addEventListener('wheel', e => {
    e.preventDefault();
    _fovH = Math.max(20, Math.min(90, _fovH + e.deltaY * 0.04));
    const aspect = canvasEl.clientWidth / canvasEl.clientHeight;
    camera.fov = fovHToV(_fovH, aspect);
    camera.updateProjectionMatrix();
    emitViewpointChanged();
  }, { passive: false });
}

function setupPointerLock() {
  // Pointer lock is requested ONLY from this user-gesture click handler.
  // Never call requestPointerLock programmatically — it throws SecurityError.
  canvasEl.addEventListener('click', () => {
    if (_mode !== 'walk' || document.pointerLockElement) return;
    try {
      const p = canvasEl.requestPointerLock?.();
      // Modern browsers return a Promise; older ones don't. Either way we just
      // log denials (e.g. the brief cooldown right after Esc).
      if (p && typeof p.catch === 'function') {
        p.catch(err => console.warn('[CameraController] pointer lock denied:', err?.message));
      }
    } catch (err) {
      console.warn('[CameraController] pointer lock threw:', err?.message);
    }
  });

  document.addEventListener('pointerlockchange', () => {
    walkState.pointerLocked = document.pointerLockElement === canvasEl;
  });

  // Mouse-look while pointer is locked. WASD movement works regardless of lock state.
  document.addEventListener('mousemove', e => {
    if (!walkState.pointerLocked) return;
    const sens = 0.15 * (_fovH / DEFAULT_FOV_DEG);
    _azimuth = ((_azimuth + e.movementX * sens) + 360) % 360;
    _elevation = Math.max(-85, Math.min(85, _elevation - e.movementY * sens));
    state.set('time.followSun', false);
    applyLookAt();
  });
}

// Resolve a keyboard event to one of {w, a, s, d, shift, null}.
// Prefer `e.code` (layout-independent, case-independent — survives Shift+W).
// Fall back to `e.key.toLowerCase()` so AZERTY/Dvorak users still work.
function resolveKey(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    return 'w';
    case 'KeyS': case 'ArrowDown':  return 's';
    case 'KeyA': case 'ArrowLeft':  return 'a';
    case 'KeyD': case 'ArrowRight': return 'd';
    case 'ShiftLeft': case 'ShiftRight': return 'shift';
  }
  const k = (e.key ?? '').toLowerCase();
  if (k === 'w' || k === 'arrowup')    return 'w';
  if (k === 's' || k === 'arrowdown')  return 's';
  if (k === 'a' || k === 'arrowleft')  return 'a';
  if (k === 'd' || k === 'arrowright') return 'd';
  if (k === 'shift') return 'shift';
  return null;
}

function isTypingInForm() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function setupKeyboard() {
  // Window-level listeners — canvas elements don't get keyboard events
  // unless explicitly focused, and we don't want to require focus.

  // Track keys regardless of mode (per camera.md item 2). Gating on mode here
  // creates a race when the user toggles mode while holding W.
  window.addEventListener('keydown', e => {
    if (isTypingInForm()) return;        // don't hijack search box
    const k = resolveKey(e);
    if (!k) return;
    walkState.keys[k] = true;
    if (_mode === 'walk') e.preventDefault();
  });

  // keyup handler MUST exist (sub-checklist item A). Without it, OS auto-repeat
  // fires once and the camera moves a single frame before stopping.
  window.addEventListener('keyup', e => {
    const k = resolveKey(e);
    if (!k) return;
    walkState.keys[k] = false;
  });

  // Alt-tabbing while a key is held would otherwise leave the walker drifting.
  window.addEventListener('blur', () => {
    walkState.keys = { w: false, a: false, s: false, d: false, shift: false };
  });
}

function reportDebug() {
  const dbg = window.__panoramaDebug;
  if (!dbg) return;
  const keysDown = [];
  if (walkState.keys.w)     keysDown.push('W');
  if (walkState.keys.a)     keysDown.push('A');
  if (walkState.keys.s)     keysDown.push('S');
  if (walkState.keys.d)     keysDown.push('D');
  if (walkState.keys.shift) keysDown.push('Shift');
  dbg.cameraMode = _mode;
  dbg.cameraPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  dbg.walkAnchor = { x: walkState.anchorX, z: walkState.anchorZ };
  dbg.walkVelocity = Math.hypot(walkState.velX, walkState.velZ);
  dbg.walkedTotalM = Math.hypot(walkState.anchorX, walkState.anchorZ);
  dbg.keysDown = keysDown;
}

function setupWalkerResetHook() {
  // UI emits these — Camera reacts. Avoids UI importing CameraController.
  state.on('walker:reset_request', () => CameraController.resetToOrigin());
  state.on('viewpoint:mode_changed', ({ mode }) => doModeSwitch(mode));
}

function doModeSwitch(mode) {
  if (mode !== 'orbit' && mode !== 'walk') return;
  if (mode === _mode) return;
  _mode = mode;

  if (mode === 'orbit') {
    walkState.anchorX = 0;
    walkState.anchorZ = 0;
    walkState.velX = 0;
    walkState.velZ = 0;
    walkState.smoothedY = null;
    snapCameraToLocation();
    if (document.pointerLockElement === canvasEl) document.exitPointerLock?.();
  } else {
    walkState.smoothedY = camera.position.y;
  }
  applyLookAt();
}

function snapCameraToLocation() {
  const loc = state.get('location');
  if (!loc) { camera.position.set(0, _eyeHeight, 0); return; }
  const groundY = HeightSampler.isReady()
    ? HeightSampler.getHeightAt(loc.lat, loc.lon)
    : 0;
  camera.position.set(0, groundY + _eyeHeight, 0);
}

function updateWalk(dt) {
  // Forward / right axes from current azimuth (XZ plane only)
  const azRad = THREE.MathUtils.degToRad(_azimuth);
  const fx = Math.sin(azRad);
  const fz = -Math.cos(azRad);
  const rx = Math.cos(azRad);
  const rz = Math.sin(azRad);

  let inX = 0, inZ = 0;
  if (walkState.keys.w) { inX += fx; inZ += fz; }
  if (walkState.keys.s) { inX -= fx; inZ -= fz; }
  if (walkState.keys.d) { inX += rx; inZ += rz; }
  if (walkState.keys.a) { inX -= rx; inZ -= rz; }

  const speed = walkState.keys.shift ? JOG_SPEED_MS : WALK_SPEED_MS;
  let targetVx = 0, targetVz = 0;
  const inLen = Math.hypot(inX, inZ);
  if (inLen > 0) {
    targetVx = (inX / inLen) * speed;
    targetVz = (inZ / inLen) * speed;
  }

  // Smooth velocity ramp (frame-rate independent via dt)
  const accelFrac = Math.min(1, ACCELERATION_MS2 * dt);
  walkState.velX += (targetVx - walkState.velX) * accelFrac;
  walkState.velZ += (targetVz - walkState.velZ) * accelFrac;

  let nx = walkState.anchorX + walkState.velX * dt;
  let nz = walkState.anchorZ + walkState.velZ * dt;

  // Soft bound: stay inside the loaded terrain
  if (isFinite(_walkBoundRadius)) {
    const r = Math.hypot(nx, nz);
    if (r > _walkBoundRadius) {
      const k = _walkBoundRadius / r;
      nx *= k; nz *= k;
      walkState.velX = 0; walkState.velZ = 0;
    }
  }

  walkState.anchorX = nx;
  walkState.anchorZ = nz;

  const groundY = HeightSampler.isReady()
    ? HeightSampler.getHeightAtWorld(walkState.anchorX, walkState.anchorZ)
    : 0;
  const targetY = groundY + _eyeHeight;

  // Smooth Y over ~WALK_Y_SMOOTHING_MS so cliff edges don't pop the camera
  if (walkState.smoothedY === null) walkState.smoothedY = targetY;
  const smoothFrac = Math.min(1, dt / (WALK_Y_SMOOTHING_MS / 1000));
  walkState.smoothedY += (targetY - walkState.smoothedY) * smoothFrac;

  camera.position.set(walkState.anchorX, walkState.smoothedY, walkState.anchorZ);

  // Re-aim look vector at the new position; cheap.
  applyLookAt();
  emitWalkerMoved();
}

export const CameraController = {
  /**
   * @param {HTMLCanvasElement} canvas
   * @returns {THREE.PerspectiveCamera}
   */
  init(canvas) {
    canvasEl = canvas;
    const aspect = canvas.clientWidth / canvas.clientHeight || 16 / 9;
    camera = new THREE.PerspectiveCamera(fovHToV(_fovH, aspect), aspect, 0.1, 200000);
    camera.position.set(0, _eyeHeight, 0);
    applyLookAt();

    setupOrbitDrag();
    setupWheel();
    setupPointerLock();
    setupKeyboard();
    setupWalkerResetHook();

    return camera;
  },

  placeAt(location, eyeHeight) {
    const groundY = HeightSampler.isReady()
      ? HeightSampler.getHeightAt(location.lat, location.lon)
      : 0;
    // Reset walk state — every new location is a fresh anchor
    walkState.anchorX = 0;
    walkState.anchorZ = 0;
    walkState.velX = 0;
    walkState.velZ = 0;
    walkState.smoothedY = null;
    camera.position.set(0, groundY + eyeHeight, 0);
    applyLookAt();
  },

  lookAt(azimuthDeg, elevationDeg) {
    _azimuth = (azimuthDeg + 360) % 360;
    _elevation = Math.max(-85, Math.min(85, elevationDeg));
    applyLookAt();
  },

  setFOV(degrees) {
    _fovH = Math.max(20, Math.min(90, degrees));
    const aspect = canvasEl.clientWidth / canvasEl.clientHeight;
    camera.fov = fovHToV(_fovH, aspect);
    camera.updateProjectionMatrix();
    emitViewpointChanged();
  },

  /**
   * Update eye height in metres above ground. Repositions the camera
   * immediately at the new height (orbit mode) or feeds into the smoothed
   * walk-mode Y on the next frame. Reads ground Y from HeightSampler
   * under the camera's current XZ so high cliffs / valleys don't lurch.
   */
  setEyeHeight(meters) {
    _eyeHeight = Math.max(0.1, Math.min(100, meters));
    if (!camera) return;
    if (_mode === 'walk') {
      // Walk mode: updateWalk() reads _eyeHeight every frame for the
      // target Y, smoothed over WALK_Y_SMOOTHING_MS. Just emit so the
      // map / preview re-render with the new height in their viewpoint.
      emitViewpointChanged();
      return;
    }
    const groundY = HeightSampler.isReady() && state.get('location')
      ? HeightSampler.getHeightAtWorld(camera.position.x, camera.position.z)
      : 0;
    camera.position.y = groundY + _eyeHeight;
    applyLookAt();
  },

  /** Phase 2: switch between orbit and walk modes (programmatic entry point). */
  setMode(mode) {
    if (mode !== 'orbit' && mode !== 'walk') return;
    if (mode === _mode) return;
    state.set('viewpoint.mode', mode);
    state.emit('viewpoint:mode_changed', { mode });
    // doModeSwitch runs from the listener in setupWalkerResetHook.
  },

  getMode() { return _mode; },

  /** Phase 2: snap walker back to chosen location (does not change mode). */
  resetToOrigin() {
    walkState.anchorX = 0;
    walkState.anchorZ = 0;
    walkState.velX = 0;
    walkState.velZ = 0;
    walkState.smoothedY = null;
    snapCameraToLocation();
    applyLookAt();
    emitWalkerMoved();
  },

  /** SceneManager calls this after terrain build with the effective terrain radius. */
  setWalkBounds(radiusM) {
    _walkBoundRadius = Math.max(50, radiusM);
  },

  /** Called every frame from the render loop. */
  update(deltaSeconds) {
    // Sub-checklist item D: warn once per session if dt looks broken.
    if (deltaSeconds === undefined || deltaSeconds === null) {
      console.warn('[CameraController] update() called without dt');
    } else if (deltaSeconds > 1) {
      console.warn('[CameraController] dt unusually large:', deltaSeconds);
    }
    const dt = Math.max(0, Math.min(0.1, deltaSeconds || 0));
    if (_mode === 'walk') updateWalk(dt);
    reportDebug();
    // Orbit: position fixed; nothing to do per frame.
  },

  getCamera() { return camera; },

  getViewpoint() {
    return {
      location: state.get('location'),
      eyeHeight: _eyeHeight,
      azimuth: _azimuth,
      elevation: _elevation,
      fov: _fovH,
      mode: _mode,
      anchor: { x: walkState.anchorX, z: walkState.anchorZ },
    };
  },
};
