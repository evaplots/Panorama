# Module: Sky & Lighting

**Owner role:** ☀️ Sky & Lighting Engineer
**Phase introduced:** Phase 1
**Files:**
- `src/sky/SkySystem.js`
- `src/sky/SunCalculator.js`

---

## Purpose

This is the artistic heart of Panorama. Sunset is what the app exists to capture — the orange haze, the long shadows, the sun disk hugging the horizon, the gradient from warm sky behind to cool sky overhead. This module produces all of it.

It does two things:

1. Computes where the sun is at any given moment, anywhere on Earth.
2. Renders the sky and lights the scene accordingly.

---

## Public API

```js
// SunCalculator.js — pure math, no Three.js
export const SunCalculator = {
  getSunPosition(timestamp: Date, lat: number, lon: number): SunPosition
  getSunsetTime(date: Date, lat: number, lon: number): Date
  getCivilTwilightTime(date: Date, lat: number, lon: number): Date
  getPhase(altitudeDeg: number): 'day' | 'goldenHour' | 'sunset' | 'civilTwilight' | 'night'
};

// SkySystem.js — the Three.js side
export const SkySystem = {
  init(scene: THREE.Scene): void           // adds sky dome + lights to scene
  update(timestamp: Date, location: Location): void   // called every frame
  getDirectionalLight(): THREE.DirectionalLight       // for shadow casters
};
```

---

## Sun math (SunCalculator)

