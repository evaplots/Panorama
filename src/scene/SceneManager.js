import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SkySystem } from '../sky/SkySystem.js';
import { CameraController } from '../camera/CameraController.js';
import { ScenicDefault } from '../camera/ScenicDefault.js';
import { TerrainBuilder } from '../terrain/TerrainBuilder.js';
import { OSMFeatureBuilder } from '../osm/index.js';
import { state } from '../state.js';
import {
  PRESETS, DEFAULT_PRESET, EYE_HEIGHT_M,
  PHASE1_TERRAIN_CAP_M, WALK_HARD_BOUND_MARGIN_M,
} from '../config.js';

let scene, camera, renderer;
let currentTerrainGroup = null;
let currentOSMGroup = null;
let rebuildTokenCounter = 0;
let _lastTickTime = 0;

function disposeGroup(group) {
  group.traverse(obj => {
    obj.geometry?.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { m.map?.dispose(); m.dispose(); });
    }
  });
  scene.remove(group);
}

async function rebuild() {
  const location = state.get('location');
  if (!location) return;

  const myToken = ++rebuildTokenCounter;
  const presetName = state.get('preset');
  const preset = PRESETS[presetName] ?? PRESETS[DEFAULT_PRESET];

  state.set('scene.status', 'loading');
  state.emit('scene:loading', { phase: 'terrain' });

  try {
    const newTerrain = await TerrainBuilder.build(location, preset.terrainRadius);

    if (myToken !== rebuildTokenCounter) {
      disposeGroup(newTerrain);
      return;
    }

    if (currentTerrainGroup) disposeGroup(currentTerrainGroup);
    currentTerrainGroup = newTerrain;
    scene.add(currentTerrainGroup);

    // Camera + scenic default first — gives the user a usable view while OSM loads
    const scenic = ScenicDefault.suggest(location, state.get('time'));
    CameraController.lookAt(scenic.azimuth, scenic.elevation);
    CameraController.placeAt(location, EYE_HEIGHT_M);
    // Phase 2: walker may not leave the loaded terrain
    const effRadius = Math.min(preset.terrainRadius, PHASE1_TERRAIN_CAP_M);
    CameraController.setWalkBounds(effRadius - WALK_HARD_BOUND_MARGIN_M);

    // Phase 1.5: ground cover after terrain (HeightSampler must be populated)
    state.emit('scene:loading', { phase: 'osm' });
    let newOSM;
    try {
      newOSM = await OSMFeatureBuilder.build(location, preset);
    } catch (err) {
      console.warn('[SceneManager] OSM features failed:', err);
      newOSM = null;
    }

    if (myToken !== rebuildTokenCounter) {
      if (newOSM) disposeGroup(newOSM);
      return;
    }

    if (currentOSMGroup) disposeGroup(currentOSMGroup);
    if (newOSM) {
      currentOSMGroup = newOSM;
      scene.add(currentOSMGroup);
    } else {
      currentOSMGroup = null;
    }

    state.set('scene.status', 'ready');
    state.emit('scene:ready', null);
  } catch (err) {
    if (myToken !== rebuildTokenCounter) return;
    console.error('[SceneManager] rebuild failed:', err);
    state.set('scene.status', 'error');
    state.emit('scene:error', { message: err.message });
  }
}

// Smoothed FPS for the debug overlay
let _fpsAvg = 0;

function tick() {
  requestAnimationFrame(tick);

  const now = performance.now();
  const dt = _lastTickTime ? Math.min(0.1, (now - _lastTickTime) / 1000) : 0;
  _lastTickTime = now;

  if (dt > 0) {
    const inst = 1 / dt;
    _fpsAvg = _fpsAvg ? _fpsAvg * 0.9 + inst * 0.1 : inst;
  }

  const location = state.get('location');
  const timeSpec = state.get('time');

  SkySystem.update(timeSpec.timestamp, location);

  const sun = state.get('sun');
  if (timeSpec.followSun && sun && CameraController.getMode() === 'orbit') {
    CameraController.lookAt(sun.azimuth, Math.max(-10, sun.altitude * 0.3));
  }

  CameraController.update(dt);
  renderer.render(scene, camera);

  const dbg = window.__panoramaDebug;
  if (dbg) {
    dbg.fps = _fpsAvg;
    dbg.dt = dt;
    if (sun) dbg.sun = { azimuth: sun.azimuth, altitude: sun.altitude };
    dbg.sceneStatus = state.get('scene.status');
  }
}

export const SceneManager = {
  /** @param {HTMLCanvasElement} canvas */
  init(canvas) {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.0000035);

    renderer = Renderer.init(canvas);
    camera = CameraController.init(canvas);
    SkySystem.init(scene, renderer);

    state.on('location:changed', rebuild);
    state.on('preset:changed', () => {
      if (state.get('location')) rebuild();
    });

    window.addEventListener('resize', () => Renderer.handleResize(canvas, camera));

    tick();
  },

  rebuild,
  getScene() { return scene; },
  getCamera() { return camera; },
  getRenderer() { return renderer; },

  dispose() {
    rebuildTokenCounter = Infinity;
    if (currentTerrainGroup) disposeGroup(currentTerrainGroup);
    if (currentOSMGroup) disposeGroup(currentOSMGroup);
    renderer.dispose();
  },
};
