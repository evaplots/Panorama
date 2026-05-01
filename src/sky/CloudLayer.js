// V2 Step 5b — sprite-based cloud layer in the sky dome.
//
// Visual approach: ~MAX_SPRITES soft white blobs distributed pseudo-randomly
// across a hemispherical shell at CLOUD_ALTITUDE_M. The visible count tracks
// cloudCover_pct; tint tracks weatherCode; horizontal position drifts at
// wind.speedMs * WIND_DRIFT_FACTOR in wind.directionDeg.
//
// Determinism: the per-sprite *layout* is seeded by location lat/lon, so the
// same place at any time always shows the same arrangement (composition
// stability). Only the wind drift offset is time-varying.
//
// World-space convention (from SkySystem.update): +X east, +Z south, +Y up.
// Wind compass direction: 0° = wind FROM north → blowing toward south (+Z),
// 90° = from east → toward west (-X), etc. Matches the convention used by
// the painter call-site in ControlsPanel (windDirectionDeg = directionDeg + 90).
//
// Public API:
//   CloudLayer.init(scene)
//   CloudLayer.update(weatherSnapshot, dt)
//   CloudLayer.dispose()

import * as THREE from 'three';

const MAX_SPRITES        = 300;
const CLOUD_ALTITUDE_M   = 1500;     // above observer's groundY
const CLOUD_FIELD_RADIUS = 8000;     // wraparound boundary, metres
const SPRITE_SIZE_M      = 600;      // base sprite world-space size
const WIND_DRIFT_FACTOR  = 0.5;      // sprite m/s = wind.speedMs * this

let _scene = null;
let _group = null;            // THREE.Group containing all sprites
let _texture = null;          // shared radial-gradient texture
let _sprites = [];            // length MAX_SPRITES, all THREE.Sprite
let _basePositions = [];      // length MAX_SPRITES, {x, z} of the layout
let _driftOffset = { x: 0, z: 0 };  // accumulated wind translation
let _lastSeed = null;         // lat/lon seed of the current layout

/** Tiny deterministic PRNG so layouts are reproducible per location. */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Soft radial-gradient blob, encoded once and shared across all sprites. */
function makeCloudTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.65)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** weatherCode → {tint:THREE.Color, sizeMul} for the sprite material. */
function weatherCodeStyle(code) {
  if (!Number.isFinite(code)) return { color: 0xffffff, sizeMul: 1 };
  if (code <= 2)            return { color: 0xfff5e8, sizeMul: 1 };    // clear/mainly clear, slight warm
  if (code === 3)           return { color: 0xcfd1d3, sizeMul: 1.05 };  // overcast: grey-white
  if (code >= 51 && code <= 67) return { color: 0x8a8c90, sizeMul: 1.1 };  // drizzle/rain: mid grey
  if (code >= 71 && code <= 77) return { color: 0xf0f4f8, sizeMul: 1.4 };  // snow: near white, larger
  if (code >= 95)           return { color: 0x4a4d54, sizeMul: 1.2 };  // thunderstorm: dark grey
  return { color: 0xffffff, sizeMul: 1 };
}

/**
 * Layout sprites on a hemisphere shell at CLOUD_ALTITUDE_M, deterministic
 * per (lat, lon). Replaces previous layout. Sprites stay invisible until
 * update() is called with a snapshot.
 */
function relayoutFor(location) {
  const seed = Math.floor((location.lat + 90) * 73856093) ^ Math.floor((location.lon + 180) * 19349663);
  if (seed === _lastSeed) return;
  _lastSeed = seed;
  const rand = mulberry32(seed >>> 0);
  _basePositions.length = 0;
  for (let i = 0; i < MAX_SPRITES; i++) {
    // Polar coords on the disk so density reads like a real sky, not a
    // square. r ∝ √rand keeps area-uniform; small clamp avoids stacking
    // sprites directly on top of the camera.
    const r = (0.1 + 0.9 * Math.sqrt(rand())) * CLOUD_FIELD_RADIUS;
    const theta = rand() * Math.PI * 2;
    _basePositions.push({
      x: Math.cos(theta) * r,
      z: Math.sin(theta) * r,
      // Slight altitude jitter so the dome isn't a perfect plane
      yJitter: (rand() - 0.5) * 200,
      // Per-sprite size jitter for visual variety
      sizeJitter: 0.7 + rand() * 0.6,
    });
  }
  _driftOffset.x = 0;
  _driftOffset.z = 0;
}

