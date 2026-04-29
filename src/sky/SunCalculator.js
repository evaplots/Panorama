import SunCalc from 'suncalc';

/** Altitude boundaries for sun phase classification (degrees). */
const PHASES = [
  { phase: 'day', min: 6 },
  { phase: 'goldenHour', min: 0 },
  { phase: 'sunset', min: -2 },
  { phase: 'civilTwilight', min: -6 },
  { phase: 'night', min: -Infinity },
];

function getPhase(altDeg) {
  for (const { phase, min } of PHASES) {
    if (altDeg >= min) return phase;
  }
  return 'night';
}

function estimateColourTemp(altDeg) {
  if (altDeg > 30) return 5800;
  if (altDeg > 6)  return 4500;
  if (altDeg > 0)  return 3200;
  if (altDeg > -2) return 2200;
  if (altDeg > -6) return 1800;
  return 1500;
}

export const SunCalculator = {
  /**
   * @param {Date} timestamp
   * @param {number} lat
   * @param {number} lon
   * @returns {{azimuth, altitude, colourTempK, phase}}
   */
  getSunPosition(timestamp, lat, lon) {
    const raw = SunCalc.getPosition(timestamp, lat, lon);
    // SunCalc azimuth: radians from south, positive = west
    const azimuthDeg = (180 + raw.azimuth * 180 / Math.PI + 360) % 360;
    const altitudeDeg = raw.altitude * 180 / Math.PI;
    return {
      azimuth: azimuthDeg,
      altitude: altitudeDeg,
      colourTempK: estimateColourTemp(altitudeDeg),
      phase: getPhase(altitudeDeg),
    };
  },

  /**
   * @param {Date} date
   * @param {number} lat
   * @param {number} lon
   * @returns {Date}
   */
  getSunsetTime(date, lat, lon) {
    const times = SunCalc.getTimes(date, lat, lon);
    return times.sunset;
  },

  /**
   * @param {Date} date
   * @param {number} lat
   * @param {number} lon
   * @returns {Date}
   */
  getCivilTwilightTime(date, lat, lon) {
    const times = SunCalc.getTimes(date, lat, lon);
    return times.dusk; // end of civil twilight
  },

  getSunriseTime(date, lat, lon) {
    return SunCalc.getTimes(date, lat, lon).sunrise;
  },

  /** Evening golden hour start (sun about to dip toward horizon). */
  getGoldenHourTime(date, lat, lon) {
    return SunCalc.getTimes(date, lat, lon).goldenHour;
  },

  getSolarNoonTime(date, lat, lon) {
    return SunCalc.getTimes(date, lat, lon).solarNoon;
  },

  /**
   * @param {Date} date
   * @param {number} lat
   * @param {number} lon
   * @returns {{sunrise, sunset, goldenHour, dusk, solarNoon}}
   */
  getKeyTimes(date, lat, lon) {
    const t = SunCalc.getTimes(date, lat, lon);
    return {
      sunrise:    t.sunrise,
      sunset:     t.sunset,
      goldenHour: t.goldenHour,
      dusk:       t.dusk,
      solarNoon:  t.solarNoon,
    };
  },

  getPhase,
};
