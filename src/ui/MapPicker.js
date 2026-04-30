import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { state } from '../state.js';
import { DEFAULT_FOV_DEG } from '../config.js';

const CONE_RADIUS_M = 2000;
const CONE_ARC_SAMPLES = 32;
const FOV_MIN = 30;
const FOV_MAX = 120;

const EARTH_R = 6371000;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

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
          redrawCone();
          updateReadout();
        });
    }
  }

  function placePin(lat, lon) {
    local.lat = lat;
    local.lon = lon;
    if (pinMarker) {
      pinMarker.setLatLng([lat, lon]);
    } else {
      pinMarker = L.marker([lat, lon], { icon: pinIcon, draggable: true })
        .addTo(map)
        .on('drag', e => {
          const ll = e.target.getLatLng();
          local.lat = ll.lat;
          local.lon = ll.lng;
          redrawCone();
          updateReadout();
        });
    }
    redrawCone();
    updateReadout();
  }

  map.on('click', e => placePin(e.latlng.lat, e.latlng.lng));

  fovSlider.addEventListener('input', () => {
    local.fovDeg = parseInt(fovSlider.value, 10);
    fovReadout.textContent = `${local.fovDeg}°`;
    redrawCone();
    updateReadout();
  });

  viewBtn.addEventListener('click', () => {
    if (local.lat == null) return;
    state.set('viewpoint.azimuth', local.azimuthDeg);
    state.set('viewpoint.fov', local.fovDeg);
    state.set('location', {
      lat: local.lat,
      lon: local.lon,
      displayName: `${local.lat.toFixed(5)}, ${local.lon.toFixed(5)}`,
    });
  });

  // External location updates (e.g., LocationPicker search) sync the map.
  const onLocationChanged = loc => {
    if (!loc || loc.lat == null) return;
    if (local.lat === loc.lat && local.lon === loc.lon) return;
    placePin(loc.lat, loc.lon);
    map.setView([loc.lat, loc.lon], Math.max(map.getZoom(), 11));
  };
  state.on('location:changed', onLocationChanged);

  // Leaflet needs a size invalidation after the container becomes visible
  // (sidebar mounts inside a fixed-position parent; first render can mis-size).
  setTimeout(() => map.invalidateSize(), 0);

  if (initialLoc?.lat != null) {
    placePin(initialLoc.lat, initialLoc.lon);
    map.setView([initialLoc.lat, initialLoc.lon], 11);
  }

  return () => {
    state.off('location:changed', onLocationChanged);
    map.remove();
    container.removeChild(root);
  };
}
