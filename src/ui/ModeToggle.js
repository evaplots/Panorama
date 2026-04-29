import { state } from '../state.js';

const HINT_TEXT =
  'Use W A S D or arrow keys to walk. Hold Shift to jog. ' +
  'Click the canvas to enable mouse-look (Esc to release).';

let _hintShownThisSession = false;

export function createModeToggle(container) {
  const root = document.createElement('div');
  root.className = 'pano-section pano-mode-toggle';
  root.innerHTML = `
    <h3>View mode</h3>
    <div class="pano-mode-row">
      <button class="pano-mode-btn" data-mode="orbit">Orbit</button>
      <button class="pano-mode-btn" data-mode="walk">Walk</button>
    </div>
    <div class="pano-walk-extras" style="display:none">
      <button class="pano-reset-btn" type="button">↺ Reset position</button>
      <div class="pano-walk-distance">Walked: 0 m</div>
    </div>
  `;
  container.appendChild(root);

  const orbitBtn = root.querySelector('.pano-mode-btn[data-mode=orbit]');
  const walkBtn  = root.querySelector('.pano-mode-btn[data-mode=walk]');
  const extras   = root.querySelector('.pano-walk-extras');
  const resetBtn = root.querySelector('.pano-reset-btn');
  const distEl   = root.querySelector('.pano-walk-distance');

  function reflect(mode) {
    orbitBtn.classList.toggle('active', mode === 'orbit');
    walkBtn.classList.toggle('active', mode === 'walk');
    extras.style.display = mode === 'walk' ? 'flex' : 'none';
    if (mode === 'orbit') distEl.textContent = 'Walked: 0 m';
  }
  reflect(state.get('viewpoint.mode') ?? 'orbit');

  function setMode(mode) {
    if (state.get('viewpoint.mode') === mode) return;
    state.set('viewpoint.mode', mode);
    state.emit('viewpoint:mode_changed', { mode });
    reflect(mode);
    if (mode === 'walk' && !_hintShownThisSession) {
      _hintShownThisSession = true;
      showWalkHint();
    }
  }

  orbitBtn.addEventListener('click', () => setMode('orbit'));
  walkBtn.addEventListener('click', () => setMode('walk'));
  resetBtn.addEventListener('click', () => state.emit('walker:reset_request', null));

  // Distance readout updates from camera throttled events
  const onMoved = ({ distanceFromOriginM }) => {
    distEl.textContent = `Walked: ${Math.round(distanceFromOriginM)} m`;
  };
  state.on('walker:moved', onMoved);

  // External mode changes (e.g. setMode from camera) sync the buttons
  const onModeChanged = ({ mode }) => reflect(mode);
  state.on('viewpoint:mode_changed', onModeChanged);

  return () => {
    state.off('walker:moved', onMoved);
    state.off('viewpoint:mode_changed', onModeChanged);
    container.removeChild(root);
  };
}

function showWalkHint() {
  const hint = document.createElement('div');
  hint.className = 'pano-walk-hint';
  hint.textContent = HINT_TEXT;
  document.body.appendChild(hint);

  const dismiss = () => {
    hint.classList.add('fading');
    setTimeout(() => hint.remove(), 350);
    window.removeEventListener('keydown', dismiss);
    window.removeEventListener('mousedown', dismiss);
  };
  window.addEventListener('keydown', dismiss, { once: true });
  window.addEventListener('mousedown', dismiss, { once: true });
  setTimeout(dismiss, 8000);
}
