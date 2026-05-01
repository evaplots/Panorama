// State schema version: 5
// See DATA-CONTRACTS.md
import { DEFAULT_PRESET } from './config.js';

function createBus() {
  const listeners = {};
  return {
    on(event, fn) {
      (listeners[event] ??= []).push(fn);
    },
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(f => f !== fn);
    },
    emit(event, payload) {
      (listeners[event] ?? []).slice().forEach(fn => fn(payload));
    },
  };
}

const bus = createBus();

const _state = {
  location: null,
  preset: DEFAULT_PRESET,
  customRadius: null,
  time: {
    timestamp: new Date(),
    followSun: true,
  },
  viewpoint: {
    azimuth: 270,
    elevation: -5,
    fov: 60,
    eyeHeight: 1.7,
    mode: 'orbit',         // 'orbit' | 'walk' (Phase 2+)
    anchor: { x: 0, z: 0 }, // walk-mode offset from chosen location, metres
  },
  sun: null,
  scene: {
    status: 'idle',
    progress: 0,
    error: null,
  },
  export: {
    format: 'A3',
    orientation: 'landscape',
    dpi: 300,
    inProgress: false,
  },
  style: {
    // 'auto' is the ColorThief sentinel matching the Snapshot contract in
    // STRATEGY-V2 §"The Snapshot". When painter === 'auto' the palette is
    // extracted from the underpainting; otherwise it is a palettes.json slug.
    painter: 'auto',
    paletteSource: 'colorthief', // 'curated' | 'colorthief'
  },
  // V2 Step 5: WeatherPanel overrides. Each field is null when the panel
  // input is empty (= use fetched value); a number when the user has typed
  // an override. mergeWeather() in src/weather/mergeWeather.js applies the
  // per-field override-wins-else-fetched composition (consumed by both the
  // paint-time bindings and Step 5b's live 3D scene weather).
  weatherOverrides: {
    wind: { directionDeg: null, speedMs: null },
    cloudCover_pct: null,
    humidity_pct: null,
    precipitation_mmh: null,
    temperature_C: null,
  },
  // V2 Step 5c: PainterParamsPanel surface. Defaults match the Pointillism
  // engine's existing DEFAULTS so an untouched panel reproduces the
  // pre-step-5c painting bit-for-bit (regression guard). windInfluenceOverride
  // is null when the user has selected "auto" — the PR #9 weather binding
  // (speedMs > 1.5 ? 0.4 : 0) applies. A finite number forces windInfluence
  // unconditionally at the call site.
  painter: {
    brushWidthMm: 0.7,
    density: 0.06,
    brushOpacity: 0.85,
    brushStrokeFactor: 1.0,
    paletteTemperature: 28,
    paletteSize: 20,
    windInfluenceOverride: null,
    seed: 0xC0FFEE,
  },
  // V2 Step 5c: TerrainPanel surface. yExaggeration multiplies the heightmap
  // at TerrainBuilder.build() — vertical scale of the rendered mountains and
  // of the heights HeightSampler returns to camera/painter consumers, so the
  // 3D viewer and the painter projection see the same exaggerated world.
  // Default 1.0 = honest DEM (no behaviour change).
  terrain: {
    yExaggeration: 1.0,
  },
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

export const state = {
  get(path) {
    return getPath(_state, path);
  },

  /** Mutates state and fires '<topKey>:changed' */
  set(path, value) {
    setPath(_state, path, value);
    const topKey = path.split('.')[0];
    bus.emit(`${topKey}:changed`, getPath(_state, topKey));
  },

  on: bus.on.bind(bus),
  off: bus.off.bind(bus),
  emit: bus.emit.bind(bus),
};
