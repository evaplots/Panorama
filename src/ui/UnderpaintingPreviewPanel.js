// Live underpainting preview — a fast, interactive view of everything the
// painter does BEFORE the pointillism stroke pass. Re-renders on relevant
// state changes (camera orbit, painter sliders, time slider, etc.) so
// curation has a sub-200 ms feedback loop instead of a 22 s full paint.
//
// Mounting model:
//   - Floats over the 3D viewer canvas, anchored bottom-right
//   - Aspect ratio tracks export.format / export.orientation, capped to
//     480 × 340 (the larger dim hits 480 in landscape, the larger dim hits
//     340 in portrait; smaller dim scales proportionally)
//   - Closeable; the toggle in ControlsPanel mounts/unmounts the panel
//
// Re-render trigger model:
//   - Camera updates (viewpoint:changed) are debounced ~100 ms — orbiting
//     produces dozens of events per second, we don't want a render queue
//     pile-up
//   - Other events render immediately — they fire less frequently and
//     immediate feedback is the point
//   - Token-counter cancellation: every render request takes a token; if
//     a newer request lands before this one resolves, the result is
//     discarded. Mirrors the SceneManager rebuild pattern.
//
// What this is NOT:
//   - Not the export. There is no "Save image" path here; that stays in
//     ControlsPanel's Test pointillism / Save image buttons.
//   - Not the full painting. The pointillism stroke pass is deliberately
//     skipped (it's the slow step). The preview shows what pointillism
//     would START FROM, not what it would end up as.

import { state } from '../state.js';
import { buildSnapshot } from '../snapshot.js';
import { renderUnderpainting } from '../style/underpainting.js';

// Panel sizing: bound the LONGER edge to 480 px, shorter scales to maintain
// aspect ratio. A3 landscape (420×297) → 480×340; A3 portrait (297×420) →
// 340×480. Same for A4/A2 (same aspect ratio as A3 in their orientation).
const MAX_LONG_EDGE = 480;
const MAX_SHORT_EDGE = 340;

const PAPER_DIMS_MM = {
  A4: { short: 210, long: 297 },
  A3: { short: 297, long: 420 },
  A2: { short: 420, long: 594 },
};

function previewDimensions(format, orientation) {
  const dims = PAPER_DIMS_MM[format] ?? PAPER_DIMS_MM.A3;
  // Aspect = long / short  (always >= 1).
  const aspect = dims.long / dims.short;
  // In landscape, width is the long edge; in portrait it's the short edge.
  if (orientation === 'landscape') {
    // long-edge / short-edge = aspect → height = width / aspect
    const w = MAX_LONG_EDGE;
    const h = Math.round(w / aspect);
    return { width: w, height: h };
  } else {
    // portrait: height is long, width is short
    const h = MAX_LONG_EDGE;
    const w = Math.round(h / aspect);
    // Clamp the long edge so the panel doesn't grow taller than 480; if it
    // would exceed MAX_LONG_EDGE in portrait mode we already cap above.
    // Also clamp short edge: 480/1.414 ≈ 339 ≤ 340 — fine for A-series.
    void MAX_SHORT_EDGE;
    return { width: w, height: h };
  }
}

// Debounce helper. Trailing-edge: schedules a single call `delay` ms after
// the latest invocation.
function debounce(fn, delayMs) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
  debounced.cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  return debounced;
}

// Capture the live WebGL canvas downsampled to the preview's working size.
// Returns a fresh 2D canvas the painter can take ownership of. If the
// WebGL canvas isn't mounted yet (very early app boot), returns a flat
// midtone canvas so renderUnderpainting still has something valid to paint
// onto.
function captureWebglAt(width, height) {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');

  const webgl = document.getElementById('panorama-canvas');
  if (webgl && webgl.width > 0 && webgl.height > 0) {
    ctx.drawImage(webgl, 0, 0, width, height);
  } else {
    // Pre-mount fallback: midtone fill so the painter has a non-degenerate
    // input. The user only sees this for the brief window before the first
    // 3D frame is ready.
    ctx.fillStyle = '#5a6478';
    ctx.fillRect(0, 0, width, height);
  }
  return out;
}

/**
 * Mount the live underpainting preview panel.
 *
 * @param {HTMLElement} rootEl   container the panel is appended to.
 * @param {Object}      [opts]
 * @param {() => void}  [opts.onClose]   called when the user clicks the
 *        panel's close button. Owner can use this to update its visible /
 *        hidden state (e.g. toggle a button in the sidebar). The preview
 *        panel itself does not touch state — show / hide is the owner's
 *        responsibility.
 * @returns {{ destroy(): void }}
 */
