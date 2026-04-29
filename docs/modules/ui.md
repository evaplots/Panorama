# Module: UI / Controls

**Owner role:** 🎛 UI/Controls Engineer
**Phase introduced:** Phase 1, expanded each phase
**Files:**
- `src/ui/ControlsPanel.js` — top-level container, owns layout
- `src/ui/LocationPicker.js` — search + lat/lon input
- `src/ui/TimeSlider.js` — time slider, "follow sun" toggle
- `src/ui/PresetSelector.js` — distance preset radio + custom input
- (Phase 2) `src/ui/ModeToggle.js` — orbit/walk mode switch
- (Phase 2) `src/ui/DebugOverlay.js` — toggleable diagnostic panel
- (Phase 4) `src/ui/ExportPanel.js` — format/DPI/orientation pickers

---

## Purpose

All DOM, all interactions, all CSS. The 3D canvas does not produce a single click handler — every user action goes through this module.

The UI module is intentionally *separate* from the rendering pipeline. UI reads/writes `state`; the scene reacts to `state` changes. UI never imports from `src/scene/`, `src/terrain/`, etc.

---

## Public API

```js
// ControlsPanel.js — the only public entry
export const ControlsPanel = {
  init(rootElement: HTMLElement): void
};
```

Internally `ControlsPanel.init()` instantiates and mounts each sub-component. Sub-components are not exported — if you need a sub-component elsewhere, that's a refactor conversation.

---

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ┌────────────────────┐                                      │
│  │  Location Picker   │                                      │
│  │  [search input]    │                                      │
│  │  46.83°N 6.86°E    │                                      │
│  └────────────────────┘                                      │
│                                                              │
│  ┌────────────────────┐    ┌──── 3D canvas ───────────────┐  │
│  │  Preset Selector   │    │                              │  │
│  │  ◯ urban           │    │                              │  │
│  │  ⦿ suburban        │    │      [scene renders here]    │  │
│  │  ◯ open            │    │                              │  │
│  │  ◯ alpine          │    │                              │  │
│  │  ◯ custom: [_]km   │    │                              │  │
│  └────────────────────┘    │                              │  │
│                             │  ┌──compass──┐               │  │
│  ┌────────────────────┐    │  │  N        │               │  │
│  │  Time Slider       │    │  │  ☼ →      │               │  │
│  │  ━━━━━●━━━━━       │    │  └───────────┘               │  │
│  │  20:14 (sunset)    │    └─────────────────────────────┘  │
│  │  ☐ Follow sun      │                                      │
│  └────────────────────┘                                      │
│                                                              │
│  ┌────────────────────┐                                      │
│  │  Export            │                                      │
│  │  [A3 ▼] [land. ▼]  │                                      │
│  │  [300 DPI ▼]       │                                      │
│  │  [ Export PNG ]    │                                      │
│  └────────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
```

Phase 1: location picker, preset, time slider, basic export button.
Phase 4: full export panel, framing overlay on canvas.

Sidebar collapses on narrow viewports. Mobile is best-effort, not a target.

---

## Component pattern

Each sub-component follows the same pattern:

```js
export function createTimeSlider(container) {
  // 1. Build DOM
  const root = document.createElement('div');
  root.className = 'panorama-time-slider';
  root.innerHTML = `
    <input type="range" min="-7200" max="3600" value="0" step="60" />
    <div class="time-display"></div>
    <label><input type="checkbox" checked /> Follow sun</label>
  `;
  container.appendChild(root);

  const slider = root.querySelector('input[type=range]');
  const display = root.querySelector('.time-display');
  const followSun = root.querySelector('input[type=checkbox]');

  // 2. Read state, render
  const render = () => {
    const offset = slider.valueAsNumber * 1000;
    const sunsetTime = SunCalculator.getSunsetTime(new Date(), state.location.lat, state.location.lon);
    display.textContent = formatTime(new Date(sunsetTime.getTime() + offset));
  };
  state.on('location:changed', render);

  // 3. Write to state on input
  slider.addEventListener('input', () => {
    const t = new Date(sunsetTime.getTime() + slider.valueAsNumber * 1000);
    state.set('time.timestamp', t);
  });
  followSun.addEventListener('change', () => {
    state.set('time.followSun', followSun.checked);
  });

  // 4. Cleanup hook
  return () => {
    state.off('location:changed', render);
    container.removeChild(root);
  };
}
```

Pattern summary:
1. Build DOM in one place.
2. Render reactively from state.
3. Write to state on user input.
4. Return a cleanup function for hot reload / testing.

No frameworks, no virtual DOM. The components are small enough that direct DOM manipulation is the simplest possible solution.

---

## Sub-component responsibilities

### LocationPicker

- Text search box debounced 300ms → calls `Geocoder.search`.
- Dropdown of suggestions (top 5 results).
- Manual lat/lon input fields as fallback.
- "Use my location" button (optional — geolocation API requires HTTPS).
- On selection: `state.set('location', {lat, lon, displayName})`.

Validation:
- Lat in [-85, 85] (terrain breaks beyond polar latitudes).
- Lon in [-180, 180].
- Displays error inline, never alerts.

### PresetSelector

- Radio buttons for the four named presets.
- "Custom" reveals a number input (km).
- On change: `state.set('preset', name)` (and `state.set('customRadius', km)` if custom).

### TimeSlider

- Range slider covering a **full 24-hour day** at the chosen location, in that location's **local time**.
- Range: 00:00 to 23:59, step 1 minute (1440 positions).
- Live time readout displays in local time with timezone abbreviation (e.g. `17:42 CET`, `06:14 EST`, `12:30 NPT`).
- **Markers visible on the slider track**: sunrise (small ☀ icon, golden), sunset (small ☀ icon, orange), solar noon (subtle vertical line). These help the user navigate to interesting moments without scrubbing blindly.
- **Snap buttons** below the slider: ☀↑ Sunrise, ☀↓ Sunset, 🌅 Golden hour (–30min before sunset), 🌃 Civil twilight. Click to jump the slider to that moment.
- "Follow sun" checkbox toggles `state.time.followSun` — when enabled, camera azimuth tracks the sun automatically as the slider moves.
- Auto-recentre on `location:changed` — when the location changes, the slider's sunrise/sunset markers and timezone update; the time-of-day position holds (e.g. if user was at 17:42, after changing location they're still at 17:42 *local time of the new location*).

#### Local time and timezone

The timezone of the chosen location is determined client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone` for the *user's* device, BUT we want the *location's* timezone — different things if you're planning a sunset in Tokyo from a laptop in Rome.

