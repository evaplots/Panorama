import { createLocationPicker } from './LocationPicker.js';
import { createMapPicker } from './MapPicker.js';
import { createIconicViewGallery } from './IconicViewGallery.js';
import { createPresetSelector } from './PresetSelector.js';
import { createDatePicker } from './DatePicker.js';
import { createTimeSlider } from './TimeSlider.js';
import { createModeToggle } from './ModeToggle.js';
import { createDebugOverlay } from './DebugOverlay.js';
import { createPalettePicker } from './PalettePicker.js';
import { createWeatherPanel } from './WeatherPanel.js';
import { createPainterParamsPanel } from './PainterParamsPanel.js';
import { createOutputPanel } from './OutputPanel.js';
import { createTerrainPanel } from './TerrainPanel.js';
import palettes from '../style/palettes.json';
import { desaturatePalette } from '../style/algorithm.js';
import { state } from '../state.js';
import { CameraController } from '../camera/CameraController.js';
import { HeightSampler } from '../terrain/HeightSampler.js';
import { OSMFetcher } from '../osm/OSMFetcher.js';
import { WeatherFetcher } from '../weather/WeatherFetcher.js';
import { mergeWeather } from '../weather/mergeWeather.js';
import { categorise } from '../style/categories.js';
import { PRESETS, DEFAULT_PRESET, EYE_HEIGHT_M } from '../config.js';

function resolvePainterOpts() {
  const painter = state.get('style.painter');
  const source = state.get('style.paletteSource');
  if (source === 'curated' && painter && palettes[painter]) {
    return { palette: palettes[painter].colors };
  }
  return {}; // colorthief / 'auto' — let applyPointillism extract from source
}

/**
 * Build the StyleBindings snapshot at trigger time. Returns null when no
 * location is set — the painter then falls back to its pre-Step-4 path of
 * consuming the rendered canvas verbatim.
 *
 * `ground.osmFeatures` is read **cache-only** via `OSMFetcher.peekGroundCover`
 * — paint-time must never block on a fresh Overpass fetch (10–60 s). When the
 * cache is cold or the scene-rebuild fetch is still in flight, this returns
 * `osmFeatures: []` and the painter no-ops the polygon pass. Subsequent paints
 * after the scene rebuild lands pick up the polygons automatically.
 */
