# Module: Export Pipeline

**Owner role:** 🖨 Export Pipeline Engineer
**Phase introduced:** Phase 1 (basic screen-resolution PNG), Phase 4 (full A3 300 DPI)
**Files:**
- `src/export/ExportPipeline.js`
- `src/export/TiledRenderer.js`

---

## Purpose

Produce a print-quality PNG of the current scene at the user's chosen format (A3 default), DPI (300 default), and orientation (landscape default). Survive any GPU.

This is the deliverable users actually take away from the app, so quality and reliability matter more than speed.

---

## Public API

```js
// ExportPipeline.js
export const ExportPipeline = {
  export(spec: ExportSpec): Promise<Blob>
  canRenderInOnePass(width: number, height: number): boolean
  getRecommendedDPI(format: string): number       // based on detected GPU
};
```

---

## The size math

A3: 420mm × 297mm.

| DPI | Landscape pixels | Megapixels | Memory @ RGBA float32 |
| --- | ---------------- | ---------- | ---------------------- |
| 72  | 1191 × 842       | 1.0 MP     | ~16 MB                 |
| 150 | 2480 × 1754      | 4.4 MP     | ~70 MB                 |
| 300 | 4961 × 3508      | 17.4 MP    | ~280 MB                |
| 600 | 9921 × 7016      | 69.6 MP    | ~1.1 GB                |

300 DPI is print-shop standard. We support up to 600 with tiled rendering.

---

## Single-pass vs tiled

```js
function canRenderInOnePass(w, h) {
  const max = renderer.capabilities.maxTextureSize;
  return w <= max && h <= max;
}
```

`maxTextureSize` reports the GPU's largest possible render target. Modern desktops report 16384, mobile typically 8192–4096.

| GPU class                | Reported max | Single-pass A3 300 DPI? |
| ------------------------ | ------------ | ----------------------- |
| Desktop GPU (NVIDIA/AMD) | 16384        | ✅                      |
| Modern integrated (Intel)| 8192         | ✅                      |
| Recent Apple Silicon     | 16384        | ✅                      |
| Older mobile             | 4096         | ❌ → tile               |

If single-pass works, we use it. Otherwise the TiledRenderer takes over.

---

## Single-pass export flow

```js
async function singlePassExport(spec) {
  const { width, height } = pixelSize(spec);
  state.emit('export:start', spec);

  // 1. Save current state
  const oldSize = renderer.getSize(new THREE.Vector2());
  const oldAspect = camera.aspect;
  const oldPixelRatio = renderer.getPixelRatio();

  try {
    // 2. Resize for export
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // 3. Optionally enable extra quality (MSAA, shadows, post-processing)
    renderer.setRenderTarget(makeMultisampleRenderTarget(width, height, 4));

    // 4. Render once
    renderer.render(scene, camera);

    // 5. Read pixels back
    const blob = await renderTargetToBlob(renderer.getRenderTarget(), width, height);

    state.emit('export:complete', { filename: makeFilename(spec), sizeBytes: blob.size });
    return blob;
  } finally {
    // 6. Restore
    renderer.setRenderTarget(null);
    renderer.setPixelRatio(oldPixelRatio);
    renderer.setSize(oldSize.x, oldSize.y, false);
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();
  }
}
```

Critical: the `finally` block. If the export fails halfway, we MUST restore the renderer or the preview is broken until reload.

---

## Tiled export flow

For low-end GPUs or huge sizes (A3 600, A2, A1):

```js
async function tiledExport(spec, tilesX = 2, tilesY = 2) {
  const { width, height } = pixelSize(spec);
  const tileW = Math.ceil(width / tilesX);
  const tileH = Math.ceil(height / tilesY);

  const composite = new OffscreenCanvas(width, height);
  const ctx = composite.getContext('2d');

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // Use Three.js's setViewOffset to render a sub-rectangle
      camera.setViewOffset(width, height, tx * tileW, ty * tileH, tileW, tileH);
      camera.updateProjectionMatrix();

      renderer.setSize(tileW, tileH, false);
      renderer.render(scene, camera);

      const tileBlob = await canvasToBlob(renderer.domElement);
      const tileBitmap = await createImageBitmap(tileBlob);
      ctx.drawImage(tileBitmap, tx * tileW, ty * tileH);

      state.emit('export:progress', { tile: ty * tilesX + tx + 1, total: tilesX * tilesY });
    }
  }

  camera.clearViewOffset();
  return composite.convertToBlob({ type: 'image/png' });
}
```

`setViewOffset` is the magic — it tells the camera to render only a sub-rectangle of its frustum, allowing seamless tiling.

