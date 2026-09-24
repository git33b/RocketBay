# Rocket Bay — live compose web (MVP-compose-web + LIFTOFF-FEEL)

Phone-friendly assemble → pad-ops → **heavy liftoff** → mission loop with live stack compositing on empty pads.

- Live: https://finance-tracker-159e2.web.app/rocketbay/
- Empty pads: per-TOD path in `pad-config.js` (default `plates/empty/{02–05}-empty-pad-v2.png`)
- Kit: **modular kit v1.5.3** (CoE-gated, copied read-only) under `kit/modular/` — `kit.json` (piece metas,
  pairsDisallowed, precomputed v153 grounded Lab stats) + `pieces/{first_stage,upper,payload,side_booster}/*.png`
- `modular.js`: JS port of `modular_join.py` (join_width, body_cx, edge_row_mid, make_frustum, join_rule,
  check_pair, check_stack, compose_stack) + `compose_proofs_v153` light / seat / contact shadow.
  Verified against the architect's mixed proofs: `dev/proof.html` (0 px silhouette XOR, joins/feet identical).
- Builder (phone first): 1 FIRST STAGE → 2 UPPER (Steel Ship ends the stack) → 3 PAYLOAD, + optional side
  boosters. Disallowed pieces are greyed with the kit's one-line reason; height budget = tip y ≥ 40 at the
  plate's sit_y. Tap a placed piece to swap it; UNDO / CLEAR. `?build=a,b,c&sides=1&tod=05` preloads a stack.
- Pad geometry: **`web/pad-config.js`** (see below) — compose seating + liftoff FX both read it
- CLEAR: empty pad only (no stack ghost)


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

## Liftoff feel (`liftoff.js` v2 / liftoff24)

1. Light pad-ops then **T-5…T-0** countdown (GO FOR LAUNCH)
2. **T-2** ignition: layered white→yellow→orange→red tapered flame (2px display grid, additive), pad glow, ground smoke at `deckY`
3. **T-0** release flash (~150ms) → ~0.5s hold → ease-in climb `y = a·t²`
4. Screen shake + `navigator.vibrate` (feature-detected)
5. Camera follow; cover-style `plateMap()` (landscape crop / portrait CX-centered); `#skyExt` tiles sampled plate top band with soft blend
6. Split smoke: ground (world/deck anchored) + nozzle trail; round pixel puffs; low-res buffer upscale
7. Parallax stars/clouds with velocity streaks; altitude grade toward deep sky
8. Optional WebAudio rumble (muted by default); DPR≤2
9. Deterministic capture: `?capture=1` + `window.__liftoffCapture.step(1/60)`

FLY AGAIN resets camera, shake, particles, and audio.

### Plate mapping

`plateMap()` / `applyPlateMap()` — **cover** (not contain). Landscape centers; portrait centers on TOD `cx`. Stack, FX, and config coords share this transform.
