import { SceneManager } from '../scene/SceneManager.js';

/** Screen-resolution PNG download of the live WebGL canvas. */
export const ExportPipeline = {
  async export() {
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
};
