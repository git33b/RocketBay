# FIRST-RUN tutorial — How to fly (orbit cruise overlay)

**Status:** Ateeb APPROVED 17:57 PT. SHIP with full trial push (Ateeb "push it all" 17:58 PT) — tutorial + mid-band + meteors together.  
**Still:** `tutorial/FT-first-flight-overlay.png` (+ `.jpg`)  
**Phone QA:** `tutorial/_qa/FT-first-flight-overlay-phone640.png`  
**Rebuild:** `/workspace/.venv-pil/bin/python _tools/build_tutorial_first_flight.py`
**Method:** composite / edit only (locked orbit-edge tile, earth-limb, Steel stack via kit, HUD language from flight NOTES). No GenerateImage.

---

## Beat (placement in run)

After climb reaches space, **before** real hazard flight:

1. Rocket holds / maintains middle of screen (gentle cruise, **no hazards yet**)
2. Translucent overlay flashes explaining the game
3. Bottom text: `tap screen to continue`
4. After dismiss → a few seconds open practice (thrust / drift) → then first hazard wall

---

## Flow timing (proposal)

| Phase | Duration | Behavior |
|---|---|---|
| A. Overlay flash | **Wait for tap** (preferred). Optional soft auto-advance after **~6–8 s** if no input. | World frozen or crawl-scroll only. Rocket idles mid-screen (gentle flame / tilt). HUD live but dimmed under card. |
| B. Dismiss | instant | Card + bottom tip fade out (~0.2 s). Soft dim lifts. |
| C. Open practice | **~3–5 s** (suggest **4.0 s**) | Player can thrust / drift. World scrolls. **Still zero hazards**. Sparse coins optional (0–3). |
| D. First hazard | after practice ends | First wall / asteroid gate spawns ahead. Normal flight begins. |

**First-run only.** Gate on a local flag e.g. `prefs.first_flight_tutorial_seen`. Skip overlay + practice window on later runs (straight into hazard flight after pitch-over). Do **not** re-show if the player already finished practice once this install.

---

## Exact copy strings

```
TITLE:
How to fly

BULLETS:
Hold anywhere to thrust up · release to drift down
Grab coins
DEPLOY from 300 km (one time)
Crash ends the run

BOTTOM TIP (outside card, load-tip language — NOT a big red button):
tap screen to continue
```

Optional runtime (not on this still): title alt `First flight`; tip opacity pulse 70↔100% @ ~1.2 Hz.

---

## Layout (1280×720)

| Element | Spec |
|---|---|
| Canvas | 1280×720 landscape (matches FP stills) |
| Background | `sprites/bg-orbit-edge-tile.png` + `sprites/earth-limb.png` + soft decor only. **Zero hazards.** |
| Rocket | Steel Booster + Steel Ship, nose-right, ~screen center / slightly left of card (~520, 380), length ≈208 px, light tilt (~6°), flame on |
| HUD | Minimal: low distance (**42 km** on still; runtime 0–80 km), **0** coins, **full** fuel, pause. Dimmed ~35% under overlay |
| Soft dim | Full-frame black @ **~26%** behind card (rocket still faintly visible) |
| Card | Mission-button UI: fill `#0A1C3A` @ **~85%**, 2px border `#64D2FF`, 1px inner `#3C6385`, text `#E1F2FF`, DejaVu Sans Bold. Size **680×360**, center nudged slightly up/left (box ≈ 280,162–960,522) so rocket peeks bottom-right. Radius 14. Text inset ~40 px |
| Title | 32 px, centered in card; 1px inner-tone divider under title |
| Bullets | 19 px, 4 lines, pitch ~48 px. Tiny icons: coin sprite on “Grab coins”, `sprites/hud/deploy-icon.png` on DEPLOY line. Cyan pip on other lines. Clean — not noisy, not mirrored clutter |
| Bottom tip | Outside / below card, screen bottom center (~y = H−28). **18 px** Bold, same small bottom-text language as load tip (`tap screen to…`). Soft 1px shadow. **Not** a button |

**Phone-640:** LANCZOS downscale QA only. Gameplay art stays NEAREST.

---

## What NOT to show (during tutorial + practice)

- No asteroids / planet-hazards / wreckage / debris walls  
- No shield / magnet / gem pickups (coins optional and sparse)  
- No zone banner flash; DEPLOY stays locked until 300 km  
- No crash FX, no leaderboard  
- No leftover mission-choice UI  
- Do **not** gate CoE from this ticket — still is for Ateeb eye-check only  

---

## Asset lock (reuse)

- Orbit edge: `sprites/bg-orbit-edge-tile.png`  
- Earth limb: `sprites/earth-limb.png`  
- Steel stack: kit via `flightlib.place_rocket(..., "steel", …)`  
- HUD / panel / text: `flightlib.hud` / `ui_panel` / `ui_text` (mission-button palette)  
- Icons: coin sprite, `sprites/hud/deploy-icon.png`  
- Soft decor: `sprites/parallax/decor-planets/z1-far-*.png`, `sprites/parallax/setpiece-station-z1.png`  

---

## Deliverables checklist

- [x] `tutorial/FT-first-flight-overlay.png` (+ `.jpg`)
- [x] `tutorial/NOTES-first-flight.md` (this file)
- [x] `tutorial/_qa/FT-first-flight-overlay-phone640.png`
- [x] Ateeb approval → SHIP with a limited trial; wire first-run flag + practice window in runtime
