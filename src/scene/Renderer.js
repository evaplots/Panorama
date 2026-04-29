import * as THREE from 'three';

let _renderer;

export const Renderer = {
  /**
   * @param {HTMLCanvasElement} canvas
   * @returns {THREE.WebGLRenderer}
   */
  init(canvas) {
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    _renderer.toneMapping = THREE.ACESFilmicToneMapping;
    _renderer.toneMappingExposure = 0.5;
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
    return _renderer;
  },

  handleResize(canvas, camera) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    _renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  },

  getRenderer() { return _renderer; },
};
