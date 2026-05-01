import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SkySystem } from '../sky/SkySystem.js';
import { CameraController } from '../camera/CameraController.js';
import { ScenicDefault } from '../camera/ScenicDefault.js';
import { TerrainBuilder } from '../terrain/TerrainBuilder.js';
import { OSMFeatureBuilder } from '../osm/index.js';
import { WeatherFetcher } from '../weather/WeatherFetcher.js';
import { mergeWeather } from '../weather/mergeWeather.js';
import { CloudLayer } from '../sky/CloudLayer.js';
import { Precipitation } from '../sky/Precipitation.js';
import { HeightSampler } from '../terrain/HeightSampler.js';
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
// Hour-bucket key (lat3,lon3,hourBucketISO) of the last weather warm we
// dispatched. Slider scrubs fire many time:changed events per second; the
// warmWeather no-op when the bucket key is unchanged is the primary throttle
// (Cache.dedupe inside fetchWeather is the belt-and-braces backup).
let _lastWarmedWeatherKey = null;
let _weatherWarmToken = 0;
// Live weather snapshot consumed by CloudLayer/Precipitation/SkySystem each
// frame. Refreshed only on the four events that can change it (location,
// time, fetch land, override panel) so tick() stays sync. mergeWeather
// returns undefined when both fetched and every override are null — we
// store that as null here for consistent "no weather" semantics.
let _currentWeather = null;
// Hand off the just-loaded terrain's groundY-at-observer to the per-frame
// dispatch so Precipitation knows where to respawn particles. -1.7 is the
// pre-terrain default (camera Y for a ground at sea level minus eye height).
let _observerGroundY = 0;

/**
 * Fire-and-forget Open-Meteo warm. Gated on the hour-bucket key so that a
 * dragging time slider triggers at most one fetch per bucket crossed.
 * Returns silently when there's no location yet, when the bucket hasn't
 * moved, or on any fetch error — paint-time tolerates a cold cache and the
 * peek will simply return null.
 */
function warmWeather() {
  const location = state.get('location');
  const timestamp = state.get('time.timestamp');
  if (!location || !timestamp) return;

  const key = `${location.lat.toFixed(3)},${location.lon.toFixed(3)},${WeatherFetcher.hourBucketISO(timestamp)}`;
  if (key === _lastWarmedWeatherKey) return;
  _lastWarmedWeatherKey = key;

  const myToken = ++_weatherWarmToken;
  WeatherFetcher.fetchWeather(location, timestamp).then(() => {
    if (myToken !== _weatherWarmToken) return;
    // WeatherPanel listens to refresh its placeholders. Payload is null
    // because the panel re-peeks the cache itself — we don't want to ship
    // the snapshot through the bus and risk staleness if the bucket has
    // moved between fetch-issue and fetch-resolve.
    state.emit('weather:fetched', null);
  }).catch(err => {
    if (myToken !== _weatherWarmToken) return;
    console.warn('[SceneManager] weather warm failed:', err.message);
  });
}

/**
 * Refresh `_currentWeather` from the cache + override state. Cheap when
 * the cache hits in-memory; the per-frame `tick()` then reads the cached
 * snapshot synchronously rather than awaiting a peek per frame. Called on
 * `location:changed`, `time:changed`, `weather:fetched`, and
 * `weatherOverride:changed` — the four events that can change the merged
 * snapshot.
 */