export function createUnderpaintingPreviewPanel(rootEl, opts = {}) {
  // ── DOM ────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'pano-preview-panel';
  panel.innerHTML = `
    <div class="pano-preview-header">
      <span class="pano-preview-title">Preview — composition only</span>
      <button class="pano-preview-close" type="button" title="Hide preview" aria-label="Hide preview">×</button>
    </div>
    <canvas class="pano-preview-canvas"></canvas>
    <div class="pano-preview-footer">
      <label class="pano-preview-soften">
        <input type="checkbox" class="pano-preview-soften-input" />
        <span>Soften edges</span>
      </label>
      <span class="pano-preview-stat" title="Last underpainting render time">— ms</span>
    </div>
  `;
  rootEl.appendChild(panel);

  const canvas = panel.querySelector('.pano-preview-canvas');
  const stat = panel.querySelector('.pano-preview-stat');
  const softenInput = panel.querySelector('.pano-preview-soften-input');
  const closeBtn = panel.querySelector('.pano-preview-close');

  let softenEdges = true;
  softenInput.checked = softenEdges;

  // ── Sizing: track export.format/orientation ────────────────────────────
  function applyDimensions() {
    const format = state.get('export.format') ?? 'A3';
    const orientation = state.get('export.orientation') ?? 'landscape';
    const { width, height } = previewDimensions(format, orientation);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }
  applyDimensions();

  // ── Render core ────────────────────────────────────────────────────────
  // Token-counter cancellation: every render bumps `renderToken`; if a
  // newer render starts while an older one is mid-async, the older
  // discards its result silently.
  let renderToken = 0;

  async function renderNow() {
    const myToken = ++renderToken;
    const t0 = performance.now();

    applyDimensions();

    const snapshot = await buildSnapshot();
    if (myToken !== renderToken) return;

    const w = canvas.width;
    const h = canvas.height;
    const source = captureWebglAt(w, h);
    if (myToken !== renderToken) return;

    let result;
    try {
      // The brushWidthMm / targetPaperSize / targetOrientation feed
      // canopy's brushThicknessPx calculation, so the preview's canopy
      // texture matches what the full paint would produce at the chosen
      // export DPI. We pull these from state so the preview tracks the
      // PainterParamsPanel + OutputPanel sliders live.
      const painter = state.get('painter');
      const exportSpec = state.get('export');
      result = await renderUnderpainting(source, {
        bindings: snapshot,
        brushWidthMm: painter?.brushWidthMm ?? 0.7,
        targetPaperSize: exportSpec?.format ?? 'A3',
        targetOrientation: exportSpec?.orientation ?? 'landscape',
        seed: painter?.seed ?? 0xC0FFEE,
        softenEdges,
        // medianKernel intentionally falls through to renderUnderpainting's
        // default (11) so the preview shows the same softening intensity as
        // a full paint with applyMedianUnderpaint=true.
      });
    } catch (err) {
      if (myToken !== renderToken) return;
      console.warn('[UnderpaintingPreviewPanel] render failed:', err);
      stat.textContent = 'error';
      stat.classList.add('is-error');
      return;
    }

    if (myToken !== renderToken) return;

    // Blit the underpainting onto the visible canvas.
    const ctx = canvas.getContext('2d');
    ctx.drawImage(result.canvas, 0, 0, w, h);

    const wallMs = Math.round(performance.now() - t0);
    stat.classList.remove('is-error');
    stat.textContent = `${wallMs} ms` +
      (result.timing.canopyDabCount
        ? ` · ${result.timing.canopyDabCount} dabs`
        : '') +
      (result.timing.landmarkDrawnCount
        ? ` · ${result.timing.landmarkDrawnCount} mks`
        : '');
  }

  // Debounced render for high-frequency triggers (camera drag).
  const renderDebounced = debounce(renderNow, 100);

  // ── Subscriptions ──────────────────────────────────────────────────────
  // The state event bus emits `<topKey>:changed` for any state.set call.
  // We wire each event to either the immediate renderer (sliders, time)
  // or the debounced one (camera).
  const subs = [];
  function on(event, handler) {
    state.on(event, handler);
    subs.push(() => state.off(event, handler));
  }

  on('viewpoint:changed', renderDebounced);
  on('painter:changed', renderNow);
  on('terrain:changed', renderNow);
  on('time:changed', renderNow);
  on('location:changed', renderNow);
  on('sun:changed', renderNow);
  on('export:changed', renderNow);
  on('weather:fetched', renderNow);
  on('weatherOverrides:changed', renderNow);
  on('scene:ready', renderNow);

  // First render (deferred so the 3D viewer has a chance to draw a frame).
  setTimeout(renderNow, 0);

  // ── Soften toggle ──────────────────────────────────────────────────────
  softenInput.addEventListener('change', () => {
    softenEdges = softenInput.checked;
    renderNow();
  });

  // ── Close button ───────────────────────────────────────────────────────
  // The panel itself doesn't own the show/hide preference — the owner
  // (ControlsPanel) does, via an in-session local flag. This keeps the
  // panel pure and avoids a state-schema bump for what is effectively
  // session UI ephemera.
  closeBtn.addEventListener('click', () => {
    opts.onClose?.();
  });

  // ── Cleanup ────────────────────────────────────────────────────────────
  return {
    destroy() {
      renderDebounced.cancel();
      subs.forEach(off => off());
      panel.remove();
    },
  };
}
