# Rocket Bay — live compose web (MVP-compose-web + LIFTOFF-FEEL)

Phone-friendly assemble → pad-ops → **heavy liftoff** → mission loop with live stack compositing on empty pads.

- Live: https://finance-tracker-159e2.web.app/rocketbay/
- Empty pads: per-TOD path in `pad-config.js` (default `plates/empty/{02–05}-empty-pad-v2.png`)
- Kit: architect-sealed / span-solid opaque under `kit/opaque/`
- Pad geometry: **`web/pad-config.js`** (see below) — compose seating + liftoff FX both read it
- CLEAR: empty pad only (no stack ghost)
- Steel mutually exclusive with Moon Giant / Pencil Core


## Pad config (`pad-config.js`)

Single source of truth for per-TOD pad geometry. Loaded before compose / liftoff.
Architect can drop **empty-pad-v3** + measured deck Y by editing values only.

**Path:** `web/pad-config.js` (cache-bust `?v=pad1` in `index.html`)

**Schema** (native 1280×720), keyed by `"02"` | `"03"` | `"04"` | `"05"`:

| Field | Meaning |
|-------|---------|
| `cx` | Stack center X |
| `sitY` | Content-bbox feet / stack seat line |
| `deckY` | Pad deck line for glow + sideways smoke |
| `targetH` | Seated stack content height |
| `nozzleOffsetY` | Added to `sitY` for flame/plume origin |
| `smokeOriginY` | Smoke / linger origin Y (usually `deckY`) |
| `emptyPad` | Relative empty-pad image path |

**Defaults today (v2, unchanged behavior):** sitY=deckY=smokeOriginY=548, targetH=500, nozzleOffsetY=0, CX 02→556 · 03→685 · 04→717 · 05→634, emptyPad `…-empty-pad-v2.png`.

API: `window.RocketBayPadConfig.padFor(todId)` → config object; `PAD_CONFIG` map.

Compose (`index.html`) seating, plate path, and liftoff nozzle/glow/smoke all call `padFor` — **no leftover hardcoded SIT_Y=548 constants**.

## Liftoff feel (`liftoff.js`)

1. Light pad-ops then **T-5…T-0** countdown (GO FOR LAUNCH)
2. **T-2** ignition: pixel-crisp flame/plume at nozzle (stack content-bbox bottom @ SIT_Y), TOD-tinted pad glow, sideways smoke
3. **T-0** clamp release → ~0.5s hold → ease-in climb `y = a·t²` via rAF (no CSS slide)
4. Screen shake + `navigator.vibrate` (feature-detected)
5. Camera pans up (world `translate3d`); `#skyExt` fills above plate so no black gap
6. PSP-sharp particles: integer grid, posterized palette, `imageSmoothingEnabled=false`, no blur / no radial-gradient flames
7. Optional WebAudio rumble (muted by default; SOUND toggle; AudioContext after gesture)
8. Perf: FX canvas letterboxed, DPR≤2, ~520 particle pool, composited CSS transforms only

FLY AGAIN resets camera, shake, particles, and audio.