async function refreshCurrentWeather() {
  const location = state.get('location');
  const timestamp = state.get('time.timestamp');
  if (!location || !timestamp) {
    _currentWeather = null;
    return;
  }
  let fetched = null;
  try {
    fetched = await WeatherFetcher.peekWeather(location, timestamp);
  } catch (err) {
    console.warn('[SceneManager] weather peek failed:', err.message);
  }
  const overrides = state.get('weatherOverrides');
  const merged = mergeWeather(fetched, overrides);
  _currentWeather = merged ?? null;
}

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

    // Camera + scenic default
    const scenic = ScenicDefault.suggest(location, state.get('time'));
    CameraController.lookAt(scenic.azimuth, scenic.elevation);
    CameraController.placeAt(location, EYE_HEIGHT_M);
    // Phase 2: walker may not leave the loaded terrain
    const effRadius = Math.min(preset.terrainRadius, PHASE1_TERRAIN_CAP_M);
    CameraController.setWalkBounds(effRadius - WALK_HARD_BOUND_MARGIN_M);

    // The 3D viewer is functional now (terrain + sky + sun). Declare ready
    // before the OSM cache-warm — that warm is purely opportunistic for the
    // painter and a slow Overpass fetch must not gate the viewer or the
    // Save image button. The painter's peek will return [] until the warm
    // lands; subsequent paints pick up polygons automatically.
    state.set('scene.status', 'ready');
    state.emit('scene:ready', null);

    // Background OSM cache-warm — fire-and-forget. Honour rebuildToken so a
    // stale warm from an earlier preset doesn't mutate scene state for the
    // current one.
    OSMFeatureBuilder.build(location, preset).then(newOSM => {
      if (myToken !== rebuildTokenCounter) {
        if (newOSM) disposeGroup(newOSM);
        return;
      }
      if (currentOSMGroup) disposeGroup(currentOSMGroup);
      currentOSMGroup = newOSM ?? null;
      if (newOSM) scene.add(newOSM);
    }).catch(err => {
      if (myToken !== rebuildTokenCounter) return;
      console.warn('[SceneManager] OSM cache-warm failed:', err);
    });
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

  // Apply live-weather modulations *before* SkySystem.update so the
  // sun-intensity scale set by updateWeather feeds into the same-frame
  // intensity calculation in update().
  SkySystem.updateWeather(_currentWeather);
  SkySystem.update(timeSpec.timestamp, location);

  const sun = state.get('sun');
  if (timeSpec.followSun && sun && CameraController.getMode() === 'orbit') {
    CameraController.lookAt(sun.azimuth, Math.max(-10, sun.altitude * 0.3));
  }

  CameraController.update(dt);

  // Live 3D weather. Both modules are camera-relative — they translate with
  // the observer so the user sees the same cloud field and rain volume
  // regardless of where they walk to within the terrain bounds. Cold
  // snapshot (null) → CloudLayer hides all sprites and Precipitation pulls
  // its draw range to 0.
  if (location) {
    const camPos = camera.position;
    const groundY = HeightSampler.isReady()
      ? HeightSampler.getHeightAt(location.lat, location.lon)
      : _observerGroundY;
    CloudLayer.update(_currentWeather, dt, camPos, location);
    Precipitation.update(_currentWeather, dt, camPos, groundY, location);
  }

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
    CloudLayer.init(scene);
    Precipitation.init(scene);

    state.on('location:changed', () => {
      // location change always crosses the per-location bucket key; reset
      // so warmWeather doesn't no-op on the new lat/lon.
      _lastWarmedWeatherKey = null;
      // Re-init the live-weather modules so their world-space anchors and
      // (CloudLayer's) deterministic per-place layout track the new observer.
      // The next tick() picks up the new location automatically.
      CloudLayer.dispose();
      Precipitation.dispose();
      CloudLayer.init(scene);
      Precipitation.init(scene);
      rebuild();
      warmWeather();
      refreshCurrentWeather();
    });
    state.on('preset:changed', () => {
      if (state.get('location')) rebuild();
    });
    // V2 Step 5c — verticality changes shape the heightmap at TerrainBuilder
    // time. DEM tiles are cached so the rebuild is seconds, not minutes; the
    // slider commits on `change` (release) so we don't rebuild mid-drag.
    state.on('terrainOption:changed', () => {
      if (state.get('location')) rebuild();
    });
    state.on('time:changed', () => {
      warmWeather();
      refreshCurrentWeather();
    });
    // Newly-landed cache entry — pull it into _currentWeather between frames.
    state.on('weather:fetched', refreshCurrentWeather);
    // Override panel input typed/cleared — re-merge without a peek round-trip.
    state.on('weatherOverride:changed', refreshCurrentWeather);

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
    CloudLayer.dispose();
    Precipitation.dispose();
    renderer.dispose();
  },
};
