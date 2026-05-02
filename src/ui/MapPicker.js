import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { state } from '../state.js';
import { CameraController } from '../camera/CameraController.js';
import { DEFAULT_FOV_DEG } from '../config.js';

const CONE_RADIUS_M = 2000;
const CONE_ARC_SAMPLES = 32;
const FOV_MIN = 30;
const FOV_MAX = 120;

const EARTH_R = 6371000;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// Earth radius matching `src/terrain/HeightSampler.js` and
// `src/style/projection.js` so the map's world-XZ → lat/lon conversion
// stays consistent with the 3D viewer's coordinate frame. (TileMath
// uses 6378137; we use the same here to avoid sub-metre drift between
// where the walker is in the 3D scene and where the pin is on the
// map.) The cone math above uses 6371000 (mean Earth radius) for
// great-circle distance — that's a few-km display estimate, separate
// from the metres-precise walker offset.
const TERRAIN_EARTH_R = 6378137;

// Convert a walker's world-XZ offset (relative to the chosen scene
// origin's lat/lon) back into a lat/lon. Mirrors the inverse of
// TileMath.lonLatToLocal that TerrainBuilder / HeightSampler use to
// place mesh vertices, so the pin lands exactly under the walker.
function anchorToLatLon(originLat, originLon, anchorX, anchorZ) {
  const dLat = -anchorZ / TERRAIN_EARTH_R * R2D;
  const dLon = anchorX / (TERRAIN_EARTH_R * Math.cos(originLat * D2R)) * R2D;
  return { lat: originLat + dLat, lon: originLon + dLon };
}

/**
 * Walk a great-circle distance from (lat, lon) along bearingDeg (deg from N, clockwise).
 * Sufficiently accurate for the few-km cone radii used here.
 * @returns {[number, number]} [lat, lon]
 */
function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const δ = distanceM / EARTH_R;
  const θ = bearingDeg * D2R;
  const φ1 = lat * D2R;
  const λ1 = lon * D2R;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * sinφ2,
  );
  return [φ2 * R2D, ((λ2 * R2D) + 540) % 360 - 180];
}

