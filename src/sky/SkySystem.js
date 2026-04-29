import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SunCalculator } from './SunCalculator.js';
import { SKY } from '../config.js';
import { state } from '../state.js';

let sky, sunLight, skyLight, ambientLight;
let _renderer = null;

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

    // Sun light: fade out below horizon
    const sunIntensity = Math.max(0, Math.sin(el)) * 2.5;
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
};