export const CloudLayer = {
  init(scene) {
    if (_group) this.dispose();
    _scene = scene;
    _texture = makeCloudTexture();
    _group = new THREE.Group();
    _group.name = 'CloudLayer';
    _scene.add(_group);

    for (let i = 0; i < MAX_SPRITES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: _texture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,    // alpha-blended cloud sprites mustn't write depth
        color: 0xffffff,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(SPRITE_SIZE_M, SPRITE_SIZE_M, 1);
      s.visible = false;
      _group.add(s);
      _sprites.push(s);
    }
  },

  /**
   * @param {import('../weather/WeatherFetcher.js').WeatherSnapshot|null} weather
   * @param {number} dt seconds since last frame
   * @param {{x:number, y:number, z:number}} cameraPosition observer world position
   * @param {{lat:number, lon:number}} location used to seed the per-place layout
   */
  update(weather, dt, cameraPosition, location) {
    if (!_group) return;

    // Layout is per-location and stable across time. Re-layout if the
    // current seed location differs.
    if (location) relayoutFor(location);

    const cloudCover = weather?.cloudCover_pct;
    const visibleCount = !Number.isFinite(cloudCover) || cloudCover < 5
      ? 0
      : Math.round(MAX_SPRITES * Math.min(100, cloudCover) / 100);

    // Wind drift accumulates between frames. Compass: 0° = north (wind from
    // N → toward S, +Z), 90° = east (toward -X), etc.
    const windSpeed = Number.isFinite(weather?.wind?.speedMs) ? weather.wind.speedMs : 0;
    const windDirDeg = Number.isFinite(weather?.wind?.directionDeg) ? weather.wind.directionDeg : 0;
    const windRad = THREE.MathUtils.degToRad(windDirDeg);
    const driftSpeed = windSpeed * WIND_DRIFT_FACTOR;
    // Wind FROM N blows TOWARD S, so the sprites move +Z when dirDeg = 0.
    _driftOffset.x += -Math.sin(windRad) * driftSpeed * dt;
    _driftOffset.z +=  Math.cos(windRad) * driftSpeed * dt;

    const style = weatherCodeStyle(weather?.weatherCode);
    const cy = cameraPosition?.y ?? 0;
    const cx = cameraPosition?.x ?? 0;
    const cz = cameraPosition?.z ?? 0;

    for (let i = 0; i < MAX_SPRITES; i++) {
      const sprite = _sprites[i];
      if (i >= visibleCount) {
        sprite.visible = false;
        continue;
      }
      const base = _basePositions[i];
      // Apply drift, then wrap into the [-R, R) field around the camera.
      // This keeps the cloud field anchored to the observer (sprites that
      // exit the boundary reappear on the opposite side).
      const R = CLOUD_FIELD_RADIUS;
      const wx = ((base.x + _driftOffset.x + R) % (2 * R) + 2 * R) % (2 * R) - R;
      const wz = ((base.z + _driftOffset.z + R) % (2 * R) + 2 * R) % (2 * R) - R;
      sprite.position.set(cx + wx, cy + CLOUD_ALTITUDE_M + base.yJitter, cz + wz);
      sprite.scale.set(SPRITE_SIZE_M * base.sizeJitter * style.sizeMul,
                       SPRITE_SIZE_M * base.sizeJitter * style.sizeMul, 1);
      sprite.material.color.setHex(style.color);
      sprite.visible = true;
    }
  },

  dispose() {
    if (!_group) return;
    for (const s of _sprites) s.material.dispose();
    _texture?.dispose();
    if (_scene) _scene.remove(_group);
    _sprites = [];
    _basePositions = [];
    _texture = null;
    _group = null;
    _scene = null;
    _lastSeed = null;
    _driftOffset.x = 0;
    _driftOffset.z = 0;
  },
};
