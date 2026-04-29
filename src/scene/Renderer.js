import * as THREE from 'three';

let _renderer;

export const Renderer = {
  /**
   * @param {HTMLCanvasElement} canvas
   * @returns {THREE.WebGLRenderer}
   */
  init(canvas) {
    // preserveDrawingBuffer:true is required for canvas.toBlob() to return
    // anything other than a blank image. Without it, WebGL discards the back
    // buffer after each present, so the export captures nothing. Small perf
    // cost but the render loop already runs at 60 fps with headroom.
    _renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
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
