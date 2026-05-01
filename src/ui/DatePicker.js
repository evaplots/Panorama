// V2 Step 5 (amendment) — Date picker.
//
// Native `<input type="date">` mounted immediately above the TimeSlider.
// Picking a new date shifts state.time.timestamp by the day-delta (in UTC
// milliseconds) so the existing time:changed listeners (Sky, SceneManager
// weather warm) all fire without further wiring. We use the location's
// timezone via tz-lookup so the picker reads "the date *there*", matching
// how TimeSlider reads "the time *there*".
//
// DST-handling note: shifting by Date.UTC delta keeps the UTC instant N
// days apart from where it was, which on a DST-crossing pair of days will
// drift the local wall-clock hour by ±1. This mirrors the same simple-shift
// approach TimeSlider uses for its minute slider — both prioritise stable
// state-bus semantics over wall-clock pinning, and DST drift in the picked
// time is acceptable for v0 curation.

import tzlookup from 'tz-lookup';
import { state } from '../state.js';

function tzForLocation() {
  const loc = state.get('location');
  if (!loc) return 'UTC';
  try { return tzlookup(loc.lat, loc.lon); }
  catch { return 'UTC'; }
}

/** YYYY-MM-DD as it reads in `tz` for the given Date. */
function dateInTz(date, tz) {
  // 'en-CA' yields YYYY-MM-DD ordering directly via formatToParts.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

export function createDatePicker(container) {
  const root = document.createElement('div');
  root.className = 'pano-section pano-date-section';
  root.innerHTML = `
    <h3>Date</h3>
    <input type="date" class="pano-date-input" />
  `;
  container.appendChild(root);

  const input = root.querySelector('.pano-date-input');

  // Suppress our own time:changed echo (mirrors TimeSlider's `suppress`).
  let suppress = false;

  function syncFromState() {
    const ts = state.get('time.timestamp');
    if (!(ts instanceof Date)) return;
    input.value = dateInTz(ts, tzForLocation());
  }

  function applyPicked() {
    const picked = input.value; // "YYYY-MM-DD" or "" (cleared)
    if (!picked) return;
    const ts = state.get('time.timestamp');
    if (!(ts instanceof Date)) return;

    const tz = tzForLocation();
    const currentDay = dateInTz(ts, tz);
    if (currentDay === picked) return;

    const [py, pm, pd] = picked.split('-').map(Number);
    const [cy, cm, cd] = currentDay.split('-').map(Number);
    const dayDeltaMs = Date.UTC(py, pm - 1, pd) - Date.UTC(cy, cm - 1, cd);

    suppress = true;
    state.set('time.timestamp', new Date(ts.getTime() + dayDeltaMs));
    suppress = false;
  }

  input.addEventListener('change', applyPicked);

  // Re-sync when location changes (tz may shift) or when something else
  // moves the timestamp (e.g., snap-to-sunrise on a new location).
  state.on('location:changed', syncFromState);
  state.on('time:changed', () => {
    if (suppress) return;
    syncFromState();
  });

  syncFromState();

  return {
    destroy() { root.remove(); },
  };
}