function bearingFromTo(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * D2R;
  const φ2 = lat2 * D2R;
  const Δλ = (lon2 - lon1) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

function coneRing(lat, lon, bearingDeg, fovDeg, radiusM) {
  const half = fovDeg / 2;
  const start = bearingDeg - half;
  const end = bearingDeg + half;
  const ring = [[lat, lon]];
  for (let i = 0; i <= CONE_ARC_SAMPLES; i++) {
    const t = i / CONE_ARC_SAMPLES;
    const b = start + (end - start) * t;
    ring.push(destinationPoint(lat, lon, b, radiusM));
  }
  ring.push([lat, lon]);
  return ring;
}

const pinIcon = L.divIcon({
  className: 'pano-map-pin',
  html: '<div class="pano-map-pin-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const bearingIcon = L.divIcon({
  className: 'pano-map-bearing',
  html: '<div class="pano-map-bearing-handle"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export function createMapPicker(container) {
  const root = document.createElement('div');
  root.className = 'pano-section pano-map-section';
  root.innerHTML = `
    <h3>Map</h3>
    <div class="pano-map-canvas"></div>
    <div class="pano-map-readout">Click the map to drop a pin.</div>
    <div class="pano-fov-row">
      <label>FOV
        <input type="range" class="pano-fov-slider" min="${FOV_MIN}" max="${FOV_MAX}" step="1" value="${DEFAULT_FOV_DEG}" />
        <span class="pano-fov-readout">${DEFAULT_FOV_DEG}°</span>
      </label>
    </div>
    <button class="pano-view-btn" type="button" disabled>View in 3D</button>
  `;
  container.appendChild(root);

  const mapEl = root.querySelector('.pano-map-canvas');
  const readoutEl = root.querySelector('.pano-map-readout');
  const fovSlider = root.querySelector('.pano-fov-slider');
  const fovReadout = root.querySelector('.pano-fov-readout');
  const viewBtn = root.querySelector('.pano-view-btn');

  const map = L.map(mapEl, {
    center: [45.8326, 6.8652],
    zoom: 9,
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const initialLoc = state.get('location');
  const local = {
    lat: initialLoc?.lat ?? null,
    lon: initialLoc?.lon ?? null,
    azimuthDeg: state.get('viewpoint.azimuth') ?? 270,
    fovDeg: state.get('viewpoint.fov') ?? DEFAULT_FOV_DEG,
  };

  let pinMarker = null;
  let bearingMarker = null;
  let conePoly = null;
  let bearingLine = null;

  function updateReadout() {
    if (local.lat == null) {
      readoutEl.textContent = 'Click the map to drop a pin.';
      viewBtn.disabled = true;
      return;
    }
    readoutEl.innerHTML =
      `${local.lat.toFixed(5)}°, ${local.lon.toFixed(5)}° &middot; ` +
      `bearing ${Math.round(local.azimuthDeg)}° &middot; FOV ${Math.round(local.fovDeg)}°`;
    viewBtn.disabled = false;
  }

  function redrawCone() {
    if (local.lat == null) return;
    const ring = coneRing(local.lat, local.lon, local.azimuthDeg, local.fovDeg, CONE_RADIUS_M);
    if (conePoly) {
      conePoly.setLatLngs(ring);
    } else {
      conePoly = L.polygon(ring, {
        color: '#e07b39',
        weight: 1.5,
        fillColor: '#e07b39',
        fillOpacity: 0.18,
        interactive: false,
      }).addTo(map);
    }
    const tip = destinationPoint(local.lat, local.lon, local.azimuthDeg, CONE_RADIUS_M);
    if (bearingLine) {
      bearingLine.setLatLngs([[local.lat, local.lon], tip]);
    } else {
      bearingLine = L.polyline([[local.lat, local.lon], tip], {
        color: '#f5a623',
        weight: 2,
        interactive: false,
      }).addTo(map);
    }
    if (bearingMarker) {
      bearingMarker.setLatLng(tip);
    } else {
      bearingMarker = L.marker(tip, { icon: bearingIcon, draggable: true })
        .addTo(map)
        .on('drag', e => {
          const ll = e.target.getLatLng();
          local.azimuthDeg = bearingFromTo(local.lat, local.lon, ll.lat, ll.lng);
          // Live-rotate the 3D camera. Cheap (no rebuild), so we drive it
          // every drag tick. The viewpoint:changed echo from CameraController
          // hits applyViewpointToMap below but local.azimuthDeg already
          // matches the event so the diff-guard there is a no-op — no loop.
          CameraController.lookAt(local.azimuthDeg, state.get('viewpoint.elevation') ?? -5);
          state.set('viewpoint.azimuth', local.azimuthDeg);
          redrawCone();
          updateReadout();
        });
    }
  }

  function commitLocation() {
    if (local.lat == null) return;
    state.set('location', {
      lat: local.lat,
      lon: local.lon,
      displayName: `${local.lat.toFixed(5)}, ${local.lon.toFixed(5)}`,
    });
  }

  function placePin(lat, lon, { commit = true } = {}) {
    local.lat = lat;
    local.lon = lon;
    if (pinMarker) {
      pinMarker.setLatLng([lat, lon]);
    } else {
      pinMarker = L.marker([lat, lon], { icon: pinIcon, draggable: true })
        .addTo(map)
        // Throttle the live cone redraw during drag; only commit the
        // location (which triggers a terrain rebuild) on dragend. While
        // mid-drag the camera-follower sync is paused so a stray
        // viewpoint:changed event doesn't fight the user's drag.
        .on('dragstart', () => { pinReflectsCamera = false; })
        .on('drag', e => {
          const ll = e.target.getLatLng();
          local.lat = ll.lat;
          local.lon = ll.lng;
          redrawCone();
          updateReadout();
        })
        .on('dragend', () => commitLocation());
    }
    redrawCone();
    updateReadout();
    if (commit) commitLocation();
  }

  map.on('click', e => placePin(e.latlng.lat, e.latlng.lng));

  fovSlider.addEventListener('input', () => {
    local.fovDeg = parseInt(fovSlider.value, 10);
    fovReadout.textContent = `${local.fovDeg}°`;
    // Live-zoom the 3D camera. Same diff-guard story as bearing drag —
    // the echo lands on applyViewpointToMap, finds local.fovDeg already
    // matches, and short-circuits.
    CameraController.setFOV(local.fovDeg);
    state.set('viewpoint.fov', local.fovDeg);
    redrawCone();
    updateReadout();
  });

  viewBtn.addEventListener('click', commitLocation);

  // Tracks the SCENE-ORIGIN lat/lon — the location the user dropped the
  // pin at AND committed via "View in 3D" (or via LocationPicker search).
  // The walker's `anchor` is offset from this origin in world XZ metres;
  // we convert it back to lat/lon to drive the pin position when the
  // user walks in the 3D viewer.
  let sceneOriginLat = initialLoc?.lat ?? null;
  let sceneOriginLon = initialLoc?.lon ?? null;

  // When `pinReflectsCamera` is true, the pin tracks the 3D camera —
  // it moves as the walker walks and snaps back to scene origin on
  // walker reset. When false, the pin reflects an uncommitted user
  // click on the map (proposed scene) and ignores the 3D camera. The
  // flag flips to `false` on user-driven `placePin` (map click) and
  // back to `true` on `location:changed` (commit / search).
  let pinReflectsCamera = initialLoc != null;

  // External location updates (e.g., LocationPicker search, "View in 3D"
  // button commit) re-anchor the scene and put the pin back into
  // camera-follower mode.
  const onLocationChanged = loc => {
    if (!loc || loc.lat == null) return;
    sceneOriginLat = loc.lat;
    sceneOriginLon = loc.lon;
    pinReflectsCamera = true;
    if (local.lat === loc.lat && local.lon === loc.lon) return;
    placePin(loc.lat, loc.lon);
    pinReflectsCamera = true;     // placePin sets it false; restore here
    map.setView([loc.lat, loc.lon], Math.max(map.getZoom(), 11));
  };
  state.on('location:changed', onLocationChanged);

  // 3D viewer → map sync. Fires on every camera azimuth/elevation/FOV
  // change (orbit drag, walk-mode mouse-look, wheel zoom) and on every
  // walker step (anchor xz changes). We update the bearing arrow and
  // FOV cone live; the pin moves in walk mode as the walker drifts
  // away from the scene origin. We deliberately do NOT re-centre the
  // map — the user can pan if they want; auto-following the walker
  // would fight any pan they've done.
  let lastViewpointVersion = 0;
  function applyViewpointToMap(vp) {
    if (!vp) return;
    let changed = false;

    if (typeof vp.azimuth === 'number' && vp.azimuth !== local.azimuthDeg) {
      local.azimuthDeg = vp.azimuth;
      changed = true;
    }
    if (typeof vp.fov === 'number' && Math.abs(vp.fov - local.fovDeg) > 0.5) {
      local.fovDeg = vp.fov;
      // Sync the FOV slider + readout so the UI reflects the wheel-zoom.
      const rounded = Math.round(vp.fov);
      if (parseInt(fovSlider.value, 10) !== rounded) fovSlider.value = String(rounded);
      fovReadout.textContent = `${rounded}°`;
      changed = true;
    }

    // Camera-follower mode: pin tracks the 3D camera/walker. In orbit
    // mode the anchor is always (0, 0) so the pin sits at scene origin;
    // in walk mode the anchor offset moves the pin to where the walker
    // is. When `pinReflectsCamera` is false (user clicked an
    // uncommitted location on the map), this branch skips so we don't
    // snap the pin away from the click.
    if (pinReflectsCamera && vp.anchor && sceneOriginLat != null && sceneOriginLon != null) {
      const { lat, lon } = anchorToLatLon(
        sceneOriginLat, sceneOriginLon,
        vp.anchor.x ?? 0, vp.anchor.z ?? 0,
      );
      // Small tolerance so floating-point drift on a near-stationary
      // walker doesn't redraw every frame.
      if (Math.abs(lat - local.lat) > 1e-7 || Math.abs(lon - local.lon) > 1e-7) {
        local.lat = lat;
        local.lon = lon;
        if (pinMarker) pinMarker.setLatLng([lat, lon]);
        changed = true;
      }
    }

    if (changed) {
      redrawCone();
      updateReadout();
    }
  }

  // Throttle viewpoint:changed via rAF batching. Camera orbit drag fires
  // dozens of events per second; we only need at most one map update
  // per frame.
  let pendingViewpoint = null;
  let rafScheduled = false;
  const onViewpointChanged = vp => {
    pendingViewpoint = vp;
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      const v = pendingViewpoint;
      pendingViewpoint = null;
      applyViewpointToMap(v);
      lastViewpointVersion++;
    });
  };
  state.on('viewpoint:changed', onViewpointChanged);

  // Apply the current state once on mount so the bearing arrow lines up
  // before the first viewpoint:changed event fires (which only fires when
  // the user actually moves the camera).
  const initialVp = {
    azimuth: state.get('viewpoint.azimuth'),
    fov: state.get('viewpoint.fov'),
    anchor: state.get('viewpoint.anchor') ?? { x: 0, z: 0 },
  };
  applyViewpointToMap(initialVp);

  // Leaflet needs a size invalidation after the container becomes visible
  // (sidebar mounts inside a fixed-position parent; first render can mis-size).
  setTimeout(() => map.invalidateSize(), 0);

  if (initialLoc?.lat != null) {
    placePin(initialLoc.lat, initialLoc.lon);
    map.setView([initialLoc.lat, initialLoc.lon], 11);
  }

  return () => {
    state.off('location:changed', onLocationChanged);
    state.off('viewpoint:changed', onViewpointChanged);
    map.remove();
    container.removeChild(root);
  };
}
