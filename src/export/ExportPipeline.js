import { SceneManager } from '../scene/SceneManager.js';

/**
 * Phase 1: screen-resolution PNG download.
 * Phase 4 will extend to A3 300 DPI with TiledRenderer.
 */
export const ExportPipeline = {
  async export({ format, dpi, orientation }) {
    const renderer = SceneManager.getRenderer();
    const canvas = renderer.domElement;

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas capture failed')); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `panorama-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        resolve(blob);
      }, 'image/png');
    });
  },

  canRenderInOnePass({ width, height }) {
    // Phase 1 always uses screen resolution — no GPU limit concerns
    return true;
  },
};
