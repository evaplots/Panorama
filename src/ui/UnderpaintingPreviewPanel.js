// 3D-scene preview — shows the live WebGL canvas, cropped to the chosen
// export aspect ratio. No painter overlays, no haze, no abstract
// landmark silhouettes; what you see in the preview is exactly what the
// 3D viewer is rendering, downsampled to the panel size.
//
// Mounting model:
//   - Floats over the 3D viewer canvas, anchored bottom-right.
//   - Aspect ratio tracks export.format / export.orientation, capped to
//     480 × 340 (longer dim hits 480 in landscape, longer dim hits 340
//     in portrait; shorter dim scales proportionally).
//   - Closeable; the toggle in ControlsPanel mounts/unmounts the panel.
//
// Re-render trigger model:
//   - Camera updates (viewpoint:changed) are debounced ~100 ms — orbiting
//     produces dozens of events per second, we don't want a render queue
//     pile-up.
//   - Other events render immediately — they fire less frequently and
//     immediate feedback is the point.
//   - Token-counter cancellation: every render request takes a token; if
//     a newer request lands before this one resolves, the result is
//     discarded. Mirrors the SceneManager rebuild pattern.
//
// What this is NOT:
//   - Not the export. There is no "Save image" path here; that stays in
//     ControlsPanel's Test pointillism / Save image buttons. The painter
//     pipeline still runs at export time — this panel just doesn't
//     preview it.
//   - Not the painter underpainting. Earlier versions of this panel
//     drove a sub-50 ms painter render so curators could see how each
//     slider affected the painting. That preview turned out to add
//     visual content (abstract building silhouettes, haze tinting,
//     polygon overpaint) that didn't match the actual 3D scene the
//     user composed against, so the painter pipeline was removed from
//     the preview path. The panel is now a 3D-scene mirror at the
//     export aspect ratio. (Composition, scale, and crop preview;
//     the painterly look is a one-shot transform applied at export.)

import { state } from '../state.js';

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

// Blit the live WebGL canvas onto the panel canvas, scaled to the panel
// size. Returns the timing in ms (used for the stat readout). If the
// WebGL canvas isn't mounted yet (very early app boot), leaves the panel
// canvas blank — there's nothing meaningful to mirror.
function drawWebglOnto(targetCanvas) {
  const t0 = performance.now();
  const ctx = targetCanvas.getContext('2d');
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

  const webgl = document.getElementById('panorama-canvas');
  if (webgl && webgl.width > 0 && webgl.height > 0) {
    ctx.drawImage(webgl, 0, 0, targetCanvas.width, targetCanvas.height);
  }
  return Math.round(performance.now() - t0);
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
      <span class="pano-preview-title">Preview — 3D scene at export aspect</span>
      <button class="pano-preview-close" type="button" title="Hide preview" aria-label="Hide preview">×</button>
    </div>
    <canvas class="pano-preview-canvas"></canvas>
    <div class="pano-preview-footer">
      <span class="pano-preview-stat" title="Last frame mirror time">— ms</span>
    </div>
  `;
  rootEl.appendChild(panel);

  const canvas = panel.querySelector('.pano-preview-canvas');
  const stat = panel.querySelector('.pano-preview-stat');
  const closeBtn = panel.querySelector('.pano-preview-close');

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
  // Pure synchronous mirror of the 3D viewer's WebGL canvas onto the
  // panel canvas at the panel's export-aspect dimensions. No painter
  // pipeline, no async snapshot build, no token-counter cancellation
  // needed — `drawImage` is the whole pass.

  function renderNow() {
    applyDimensions();
    const ms = drawWebglOnto(canvas);
    stat.classList.remove('is-error');
    stat.textContent = `${ms} ms`;
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

  // Re-render whenever something the WebGL viewer is reacting to has
  // changed. `painter:changed` is intentionally NOT subscribed here:
  // painter sliders affect the export pipeline only, not the 3D viewer,
  // so they don't change what the preview should show.
  on('viewpoint:changed', renderDebounced);
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
