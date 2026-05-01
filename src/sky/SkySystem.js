import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SunCalculator } from './SunCalculator.js';
import { SKY } from '../config.js';
import { state } from '../state.js';

let sky, sunLight, skyLight, ambientLight;
let _renderer = null;
let _scene = null;
// Captured at init() so updateWeather() can scale the fog density and the
// solar lights without storing per-frame baselines that would drift across
// time-of-day updates.
let _baseSunIntensityScale = 1;     // multiplied into sunLight intensity each frame
let _baseFogDensity = 0;            // base value of scene.fog.density at init
let _hasFogBase = false;

/**
 * Convert colour temperature (Kelvin) to linear RGB.
 * Tanner Helland approximation.
 */
function kelvinToRGB(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) {
    r = 1.0;
    g = Math.max(0, Math.min(1, (99.47 * Math.log(t) - 161.12) / 255));
    b = t <= 19 ? 0 : Math.max(0, Math.min(1, (138.52 * Math.log(t - 10) - 305.04) / 255));
  } else {
    r = Math.max(0, Math.min(1, (329.70 * Math.pow(t - 60, -0.1332)) / 255));
    g = Math.max(0, Math.min(1, (288.12 * Math.pow(t - 60, -0.0755)) / 255));
    b = 1.0;
  }
  return { r, g, b };
}

export const SkySystem = {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer  – needed for toneMappingExposure
   */
  init(scene, renderer) {
    _renderer = renderer;
    _scene = scene;
    if (scene.fog && Number.isFinite(scene.fog.density)) {
      _baseFogDensity = scene.fog.density;
      _hasFogBase = true;
    }

    sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);

    const u = sky.material.uniforms;
    u.turbidity.value = SKY.turbidity;
    u.rayleigh.value = SKY.rayleigh;
    u.mieCoefficient.value = SKY.mieCoefficient;
    u.mieDirectionalG.value = SKY.mieDirectionalG;

    // Directional sun light
    sunLight = new THREE.DirectionalLight(0xfff0d0, 2);
    sunLight.castShadow = false; // Phase 4 enables shadows for export
    scene.add(sunLight);

    // Hemisphere: sky fill from above, warm ground from below
    skyLight = new THREE.HemisphereLight(0x7ec8e3, 0x5a4030, 0.4);
    scene.add(skyLight);

    // Tiny ambient to keep shadows from being pure black
    ambientLight = new THREE.AmbientLight(0x202040, 0.08);
    scene.add(ambientLight);
  },

  /**
   * Called every frame from the render loop.
   * @param {Date} timestamp
   * @param {{lat, lon}|null} location
   */
  update(timestamp, location) {
    if (!location) return;

    const sunPos = SunCalculator.getSunPosition(timestamp, location.lat, location.lon);
    state.set('sun', sunPos);
    state.emit('sun:updated', sunPos);

    // World-space sun direction: +X east, +Z south, +Y up
    const az = THREE.MathUtils.degToRad(sunPos.azimuth);
    const el = THREE.MathUtils.degToRad(sunPos.altitude);
    const dx = Math.sin(az) * Math.cos(el);
    const dy = Math.sin(el);
    const dz = -Math.cos(az) * Math.cos(el);

    const sunVec = new THREE.Vector3(dx, dy, dz);
    sky.material.uniforms.sunPosition.value.copy(sunVec);

    // Enrich turbidity near sunset for deeper orange tones
    sky.material.uniforms.turbidity.value =
      sunPos.phase === 'sunset' ? 8 :
      sunPos.phase === 'goldenHour' ? 7 :
      SKY.turbidity;

    // Sun light: fade out below horizon, then scale by the weather-driven
    // cloud-cover factor (Step 5b — set by updateWeather()).
    const sunIntensity = Math.max(0, Math.sin(el)) * 2.5 * _baseSunIntensityScale;
    sunLight.intensity = sunIntensity;
    sunLight.position.copy(sunVec.clone().multiplyScalar(150000));
    const rgb = kelvinToRGB(sunPos.colourTempK);
    sunLight.color.setRGB(rgb.r, rgb.g, rgb.b);

    // Sky fill follows phase
    const twilightFrac = Math.max(0, Math.min(1, (sunPos.altitude + 6) / 12));
    skyLight.color.setRGB(0.35 + twilightFrac * 0.3, 0.50 + twilightFrac * 0.3, 0.65 + twilightFrac * 0.2);
    skyLight.intensity = 0.05 + twilightFrac * 0.45;

    // Tone mapping exposure: brighter during day, darker at twilight
    if (_renderer) {
      _renderer.toneMappingExposure =
        sunPos.altitude > 6  ? 0.65 :
        sunPos.altitude > 0  ? 0.50 :
        sunPos.altitude > -2 ? 0.38 :
        sunPos.altitude > -6 ? 0.22 : 0.10;
    }
  },

  getDirectionalLight() { return sunLight; },

  /**
   * V2 Step 5b — atmospheric modulations driven by the live WeatherSnapshot.
   * Two effects, both no-op on cold cache (weather null/undefined):
   *
   *   • Fog density scales by humidity. 50% humidity is the baseline; 100%
   *     doubles the fog, dry air halves it. Floor at 30% so fully-arid air
   *     doesn't reveal terrain seams that the painter expects to dissolve.
   *   • Sun intensity dims by cloud cover, capped at 50% at full overcast.
   *     Stored as a multiplicative scale so the per-frame `update()` (which
   *     re-derives intensity from sun altitude) keeps respecting it without
   *     us recomputing the altitude curve here.
   *
   * Tone-mapping exposure is left alone — it tracks sun altitude in update()
   * and shouldn't be coupled to weather (a bright overcast scene at noon
   * should still expose at noon levels, just with a dimmer key light).
   *
   * @param {import('../weather/WeatherFetcher.js').WeatherSnapshot|null|undefined} weather
   */
  updateWeather(weather) {
    // Fog: humidity → density multiplier
    if (_hasFogBase && _scene?.fog) {
      const h = weather?.humidity_pct;
      const mult = Number.isFinite(h)
        ? Math.max(0.3, 1 + (h - 50) / 50)
        : 1;
      _scene.fog.density = _baseFogDensity * mult;
    }
    // Sun: cloud cover → intensity dim factor (consumed by the next update())
    const c = weather?.cloudCover_pct;
    _baseSunIntensityScale = Number.isFinite(c) ? 1 - c / 200 : 1;
  },
};
