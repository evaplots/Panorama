import { createLocationPicker } from './LocationPicker.js';
import { createMapPicker } from './MapPicker.js';
import { createPresetSelector } from './PresetSelector.js';
import { createTimeSlider } from './TimeSlider.js';
import { createModeToggle } from './ModeToggle.js';
import { createDebugOverlay } from './DebugOverlay.js';
import { state } from '../state.js';

export const ControlsPanel = {
  init(rootEl) {
    const sidebar = document.createElement('div');
    sidebar.className = 'pano-sidebar';
    rootEl.appendChild(sidebar);

    // Sub-components (return cleanup fns but we don't need them for Phase 1)
    createMapPicker(sidebar);
    createLocationPicker(sidebar);
    createPresetSelector(sidebar);
    createTimeSlider(sidebar);
    createModeToggle(sidebar);
    createDebugOverlay();

    // Export section
    const exportSection = document.createElement('div');
    exportSection.className = 'pano-section';
    exportSection.innerHTML = `
      <h3>Export</h3>
      <button class="pano-export-btn" disabled>Save image</button>
      <button class="pano-stylize-btn" disabled>🎨 Test pointillism</button>
    `;
    sidebar.appendChild(exportSection);

    const exportBtn = exportSection.querySelector('.pano-export-btn');
    const stylizeBtn = exportSection.querySelector('.pano-stylize-btn');

    const updateExportBtn = sceneObj => {
      const ready = sceneObj?.status === 'ready';
      exportBtn.disabled = !ready;
      stylizeBtn.disabled = !ready;
    };
    state.on('scene:changed', updateExportBtn);
    updateExportBtn(state.get('scene'));

    exportBtn.addEventListener('click', async () => {
      const { ExportPipeline } = await import('../export/ExportPipeline.js');
      exportBtn.disabled = true;
      exportBtn.textContent = 'Saving…';
      try {
        await ExportPipeline.export({ format: 'screen', dpi: 96, orientation: 'landscape' });
      } catch (e) {
        console.error('Export failed', e);
      } finally {
        exportBtn.disabled = state.get('scene.status') !== 'ready';
        exportBtn.textContent = 'Save image';
      }
    });

    stylizeBtn.addEventListener('click', async () => {
      const { applyPointillism } = await import('../style/index.js');
      stylizeBtn.disabled = true;
      stylizeBtn.textContent = 'Painting…';

      try {
        // Snapshot the live Three.js canvas. Read it through a 2D context
        // because applyPointillism uses getImageData (faster than reading
        // a WebGL canvas directly via gl.readPixels for our purposes).
        const webglCanvas = document.getElementById('panorama-canvas');
        const snap = document.createElement('canvas');
        snap.width = webglCanvas.width;
        snap.height = webglCanvas.height;
        const sctx = snap.getContext('2d');
        sctx.drawImage(webglCanvas, 0, 0);

        const { canvas: stylized, timing } = await applyPointillism(snap);
        console.log('[Pointillism] timing:', timing);

        // Open result in a new window with the timing summary.
        const w = window.open('', 'pointillism-result', 'width=900,height=700');
        if (w) {
          w.document.title = 'Pointillism — test result';
          w.document.body.style.cssText = 'margin:0;background:#222;color:#eee;font-family:system-ui;';
          const info = w.document.createElement('div');
          info.style.cssText = 'padding:12px 16px;font-size:13px;line-height:1.5;';
          info.innerHTML = `
            <strong>Pointillism v0.1 perf</strong><br>
            Source: ${timing.megapixels} MP &middot; Strokes: ${timing.strokeCount.toLocaleString()}<br>
            Total: <strong>${timing.totalMs} ms</strong>
            (gradient ${timing.gradientMs} ms, strokes ${timing.strokesMs} ms)<br>
            Projected A3 @ 300 DPI (17.4 MP, linear): <strong>${timing.projectedA3Ms} ms</strong>
            (${(timing.projectedA3Ms / 1000).toFixed(1)} s)
          `;
          w.document.body.appendChild(info);
          stylized.style.cssText = 'display:block;max-width:100%;height:auto;';
          w.document.body.appendChild(stylized);
        }
      } catch (e) {
        console.error('Pointillism failed', e);
        alert('Pointillism failed: ' + e.message);
      } finally {
        stylizeBtn.disabled = state.get('scene.status') !== 'ready';
        stylizeBtn.textContent = '🎨 Test pointillism';
      }
    });

    // Status bar
    const statusEl = document.createElement('div');
    statusEl.className = 'pano-status';
    sidebar.appendChild(statusEl);

    state.on('scene:loading', payload => {
      statusEl.className = 'pano-status loading';
      const phase = payload?.phase;
      statusEl.textContent =
        phase === 'osm' ? 'Loading ground cover…' : 'Loading terrain…';
    });
    state.on('scene:ready', () => {
      statusEl.className = 'pano-status';
      statusEl.textContent = 'Drag to look around · scroll to zoom';
    });
    state.on('scene:error', ({ message }) => {
      statusEl.className = 'pano-status error';
      statusEl.textContent = `Error: ${message}`;
    });

    // Hint
    const hint = document.createElement('div');
    hint.className = 'pano-hint';
    hint.textContent = 'Search for a place to begin';
    rootEl.appendChild(hint);
    state.on('location:changed', () => hint.remove());
  },
};
