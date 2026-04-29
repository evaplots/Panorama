# Setup & Run

Step-by-step instructions to get Panorama running on your machine.

---

## 1. Prerequisites

You need exactly two things installed:

### Node.js 18 or newer

Check what you have:

```bash
node --version
```

If you see `v18.x.x` or higher, you're set. If not, install from <https://nodejs.org> (pick the LTS version).

### A modern browser

Chrome, Firefox, Safari, or Edge from the last 2 years. WebGL2 is required — Panorama will refuse to start without it. To verify your browser supports WebGL2: visit <https://get.webgl.org/webgl2/>.

That's it. No Python, no Docker, no API keys.

---

## 2. Create the project

From the folder where you want the project to live:

```bash
npm create vite@latest panorama -- --template vanilla
cd panorama
npm install
```

This scaffolds a minimal Vite project. Now install Panorama's runtime dependencies:

```bash
npm install three suncalc tz-lookup
```

(`tz-lookup` is added in Phase 2 for the time slider's location-aware local-time display.)

Optionally install dev helpers (recommended):

```bash
npm install -D prettier eslint
```

---

## 3. Replace the scaffold with Panorama's structure

Vite's default scaffold gives you a `main.js`, `style.css`, and `index.html`. Replace them with the structure described in `docs/ARCHITECTURE.md`. The folder tree should end up like this:

```
panorama/
├── index.html
├── package.json
├── vite.config.js
├── README.md
├── SETUP.md
├── docs/                        ← architecture documents (already provided)
├── public/                      ← static assets (tree textures, icons)
└── src/
    ├── main.js                  ← entry point
    ├── config.js                ← presets, defaults, constants
    ├── state.js                 ← central app state + event bus
    ├── scene/
    │   ├── SceneManager.js
    │   └── Renderer.js
    ├── terrain/
    │   ├── TerrainBuilder.js
    │   ├── DEMFetcher.js
    │   └── HeightSampler.js
    ├── sky/
    │   ├── SkySystem.js
    │   └── SunCalculator.js
    ├── osm/
    │   ├── OSMFetcher.js
    │   ├── GroundCoverBuilder.js
    │   ├── BuildingsBuilder.js
    │   ├── VegetationBuilder.js
    │   └── LODManager.js
    ├── camera/
    │   ├── CameraController.js
    │   └── ScenicDefault.js
    ├── export/
    │   ├── ExportPipeline.js
    │   └── TiledRenderer.js
    ├── ui/
    │   ├── ControlsPanel.js
    │   ├── LocationPicker.js
    │   ├── TimeSlider.js
    │   ├── PresetSelector.js
    │   ├── ModeToggle.js
    │   └── DebugOverlay.js
    └── data/
        ├── Cache.js
        ├── Geocoder.js
        └── TileMath.js
```

Each leaf file's contents and responsibility are specified in the corresponding `docs/modules/*.md` file. You don't need every file to exist before running — empty stubs are fine in Phase 1.

---

## 4. Configuration files

### `vite.config.js`

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: true },
  build: { target: 'es2022', sourcemap: true },
  // Three.js is large — let it be its own chunk
  optimizeDeps: { include: ['three', 'suncalc'] },
});
```

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Panorama — sunset views from anywhere</title>
  </head>
  <body>
    <div id="app"></div>
    <canvas id="panorama-canvas"></canvas>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

### `package.json` scripts

Make sure your `scripts` block looks like this:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "format": "prettier --write src/"
  }
}
```

---

## 5. Run

### Development (with hot reload)

```bash
npm run dev
```

Vite prints a local URL, usually <http://localhost:5173>. The page auto-reloads on file save.

### Production build

```bash
npm run build
npm run preview
```

`build` produces a `dist/` folder you can host anywhere static (Netlify, GitHub Pages, S3, your own server). `preview` serves it locally to verify the build works.

---

## 5b. Recommended for Phase 2+ development: local Overpass via Docker

By Phase 2 you'll be testing OSM features (buildings, ground cover) often, which means many Overpass API calls. The public `overpass-api.de` rate-limits aggressively and will ban your IP within an hour or two of dev iteration. **Skip the pain entirely** by running a local Overpass server:

