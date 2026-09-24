# Uniform seamless pack (02–05)

## Method
- **No GenerateImage.** Masters locked; UI overlays only (PIL).
- Configs: left as rebuilt under `scenes/configs/` (not redone in this pass).
- TOD suffix: 02=sunrise, 03=sunset, 04=night, 05=day

## Per TOD (4 designs)
1. **grounded** — exact pixel copy of master (rocket already on pad).
2. **assemble** — grounded pixels for all rows above tray (`y<528`); pad-native tray overlay only.
   - Same magnet/tray LAYOUT across TODs (tabs + 6 card positions identical).
   - Chrome tinted to plate lights (warm sunrise/sunset, cool cyan night, daylight blue-white).
   - Labels EXACT: Moon Giant, Pencil Core, Gridfin Booster, **Steel Booster**, Orange Tank, Euro Core.
   - Icons: kit sprites with navy punched to alpha (+ optional lit/ remap). Fun B chrome dead.
3. **liftoff** — **HOLD for all TODs.** See `*-liftoff-*-HOLD.txt`. Prefer runtime-FX.
   - `04-liftoff-night` kept as HOLD draft only — not approved.
4. **mission** — same plate + minimal two-choice: “Deploy payload” | “Explore the universe”.
   - Minimal chrome matching pad lights (not gold ornate Fun B).

## Lit kit
Optional per-TOD lit sprites under `parts/s1-kit-02-05/lit/{02,03,04,05}/` — numpy color-match toward metal sampled from master rocket region x650–1000.

## Sanity
- 02 grounded≡master maxdiff=0
- 02 assemble top≡grounded maxdiff=0 (tray_y0=528)
- 03 grounded≡master maxdiff=0
- 03 assemble top≡grounded maxdiff=0 (tray_y0=528)
- 04 grounded≡master maxdiff=0
- 04 assemble top≡grounded maxdiff=0 (tray_y0=528)
- 05 grounded≡master maxdiff=0
- 05 assemble top≡grounded maxdiff=0 (tray_y0=528)

## Liftoff HOLD paths
- /workspace/rocket-designs/mvp1/scenes/02-liftoff-sunrise-HOLD.txt
- /workspace/rocket-designs/mvp1/scenes/03-liftoff-sunset-HOLD.txt
- /workspace/rocket-designs/mvp1/scenes/04-liftoff-night-HOLD.txt
- /workspace/rocket-designs/mvp1/scenes/05-liftoff-day-HOLD.txt
