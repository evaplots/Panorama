import { Geocoder } from '../data/Geocoder.js';
import { state } from '../state.js';

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function validate(lat, lon) {
  if (!isFinite(lat) || lat < -85 || lat > 85) return 'Latitude must be between -85 and 85.';
  if (!isFinite(lon) || lon < -180 || lon > 180) return 'Longitude must be between -180 and 180.';
  return null;
}

export function createLocationPicker(container) {
  const root = document.createElement('div');
  root.className = 'pano-section';
  root.innerHTML = `
    <h3>Location</h3>
    <div class="pano-search-wrap">
      <input type="text" class="pano-search" placeholder="Search place or paste lat, lon…" autocomplete="off" />
      <div class="pano-suggestions" style="display:none"></div>
    </div>
    <div class="pano-coords"></div>
    <div class="pano-error"></div>
  `;
  container.appendChild(root);

  const input = root.querySelector('.pano-search');
  const suggBox = root.querySelector('.pano-suggestions');
  const coordsEl = root.querySelector('.pano-coords');
  const errorEl = root.querySelector('.pano-error');

  function showError(msg) { errorEl.textContent = msg ?? ''; }
  function showCoords(loc) {
    if (!loc) { coordsEl.textContent = ''; return; }
    coordsEl.textContent = `${loc.lat.toFixed(5)}°  ${loc.lon.toFixed(5)}°`;
  }

  function selectResult(result) {
    const err = validate(result.lat, result.lon);
    if (err) { showError(err); return; }
    showError('');
    input.value = result.displayName ?? `${result.lat.toFixed(5)}, ${result.lon.toFixed(5)}`;
    suggBox.style.display = 'none';
    state.set('location', { lat: result.lat, lon: result.lon, displayName: result.displayName });
    showCoords(result);
  }

  function renderSuggestions(results) {
    suggBox.innerHTML = '';
    if (!results.length) { suggBox.style.display = 'none'; return; }
    suggBox.style.display = 'block';
    results.forEach(r => {
      const el = document.createElement('div');
      el.className = 'pano-suggestion';
      el.textContent = r.displayName;
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        selectResult(r);
      });
      suggBox.appendChild(el);
    });
  }

  // Try parsing "lat, lon" typed directly
  function tryParseLatLon(text) {
    const m = text.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), displayName: text };
  }

  const doSearch = debounce(async (query) => {
    showError('');
    const ll = tryParseLatLon(query);
    if (ll) { renderSuggestions([ll]); return; }
    if (query.length < 3) { suggBox.style.display = 'none'; return; }
    try {
      const results = await Geocoder.search(query);
      renderSuggestions(results);
    } catch (err) {
      showError('Search failed. Check your connection.');
    }
  }, 350);

  input.addEventListener('input', () => doSearch(input.value.trim()));
  input.addEventListener('blur', () => {
    // Delay so mousedown on suggestion fires first
    setTimeout(() => { suggBox.style.display = 'none'; }, 150);
  });
  input.addEventListener('focus', () => {
    if (suggBox.children.length) suggBox.style.display = 'block';
  });

  // Sync coords display when location changes externally
  const onLocationChanged = loc => showCoords(loc);
  state.on('location:changed', onLocationChanged);

  showCoords(state.get('location'));

  return () => {
    state.off('location:changed', onLocationChanged);
    container.removeChild(root);
  };
}
