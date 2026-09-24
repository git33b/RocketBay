# AUDIO v1 + SLOP cleanup (build label `audio1`, branch `audio-v1`, built on `friend-trial`/trial1)

Staged only: preview channel `audio` on rocketbay-game. Live channel untouched.

## Audio v1 — sources

**All synthesized with the Web Audio API. No samples, no third-party audio of any kind.**
(Sample source/licence table: none; nothing to attribute.) Noise is generated from a seeded PRNG
at runtime, so the live graph and the offline evidence render are identical.

Code: `web/audio.js` (`window.RocketBayAudio`), used by `web/liftoff.js`.

### Behaviour
- Sound is **ON by default**. Button = speaker icon + "Sound: On" / "Sound: Off"; persisted in
  `localStorage.rb_sound` ("1"/"0"); `aria-pressed` reflects state.
- The **GO FOR LAUNCH tap** creates/resumes the AudioContext and plays a 1-sample silent buffer inside
  the gesture (iOS unlock). Toggling sound on also unlocks.
- The whole launch is scheduled up-front on the audio clock at engine start; while audio runs the
  flight sim follows the audio clock (no A/V drift on slow frames). FLY AGAIN / reset stops the launch
  bus (30 ms fade) and the next GO schedules a fresh one. Mute ramps the output gain (60 ms).

### Timeline (sim seconds `e`; e=0 is T-5, 1.04 s after the GO tap)
| e | layer |
|---|---|
| 0.00–2.43 | 7 countdown beeps, accelerating (gaps 0.62 → 0.18 s) and rising 740 → 1175 Hz |
| 2.46–2.96 | one long beep, 1319 Hz |
| 3.00 | ignition whump (95 → 36 Hz sine sweep + low-passed noise burst); +0.14 s second whump with side boosters |
| 3.0–5.0 | rumble: brown-noise sub (harmonic-driven so phone speakers carry it) + 38/57 Hz body with turbulence wobble; swell 3.5 → 5.0 (~1.5 s) plus a mid "pre-roar" hiss |
| 5.00 | **release ROAR**: stereo broadband roar (low-shelf, mild drive, turbulence AM) slams (+35% for ~0.5 s), shock **crackle**, **distorted low end** |
| 5.5+ | altitude thinning, driven by the same `3 + 140·t²` altitude as the visuals: roar low-pass 9.5 kHz → 300 Hz, crackle gone by ~2 s of climb, distortion fades, gain falls |
| 11.4–13.2 | exit fade (flight ends at 13.0) |
Side boosters fitted: second whump, rumble ×1.2, extra driven low-mid roar layer, crackle ×1.15.

### Output chain / loudness
launch bus → trim 0.21 → glue compressor (−20 dB, 3:1, 8 ms/220 ms) → brick-wall limiter (−5 dB, 20:1,
1 ms/90 ms) → 4× oversampled soft clipper, ceiling 0.78 (−2.2 dBFS) → user (mute) gain → out.

Targets (phone speakers + headphones): integrated **−16…−14 LUFS** over the GO→end clip, **true peak ≤ −1.0 dBTP
including after AAC encode**, roar max short-term ≈ −10 LUFS.

Measured (ffmpeg `ebur128=peak=true`, `loudnorm` print; `coe-playtest/audio-v1/loudness-readout.txt`):
| clip | I | TP | max M | max S |
|---|---|---|---|---|
| 05 Steel Booster + side boosters, WAV (offline render) | −14.4 LUFS | −2.1 dBTP | −8.8 | −10.4 |
| same, in the evidence MP4 (AAC 192k) | −14.4 LUFS | −1.1 dBTP | −8.9 | −10.5 |
| 05 core only (no side boosters), WAV | −15.0 LUFS | −2.1 dBTP | −8.8 | −10.8 |

## SLOP cleanup (liftoff.js)
1. **Smoke over nozzles**: smoke has dithered keep-out columns at every nozzle (engine bell height above the
   nozzle, flame length below, widening with the plume); pad glow is clipped out of them too → bells + flame read
   through from the first ignition frame.
2. **Steel Booster side flames**: with strap-ons the core plume is tightened per row so there is always a gap
   ≥ max(5 px, 0.17·hull) between the core plume and each side plume; side plumes keep their own position/width.
3. **03 sunset sky**: the altitude sky overlay is now flat painted bands (22 css px) with 4×4 Bayer-dithered edges on a
   2 px grid (all TODs share the renderer; 03 keeps its plate-sampled sunset colours).
4. **Sky extension**: no mirroring anywhere. The extension is a painted continuation of the plate sky (structure-masked
   per-column top colour, block medians + wide blur, graded to an extrapolated zenith, dithered bands) — no reflected
   tower spire or clouds. Landscape side fills no longer mirror plate columns (edge colour, vertically blurred, dithered
   into the wide sky median). Its base colour is matched to the altitude overlay so the hand-off has no step.
5. **Parallax clouds**: replaced the chunky round-lobe sprites with wispy, slightly tilted streaks from value noise at
   2 native-px clusters, 5 tones sampled from each plate's own painted clouds, dithered translucent rims, drawn at the
   plate's native pixel scale; velocity stretch capped at 1.3×. Masters in `rocket-designs/` untouched; no generated images.
6. **05 high-key flame tail**: day uses its own fire ramp — the cool tail stays orange at full opacity and dissolves with a
   sparse pixel breakup instead of darkening to dim red/brown.
7. Favicon/manifest (trial1) still served; canvas readback: headless runs show **zero console warnings**.
Also: hint copy follows orientation live ("parts below" / "parts on the right", matchMedia + orientationchange);
landscape builder tabs wrap to two lines instead of touching.

## Evidence
`/workspace/coe-playtest/audio-v1/` — `audio1-05-day-GO-to-climb-with-audio.mp4` (GO tap → countdown → ignition →
release → 6 s climb + 1.5 s exit → mission screen, 17.1 s, 780×1688, AAC), WAV renders, `loudness-readout.txt`,
spectrogram/waveform, `slop1…slop6*.png` before/after sheets (portrait + landscape), `ui-*.png`, raw keyframes and the
scripts used (`scripts/`). Recording = deterministic `?capture=1` frames + `RocketBayAudio.renderOffline()` of the same
graph (pre-roll = GO tap + pad ops), muxed with ffmpeg. `web/dev/audio-render.html` is the offline-render harness.
