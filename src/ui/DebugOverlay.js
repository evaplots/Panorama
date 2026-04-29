// Phase 2+: toggleable diagnostic panel. Modules write to window.__panoramaDebug
// to avoid cross-module coupling; this UI just reads and renders.
// Toggle with `?` (Shift+/). Hidden by default.

const debug = (window.__panoramaDebug ||= {
  fps: 0,
  dt: 0,
  cameraMode: 'orbit',
  cameraPos: { x: 0, y: 0, z: 0 },
  walkAnchor: { x: 0, z: 0 },
  walkVelocity: 0,
  walkedTotalM: 0,
  keysDown: [],
  sun: { azimuth: 0, altitude: 0 },
  sceneStatus: 'idle',
  cacheHits: 0,
  cacheMisses: 0,
  lastOverpass: '–',
  report(updates) { Object.assign(this, updates); },
});

function fmt(n, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : '–';
}

export function createDebugOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'pano-debug-overlay';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  let visible = false;
  let rafId = null;

  function render() {
    const d = debug;
    const total = d.cacheHits + d.cacheMisses;
    const hitPct = total ? ((d.cacheHits / total) * 100).toFixed(1) : '–';
    overlay.innerHTML = `
      <div class="pano-debug-title">PANORAMA — DEBUG</div>
      <div class="pano-debug-row"><span>FPS</span><b>${Math.round(d.fps)}</b></div>
      <div class="pano-debug-row"><span>Frame dt</span><b>${fmt(d.dt * 1000)}ms</b></div>
      <div class="pano-debug-row"><span>Camera mode</span><b>${d.cameraMode}</b></div>
      <div class="pano-debug-row"><span>Camera pos</span><b>(${fmt(d.cameraPos.x)}, ${fmt(d.cameraPos.y)}, ${fmt(d.cameraPos.z)})</b></div>
      <div class="pano-debug-row"><span>Walk anchor</span><b>(${fmt(d.walkAnchor.x)}, ${fmt(d.walkAnchor.z)})</b></div>
      <div class="pano-debug-row"><span>Walk velocity</span><b>${fmt(d.walkVelocity, 2)} m/s</b></div>
      <div class="pano-debug-row"><span>Walked total</span><b>${Math.round(d.walkedTotalM)} m</b></div>
      <div class="pano-debug-row"><span>Keys down</span><b>${d.keysDown.length ? '[' + d.keysDown.join(', ') + ']' : '–'}</b></div>
      <div class="pano-debug-row"><span>Sun azimuth</span><b>${fmt(d.sun.azimuth, 0)}°</b></div>
      <div class="pano-debug-row"><span>Sun altitude</span><b>${fmt(d.sun.altitude)}°</b></div>
      <div class="pano-debug-row"><span>Scene status</span><b>${d.sceneStatus}</b></div>
      <div class="pano-debug-row"><span>Cache</span><b>${d.cacheHits} hits / ${d.cacheMisses} misses (${hitPct}%)</b></div>
      <div class="pano-debug-row"><span>Last Overpass</span><b>${d.lastOverpass}</b></div>
      <div class="pano-debug-hint">[press ? to hide]</div>
    `;
    if (visible) rafId = requestAnimationFrame(render);
  }

  function toggle() {
    visible = !visible;
    overlay.style.display = visible ? 'block' : 'none';
    if (visible) render();
    else if (rafId) cancelAnimationFrame(rafId);
  }

  // `?` is Shift+/ on most layouts. Accept either for tolerance.
  window.addEventListener('keydown', e => {
    // Don't toggle while typing in an input field
    const t = document.activeElement?.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      toggle();
      e.preventDefault();
    }
  });

  return () => {
    visible = false;
    if (rafId) cancelAnimationFrame(rafId);
    overlay.remove();
  };
}
