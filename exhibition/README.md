# Panorama — exhibition plates

Print-ready PNG files for the six plates described in `../EXHIBITION.md`.
All files A3 @ 300 DPI (4961×3508 px), ready to print or submit without
further processing.

| File                                  | Plate | Title             | Painter   | Scene             |
| ------------------------------------- | ----- | ----------------- | --------- | ----------------- |
| `plate-i-sturm.png`                   | I     | *Sturm*           | Nolde     | storm seascape    |
| `plate-ii-battersea-imagined.png`     | II    | *Battersea, Imagined* | Whistler  | urban dusk        |
| `plate-iii-alpine-vibration.png`      | III   | *Alpine Vibration* | Kirchner  | alpine sunset     |
| `plate-iv-snow-storm.png`             | IV    | *Snow Storm*      | Turner    | snow blizzard     |
| `plate-v-red-walls.png`               | V     | *Red Walls*       | Marc      | desert canyon     |
| `plate-vi-anxious-twilight.png`       | VI    | *Anxious Twilight* | Munch     | coastal twilight  |

Each plate was rendered from a synthetic test scene through the v1.4
expressionist pipeline (`--curated --no-median --width-mm=1.2
--brush-stroke=2.0 --density=0.03`). Re-run reproducibility: see
`scripts/pointillism-test.js` and the iteration directory paths in
`../.iterations/PROJECT-STATE.md`.

Wall-label text for each plate is in `../EXHIBITION.md` under "Plates."

## Print recommendations

- A3 (297 × 420 mm) at 300 DPI matches the file's native pixel resolution
  exactly — no upscaling, no detail loss.
- Heavyweight matte fine-art paper (e.g. Hahnemühle Photo Rag 308 gsm or
  similar) suits the painterly textures better than gloss.
- The brush-stroke physical width is 1.2 mm at A3 — strokes will be
  visibly distinct without being coarse from typical viewing distance.
