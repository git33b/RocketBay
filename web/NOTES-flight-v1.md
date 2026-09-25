# NOTES — flight-v1 (FLIGHT MODE + LEADERBOARD)

**Branch:** `flight-v1` (from main `c767033` / audio1). **Preview channel:** `flight` (staged only — live stays audio1).
**Art:** flight-pack-v1.1 + v1.2.1 (earth-limb curve, unique decor planets) + v1.3.1 debris hazards. Masters under `/workspace/rocket-designs` untouched; copies in `web/flight/`.

## Product
- Mission choice screen removed. Pad → climb (2.4s) → pitch-over (1.0s) → endless hold-to-thrust flight → crash → result + leaderboard.
- Hold anywhere = thrust; release = drift. Fuel drains while thrusting; fuel pickups refill.
- Deploy once from 300 km. `bonus = round(50 * (km/100)^1.5)`. After deploy: thrust×1.25, gravity×0.85, tilt×1.3, fuel drain×0.8.
- Score: `floor(distanceKm) + bonus + coins * COIN_PTS` with `COIN_PTS = 5`. FAILED if never deployed; SUCCESS if deployed then crashed.
- Global Firestore `leaderboard` (create-only, public list ≤50). Throttle 20 s via `throttleLb/{cid}`. Rules also verify score math + result↔deployed. **App Check still open — revisit before public launch.**

## Ateeb live feedback (folded into this branch)
1. **Countdown beeps retuned + locked to ticks.** Triangle+soft-square blend, low-pass 1800 Hz. Onsets at sim e = 0/1/2/3/4 (T-5…T-1) and long final at e = 5 (LIFTOFF / ignition). Freq table: 392, 415, 440, 466, 494 Hz; final 587 Hz / 0.55 s. Evidence: `coe-playtest/flight-v1/beep-timing.json` (visual tick vs beep onset ≤ ~28 ms).
2. **TOD selector removed.** Scene from phone local clock: 05–07 sunrise(02), 08–16 day(05), 17–19 sunset(03), 20–04 night(04). Hidden `?tod=02|03|04|05` override. Evidence: `tod-portrait-4.png`, `tod-landscape-4.png`, `tod-auto-log.json`.

## CoE addendum (debris + escape-gap) — same branch
- Debris hazards from flight-pack-v1.3: `hazard-station` (wings NON-colliding; hab+truss hitbox), `hazard-telescope`, `hazard-satellite`, `hazard-wreckage_0..2`. Dim `setpiece-station-zN` stays decor only (parallax 0.5×).
- **Escape-gap lock:** every wall leaves ≥1 gap. Gap uses tier floors (300/265/235/210) and tightens with speed (360→620 px/s). Never a full-screen wall.
- **Spacing (v1.3.1):** SPREAD default — 1–2 hazards/gate, 180–320 px loose hx. Dense clusters ~20% of walls (2–3 pieces), still keep ≥1 gap.
- Spawn density follows existing TIERS table (spacing 720→560).
- **v1.2.1 pulled** (cheap file copy): curved `earth-limb.png` + 72 unique decor planets (8 mid + 4 far / zone) with soft spawn nudge off decor centres.

### Extra Done evidence (addendum)
- Spread wall + clear gap: `coe-playtest/flight-v1/evidence-spread-gap.png` (+ log: n=1, invaders=[], hazard-telescope present).
- Occasional cluster + clear gap: `coe-playtest/flight-v1/evidence-cluster-gap.png` (+ meta: n=3 cluster, pack of asteroid_4/asteroid_2/hazard-satellite, invaders=[]).

## Audio (flight)
Synth only, same RocketBayAudio chain: flight voice bed (thrust swell), deploy pop, crash boom. Launch audio from audio1 kept. Offline mux path: `renderRunOffline`.

## Perf
Target 60 fps at 390×844 and 844×390. Evidence: `fps.json` (swiftshader, 60 s flight, avg ~59.5; rare dips noted).

## Not deployed to live
Live `rocketbay-game.web.app` remains **audio1**. Only preview channel `flight` + Firestore rules (leaderboard) were deployed.

## Select-fix (flight1b)
- Global `user-select: none` + `-webkit-touch-callout: none` + transparent tap highlight on html/body/stage/chrome/flight UI; text fields (`#fbCard` textarea/input, `#nameCard` input) keep `user-select: text`.
- `selectstart`/`dragstart` prevented outside editables; `touchstart`/`mousedown` `preventDefault` on `#flightCanvas` only (tray + assemble tap-to-swap untouched).
- Build label: `flight1b`. Evidence: `coe-playtest/flight-v1/select-fix/`.
