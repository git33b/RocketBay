/**
 * Rocket Bay — AUDIO v1 (all WebAudio synthesis; no samples).
 *
 * One launch = one scheduled graph, laid out on the sim timeline (e = liftoff sim seconds):
 *   e 0.00–2.95  countdown: 7 short beeps accelerating + rising in pitch, then one long beep
 *   e 3.00       ignition: low "whump" (+ a staggered second one when side boosters are fitted)
 *   e 3.0–5.0    rumble builds (brown-noise sub + 38/57 Hz body, ~1.5 s swell from 3.5)
 *   e 5.00       release: ROAR slam (stereo broadband roar, crackle, distorted low end)
 *   e 5.5+       climb: altitude(e) = 3 + 140·t² (same curve as liftoff.js) drives thinning —
 *                lowpass closes, crackle and distortion drop out first, gain falls
 *   e 11.5–13.2  exit fade
 * Output chain: launch bus -> glue compressor -> makeup -> brick-wall limiter ->
 *   4x-oversampled soft clipper (ceiling -1.6 dBFS) -> user gain (mute) -> destination.
 * Deterministic (seeded noise), so the offline render used for evidence is the same graph.
 */
(function (global) {
  "use strict";

  const SR_NOISE_SEC = 4;
  const CEIL = 0.78;          // soft-clip ceiling (-2.2 dBFS sample peak -> <= -1 dBTP even after AAC encode)
  const MAKEUP = 1.0;         // calibrated with ffmpeg ebur128 (see NOTES-audio-v1.md)
  const PRE = 0.21;           // bus trim into the compressor

  // Countdown beep table (e = seconds from engine start = the sim clock the countdown text follows)
  const BEEP_T = [0, 1, 2, 3, 4];                 // T-5, T-4, T-3, T-2 (ignition), T-1
  const BEEP_F = [392, 415, 440, 466, 494];       // G4 -> B4, gentle rise
  const BEEP_DUR = 0.14;
  const BEEP_FINAL_T = 5, BEEP_FINAL_F = 587, BEEP_FINAL_DUR = 0.55; // zero / LIFTOFF: D5 long tone

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // Rocket altitude in native px vs sim time — mirrors liftoff.js (hold 0.5 s, then 3 + 140 t²)
  function altAt(e) {
    if (e < 5) return 0;
    if (e < 5.5) return (e - 5) * 6;
    const t = e - 5.5;
    return 3 + 140 * t * t;
  }
  function exitFade(e) { return 1 - smooth(11.4, 13.2, e); }

  const cache = new WeakMap();
  function buffers(ctx) {
    let b = cache.get(ctx);
    if (b) return b;
    const sr = ctx.sampleRate, n = Math.round(sr * SR_NOISE_SEC);
    const mk = (ch) => ctx.createBuffer(ch, n, sr);
    // white (stereo, decorrelated)
    const white = mk(2);
    for (let c = 0; c < 2; c++) { const r = rng(101 + c * 7919), d = white.getChannelData(c); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; }
    // brown (integrated white, leaky, normalised)
    const brown = mk(1);
    { const r = rng(4242), d = brown.getChannelData(0); let y = 0, pk = 0;
      for (let i = 0; i < n; i++) { y = (y + 0.02 * (r() * 2 - 1)) * 0.998; d[i] = y; pk = Math.max(pk, Math.abs(y)); }
      for (let i = 0; i < n; i++) d[i] /= pk; }
    // crackle: sparse, positively skewed shock spikes (heavy-tailed amplitude), stereo
    const crackle = mk(2);
    for (let c = 0; c < 2; c++) {
      const r = rng(777 + c * 31), d = crackle.getChannelData(c);
      let i = 0;
      while (i < n) {
        i += Math.max(1, Math.round(-Math.log(1 - r()) * sr / 230)); // ~230 events/s
        if (i >= n) break;
        const a = Math.pow(r(), 2.6) * (r() < 0.08 ? 1 : 0.55);
        const dec = Math.round(sr * (0.0004 + r() * 0.0016));
        const w = 2 * Math.PI * (1600 + r() * 3600) / sr; // each spike rings at its own pitch (no tonal line)
        for (let k = 0; k < dec * 5 && i + k < n; k++) {
          const env = Math.exp(-k / dec);
          d[i + k] += a * env * (k < 2 ? 1 : 0.75 * Math.cos(w * k));
        }
      }
      let pk = 0; for (let k = 0; k < n; k++) pk = Math.max(pk, Math.abs(d[k]));
      for (let k = 0; k < n; k++) d[k] /= pk || 1;
    }
    // turbulence: slow smooth random (≈6–9 Hz) in [-1, 1]
    const turb = mk(1);
    { const r = rng(9001), d = turb.getChannelData(0); const step = Math.round(sr / 7.5);
      let a = r() * 2 - 1, bb = r() * 2 - 1;
      for (let i = 0; i < n; i++) { const k = i % step; if (k === 0) { a = bb; bb = r() * 2 - 1; } const t = k / step; d[i] = a + (bb - a) * (t * t * (3 - 2 * t)); } }
    b = { white, brown, crackle, turb };
    cache.set(ctx, b);
    return b;
  }

  function shaperCurve(drive) {
    const n = 2048, c = new Float32Array(n), k = Math.tanh(drive);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / k; }
    return c;
  }
  // linear to 0.6*CEIL, then a smooth knee that never exceeds CEIL
  function softClipCurve() {
    const n = 4096, c = new Float32Array(n), kn = 0.6 * CEIL, room = CEIL - kn;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 4 - 2, ax = Math.abs(x);
      const y = ax <= kn ? ax : kn + room * Math.tanh((ax - kn) / room);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }

  // Output chain shared by live + offline
  function makeChain(ctx, dest) {
    const input = ctx.createGain(); input.gain.value = PRE;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.22;
    const makeup = ctx.createGain(); makeup.gain.value = MAKEUP;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.09;
    const clip = ctx.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = "4x";
    const user = ctx.createGain(); user.gain.value = 1;
    input.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(clip); clip.connect(user); user.connect(dest);
    return { input, user, comp, lim };
  }

  // Automate `param` along fn(e) with linear ramps (dense, non-overlapping events)
  function curve(param, t0, fn, e0, e1, step) {
    step = step || 1 / 30;
    param.setValueAtTime(fn(e0), t0 + e0);
    for (let e = e0 + step; e < e1 + 1e-9; e += step) param.linearRampToValueAtTime(fn(e), t0 + e);
  }

  function scheduleLaunch(ctx, input, t0, opts) {
    opts = opts || {};
    const boost = !!opts.boosters;
    const B = buffers(ctx);
    const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(input);
    const srcs = [];
    const END = 13.4;
    const src = (buf, off) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; srcs.push(s); s._off = off || 0; return s; };
    const at = (e) => t0 + e;

    // ---- countdown beeps (flight-v1 retune, Ateeb): locked to the visible countdown ticks.
    // liftoff.js shows T-5 at e=0, T-4 at 1, T-3 at 2, T-2 at 3 (ignition), T-1 at 4, LIFTOFF (zero) at 5.
    // One short beep on every number change, the long final tone exactly on zero. Low + soft:
    // triangle body + a little square, low-passed (no bright 2f partial any more).
    const beepG = ctx.createGain(); beepG.gain.value = 0.2; beepG.connect(bus);
    const beepLP = ctx.createBiquadFilter(); beepLP.type = "lowpass"; beepLP.frequency.value = 1800; beepLP.Q.value = 0.5; beepLP.connect(beepG);
    const beep = (e, f, dur, lvl) => {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      const g2 = ctx.createGain(); g2.gain.value = 0.12;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(beepLP);
      const L = lvl || 1;
      g.gain.setValueAtTime(0, at(e)); g.gain.linearRampToValueAtTime(L, at(e) + 0.006);
      g.gain.setValueAtTime(L, at(e) + dur - 0.04); g.gain.linearRampToValueAtTime(0, at(e) + dur);
      o.start(at(e)); o2.start(at(e)); o.stop(at(e) + dur + 0.02); o2.stop(at(e) + dur + 0.02);
      srcs.push(o, o2);
    };
    for (let i = 0; i < BEEP_T.length; i++) beep(BEEP_T[i], BEEP_F[i], BEEP_DUR);
    beep(BEEP_FINAL_T, BEEP_FINAL_F, BEEP_FINAL_DUR, 1.25);

    // ---- ignition whump(s) ----
    const whump = (e, gain) => {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(95, at(e)); o.frequency.exponentialRampToValueAtTime(36, at(e) + 0.35);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, at(e)); g.gain.linearRampToValueAtTime(gain, at(e) + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, at(e) + 0.55);
      o.connect(g); g.connect(bus); o.start(at(e)); o.stop(at(e) + 0.6); srcs.push(o);
      const n = src(B.white, 0.3); n.loop = false;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(1400, at(e)); lp.frequency.exponentialRampToValueAtTime(160, at(e) + 0.4);
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0, at(e)); ng.gain.linearRampToValueAtTime(gain * 0.55, at(e) + 0.008);
      ng.gain.exponentialRampToValueAtTime(0.001, at(e) + 0.45);
      n.connect(lp); lp.connect(ng); ng.connect(bus); n._started = true; n.start(at(e), 0.3, 0.5);
    };
    whump(3.0, 0.5);
    if (boost) whump(3.14, 0.42);

    const mono = (node) => { node.channelCount = 1; node.channelCountMode = "explicit"; return node; };

    // ---- rumble: brown noise sub + tonal body; swell 3.5 -> 5.0 ----
    const rumbleEnv = (e) => {
      let g;
      if (e < 3) g = 0;
      else if (e < 3.5) g = 0.3 * smooth(3, 3.5, e);
      else if (e < 5) { const u = (e - 3.5) / 1.5; g = 0.3 + 0.7 * u * u; }
      else g = 1 / (1 + altAt(e) / 900);
      return g * (boost ? 1.2 : 1) * exitFade(e);
    };
    {
      const n = src(B.brown, 1.1);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 130; lp.Q.value = 0.9;
      // harmonics so the rumble survives phone speakers (little below ~150 Hz)
      const hd = ctx.createWaveShaper(); hd.curve = shaperCurve(2.2); hd.oversample = "2x";
      const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = 480;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(lp); lp.connect(hd); hd.connect(lp2); lp2.connect(g); g.connect(bus);
      curve(g.gain, t0, (e) => 0.42 * rumbleEnv(e), 2.9, END);
      const o1 = ctx.createOscillator(); o1.frequency.value = 38;
      const o2 = ctx.createOscillator(); o2.frequency.value = 57; o2.type = "triangle";
      const og = ctx.createGain(); og.gain.value = 0;
      const wob = src(B.turb, 0.7); const wg = ctx.createGain(); wg.gain.value = 3.5; wob.connect(wg); wg.connect(o1.frequency); wg.connect(o2.frequency);
      o1.connect(og); o2.connect(og); og.connect(bus);
      curve(og.gain, t0, (e) => 0.22 * rumbleEnv(e), 2.9, END);
      o1.start(at(2.9)); o2.start(at(2.9)); o1.stop(at(END)); o2.stop(at(END)); srcs.push(o1, o2);
    }

    // ---- pre-roar (mid band hiss that grows into the release) ----
    {
      const n = src(B.white, 2.2);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 420; bp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(bp); bp.connect(g); g.connect(bus);
      curve(g.gain, t0, (e) => (e < 3.1 ? 0 : e < 5 ? 0.32 * Math.pow((e - 3.1) / 1.9, 1.6) : 0.32 * (1 - smooth(5, 5.35, e))), 3.0, 5.5);
    }

    // ---- ROAR: stereo broadband body, slams at release, thins with altitude ----
    const roarEnv = (e) => {
      if (e < 4.96) return 0;
      const slam = e < 5.06 ? smooth(4.96, 5.04, e) * 1.35 : 1 + 0.35 * (1 - smooth(5.06, 5.6, e));
      return slam * Math.pow(1 / (1 + altAt(e) / 330), 0.9) * exitFade(e);
    };
    const roarFc = (e) => (e < 5 ? 2000 : Math.max(300, 9500 / (1 + altAt(e) / 210)));
    {
      const n = src(B.white, 0.9);
      const shelf = ctx.createBiquadFilter(); shelf.type = "lowshelf"; shelf.frequency.value = 260; shelf.gain.value = 9;
      const peak = ctx.createBiquadFilter(); peak.type = "peaking"; peak.frequency.value = 900; peak.Q.value = 0.8; peak.gain.value = 3;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.5;
      const drive = ctx.createWaveShaper(); drive.curve = shaperCurve(1.6); drive.oversample = "2x";
      const tm = ctx.createGain(); tm.gain.value = 1;              // turbulence AM
      const turb = src(B.turb, 1.9); const tg = ctx.createGain(); tg.gain.value = 0.2; turb.connect(tg); tg.connect(tm.gain);
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(shelf); shelf.connect(peak); peak.connect(drive); drive.connect(lp); lp.connect(tm); tm.connect(g); g.connect(bus);
      curve(lp.frequency, t0, roarFc, 4.9, END, 1 / 20);
      curve(g.gain, t0, (e) => 0.2 * roarEnv(e), 4.9, END);
      if (boost) { // side boosters: heavier low-mid layer
        const n2 = src(B.white, 3.1);
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 230; bp.Q.value = 0.7;
        const d2 = ctx.createWaveShaper(); d2.curve = shaperCurve(2.4); d2.oversample = "2x";
        const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.Q.value = 0.5;
        const g2 = ctx.createGain(); g2.gain.value = 0;
        n2.connect(bp); bp.connect(d2); d2.connect(lp2); lp2.connect(g2); g2.connect(bus);
        curve(lp2.frequency, t0, (e) => Math.min(2400, roarFc(e)), 4.9, END, 1 / 20);
        curve(g2.gain, t0, (e) => 0.16 * roarEnv(e), 4.9, END);
      }
    }

    // ---- crackle: near-pad shock spikes, gone early in the climb ----
    {
      const n = src(B.crackle, 0.4);
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 700;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(bus);
      curve(lp.frequency, t0, (e) => Math.max(900, roarFc(e) * 1.4), 4.0, END, 1 / 20);
      curve(g.gain, t0, (e) => {
        const pre = e < 4.2 ? 0 : e < 5 ? 0.12 * smooth(4.2, 5, e) : 0;
        const post = e < 4.98 ? 0 : smooth(4.98, 5.2, e) * Math.exp(-altAt(e) / 420);
        return (pre + 0.75 * post) * (boost ? 1.15 : 1) * exitFade(e);
      }, 4.0, END);
    }

    // ---- distorted low end (pad-close slam) ----
    {
      const n = src(B.brown, 2.7);
      const pre = ctx.createGain(); pre.gain.value = 3;
      const sh = ctx.createWaveShaper(); sh.curve = shaperCurve(3.2); sh.oversample = "2x";
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(g); g.connect(bus);
      mono(g);
      curve(g.gain, t0, (e) => (e < 4.97 ? 0 : smooth(4.97, 5.05, e) * Math.exp(-altAt(e) / 1100)) * 0.34 * (boost ? 1.2 : 1) * exitFade(e), 4.9, END);
    }

    for (const s of srcs) if (s.buffer && !s._started) { s._started = true; s.start(at(s.loop ? 2.85 : 0), s._off); s.stop(at(END)); }
    return {
      bus,
      stop(when, fade) {
        const t = Math.max(ctx.currentTime, when || ctx.currentTime), f = fade == null ? 0.05 : fade;
        try { bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + f); } catch (_) {}
        for (const s of srcs) { try { s.stop(t + f + 0.02); } catch (_) {} }
        setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, (f + 0.2) * 1000 + Math.max(0, (t - ctx.currentTime) * 1000));
      },
    };
  }

  /* ---------- flight-v1: flight engine bed, deploy pop, crash boom (all synth, seeded noise) ---------- */
  // Engine bed for the endless flight: continues the launch roar "thinned by altitude" (vacuum):
  // a quiet low-passed hiss + sub that swells while thrust is held. Returns a controller.
  function flightVoice(ctx, input, t0) {
    const B = buffers(ctx);
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(input);
    bus.gain.setValueAtTime(0, t0); bus.gain.linearRampToValueAtTime(1, t0 + 0.6);
    const n = ctx.createBufferSource(); n.buffer = B.white; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.4;
    const shelf = ctx.createBiquadFilter(); shelf.type = "lowshelf"; shelf.frequency.value = 200; shelf.gain.value = 6;
    const g = ctx.createGain(); g.gain.value = 0.05;
    n.connect(shelf); shelf.connect(lp); lp.connect(g); g.connect(bus);
    const b = ctx.createBufferSource(); b.buffer = B.brown; b.loop = true;
    const blp = ctx.createBiquadFilter(); blp.type = "lowpass"; blp.frequency.value = 160;
    const hd = ctx.createWaveShaper(); hd.curve = shaperCurve(2.0);
    const bg = ctx.createGain(); bg.gain.value = 0.06;
    b.connect(blp); blp.connect(hd); hd.connect(bg); bg.connect(bus);
    n.start(t0, 1.3); b.start(t0, 0.4);
    return {
      bus,
      setThrust(on, t) { // smooth 60-90 ms swell / decay
        t = Math.max(t, ctx.currentTime);
        g.gain.setTargetAtTime(on ? 0.16 : 0.05, t, on ? 0.03 : 0.07);
        bg.gain.setTargetAtTime(on ? 0.2 : 0.06, t, on ? 0.03 : 0.09);
        lp.frequency.setTargetAtTime(on ? 900 : 520, t, 0.05);
      },
      stop(t, fade) {
        t = Math.max(t || ctx.currentTime, ctx.currentTime); fade = fade == null ? 0.3 : fade;
        try { bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + fade); } catch (_) {}
        try { n.stop(t + fade + 0.05); b.stop(t + fade + 0.05); } catch (_) {}
      },
    };
  }
  // Deploy pop: pneumatic separation "thup" + short bright puff + a soft two-note rise (bonus cue)
  function deployPop(ctx, input, t) {
    const B = buffers(ctx);
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.55, t + 0.004); og.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(og); og.connect(input); o.start(t); o.stop(t + 0.25);
    const n = ctx.createBufferSource(); n.buffer = B.white;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(700, t + 0.18); bp.Q.value = 0.9;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.003); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(bp); bp.connect(ng); ng.connect(input); n.start(t, 0.7, 0.3);
    [[523, 0.16], [784, 0.28]].forEach(([f, d]) => {
      const c = ctx.createOscillator(); c.type = "triangle"; c.frequency.value = f;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0, t + d); cg.gain.linearRampToValueAtTime(0.22, t + d + 0.01); cg.gain.exponentialRampToValueAtTime(0.001, t + d + 0.3);
      c.connect(cg); cg.connect(input); c.start(t + d); c.stop(t + d + 0.35);
    });
  }
  // Crash boom: sub thump + low-passed brown-noise blast that darkens, crackle tail
  function crashBoom(ctx, input, t) {
    const B = buffers(ctx);
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.9, t + 0.01); og.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(og); og.connect(input); o.start(t); o.stop(t + 1.0);
    const n = ctx.createBufferSource(); n.buffer = B.brown;
    const pre = ctx.createGain(); pre.gain.value = 2.5;
    const sh = ctx.createWaveShaper(); sh.curve = shaperCurve(2.6); sh.oversample = "2x";
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.3);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.75, t + 0.008); ng.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    n.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(ng); ng.connect(input); n.start(t, 1.9, 1.7);
    const c = ctx.createBufferSource(); c.buffer = B.crackle;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0, t + 0.05); cg.gain.linearRampToValueAtTime(0.35, t + 0.1); cg.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    c.connect(hp); hp.connect(cg); cg.connect(input); c.start(t + 0.05, 0.9, 1.1);
  }
  // Offline render of a whole run for recordings: launch at `launchAt` (video s), flight bed from
  // `flightAt`, events [{t (video s), type: 'thrust'|'deploy'|'crash'|'end', on}] from the capture log.
  function renderRunOffline(opts) {
    const sr = opts.sampleRate || 48000, dur = opts.duration;
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.round(sr * dur), sr);
    const chain = makeChain(ctx, ctx.destination);
    if (opts.launchAt != null) scheduleLaunch(ctx, chain.input, opts.launchAt, { boosters: !!opts.boosters });
    let fv = null;
    if (opts.flightAt != null) fv = flightVoice(ctx, chain.input, opts.flightAt);
    for (const ev of opts.events || []) {
      if (ev.type === "thrust" && fv) fv.setThrust(!!ev.on, ev.t);
      else if (ev.type === "deploy") deployPop(ctx, chain.input, ev.t);
      else if (ev.type === "crash") { crashBoom(ctx, chain.input, ev.t); if (fv) fv.stop(ev.t, 0.25); }
      else if (ev.type === "end" && fv) fv.stop(ev.t, 0.3);
    }
    return ctx.startRendering();
  }

  // Offline render of one launch (evidence / loudness): returns an AudioBuffer.
  // preRoll = seconds of silence before sim e=0 (e.g. GO tap -> engine start).
  function renderOffline(opts) {
    opts = opts || {};
    const sr = opts.sampleRate || 48000, pre = opts.preRoll || 0, dur = opts.duration || (pre + 14);
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.round(sr * dur), sr);
    const chain = makeChain(ctx, ctx.destination);
    scheduleLaunch(ctx, chain.input, pre, { boosters: !!opts.boosters });
    return ctx.startRendering();
  }

  global.RocketBayAudio = { makeChain, scheduleLaunch, renderOffline, renderRunOffline, flightVoice, deployPop, crashBoom, altAt, CEIL,
    BEEPS: { t: BEEP_T, f: BEEP_F, dur: BEEP_DUR, finalT: BEEP_FINAL_T, finalF: BEEP_FINAL_F, finalDur: BEEP_FINAL_DUR } };
})(typeof window !== "undefined" ? window : globalThis);