Two viable approaches:

1. **Look up timezone by lat/lon.** A free static dataset like `tz-lookup` (npm package, ~500 KB, runs entirely client-side, no API) maps coordinates → IANA timezone (e.g. `Asia/Kathmandu`). Then format dates with `toLocaleString('en-GB', {timeZone: 'Asia/Kathmandu', ...})`.

2. **Compute UTC offset from longitude as approximation.** `offsetHours = Math.round(lon / 15)`. Fast, no dependency, but wrong by 30–60 minutes for many places (Nepal is UTC+5:45, India is +5:30) and ignores DST.

**Use approach 1** — `tz-lookup`. The 500 KB cost is fine (one-time download, gzips well) and the accuracy is worth it.

```js
import tzlookup from 'tz-lookup';
const tz = tzlookup(location.lat, location.lon);   // 'Asia/Kathmandu'
const localTime = new Date().toLocaleTimeString('en-GB', {
  timeZone: tz, hour: '2-digit', minute: '2-digit'
});
const tzAbbr = new Date().toLocaleTimeString('en-GB', {
  timeZone: tz, timeZoneName: 'short'
}).split(' ').pop();   // 'NPT'
```

#### Date selection

For Phase 2 the date is implicit "today." The full date picker lands in Phase 5 — the slider knows nothing about it; date stays in `state.time.date` and just gets composed with the slider's time-of-day to form the final `state.time.timestamp`.

#### Slider implementation note

A naive 1440-step range slider can feel slightly sluggish on touch devices. If responsiveness becomes an issue, switch to a custom range with `requestAnimationFrame`-throttled state writes. Phase 2's vanilla `<input type="range">` is fine for v1.

### ModeToggle (Phase 2+)

- Two-button group: **Orbit** / **Walk**.
- On click: `state.set('viewpoint.mode', 'walk')` (or `'orbit'`), then emit `viewpoint:mode_changed`.
- Highlights the active mode.
- "↺ Reset position" button visible only in walk mode — calls `CameraController.resetToOrigin()` directly via a one-shot event `walker:reset_request`, OR a small public API call (decide during implementation; either is consistent with the architecture).
- Optional walk-distance readout: "Walked: 234 m from origin" — updates on `walker:moved`.

First-time-user hint: when the user enters walk mode for the first time in a session, show a brief overlay tip:

> *Use **W A S D** or arrow keys to walk. Hold **Shift** to jog. Click the canvas to enable mouse-look (press **Esc** to release).*

Dismiss on any key press or after 8 seconds. Don't show again in the same session. Persisting "seen this hint" across sessions is Phase 5 territory.

### DebugOverlay (Phase 2+, toggleable)

A diagnostic overlay added during Phase 2 troubleshooting and kept for ongoing debugging. Toggle with the **`?`** key (or a small "🐞 Debug" button in the corner). Hidden by default.

