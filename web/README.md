# Rocket Bay — live compose web (MVP-compose-web)

Phone-friendly assemble → pad-ops → liftoff FX → mission loop with **live stack compositing** on empty pads.

- Live: https://finance-tracker-159e2.web.app/rocketbay/
- Empty pads: `plates/empty/{02–05}-empty-pad-v2.png` (CoE PASS eng v2; never grounded/assemble baked rockets)
- Kit: architect-sealed `kit/opaque/` from `rocket-designs/.../opaque/` (pencil / steel-booster / steel-ship / steel-booster-ship=steel-stack-cfg-sealed) + hardened fill for other parts
- Sit geometry (native 1280×720): SIT_Y=548, target_h=500; CX 02→556 · 03→685 · 04→717 · 05→634
- Content-bbox seating: opaque feet land on SIT_Y (not frame-bottom hover)
- CLEAR: composeToken++, wipe canvas, hide `#stack` — empty pad only
- Steel Booster mutually exclusive with Moon Giant / Pencil Core; steel-booster-ship only when s1 is null
- Labels: Moon Giant, Pencil Core, Gridfin Booster, Steel Booster (+ Steel Ship), Orange Tank, Euro Core
- Liftoff: CSS flame + stack rise on empty pad; mission keeps locked mission stills