### Prerequisites

Docker Desktop (macOS / Windows) or Docker Engine (Linux). <https://docs.docker.com/get-docker/>

### One-time setup

Pick a region from <https://download.geofabrik.de> matching where you'll be testing. For Italy:

```bash
docker run -d \
  --name overpass-panorama \
  -p 12345:80 \
  -e OVERPASS_META=yes \
  -e OVERPASS_MODE=init \
  -e OVERPASS_PLANET_URL=https://download.geofabrik.de/europe/italy/centro-latest.osm.pbf \
  -v overpass-panorama-data:/db \
  wiktorn/overpass-api
```

The container downloads the .pbf and builds the database on first run. Watch progress:

```bash
docker logs -f overpass-panorama
```

Wait until you see `Overpass API started`. Centro Italy: ~5 minutes. All Italy: ~15 minutes. Disk usage: ~12 GB for centro Italy.

### Wire it up

In `src/config.js`, prepend `localhost` to the Overpass endpoints:

```js
overpass: [
  'http://localhost:12345/api/interpreter',
  'https://overpass-api.de/api/interpreter',  // fallback
],
```

Reload Panorama. Open DevTools → Network → filter `interpreter`. Requests should hit `localhost:12345` and return in milliseconds.

### Stop / start / switch regions

```bash
docker stop overpass-panorama
docker start overpass-panorama
```

For a different region, `docker rm overpass-panorama` and run the command above with a different `OVERPASS_PLANET_URL`. Or run multiple containers on different ports.

### Why this matters

Without local Overpass: ~50 dev iterations and your IP gets a 1-hour rate-limit. With local Overpass: unlimited iterations, sub-second responses, and your dev loop is no longer at the mercy of public infrastructure. Full setup details in [docs/modules/data-layer.md](./docs/modules/data-layer.md) "Local Overpass via Docker."

---

## 6. About the external APIs

Panorama uses three free public APIs. You don't need keys, but you do need to be a good citizen:

| API                  | Used for          | Rate limit                  | Etiquette                          |
| -------------------- | ----------------- | --------------------------- | ---------------------------------- |
| **AWS Terrain Tiles**| Elevation (DEM)   | None published, be reasonable | Cache aggressively (`src/data/Cache.js`) |
| **Overpass API**     | OSM features      | Strict — see data-layer docs | **Run local Overpass via Docker for development** (section 5b) |
| **Nominatim**        | Address search    | 1 request/second hard limit | Send a `User-Agent` header identifying your app |

The `data-layer` module handles caching, backoff, and endpoint fallback. If you're deploying Panorama publicly with significant traffic, you **must** self-host Overpass — public infrastructure won't tolerate it.

---

## 7. Troubleshooting

**Blank screen, console says "WebGL2 not available."**
Update your browser, or enable hardware acceleration in browser settings. On older machines, GPU drivers may need updating.

**Export fails at A3 300 DPI.**
Your GPU's `MAX_RENDERBUFFER_SIZE` is below 4961. The export module will automatically fall back to tiled rendering — but if that also fails, drop to 150 DPI in the export panel.

**Overpass timeouts on large radii.**
Expected at 25 km+ in dense urban areas. The data-layer splits queries into tiles and retries; if a tile keeps failing, it's logged and the scene renders without that tile's features.

**Nominatim returns nothing for a known place.**
Nominatim is sensitive to query phrasing. The geocoder retries with reformatted queries; if all fail, paste lat/lon directly in the location input.

**`npm install` fails with EACCES errors on macOS/Linux.**
You're probably running with a system-installed Node. Use `nvm` (<https://github.com/nvm-sh/nvm>) to manage Node versions in your home folder.

---

## 8. Next steps

Once `npm run dev` shows a blank scene with a default sky:

1. Read [docs/ROADMAP.md](./docs/ROADMAP.md) to see the build phases.
2. Read [docs/ROLES.md](./docs/ROLES.md) to see who owns what.
3. Start with **Phase 1 MVP**: terrain + sky + sun + time slider, no OSM features yet.

Each phase in the roadmap is independently shippable — you'll have a working app at the end of Phase 1 and can show it to people before touching Phase 2.
