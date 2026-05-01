// Painter-side pinhole projection: lat/lon (+ ground Y) → canvas pixel coords.
// Shared between Step 4 (ground polygons) and Step 11 (building silhouettes,
// when that ships). Mirrors the geometry the 3D scene gets from Three.js + the
// existing TileMath.lonLatToLocal helper, so a polygon projected here lands
// approximately where it lands in the rendered scene — close enough that the
// painted result reads as the same place.
//
// Coordinate conventions (matching CameraController.applyLookAt + TileMath):
//   - World: +X east, +Y up, +Z south
//   - lonLatToLocal returns {x, z} in metres relative to the observer
//   - Camera position is (0, cameraWorldY, 0) at the observer's lat/lon
//   - Forward vector at azimuth=270 (west), elevation=0:
//       fx = sin(270°)·cos(0°) = -1
//       fy = sin(0°) = 0
//       fz = -cos(270°)·cos(0°) = 0     → looks toward -X (east-ward? no, west)
//     Reading the camera code: az=270 means looking west, fx=-1, fz=0. ✓
//
// A vertex in front of the camera projects to:
//   focal = (canvas.width / 2) / tan(fov_h / 2)
//   px = canvas.width/2 + (right · rel) / (forward · rel) · focal
//   py = canvas.height/2 - (up · rel)    / (forward · rel) · focal
//
// We do simple near-plane clipping in 2D screen-space at depth=NEAR_M
// (Sutherland–Hodgman against the depth=NEAR_M plane). Vertices behind the
// near plane are clipped, giving a polygon that the canvas fill can render
// without flipping inside-out near the camera.

const NEAR_M = 1.0;     // metres; half a pace, well inside any visible polygon
const DEG_TO_RAD = Math.PI / 180;

/**
 * @typedef {Object} ProjectionContext
 * @property {number} originLat  Observer latitude (degrees)
 * @property {number} originLon  Observer longitude (degrees)
 * @property {number} azimuthDeg
 * @property {number} elevationDeg
 * @property {number} fovDeg
 * @property {number} cameraWorldY
 * @property {number} groundY    Sampled ground Y under observer; used as the
 *                               flat-ground approximation for polygon vertices
 *                               (acceptable inaccuracy at v0; flagged P2).
 * @property {number} canvasWidth
 * @property {number} canvasHeight
 */

/**
 * Build a projector closure from a ViewpointSnapshot and canvas size.
 * The closure is a hot path — it captures cosines, focal length, and the
 * camera basis once per call to applyPointillism, not per vertex.
 *
 * @param {ProjectionContext} ctx
 */
