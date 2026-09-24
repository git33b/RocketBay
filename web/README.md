# Rocket Bay — live compose web (MVP-compose-web + LIFTOFF-FEEL)

Phone-friendly assemble → pad-ops → **heavy liftoff** → mission loop with live stack compositing on empty pads.

- Live: https://finance-tracker-159e2.web.app/rocketbay/
- Empty pads: `plates/empty/{02–05}-empty-pad-v2.png` (CoE PASS eng v2)
- Kit: architect-sealed / span-solid opaque under `kit/opaque/`
- Sit geometry (native 1280×720): SIT_Y=548, target_h=500; CX 02→556 · 03→685 · 04→717 · 05→634
- CLEAR: empty pad only (no stack ghost)
- Steel mutually exclusive with Moon Giant / Pencil Core

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
