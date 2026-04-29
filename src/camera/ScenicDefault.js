import { SunCalculator } from '../sky/SunCalculator.js';

/**
 * Phase 1: face the sun with a slight downward tilt.
 * Phase 5 will replace this with a terrain-aware heuristic.
 *
 * @param {{lat, lon}} location
 * @param {{timestamp: Date, followSun: boolean}} time
 * @returns {{azimuth: number, elevation: number}}
 */
export const ScenicDefault = {
  suggest(location, time) {
    const sun = SunCalculator.getSunPosition(time.timestamp, location.lat, location.lon);
    return { azimuth: sun.azimuth, elevation: -5 };
  },
};
