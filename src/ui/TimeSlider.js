import tzlookup from 'tz-lookup';
import { SunCalculator } from '../sky/SunCalculator.js';
import { state } from '../state.js';

const MINUTES_IN_DAY = 1440;
const DEFAULT_MINUTE = 18 * 60 + 30;     // 18:30 — useful default near sunset

/** Hour:minute (in tz) of `date`. */
function minuteOfDayInTz(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** Given a desired local minute-of-day in tz, return a Date that, when formatted in tz, equals it. */
function minuteToTimestamp(targetMinute, tz, baseDate = new Date()) {
  const currentMinute = minuteOfDayInTz(baseDate, tz);
  let delta = targetMinute - currentMinute;
  // Stay within the same calendar day in tz: if delta would jump >12h either way,
  // we still want the closest occurrence of that local time, which the raw delta
  // already gives. Just apply it.
  return new Date(baseDate.getTime() + delta * 60 * 1000);
}

function tzAbbr(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, timeZoneName: 'short', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const tzn = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
    return tzn;
  } catch { return ''; }
}

function fmtTimeInTz(date, tz) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return `${time} ${tzAbbr(date, tz)}`.trim();
}

export function createTimeSlider(container) {
  const root = document.createElement('div');
  root.className = 'pano-section pano-time-slider';
  root.innerHTML = `
    <h3>Time</h3>
    <div class="pano-time-readout">--:--</div>
    <div class="pano-slider-track">
      <input type="range" min="0" max="${MINUTES_IN_DAY - 1}" value="${DEFAULT_MINUTE}" step="1" />
      <div class="pano-marker pano-marker-noon"    title="Solar noon"></div>
      <div class="pano-marker pano-marker-sunrise" title="Sunrise"></div>
      <div class="pano-marker pano-marker-sunset"  title="Sunset"></div>
    </div>
    <div class="pano-snap-row">
      <button type="button" class="pano-snap" data-snap="sunrise">☀↑ Sunrise</button>
      <button type="button" class="pano-snap" data-snap="goldenHour">🌅 Golden</button>
      <button type="button" class="pano-snap" data-snap="sunset">☀↓ Sunset</button>
      <button type="button" class="pano-snap" data-snap="dusk">🌃 Civil</button>
    </div>
    <label class="pano-follow-row">
      <input type="checkbox" class="pano-follow-cb" checked />
      Follow sun
    </label>
  `;
  container.appendChild(root);

  const slider     = root.querySelector('input[type=range]');
  const readout    = root.querySelector('.pano-time-readout');
  const followCb   = root.querySelector('.pano-follow-cb');
  const markerNoon = root.querySelector('.pano-marker-noon');
  const markerRise = root.querySelector('.pano-marker-sunrise');
  const markerSet  = root.querySelector('.pano-marker-sunset');
  const snapButtons = root.querySelectorAll('.pano-snap');

  let tz = null;
  let keyTimes = null;     // { sunrise, sunset, goldenHour, dusk, solarNoon } — Date objects (UTC under the hood)
  let keyMinutes = null;   // same keys → minute-of-day in tz
  let suppress = false;    // internal updates that shouldn't echo back into state

  function placeMarker(el, minute) {
    if (!Number.isFinite(minute) || minute < 0 || minute >= MINUTES_IN_DAY) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.left = `${(minute / (MINUTES_IN_DAY - 1)) * 100}%`;
  }

  function updateMarkers() {
    if (!keyMinutes) {
      [markerNoon, markerRise, markerSet].forEach(m => m.style.display = 'none');
      return;
    }
    placeMarker(markerNoon, keyMinutes.solarNoon);
    placeMarker(markerRise, keyMinutes.sunrise);
    placeMarker(markerSet,  keyMinutes.sunset);
  }

  /** Recompute timezone, sun key times, and marker positions from current location. */
  function refreshLocation() {
    const loc = state.get('location');
    if (!loc) {
      tz = null;
      keyTimes = null;
      keyMinutes = null;
      readout.textContent = '--:--';
      updateMarkers();
      return;
    }
    try { tz = tzlookup(loc.lat, loc.lon); }
    catch { tz = 'UTC'; }

    const today = new Date();
    keyTimes = SunCalculator.getKeyTimes(today, loc.lat, loc.lon);
    keyMinutes = {
      sunrise:    isFinite(keyTimes.sunrise)    ? minuteOfDayInTz(keyTimes.sunrise, tz)    : NaN,
      sunset:     isFinite(keyTimes.sunset)     ? minuteOfDayInTz(keyTimes.sunset, tz)     : NaN,
      goldenHour: isFinite(keyTimes.goldenHour) ? minuteOfDayInTz(keyTimes.goldenHour, tz) : NaN,
      dusk:       isFinite(keyTimes.dusk)       ? minuteOfDayInTz(keyTimes.dusk, tz)       : NaN,
      solarNoon:  isFinite(keyTimes.solarNoon)  ? minuteOfDayInTz(keyTimes.solarNoon, tz)  : NaN,
    };
    updateMarkers();
  }

  /** Push the current slider value into state.time.timestamp for the location's tz. */
  function applySlider() {
    if (!tz) return;
    const minute = Number(slider.value);
    const t = minuteToTimestamp(minute, tz);
    readout.textContent = fmtTimeInTz(t, tz);
    suppress = true;
    state.set('time.timestamp', t);
    suppress = false;
  }

  function snapTo(name) {
    const m = keyMinutes?.[name];
    if (!Number.isFinite(m)) return;
    slider.value = String(m);
    applySlider();
  }

  slider.addEventListener('input', applySlider);
  slider.addEventListener('change', applySlider);

  followCb.addEventListener('change', () => {
    state.set('time.followSun', followCb.checked);
  });

  snapButtons.forEach(btn => {
    btn.addEventListener('click', () => snapTo(btn.dataset.snap));
  });

  // On location change: update tz, markers, and re-emit timestamp from SAME slider position
  // so we hold time-of-day across location switches.
  const onLocation = () => { refreshLocation(); applySlider(); };
  state.on('location:changed', onLocation);

  // React to external time changes (e.g., preset load) by syncing the
  // slider position and follow-sun checkbox. `suppress` skips the echo
  // from our own applySlider() write.
  const onTime = timeObj => {
    if (!timeObj || suppress) return;
    if (followCb.checked !== timeObj.followSun) {
      followCb.checked = timeObj.followSun;
    }
    if (tz && timeObj.timestamp instanceof Date) {
      const m = minuteOfDayInTz(timeObj.timestamp, tz);
      if (Number.isFinite(m) && Number(slider.value) !== m) {
        slider.value = String(m);
        readout.textContent = fmtTimeInTz(timeObj.timestamp, tz);
      }
    }
  };
  state.on('time:changed', onTime);

  // Initial render
  refreshLocation();
  if (tz) applySlider(); else readout.textContent = '--:--';

  return () => {
    state.off('location:changed', onLocation);
    state.off('time:changed', onTime);
    container.removeChild(root);
  };
}
