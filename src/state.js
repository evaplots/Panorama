// State schema version: 3
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