Wraps the SunCalc library (<https://github.com/mourner/suncalc>). SunCalc gives us azimuth in radians from south (negative = east of south); we convert to compass degrees (0=N, 90=E, 180=S, 270=W) for the rest of the app.

```js
function getSunPosition(timestamp, lat, lon) {
  const raw = SunCalc.getPosition(timestamp, lat, lon);
  // raw.azimuth: radians, 0=south, positive=west
  // raw.altitude: radians, 0=horizon, π/2=zenith
  const azimuthDeg = (180 + raw.azimuth * 180 / Math.PI + 360) % 360;
  const altitudeDeg = raw.altitude * 180 / Math.PI;
  return {
    azimuth: azimuthDeg,
    altitude: altitudeDeg,
    colourTempK: estimateColourTemp(altitudeDeg),
    phase: getPhase(altitudeDeg),
  };
}
```

### Phase boundaries

| Phase           | Sun altitude (degrees) |
| --------------- | ---------------------- |
| `day`           | > 6                    |
| `goldenHour`    | 0 to 6                 |
| `sunset`        | -2 to 0                |
| `civilTwilight` | -6 to -2               |
| `night`         | < -6                   |

Default time slider range: `civilTwilight + 5min` to `goldenHour - 5min` (about 90 minutes total around sunset).

### Colour temperature heuristic

```js
function estimateColourTemp(altitudeDeg) {
  if (altitudeDeg > 30) return 5800;      // overhead daylight
  if (altitudeDeg > 6)  return 4500;      // afternoon
  if (altitudeDeg > 0)  return 3200;      // golden hour
  if (altitudeDeg > -2) return 2200;      // sunset
  if (altitudeDeg > -6) return 1800;      // civil twilight
  return 1500;                            // night
}
```

The directional light's colour is set by converting this Kelvin value to RGB via standard blackbody-radiation formulas.

---

## Sky shader (SkySystem)

Three.js ships a `Sky` shader (under `addons/objects/Sky.js`) implementing the **Preetham atmospheric scattering** model. It takes:

- `turbidity` (haze amount; 2 = clear, 10 = hazy)
- `rayleigh` (blue-sky scattering strength)
- `mieCoefficient` (sun-disk scattering)
- `mieDirectionalG` (sun-disk forward-scatter)
- `sunPosition` (a unit vector to the sun)

For sunsets, we tune turbidity higher than default — real sunsets have more atmospheric particles in the line of sight. Defaults in `config.js`:

```js
SKY: {
  turbidity: 6,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
}
```

These can be overridden by phase — at deep sunset we push turbidity up to 8 for richer oranges, then back down at twilight.

### Sun position vector

```js
const phi = THREE.MathUtils.degToRad(90 - sunAltitudeDeg);
const theta = THREE.MathUtils.degToRad(sunAzimuthDeg);
const sunVec = new THREE.Vector3();
sunVec.setFromSphericalCoords(1, phi, theta);
sky.material.uniforms.sunPosition.value.copy(sunVec);
```

---

## Lighting setup

Three lights, all owned by SkySystem:

```js
// 1. Sun (the main directional light)
const sun = new THREE.DirectionalLight(sunColour, sunIntensity);
sun.position.copy(sunVec.multiplyScalar(10000));
sun.castShadow = true;          // Phase 4+

// 2. Sky fill (subtle blue from the dome)
const sky = new THREE.HemisphereLight(skyColour, groundColour, 0.3);

// 3. Ambient (tiny, for shadow detail)
const ambient = new THREE.AmbientLight(0x404040, 0.05);
```

`sunIntensity` is altitude-dependent: full strength when sun is up, fades to zero at -2°.

`sunColour` follows the colour temperature curve.

`skyColour` is sampled from the Preetham model itself — we render a low-res cube of the sky dome and use it as an environment map. This gives "free" image-based lighting that matches the visible sky.

---

## What this module does NOT do

- Doesn't know about terrain, buildings, or trees. Lights illuminate everything; what gets illuminated is somebody else's problem.
- Doesn't decide camera direction. (Camera asks SunCalculator for sun azimuth in "follow sun" mode, but that's Camera's logic.)
- Doesn't do clouds. Phase 5+, would be a separate sub-module.
- Doesn't handle moonlight or stars. Sunset only.

---

## How to extend

### Better sunset colours

This is the most impactful tunable in the app. To experiment:

1. Open `src/config.js` and play with `SKY.turbidity` (try 4–10) and `SKY.mieCoefficient` (try 0.002–0.02).
2. Add a phase-specific override map: `SKY_BY_PHASE.sunset = {turbidity: 8, ...}`.
3. Compare against reference photographs at the same latitude/season.

### Clouds (Phase 5)

Either a pre-rendered skybox texture mixed with the Preetham sky, or a volumetric cloud shader (expensive). Recommend the texture approach: ~10 hand-painted skies, blended by phase + a noise variation.

### Moonlight (long-term)

SunCalc also provides `getMoonPosition`. Add a second directional light with much lower intensity and bluish tint. Not a Phase 5 priority unless someone wants moonrise scenes.

### HDR sky for environment lighting

Replace the cube-rendered sky probe with a proper PMREM (`PMREMGenerator`). Improves PBR materials' look. Phase 5 polish.

### Per-location atmospheric tuning

E.g. coastal locations have more humidity → higher turbidity. Mountains are clearer → lower. This requires the climate-zone data which is out-of-scope, but the hook is there: `update(timestamp, location)` already takes location.

---

## Common pitfalls

- **Sun at horizon = sun behind terrain.** The Preetham model's sun disk is a single bright spot in the shader; it doesn't know about terrain. So when you set sun altitude to -1°, the sky still looks "sunsetty" but the bright disk is below the horizon — usually correct! But near tall mountains the sun should disappear behind them and the sky should darken. We don't simulate this in v1.
- **Time zones.** SunCalc takes a Date object, which is UTC under the hood. As long as the user's slider produces a real Date, you're fine. The display layer can show local time.
- **Shadows are expensive.** `directionalLight.castShadow = true` adds a render pass. Phase 1 ships shadowless. Phase 4 export turns them on for the print.
- **Specular highlights ≠ sunset look.** Avoid PBR shininess on most materials — sunsets are diffuse and atmospheric. Save specular for water (Phase 5).

---

## Tests worth writing

- `getSunPosition` round-trip: known location/time → expected azimuth/altitude (e.g. equinox at equator at noon UTC → altitude ~90°, azimuth ~0°).
- Phase boundaries don't have gaps or overlaps.
- Colour-temp Kelvin → RGB conversion produces expected values for known temps (2700K = warm orange, 5500K = neutral, 10000K = cool blue).