When visible, displays a fixed-position translucent panel (top-right corner of canvas) showing live diagnostic info:

```
─────────────────────────────────
 PANORAMA — DEBUG
─────────────────────────────────
 FPS:           58
 Frame dt:      0.017s
 Camera mode:   walk
 Camera pos:    (123.4, 1487.2, -56.8)
 Walk anchor:   (123.4, -56.8)
 Walk velocity: 1.4 m/s
 Walked total:  234 m
 Keys down:     [W, Shift]
 Sun azimuth:   265°
 Sun altitude:  -2°
 Scene status:  ready
 Cache:         142 hits / 8 misses (94.7%)
 Last Overpass: 200 OK (kumi mirror)
─────────────────────────────────
 [press ? to hide]
```

The values come from a small `DebugState` object that other modules write to. To avoid coupling, modules don't import `DebugOverlay` directly — they call a global `window.__panoramaDebug.report({fps: 58})` or write to a debug-state object on `state.debug.*`. UI module reads and renders.

**Why this is permanent** — every Phase showed bugs that were diagnosable in seconds with this info but took multiple rounds of "send me a screenshot" without it. Cost to keep: ~50 lines of code and a few microseconds per frame to update the readout. Worth it.

**What it must NOT do** — affect rendering, gameplay, or user state. It's read-only on the systems it inspects. If toggling it on changes the scene in any way, that's a bug.

### ExportPanel (Phase 4)

- Format dropdown (A3 / A2 / A1).
- Orientation dropdown (landscape / portrait).
- DPI dropdown (150 / 300 / 600).
- "Export" button.
- Progress bar listens to `export:progress`.
- Disabled if `state.scene.status !== 'ready'`.

### Compass overlay (Phase 4)

- Rendered with SVG inside the canvas overlay div.
- Shows N/E/S/W markers.
- Shows sun position dot.
- Shows current camera azimuth as a triangle.
- Updates on `viewpoint:changed` and `sun:updated`.

### A3 framing overlay (Phase 4)

- Translucent rectangle on the canvas matching the export aspect ratio.
- Helps user compose for the print, not the screen.
- Toggle on/off in the export panel.

---

## CSS

One stylesheet: `src/ui/styles.css`. Imported once in `main.js`.

Conventions:

- BEM-ish naming: `.panorama-control-panel`, `.panorama-time-slider__readout`.
- CSS variables at `:root` for theme: `--bg`, `--fg`, `--accent`, `--shadow`.
- Dark theme by default — UI mustn't outshine the sunset image.
- No external CSS dependencies.

Mobile breakpoint: collapse sidebar to a bottom drawer at <600px width.

---

## What this module does NOT do

- Doesn't render anything 3D.
- Doesn't compute sun position. Uses `SunCalculator`.
- Doesn't fetch location data directly. Uses `Geocoder`.
- Doesn't read scene objects. Trusts `state` for everything.
- Doesn't decide what the export does. Triggers `ExportPipeline.export()`.

---

## How to extend

### Add a new control

1. Decide whether the control needs new state. If yes — talk to the architect; update `state.js` and `DATA-CONTRACTS.md` first.
2. Create `src/ui/MyControl.js` following the component pattern.
3. Mount it from `ControlsPanel.init`.
4. Wire its state changes through `state.set`.

### Add keyboard shortcuts (Phase 5)

Centralise in `src/ui/Shortcuts.js`. Document in a help overlay (`?` key). Examples:
- `Space` — toggle "follow sun"
- `←/→` — seek time slider
- `R` — reset to scenic default view
- `E` — open export panel

### Add localisation

UI strings in a single `src/ui/i18n.js`. Detect language from browser, fall back to English. Initial languages: English. Italian, French, German, Spanish are obvious additions given the app's nature.

### Add user accounts / saved scenes

Out of scope for now. Would require backend, auth, persistence. localStorage gets us "last session" without any of that.

---

## Common pitfalls

- **Tightly coupling UI to module internals.** Bad: `import { TerrainBuilder } from '../terrain/...'`. Good: dispatch through `state`.
- **Synchronous UI updates blocking input.** All long operations are async — UI just sets state and waits for `scene:ready`.
- **Debouncing the wrong thing.** Debounce search input (network), not slider input (user expects instant feedback).
- **Not handling state during loading.** While `state.scene.status === 'loading'`, disable controls that would trigger another rebuild. Don't queue them.
- **Z-index wars.** Overlays (compass, framing rectangle) need a clear stacking context. Define z-index ranges in CSS comments.

---

## Tests worth writing

- TimeSlider readout matches the timestamp it sets on state.
- LocationPicker validation rejects out-of-range coordinates.
- Disabled state for export button when scene is loading.
- Component cleanup function fully removes DOM and event listeners.