export function createProjector(ctx) {
  const az = ctx.azimuthDeg * DEG_TO_RAD;
  const el = ctx.elevationDeg * DEG_TO_RAD;

  const sinAz = Math.sin(az);
  const cosAz = Math.cos(az);
  const sinEl = Math.sin(el);
  const cosEl = Math.cos(el);

  // Forward (the look direction)
  const fx = sinAz * cosEl;
  const fy = sinEl;
  const fz = -cosAz * cosEl;

  // Right is forward × worldUp, with worldUp=(0,1,0). Pre-normalised version
  // works out to (cos(az), 0, sin(az)) — independent of elevation.
  const rx = cosAz;
  const ry = 0;
  const rz = sinAz;

  // Up = right × forward
  const ux = -sinAz * sinEl;
  const uy = cosEl;
  const uz = cosAz * sinEl;

  const focal = (ctx.canvasWidth / 2) / Math.tan(ctx.fovDeg * DEG_TO_RAD / 2);
  const cx = ctx.canvasWidth / 2;
  const cy = ctx.canvasHeight / 2;
  const cosOriginLat = Math.cos(ctx.originLat * DEG_TO_RAD);

  // Project a single (lat, lon, worldY) point. Returns {sx, sy, depth} where
  // depth is metres along the view axis (positive = in front of camera).
  function projectPoint(lat, lon, worldY) {
    // lat/lon → local XZ metres (matches TileMath.lonLatToLocal)
    const dLat = (lat - ctx.originLat) * DEG_TO_RAD;
    const dLon = (lon - ctx.originLon) * DEG_TO_RAD;
    const x = dLon * 6378137 * cosOriginLat;
    const z = -dLat * 6378137;

    // Vector from camera to point
    const px = x;
    const py = worldY - ctx.cameraWorldY;
    const pz = z;

    const depth = px * fx + py * fy + pz * fz;
    const u     = px * rx + py * ry + pz * rz;
    const v     = px * ux + py * uy + pz * uz;

    if (depth <= 0) {
      return { sx: NaN, sy: NaN, depth };
    }
    return {
      sx: cx + (u / depth) * focal,
      sy: cy - (v / depth) * focal,
      depth,
    };
  }

  // For near-plane clipping in eye-space we need (u, v, depth) before the divide.
  function projectPointEye(lat, lon, worldY) {
    const dLat = (lat - ctx.originLat) * DEG_TO_RAD;
    const dLon = (lon - ctx.originLon) * DEG_TO_RAD;
    const x = dLon * 6378137 * cosOriginLat;
    const z = -dLat * 6378137;
    const px = x;
    const py = worldY - ctx.cameraWorldY;
    const pz = z;
    return {
      depth: px * fx + py * fy + pz * fz,
      u:     px * rx + py * ry + pz * rz,
      v:     px * ux + py * uy + pz * uz,
    };
  }

  function eyeToScreen(eye) {
    return {
      sx: cx + (eye.u / eye.depth) * focal,
      sy: cy - (eye.v / eye.depth) * focal,
      depth: eye.depth,
    };
  }

  /**
   * Project a closed lat/lon ring (e.g. polygon outer or inner) to a list of
   * canvas-space points, near-plane-clipped. Returns null if fewer than 3
   * survive the clip.
   *
   * @param {{lat:number, lon:number}[]} ring
   * @param {number} worldY
   * @returns {{sx:number, sy:number}[] | null}
   */
  function projectRing(ring, worldY) {
    const eyePts = ring.map(p => projectPointEye(p.lat, p.lon, worldY));
    // Drop trailing closure-duplicate
    if (eyePts.length >= 2) {
      const a = ring[0], b = ring[ring.length - 1];
      if (a.lat === b.lat && a.lon === b.lon) eyePts.pop();
    }
    if (eyePts.length < 3) return null;

    // Sutherland–Hodgman clip against the near plane (depth >= NEAR_M).
    const clipped = [];
    for (let i = 0; i < eyePts.length; i++) {
      const cur = eyePts[i];
      const prev = eyePts[(i - 1 + eyePts.length) % eyePts.length];
      const curIn = cur.depth >= NEAR_M;
      const prevIn = prev.depth >= NEAR_M;

      if (curIn) {
        if (!prevIn) {
          // Edge enters — emit intersection then current
          const t = (NEAR_M - prev.depth) / (cur.depth - prev.depth);
          clipped.push({
            depth: NEAR_M,
            u: prev.u + (cur.u - prev.u) * t,
            v: prev.v + (cur.v - prev.v) * t,
          });
        }
        clipped.push(cur);
      } else if (prevIn) {
        // Edge exits — emit intersection only
        const t = (NEAR_M - prev.depth) / (cur.depth - prev.depth);
        clipped.push({
          depth: NEAR_M,
          u: prev.u + (cur.u - prev.u) * t,
          v: prev.v + (cur.v - prev.v) * t,
        });
      }
      // both out: emit nothing
    }

    if (clipped.length < 3) return null;
    return clipped.map(eyeToScreen);
  }

  return {
    projectPoint,
    projectRing,
    horizonY() {
      // A horizontal ray (Y = cameraY) at distance D has py=0, so v/depth
      // simplifies to -tan(el). Canvas-y of the horizon is cy + tan(el)·focal:
      // looking down (el<0) puts horizon above center (smaller y), as expected.
      return cy + (sinEl / cosEl) * focal;
    },
  };
}
