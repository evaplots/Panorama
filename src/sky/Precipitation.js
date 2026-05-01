// V2 Step 5b — particle-based rain/snow.
//
// THREE.Points with a single BufferGeometry of MAX_PARTICLES floats. The
// active prefix tracks precipitation_mmh; the texture and fall speed switch
// between rain (small white streak, 10 m/s) and snow (soft blob, 1.5 m/s)
// keyed off weatherCode. Particles spawn at cloud altitude in a 1 km radius
// around the observer, fall + drift with the wind, and respawn at altitude
// when y reaches groundY (or when they exit the horizontal field).
//
// World convention matches CloudLayer.js: +X east, +Z south, +Y up.

import * as THREE from 'three';

const MAX_PARTICLES        = 5000;
const SPAWN_RADIUS_M       = 1000;
const SPAWN_ALTITUDE_M     = 1500;     // matches CloudLayer's CLOUD_ALTITUDE_M
const RAIN_FALL_MS         = 10.0;
const SNOW_FALL_MS         = 1.5;
const SPAWN_THRESHOLD_MMH  = 0.1;      // below this, no precipitation

let _scene = null;
let _points = null;            // THREE.Points
let _geom = null;              // THREE.BufferGeometry with `position`
let _mat = null;               // THREE.PointsMaterial
let _positions = null;         // Float32Array (length MAX_PARTICLES * 3)
let _rainTex = null;
let _snowTex = null;
let _activeCount = 0;
let _isSnow = false;
let _location = null;
let _initialised = false;

function makeRainTexture() {
  const w = 4, h = 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // Vertical gradient streak — bright in the middle, fades at top/bottom.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(220,230,240,0.95)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSnowTexture() {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function isSnowCode(code) {
  return Number.isFinite(code) && code >= 71 && code <= 77;
}

function spawnParticleAt(idx, cameraPosition) {
  const r = Math.sqrt(Math.random()) * SPAWN_RADIUS_M;
  const t = Math.random() * Math.PI * 2;
  const off = idx * 3;
  _positions[off    ] = (cameraPosition?.x ?? 0) + Math.cos(t) * r;
  _positions[off + 1] = (cameraPosition?.y ?? 0) + SPAWN_ALTITUDE_M * (0.5 + Math.random() * 0.5);
  _positions[off + 2] = (cameraPosition?.z ?? 0) + Math.sin(t) * r;
}

export const Precipitation = {
  init(scene) {
    if (_initialised) this.dispose();
    _scene = scene;

    _rainTex = makeRainTexture();
    _snowTex = makeSnowTexture();

    _positions = new Float32Array(MAX_PARTICLES * 3);
    // Start far below the world so any unmasked particle is invisible.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      _positions[i * 3 + 1] = -1e6;
    }

    _geom = new THREE.BufferGeometry();
    _geom.setAttribute('position', new THREE.BufferAttribute(_positions, 3));
    _geom.setDrawRange(0, 0);

    _mat = new THREE.PointsMaterial({
      map: _rainTex,
      size: 8,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      color: 0xffffff,
    });

    _points = new THREE.Points(_geom, _mat);
    _points.name = 'Precipitation';
    _points.frustumCulled = false; // particles span a 1 km radius; safer with culling off
    _scene.add(_points);

    _activeCount = 0;
    _isSnow = false;
    _initialised = true;
  },

  /**
   * @param {import('../weather/WeatherFetcher.js').WeatherSnapshot|null} weather
   * @param {number} dt seconds since last frame
   * @param {{x:number, y:number, z:number}} cameraPosition
   * @param {number} groundY local terrain elevation under the observer
   * @param {{lat:number, lon:number}} [location] kept for parity with CloudLayer.update
   */
  update(weather, dt, cameraPosition, groundY, location) {
    if (!_initialised) return;
    _location = location ?? _location;

    const precip = weather?.precipitation_mmh;
    const targetCount = !Number.isFinite(precip) || precip < SPAWN_THRESHOLD_MMH
      ? 0
      : Math.min(MAX_PARTICLES, Math.round(2000 * precip / 10));

    // Switch material/fall-speed when weatherCode crosses the snow band.
    const wantSnow = isSnowCode(weather?.weatherCode);
    if (wantSnow !== _isSnow) {
      _isSnow = wantSnow;
      _mat.map = wantSnow ? _snowTex : _rainTex;
      _mat.size = wantSnow ? 14 : 8;
      _mat.needsUpdate = true;
    }

    // Spawn newly-activated particles. We never "un-spawn" — particles in
    // [targetCount, _activeCount) just get hidden by the draw range.
    if (targetCount > _activeCount) {
      for (let i = _activeCount; i < targetCount; i++) spawnParticleAt(i, cameraPosition);
      _activeCount = targetCount;
    } else if (targetCount < _activeCount) {
      _activeCount = targetCount;
    }
    _geom.setDrawRange(0, _activeCount);

    if (_activeCount === 0) return;

    // Wind: same convention as CloudLayer (compass FROM-direction).
    const windSpeed = Number.isFinite(weather?.wind?.speedMs) ? weather.wind.speedMs : 0;
    const windDirDeg = Number.isFinite(weather?.wind?.directionDeg) ? weather.wind.directionDeg : 0;
    const windRad = THREE.MathUtils.degToRad(windDirDeg);
    const windDx = -Math.sin(windRad) * windSpeed * dt;
    const windDz =  Math.cos(windRad) * windSpeed * dt;

    const fall = (_isSnow ? SNOW_FALL_MS : RAIN_FALL_MS) * dt;
    const cy = cameraPosition?.y ?? 0;
    const cx = cameraPosition?.x ?? 0;
    const cz = cameraPosition?.z ?? 0;
    const groundLimit = (groundY ?? cy - 1.7);

    for (let i = 0; i < _activeCount; i++) {
      const off = i * 3;
      _positions[off    ] += windDx;
      _positions[off + 1] -= fall;
      _positions[off + 2] += windDz;

      const dx = _positions[off    ] - cx;
      const dz = _positions[off + 2] - cz;
      const horizSq = dx * dx + dz * dz;
      const escaped = horizSq > SPAWN_RADIUS_M * SPAWN_RADIUS_M * 1.4;
      const hitGround = _positions[off + 1] <= groundLimit;

      if (hitGround || escaped) {
        // Respawn at altitude with a fresh horizontal position around camera.
        const r = Math.sqrt(Math.random()) * SPAWN_RADIUS_M;
        const t = Math.random() * Math.PI * 2;
        _positions[off    ] = cx + Math.cos(t) * r;
        _positions[off + 1] = cy + SPAWN_ALTITUDE_M;
        _positions[off + 2] = cz + Math.sin(t) * r;
      }
    }
    _geom.attributes.position.needsUpdate = true;
  },

  dispose() {
    if (!_initialised) return;
    if (_scene && _points) _scene.remove(_points);
    _geom?.dispose();
    _mat?.dispose();
    _rainTex?.dispose();
    _snowTex?.dispose();
    _points = null;
    _geom = null;
    _mat = null;
    _positions = null;
    _rainTex = null;
    _snowTex = null;
    _scene = null;
    _activeCount = 0;
    _isSnow = false;
    _location = null;
    _initialised = false;
  },
};
