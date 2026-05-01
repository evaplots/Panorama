// Shared StyleBindings snapshot builder. Used by both the "Test pointillism"
// trigger in ControlsPanel and the live UnderpaintingPreviewPanel so the
// preview and the full paint consume identical inputs (modulo dimensions).
//
// See STRATEGY-V2.md "The Snapshot — the new central contract" and
// DATA-CONTRACTS.md "StyleBindings", "ViewpointSnapshot", "GroundSnapshot".
//
// Cache-only reads: paint-time (and preview-time) must never block on a
// fresh Overpass / Open-Meteo round-trip. `peekGroundCover` /
// `peekLandmarks` / `peekWeather` return whatever is already cached;
// cold-cache returns are tolerated (empty polygon list, undefined weather)
// and the painter degrades gracefully.

import { state } from './state.js';
import { CameraController } from './camera/CameraController.js';
import { HeightSampler } from './terrain/HeightSampler.js';
import { OSMFetcher } from './osm/OSMFetcher.js';
import { WeatherFetcher } from './weather/WeatherFetcher.js';
import { mergeWeather } from './weather/mergeWeather.js';
import { categorise } from './style/categories.js';
import { PRESETS, DEFAULT_PRESET, EYE_HEIGHT_M } from './config.js';

/**
 * Assemble a StyleBindings snapshot from the current `state`. Returns null
 * if no location is set. Cache-only — never issues network fetches.
 *
 * @returns {Promise<import('./style/Pointillism.js').StyleBindings | null>}
 */
export async function buildSnapshot() {
  const location = state.get('location');
  if (!location) return null;

  const vp = CameraController.getViewpoint();
  const groundY = HeightSampler.isReady()
    ? HeightSampler.getHeightAt(location.lat, location.lon)
    : 0;
  const eyeHeight = vp.eyeHeight ?? EYE_HEIGHT_M;
  const cameraWorldY = groundY + eyeHeight;

  const presetName = state.get('preset');
  const preset = PRESETS[presetName] ?? PRESETS[DEFAULT_PRESET];

  let osmFeatures = [];
  let landmarks = [];
  try {
    const polygons = await OSMFetcher.peekGroundCover(location, preset);
    osmFeatures = polygons
      .map(p => {
        const category = categorise(p.tags);
        if (!category) return null;
        return { tags: p.tags, category, outer: p.outer, inners: p.inners };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[snapshot] OSM ground-cover peek failed, snapshot has no polygons:', err.message);
  }
  try {
    landmarks = await OSMFetcher.peekLandmarks(location, preset);
  } catch (err) {
    console.warn('[snapshot] OSM landmark peek failed, snapshot has no landmarks:', err.message);
  }

  const timestamp = state.get('time.timestamp');
  let fetched = null;
  try {
    fetched = await WeatherFetcher.peekWeather(location, timestamp);
  } catch (err) {
    console.warn('[snapshot] Weather peek failed, falling back to overrides only:', err.message);
  }
  const overrides = state.get('weatherOverrides');
  const weather = mergeWeather(fetched, overrides);

  return {
    sun: state.get('sun'),
    timestamp,
    location,
    viewpoint: {
      location,
      azimuthDeg: vp.azimuth,
      elevationDeg: vp.elevation,
      fovDeg: vp.fov,
      eyeHeightM: eyeHeight,
      cameraWorldY,
      groundY,
    },
    ground: { osmFeatures, landmarks },
    weather,
  };
}