async function buildBindings() {
  const location = state.get('location');
  if (!location) return null;

  const vp = CameraController.getViewpoint();
  const groundY = HeightSampler.isReady()
    ? HeightSampler.getHeightAt(location.lat, location.lon)
    : 0;
  const eyeHeight = vp.eyeHeight ?? EYE_HEIGHT_M;
  const cameraWorldY = groundY + eyeHeight;

  const presetName = state.get('preset');
  const preset = PRESETS[presetName] ?? PRESETS[DEFAULT_PRESET];

  let osmFeatures = [];
  let landmarks = [];
  try {
    const polygons = await OSMFetcher.peekGroundCover(location, preset);
    osmFeatures = polygons
      .map(p => {
        const category = categorise(p.tags);
        if (!category) return null;
        return { tags: p.tags, category, outer: p.outer, inners: p.inners };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[ControlsPanel] OSM cache peek failed at paint time, painting without polygons:', err.message);
  }
  // Landmarks share the same combined-query cache, so a successful ground
  // peek implies a successful landmark peek. Wrapped in its own try anyway
  // so a tag-classification bug in elementsToLandmarks doesn't blank out
  // ground polygons (which are the higher-impact rendering layer).
  try {
    landmarks = await OSMFetcher.peekLandmarks(location, preset);
  } catch (err) {
    console.warn('[ControlsPanel] OSM landmark peek failed at paint time, painting without landmarks:', err.message);
  }

  const timestamp = state.get('time.timestamp');

  // Weather peek is cache-only (mirrors OSM peek). Cold cache → null fetched,
  // and mergeWeather composes a snapshot from overrides alone (offline path).
  // `weather` is undefined when both fetched and every override is null, which
  // keeps the optional `weather` field in StyleBindings cleanly absent under
  // destructuring — same shape the painter saw before this PR.
  let fetched = null;
  try {
    fetched = await WeatherFetcher.peekWeather(location, timestamp);
  } catch (err) {
    console.warn('[ControlsPanel] Weather cache peek failed at paint time, falling back to overrides only:', err.message);
  }
  const overrides = state.get('weatherOverrides');
  const weather = mergeWeather(fetched, overrides);

  return {
    sun: state.get('sun'),
    timestamp,
    location,
    viewpoint: {
      location,
      azimuthDeg: vp.azimuth,
      elevationDeg: vp.elevation,
      fovDeg: vp.fov,
      eyeHeightM: eyeHeight,
      cameraWorldY,
      groundY,
    },
    ground: { osmFeatures, landmarks },
    weather,
  };
}

export const ControlsPanel = {
  init(rootEl) {
    const sidebar = document.createElement('div');
    sidebar.className = 'pano-sidebar';
    rootEl.appendChild(sidebar);

    // Sub-components (return cleanup fns but we don't need them for Phase 1)
    createMapPicker(sidebar);
    createLocationPicker(sidebar);
    createIconicViewGallery(sidebar);
    createPalettePicker(sidebar);
    createWeatherPanel(sidebar);
    createPainterParamsPanel(sidebar);
    createPresetSelector(sidebar);
    createTerrainPanel(sidebar);
    createDatePicker(sidebar);
    createTimeSlider(sidebar);
    createOutputPanel(sidebar);
    createModeToggle(sidebar);
    createDebugOverlay();

    // Export section
    const exportSection = document.createElement('div');
    exportSection.className = 'pano-section';
    exportSection.innerHTML = `
      <h3>Export</h3>
      <button class="pano-export-btn" disabled>Save image</button>
      <button class="pano-stylize-btn">🎨 Test pointillism</button>
    `;
    sidebar.appendChild(exportSection);

    const exportBtn = exportSection.querySelector('.pano-export-btn');
    const stylizeBtn = exportSection.querySelector('.pano-stylize-btn');

    // Pointillism paints whatever is currently on the canvas, so it has no
    // dependency on scene-readiness — terrain still loading, OSM not yet in,
    // even nothing rendered yet. The button stays enabled and the user gets
    // a painting of whatever the canvas shows at click time.
    // SceneManager only emits 'scene:loading' / 'scene:ready' / 'scene:error' —
    // there is no 'scene:changed' event. Mirror the status-bar listeners below.
    const setExportEnabled = enabled => { exportBtn.disabled = !enabled; };
    state.on('scene:ready', () => setExportEnabled(true));
    state.on('scene:loading', () => setExportEnabled(false));
    state.on('scene:error', () => setExportEnabled(false));
    setExportEnabled(state.get('scene.status') === 'ready');

    exportBtn.addEventListener('click', async () => {
      const { ExportPipeline } = await import('../export/ExportPipeline.js');
      exportBtn.disabled = true;
      exportBtn.textContent = 'Saving…';
      try {
        await ExportPipeline.export({ format: 'screen', dpi: 96, orientation: 'landscape' });
      } catch (e) {
        console.error('Export failed', e);
      } finally {
        exportBtn.disabled = state.get('scene.status') !== 'ready';
        exportBtn.textContent = 'Save image';
      }
    });

    stylizeBtn.addEventListener('click', async () => {
      const { applyPointillism } = await import('../style/index.js');
      stylizeBtn.disabled = true;
      stylizeBtn.textContent = 'Painting…';

      try {
        // Snapshot the live Three.js canvas. Read it through a 2D context
        // because applyPointillism uses getImageData (faster than reading
        // a WebGL canvas directly via gl.readPixels for our purposes).
        const webglCanvas = document.getElementById('panorama-canvas');
        const snap = document.createElement('canvas');
        snap.width = webglCanvas.width;
        snap.height = webglCanvas.height;
        const sctx = snap.getContext('2d');
        sctx.drawImage(webglCanvas, 0, 0);

        const targetPaperSize = state.get('export.format');
        const targetOrientation = state.get('export.orientation');

        const bindings = await buildBindings();

        // Bridge weather → painter opts (DATA-CONTRACTS v0 bindings). All
        // derivations happen at the call site per the brief — the Pointillism
        // engine is unchanged. Each binding is gated on the relevant field
        // being a finite number, so partial weather (overrides without a
        // fetched snapshot, or vice versa) still works.
        const weatherOpts = {};
        const wx = bindings?.weather;
        const wind = wx?.wind;
        if (wind && Number.isFinite(wind.directionDeg) && Number.isFinite(wind.speedMs)) {
          weatherOpts.windDirectionDeg = wind.directionDeg + 90;
          weatherOpts.windInfluence = wind.speedMs > 1.5 ? 0.4 : 0;
          weatherOpts.brushStrokeFactor = 1.0 * (1 + wind.speedMs / 10);
        }
        // Precipitation → brushOpacity. Heavy rain softens strokes;
        // clamped to keep the painting readable at the extremes.
        if (Number.isFinite(wx?.precipitation_mmh)) {
          const op = 0.85 - wx.precipitation_mmh / 40;
          weatherOpts.brushOpacity = Math.max(0.55, Math.min(0.85, op));
        }

        // Cloud cover → palette desaturation. Applied at the call site by
        // mutating the curated-palette opt before the engine extends it.
        // For 'auto' / ColorThief mode the engine extracts the palette
        // internally and we cannot intercept post-extension without an
        // engine change (the brief explicitly forbids that), so this
        // binding only fires when a curated palette is selected at v0.
        // Tracking issue for an engine hook lives in the curation backlog.
        const painterOpts = resolvePainterOpts();
        if (
          Number.isFinite(wx?.cloudCover_pct) &&
          Array.isArray(painterOpts.palette) &&
          painterOpts.palette.length > 0
        ) {
          const factor = Math.min(0.5, wx.cloudCover_pct / 200);
          if (factor > 0) {
            painterOpts.palette = desaturatePalette(painterOpts.palette, factor);
          }
        }

        // V2 Step 5c — PainterParamsPanel surface, read at trigger time.
        // Defaults match the engine's own DEFAULTS so an untouched panel
        // reproduces the pre-step-5c painting.
        const p = state.get('painter');
        const painterParams = {
          brushWidthMm: p.brushWidthMm,
          density: p.density,
          brushOpacity: p.brushOpacity,
          brushStrokeFactor: p.brushStrokeFactor,
          paletteTemperature: p.paletteTemperature,
          paletteSize: p.paletteSize,
          seed: p.seed,
        };
        // Wind-tilt override semantics: when finite, the user wants
        // unconditional control — force windInfluence and let the panel
        // win over the PR #9 weather rule. Null = auto = the rule above
        // already wrote the data-driven value into weatherOpts.
        if (Number.isFinite(p.windInfluenceOverride)) {
          weatherOpts.windInfluence = p.windInfluenceOverride;
        }

        // Spread order: palette source → painter sliders → weather data.
        // weatherOpts last lets brushOpacity (precip) and brushStrokeFactor
        // (wind speed) override the panel sliders; that matches the brief's
        // call-site contract from PR #9 (data-driven beats user-configured
        // for those two, except where the user overrode them). For
        // brushOpacity / brushStrokeFactor we accept that the slider becomes
        // a no-op when weather data is present — by design; the panel ships
        // the parameter surface, the data surface stays in charge.
        const { canvas: stylized, timing } = await applyPointillism(snap, {
          ...painterOpts,
          ...painterParams,
          targetPaperSize,
          targetOrientation,
          bindings,
          ...weatherOpts,
        });
        console.log('[Pointillism] timing:', timing);

        // Open result in a new window with the timing summary.
        const w = window.open('', 'pointillism-result', 'width=900,height=700');
        if (w) {
          w.document.title = 'Pointillism — test result';
          w.document.body.style.cssText = 'margin:0;background:#222;color:#eee;font-family:system-ui;';
          const info = w.document.createElement('div');
          info.style.cssText = 'padding:12px 16px;font-size:13px;line-height:1.5;';
          info.innerHTML = `
            <strong>Pointillism v0.1 perf</strong><br>
            Source: ${timing.megapixels} MP &middot; Strokes: ${timing.strokeCount.toLocaleString()}<br>
            Effective DPI: <strong>${timing.effectiveDpi}</strong> &middot;
              Target: ${timing.targetPaperSize} ${timing.targetOrientation} &middot;
              Stroke px: <strong>${timing.brushThicknessPx}</strong><br>
            Ground polygons: <strong>${timing.groundPolygonCount ?? 0}</strong> &middot;
              Canopy dabs: <strong>${(timing.canopyDabCount ?? 0).toLocaleString()}</strong>
              (${timing.canopyMs ?? 0} ms) &middot;
              Landmarks: <strong>${timing.landmarkDrawnCount ?? 0}</strong>
              (${timing.landmarkMs ?? 0} ms)<br>
            Total: <strong>${timing.totalMs} ms</strong>
            (gradient ${timing.gradientMs} ms, strokes ${timing.strokesMs} ms)<br>
            Projected A3 @ 300 DPI (17.4 MP, linear): <strong>${timing.projectedA3Ms} ms</strong>
            (${(timing.projectedA3Ms / 1000).toFixed(1)} s)
          `;
          w.document.body.appendChild(info);
          stylized.style.cssText = 'display:block;max-width:100%;height:auto;';
          w.document.body.appendChild(stylized);
        }
      } catch (e) {
        console.error('Pointillism failed', e);
        alert('Pointillism failed: ' + e.message);
      } finally {
        stylizeBtn.disabled = false;
        stylizeBtn.textContent = '🎨 Test pointillism';
      }
    });

    // Status bar
    const statusEl = document.createElement('div');
    statusEl.className = 'pano-status';
    sidebar.appendChild(statusEl);

    state.on('scene:loading', payload => {
      statusEl.className = 'pano-status loading';
      const phase = payload?.phase;
      statusEl.textContent =
        phase === 'osm' ? 'Loading ground cover…' : 'Loading terrain…';
    });
    state.on('scene:ready', () => {
      statusEl.className = 'pano-status';
      statusEl.textContent = 'Drag to look around · scroll to zoom';
    });
    state.on('scene:error', ({ message }) => {
      statusEl.className = 'pano-status error';
      statusEl.textContent = `Error: ${message}`;
    });

    // Hint
    const hint = document.createElement('div');
    hint.className = 'pano-hint';
    hint.textContent = 'Search for a place to begin';
    rootEl.appendChild(hint);
    state.on('location:changed', () => hint.remove());
  },
};
