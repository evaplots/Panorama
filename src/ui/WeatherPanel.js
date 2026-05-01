// V2 Step 5 — Weather override panel.
//
// Pattern (modelled on generative_panorama.html): each row's placeholder is
// the value most recently peeked from WeatherFetcher's cache for the current
// location/time. Typing into the input overrides the fetched value at paint
// time; clearing the input restores the fetched value. Cold cache or no
// internet → user can still drive the painting purely from overrides.
//
// State writes go to `weatherOverrides.*`; bindings composition lives in
// ControlsPanel.buildBindings (mergeWeather merges fetched + overrides per
// field). This panel never reads or writes the Pointillism engine.

import { state } from '../state.js';
import { WeatherFetcher } from '../weather/WeatherFetcher.js';

const FIELDS = [
  { key: 'wind.directionDeg',     label: 'Wind direction',  unit: '°',     statePath: 'weatherOverrides.wind.directionDeg' },
  { key: 'wind.speedMs',          label: 'Wind speed',      unit: 'm/s',   statePath: 'weatherOverrides.wind.speedMs' },
  { key: 'cloudCover_pct',        label: 'Cloud cover',     unit: '%',     statePath: 'weatherOverrides.cloudCover_pct' },
  { key: 'humidity_pct',          label: 'Humidity',        unit: '%',     statePath: 'weatherOverrides.humidity_pct' },
  { key: 'precipitation_mmh',     label: 'Precipitation',   unit: 'mm/h',  statePath: 'weatherOverrides.precipitation_mmh' },
  { key: 'temperature_C',         label: 'Temperature',     unit: '°C',    statePath: 'weatherOverrides.temperature_C' },
];

function readSnapshotField(snapshot, key) {
  if (!snapshot) return null;
  if (key === 'wind.directionDeg') return snapshot.wind?.directionDeg ?? null;
  if (key === 'wind.speedMs')      return snapshot.wind?.speedMs ?? null;
  return snapshot[key] ?? null;
}

function formatPlaceholder(fetchedValue) {
  if (fetchedValue == null || !Number.isFinite(fetchedValue)) return 'auto';
  // One decimal for sub-1 fractional fields (precipitation, wind speed),
  // integer otherwise. Tabular-ish — placeholders are hints, not data.
  const rounded = Math.abs(fetchedValue) < 10
    ? Math.round(fetchedValue * 10) / 10
    : Math.round(fetchedValue);
  return `auto · ${rounded}`;
}

function setOverride(statePath, value) {
  // _state.weatherOverrides is a nested object; state.set walks the dotted
  // path, so 'weatherOverrides.wind.directionDeg' lands in the right slot
  // and fires 'weatherOverrides:changed' as the top-level event.
  state.set(statePath, value);
  // Lightweight dedicated event so the panel can re-render placeholders
  // without coupling to the wider 'weatherOverrides:changed' fan-out.
  state.emit('weatherOverride:changed', null);
}

export function createWeatherPanel(parentEl) {
  const section = document.createElement('div');
  section.className = 'pano-section pano-weather-section';
  section.innerHTML = '<h3>Weather</h3>';
  parentEl.appendChild(section);

  const list = document.createElement('div');
  list.className = 'pano-weather-list';
  section.appendChild(list);

  const inputs = new Map();

  for (const field of FIELDS) {
    const row = document.createElement('label');
    row.className = 'pano-weather-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'pano-weather-label';
    labelEl.textContent = field.label;
    row.appendChild(labelEl);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = 'auto';
    // Initialise from any pre-existing override (e.g., reload-via-bundler
    // restored state). null → empty input.
    const initial = state.get(field.statePath);
    if (Number.isFinite(initial)) input.value = String(initial);
    row.appendChild(input);

    const unit = document.createElement('span');
    unit.className = 'pano-weather-unit';
    unit.textContent = field.unit;
    row.appendChild(unit);

    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (raw === '') {
        setOverride(field.statePath, null);
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return; // ignore garbage; don't clobber state
      setOverride(field.statePath, parsed);
    });

    list.appendChild(row);
    inputs.set(field.key, input);
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'pano-weather-reset';
  resetBtn.textContent = 'Reset overrides';
  section.appendChild(resetBtn);

  resetBtn.addEventListener('click', () => {
    for (const field of FIELDS) {
      state.set(field.statePath, null);
    }
    for (const input of inputs.values()) input.value = '';
    state.emit('weatherOverride:changed', null);
  });

  // Refresh placeholders from the current cache. Cold cache → 'auto' on every
  // row. The warm path in SceneManager emits 'weather:fetched' once a fetch
  // lands; we also re-peek on location/time changes for the cache-hit case.
  async function refreshPlaceholders() {
    const location = state.get('location');
    const timestamp = state.get('time.timestamp');
    let snapshot = null;
    if (location && timestamp) {
      try {
        snapshot = await WeatherFetcher.peekWeather(location, timestamp);
      } catch (err) {
        console.warn('[WeatherPanel] peekWeather failed:', err.message);
      }
    }
    for (const field of FIELDS) {
      const fetched = readSnapshotField(snapshot, field.key);
      inputs.get(field.key).placeholder = formatPlaceholder(fetched);
    }
  }

  // Initial paint + reactive refresh.
  refreshPlaceholders();
  state.on('location:changed', refreshPlaceholders);
  state.on('time:changed', refreshPlaceholders);
  state.on('weather:fetched', refreshPlaceholders);

  return {
    destroy() {
      section.remove();
    },
  };
}
