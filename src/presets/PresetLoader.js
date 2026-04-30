import iconicViews from './iconicViews.json';
import tzlookup from 'tz-lookup';
import { state } from '../state.js';

/**
 * @typedef {Object} IconicView
 * @property {string} slug
 * @property {string} name
 * @property {string} region
 * @property {{lat:number, lon:number, eyeHeightM:number}} observer
 * @property {{azimuthDeg:number, fovDeg:number}} view
 * @property {{hour:number, month:number}} recommended
 * @property {string} blurb
 */

/** @returns {IconicView[]} */
export function getAll() {
  return iconicViews;
}

/**
 * @param {string} slug
 * @returns {IconicView | null}
 */
export function getBySlug(slug) {
  return iconicViews.find(v => v.slug === slug) ?? null;
}

/**
 * Build a Date that, when formatted in `tz`, shows the given wall-clock.
 * Used to convert a preset's `{hour, month}` (with day-of-month fixed at
 * the 15th — a representative mid-month date with stable sun phase) into
 * an absolute timestamp the time/sun/scene pipeline can consume.
 */
function dateInTimezone(year, month, day, hour, tz) {
  const guessUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(guessUtc));
  const got = {};
  for (const p of parts) if (p.type !== 'literal') got[p.type] = parseInt(p.value, 10);
  if (got.hour === 24) got.hour = 0; // some locales report midnight as '24'
  const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
  return new Date(guessUtc + (guessUtc - gotUtc));
}

/**
 * Load a preset into application state. Writes location, viewpoint
 * (azimuth, fov, eyeHeight), and time (reconstructed from
 * recommended.{hour, month} for the current year, in the location's
 * timezone). Turns off followSun so the preset's explicit bearing isn't
 * overwritten by sun-tracking.
 *
 * @param {string} slug
 * @returns {boolean} true on success, false if slug unknown
 */
export function loadIntoState(slug) {
  const preset = getBySlug(slug);
  if (!preset) {
    console.warn(`[PresetLoader] No preset found for slug "${slug}"`);
    return false;
  }
  const { observer, view, recommended } = preset;

  let tz;
  try { tz = tzlookup(observer.lat, observer.lon); }
  catch { tz = 'UTC'; }

  const year = new Date().getFullYear();
  const presetTime = dateInTimezone(year, recommended.month, 15, recommended.hour, tz);

  if (state.get('time.followSun')) {
    state.set('time.followSun', false);
  }

  state.set('viewpoint.azimuth', view.azimuthDeg);
  state.set('viewpoint.fov', view.fovDeg);
  state.set('viewpoint.eyeHeight', observer.eyeHeightM);

  // Location must precede time: TimeSlider's location handler recomputes
  // its timezone from the new coordinates, so the timestamp we write
  // afterwards lands on the right tz axis.
  state.set('location', {
    lat: observer.lat,
    lon: observer.lon,
    displayName: preset.name,
  });

  state.set('time.timestamp', presetTime);

  return true;
}