Tile counts auto-chosen by GPU max:

```js
function pickTileCount(width, height, maxTextureSize) {
  const tilesX = Math.ceil(width / maxTextureSize);
  const tilesY = Math.ceil(height / maxTextureSize);
  return [tilesX, tilesY];
}
```

---

## Quality settings for export

Different from preview. Preview prioritises 60 FPS; export prioritises image quality.

| Setting                | Preview | Export                       |
| ---------------------- | ------- | ---------------------------- |
| MSAA                   | 0–2x    | 4x                           |
| Shadow map size        | 1024    | 4096                         |
| Anisotropic filtering  | 4       | 16 (max)                     |
| Tree LOD distances     | aggressive | 1.5× more generous        |
| Pixel ratio            | window.devicePixelRatio | 1 (we already render at print res) |

Some of these settings live in other modules — Export coordinates by setting flags on `state.export.inProgress = true`, and other modules check this.

---

## Filename convention

```
panorama_{location-slug}_{YYYYMMDD-HHmm}_{format}-{orientation}-{dpi}.png

panorama_mont-blanc_20260427-2014_A3-landscape-300.png
panorama_46.83N-6.86E_20260101-1655_A3-portrait-300.png
```

- Location slug: from `Location.displayName` (kebab-case, ASCII-only). Falls back to lat/lon if missing.
- Timestamp: the rendered moment (the time on the slider), not the export moment. Users sort their downloads.

---

## Pause render loop during export

The preview render loop competes for the GPU. Pause it:

```js
async function export(spec) {
  SceneManager.pauseRenderLoop();
  try {
    return await doExport(spec);
  } finally {
    SceneManager.resumeRenderLoop();
  }
}
```

Add `pauseRenderLoop` / `resumeRenderLoop` to SceneManager's public API for this.

---

## What this module does NOT do

- Doesn't modify scene contents. Read-only access to scene/camera/renderer.
- Doesn't reschedule async builds. If user clicks export mid-build, we wait for `state.scene.status === 'ready'` first.
- Doesn't apply post-processing the preview doesn't have. Look should match what user sees, just sharper.
- Doesn't print. Just produces a file.

---

## How to extend

### Add JPEG / WebP

Trivial — `canvas.toBlob('image/jpeg', 0.95)`. PNG is the default because of lossless quality, but JPEG @ 95 is much smaller. Add format option to UI in Phase 5.

### Add metadata (EXIF)

Library: `piexifjs`. Embed location, datetime, viewpoint into the PNG. Useful for archiving. Phase 5.

### Add SVG export

Probably impossible — sky shader is not SVG-renderable. Could rasterise the sky and overlay vector terrain contours. Niche; defer.

### Print to PDF

Ironically harder than image export — needs jsPDF or similar, and the output is just an image embedded in PDF anyway. Skip; users can wrap PNG in PDF themselves.

### Add A2 / A1

Update `EXPORT` constants in `config.js`. Tiled rendering already scales — the only thing that might surprise you is memory pressure on the OffscreenCanvas at A1@300 (about 4 GB). Test before promising it.

### Better progressive rendering

For tiled exports of A1 or larger, show preview tiles as they complete (composite into a small preview canvas in the UI). Phase 5 polish.

---

## Common pitfalls

- **Forgetting `camera.updateProjectionMatrix()`** after changing aspect → invisible bug, the image looks subtly stretched.
- **`canvas.toBlob` vs `canvas.toDataURL`.** Use `toBlob` — much faster and lower memory for large images.
- **`OffscreenCanvas` not supported on older Safari.** Polyfill or fall back to a regular hidden canvas.
- **Max texture size != max renderbuffer size.** They can differ on some GPUs. Check both.
- **Preview camera is dirty after export.** If `finally` doesn't restore correctly, user sees broken view. Always test by exporting twice in a row.
- **MSAA + render-to-texture interactions.** WebGL2's `MultisampledRenderTarget` is the right path. WebGL1 fallbacks involve a blit step. We require WebGL2, simplifying this.
- **Browser hangs during export.** Tiled rendering is on the main thread by default. If tiles take >100 ms each, browser shows "page unresponsive." Fix: yield with `await new Promise(r => setTimeout(r, 0))` between tiles.

---

## Tests worth writing

- `pixelSize({format: 'A3', orientation: 'landscape', dpi: 300})` returns `{width: 4961, height: 3508}`.
- `canRenderInOnePass` returns true on test system.
- Renderer state restored after success and after failure (both paths).
- Filename slug correct for various display names.
