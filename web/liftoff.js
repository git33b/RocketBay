/**
 * Rocket Bay — heavy liftoff feel (LIFTOFF-FEEL)
 * Pixel-crisp particles, rAF physics climb, camera pan, optional rumble.
 * Exposes window.RocketBayLiftoff
 */
(function (global) {
  "use strict";

  const POOL = 520;
  const CELL = 3; // pixel block size at canvas CSS px (snapped)

  const TOD_GLOW = {
    "02": { flame: ["#fff6d0", "#ffd060", "#ff8c20", "#e04800"], smoke: ["#c8b8a0", "#8a7a68", "#5a5048", "#3a3430"], glow: "rgba(255,140,40,0.55)", pad: "#ffb060" },
    "03": { flame: ["#ffe0c0", "#ff9040", "#e04010", "#a01808"], smoke: ["#b09080", "#705848", "#403830", "#28201c"], glow: "rgba(255,80,20,0.65)", pad: "#ff6030" },
    "04": { flame: ["#fff0c8", "#ffb040", "#ff7010", "#d03800"], smoke: ["#687888", "#485060", "#303840", "#1c2028"], glow: "rgba(255,120,30,0.85)", pad: "#ff8820" },
    "05": { flame: ["#fff8e0", "#ffe080", "#ff9a30", "#e06010"], smoke: ["#d0d4d8", "#989ca0", "#686c70", "#404448"], glow: "rgba(255,160,60,0.35)", pad: "#ffc060" },
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function snap(v, cell) { return Math.round(v / cell) * cell; }

  function makePool(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = { alive: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: 0, cell: CELL };
    }
    return a;
  }

  function LiftoffEngine(opts) {
    this.getLetterbox = opts.getLetterbox;
    this.getSeat = opts.getSeat; // () => { cx, sitY, width, nozzles[] } in native 1280x720
    this.getTodId = opts.getTodId;
    this.getWorldEl = opts.getWorldEl;
    this.getSkyEl = opts.getSkyEl;
    this.getFxCanvas = opts.getFxCanvas;
    this.getCountdownEl = opts.getCountdownEl;
    this.getStackEl = opts.getStackEl;
    this.onComplete = opts.onComplete || function () {};
    this.onPerfSample = opts.onPerfSample || null;

    this.particles = makePool(POOL);
    this.running = false;
    this.raf = 0;
    this.t0 = 0;
    this.phase = "idle"; // countdown | burn | hold | climb | linger
    this.countdown = 5;
    this.rocketY = 0; // native px upward (negative CSS translate)
    this.camY = 0; // world translateY positive = camera up
    this.shake = 0;
    this.shakeSeed = 0;
    this.ignited = false;
    this.released = false;
    this.climbT = 0;
    this.perf = [];
    this.lastTs = 0;
    this.audio = null;
    this.audioMuted = true;
    this._lbCache = null;
  }

  LiftoffEngine.prototype.reset = function () {
    this.stop();
    this.phase = "idle";
    this.countdown = 5;
    this.rocketY = 0;
    this.camY = 0;
    this.shake = 0;
    this.ignited = false;
    this.released = false;
    this.climbT = 0;
    this.perf = [];
    for (let i = 0; i < this.particles.length; i++) this.particles[i].alive = false;
    const stack = this.getStackEl();
    if (stack) {
      stack.style.transform = "";
      stack.classList.remove("liftoff");
    }
    const world = this.getWorldEl();
    if (world) world.style.transform = "";
    const sky = this.getSkyEl();
    if (sky) {
      sky.style.opacity = "0";
      sky.style.background = "transparent";
    }
    const cd = this.getCountdownEl();
    if (cd) { cd.style.display = "none"; cd.textContent = ""; }
    const fx = this.getFxCanvas();
    if (fx) {
      const ctx = fx.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, fx.width, fx.height);
      fx.style.display = "none";
    }
    this.stopAudio(true);
  };

  LiftoffEngine.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  LiftoffEngine.prototype.ensureAudio = function () {
    if (this.audio) return this.audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // noise
    const bufSize = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 180;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.35;
    noise.connect(filt); filt.connect(nGain); nGain.connect(master);
    noise.start();

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 42;
    const oGain = ctx.createGain();
    oGain.gain.value = 0.12;
    const oFilt = ctx.createBiquadFilter();
    oFilt.type = "lowpass";
    oFilt.frequency.value = 90;
    osc.connect(oFilt); oFilt.connect(oGain); oGain.connect(master);
    osc.start();

    this.audio = { ctx, master, noise, osc, nGain, oGain };
    return this.audio;
  };

  LiftoffEngine.prototype.setMuted = function (muted) {
    this.audioMuted = !!muted;
    if (this.audio) {
      const g = this.audio.master.gain;
      const now = this.audio.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(this.audioMuted ? 0 : this._targetVol || 0, now + 0.08);
    }
  };

  LiftoffEngine.prototype.stopAudio = function (immediate) {
    if (!this.audio) return;
    const g = this.audio.master.gain;
    const now = this.audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    if (immediate) g.setValueAtTime(0, now);
    else g.linearRampToValueAtTime(0, now + 0.6);
  };

  LiftoffEngine.prototype.setAudioLevel = function (level) {
    this._targetVol = clamp(level, 0, 0.55);
    if (!this.audio || this.audioMuted) return;
    const g = this.audio.master.gain;
    const now = this.audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this._targetVol, now + 0.05);
  };

  LiftoffEngine.prototype.vibrate = function (pattern) {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);
      }
    } catch (_) {}
  };

  LiftoffEngine.prototype.spawn = function (kind, x, y, vx, vy, life, size, color, cell) {
    const p = this.particles;
    for (let i = 0; i < p.length; i++) {
      if (!p[i].alive) {
        const o = p[i];
        o.alive = true;
        o.kind = kind;
        o.x = x; o.y = y; o.vx = vx; o.vy = vy;
        o.life = 0; o.max = life;
        o.size = size; o.color = color; o.cell = cell || CELL;
        return o;
      }
    }
    return null;
  };

  LiftoffEngine.prototype.emitIgnition = function (seat, lb, tod, dt) {
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const sx = lb.left + (seat.cx / lb.nw) * lb.width;
    const sy = lb.top + (seat.sitY / lb.nh) * lb.height;
    const scale = lb.width / lb.nw;
    const plumeW = Math.max(18, seat.width * scale * 0.55);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const nRate = Math.ceil(40 * dt * 60);

    for (let n = 0; n < nozzles.length; n++) {
      const nx = sx + nozzles[n] * scale;
      for (let i = 0; i < nRate; i++) {
        const side = (Math.random() - 0.5) * plumeW;
        // flame down
        this.spawn(
          1,
          nx + side * 0.35,
          sy + Math.random() * 4,
          (Math.random() - 0.5) * 40,
          80 + Math.random() * 120,
          0.18 + Math.random() * 0.25,
          3 + (Math.random() < 0.3 ? 4 : 0),
          (Math.random() * pal.flame.length) | 0,
          CELL
        );
        // smoke sideways along pad
        if (Math.random() < 0.55) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          this.spawn(
            2,
            nx + side * 0.2,
            sy + 2 + Math.random() * 6,
            dir * (40 + Math.random() * 90),
            -10 + Math.random() * 20,
            0.9 + Math.random() * 1.4,
            4 + (Math.random() < 0.4 ? 3 : 0),
            (Math.random() * pal.smoke.length) | 0,
            CELL
          );
        }
      }
    }
    // pad glow particles (sparse)
    if (Math.random() < 0.4) {
      this.spawn(3, sx + (Math.random() - 0.5) * plumeW * 1.6, sy + 8, (Math.random() - 0.5) * 20, 5, 0.2, 3, 0, CELL);
    }
  };

  LiftoffEngine.prototype.emitTrail = function (seat, lb, tod, rocketYNative) {
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const scale = lb.width / lb.nw;
    const sx = lb.left + (seat.cx / lb.nw) * lb.width;
    const baseSy = lb.top + (seat.sitY / lb.nh) * lb.height;
    const sy = baseSy - rocketYNative * scale;
    const plumeW = Math.max(14, seat.width * scale * 0.45);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    for (let n = 0; n < nozzles.length; n++) {
      const nx = sx + nozzles[n] * scale;
      for (let i = 0; i < 6; i++) {
        this.spawn(
          1,
          nx + (Math.random() - 0.5) * plumeW * 0.5,
          sy + Math.random() * 6,
          (Math.random() - 0.5) * 30,
          60 + Math.random() * 100,
          0.15 + Math.random() * 0.2,
          3,
          (Math.random() * pal.flame.length) | 0,
          CELL
        );
      }
      if (Math.random() < 0.7) {
        this.spawn(
          2,
          nx + (Math.random() - 0.5) * plumeW,
          sy + 4,
          (Math.random() - 0.5) * 50,
          20 + Math.random() * 40,
          1.2 + Math.random(),
          4,
          (Math.random() * pal.smoke.length) | 0,
          CELL
        );
      }
    }
  };

  LiftoffEngine.prototype.updateParticles = function (dt) {
    const p = this.particles;
    for (let i = 0; i < p.length; i++) {
      const o = p[i];
      if (!o.alive) continue;
      o.life += dt;
      if (o.life >= o.max) { o.alive = false; continue; }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.kind === 2) {
        o.vx *= 0.985;
        o.vy *= 0.99;
        o.vy -= 8 * dt; // slight rise
      } else if (o.kind === 1) {
        o.vy += 40 * dt;
        o.vx *= 0.97;
      }
    }
  };

  LiftoffEngine.prototype.drawFx = function (lb, tod, seat, rocketYNative) {
    const canvas = this.getFxCanvas();
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(lb.width);
    const h = Math.round(lb.height);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    canvas.style.left = lb.left + "px";
    canvas.style.top = lb.top + "px";
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const scale = lb.width / lb.nw;
    const sx = lb.left + (seat.cx / lb.nw) * lb.width - lb.left;
    const sitCss = (seat.sitY / lb.nh) * lb.height;
    const nozzleY = sitCss - rocketYNative * scale;

    // pad/tower glow at ignition — posterized rects, no blur
    if (this.ignited) {
      const glowA = this.released ? 0.35 : 0.7;
      const gw = Math.max(40, seat.width * scale * 1.1);
      const gh = 28;
      ctx.globalAlpha = glowA * (0.7 + 0.3 * Math.sin(performance.now() * 0.03));
      ctx.fillStyle = pal.pad;
      const gx = snap(sx - gw / 2, CELL);
      const gy = snap(nozzleY + 2, CELL);
      for (let yy = 0; yy < gh; yy += CELL) {
        const rowA = 1 - yy / gh;
        ctx.globalAlpha = glowA * rowA * 0.55;
        ctx.fillRect(gx - yy * 0.15, gy + yy, gw + yy * 0.3, CELL);
      }
      // tower-side tint strip
      ctx.globalAlpha = glowA * 0.25;
      ctx.fillStyle = pal.flame[1];
      const towerSide = seat.cx > lb.nw / 2 ? -1 : 1;
      ctx.fillRect(snap(sx + towerSide * gw * 0.7, CELL), snap(nozzleY - 80, CELL), CELL * 2, 100);
      ctx.globalAlpha = 1;
    }

    const p = this.particles;
    for (let i = 0; i < p.length; i++) {
      const o = p[i];
      if (!o.alive) continue;
      const t = o.life / o.max;
      // convert absolute page-ish coords stored as canvas-local already if we store local
      // particles stored in canvas-local coords relative to letterbox
      let px = o.x - lb.left;
      let py = o.y - lb.top;
      // trail particles already local if we adjust — we spawn with absolute left/top of letterbox
      px = snap(px, o.cell);
      py = snap(py, o.cell);
      const colors = o.kind === 2 ? pal.smoke : pal.flame;
      ctx.globalAlpha = o.kind === 2 ? (1 - t) * 0.85 : (1 - t * t);
      ctx.fillStyle = colors[o.color % colors.length];
      const s = o.size;
      ctx.fillRect(px, py, s, s);
    }
    ctx.globalAlpha = 1;
  };

  LiftoffEngine.prototype.sampleTopRowColor = function () {
    // Approximate from TOD if we can't read plate pixels cheaply
    const tod = this.getTodId();
    if (tod === "04") return "#0a1020";
    if (tod === "02") return "#f0a878";
    if (tod === "03") return "#c85840";
    return "#4a90d0";
  };

  LiftoffEngine.prototype.applyCamera = function (lb) {
    const world = this.getWorldEl();
    const sky = this.getSkyEl();
    if (!world) return;
    const sh = this.shake;
    const sx = sh ? ((Math.random() - 0.5) * 2 * sh) : 0;
    const sy = sh ? ((Math.random() - 0.5) * 2 * sh) : 0;
    // camera pans up: world moves down
    world.style.transform = "translate3d(" + sx.toFixed(2) + "px," + (this.camY + sy).toFixed(2) + "px,0)";

    if (sky) {
      const top = this.sampleTopRowColor();
      const fade = clamp(this.camY / (lb ? lb.height * 0.7 : 400), 0, 1);
      sky.style.opacity = fade < 0.02 ? "0" : "1";
      const spaceStop = Math.min(75, 12 + fade * 55);
      sky.style.background =
        "linear-gradient(to bottom, #010208 0%, #010208 " + spaceStop.toFixed(1) + "%, " + top + " 100%)";
    }
  };

  LiftoffEngine.prototype.applyRocketTransform = function (lb, seat) {
    const stack = this.getStackEl();
    if (!stack || !lb) return;
    const scale = lb.height / lb.nh;
    const yCss = -this.rocketY * scale;
    stack.style.transform = "translate3d(0," + yCss.toFixed(2) + "px,0)";
    stack.style.opacity = "1";
  };

  LiftoffEngine.prototype.tick = function (ts) {
    if (!this.running) return;
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.05) dt = 0.05; // clamp hitch
    this.perf.push(dt * 1000);
    if (this.perf.length > 240) this.perf.shift();

    const elapsed = (ts - this.t0) / 1000;
    const lb = this.getLetterbox();
    const seat = this.getSeat() || { cx: 640, sitY: 548, width: 120, nozzles: [0], nw: 1280, nh: 720 };
    if (lb) {
      seat.nw = lb.nw; seat.nh = lb.nh;
    }
    const tod = this.getTodId();
    const cdEl = this.getCountdownEl();

    // --- Timeline ---
    // 0..5s countdown T-5..T-0; ignition at T-2 (elapsed>=3); release at T-0 (elapsed>=5)
    if (elapsed < 5) {
      this.phase = "countdown";
      this.countdown = Math.max(0, Math.ceil(5 - elapsed));
      if (cdEl) {
        cdEl.style.display = "flex";
        cdEl.textContent = this.countdown > 0 ? ("T-" + this.countdown) : "T-0";
      }
      if (elapsed >= 3 && !this.ignited) {
        this.ignited = true;
        this.phase = "burn";
        this.shake = 4;
        this.vibrate([40, 30, 40]);
        this.setAudioLevel(0.25);
      }
      if (this.ignited) {
        this.shake = lerp(this.shake, 6, 0.08);
        if (lb) this.emitIgnition(seat, lb, tod, dt);
        this.setAudioLevel(0.25 + (elapsed - 3) * 0.08);
      }
    } else {
      // released
      if (!this.released) {
        this.released = true;
        this.phase = "hold";
        this.climbT = 0;
        this.shake = 10;
        this.vibrate([80, 40, 60, 40, 80]);
        this.setAudioLevel(0.5);
        if (cdEl) cdEl.textContent = "LIFTOFF";
      }
      const sinceRelease = elapsed - 5;
      if (sinceRelease < 0.5) {
        this.phase = "hold";
        this.rocketY = sinceRelease * 4; // nearly stationary (~2px native)
        this.shake = lerp(this.shake, 7, 0.1);
        if (lb) this.emitIgnition(seat, lb, tod, dt);
      } else {
        this.phase = "climb";
        this.climbT = sinceRelease - 0.5;
        // heavy ease-in: y = a * t^2  (native px)
        const a = 480; // heavy ease-in (native px/s^2)
        this.rocketY = 2 + a * this.climbT * this.climbT;
        // camera follows after rocket rises a bit
        const follow = Math.max(0, this.rocketY - 20);
        const targetCam = Math.min(follow * (lb ? lb.height / lb.nh : 0.5) * 0.95, lb ? lb.height * 1.25 : 560);
        this.camY = lerp(this.camY, targetCam, 1 - Math.pow(0.001, dt));
        this.shake = Math.max(0, this.shake - 8 * dt);
        if (lb) this.emitTrail(seat, lb, tod, this.rocketY);
        this.setAudioLevel(clamp(0.5 - this.climbT * 0.12, 0.05, 0.5));
        if (cdEl && this.climbT > 0.3) cdEl.style.display = "none";
      }
    }

    this.updateParticles(dt);
    if (lb) {
      this.drawFx(lb, tod, seat, this.rocketY);
      this.applyRocketTransform(lb, seat);
      this.applyCamera(lb);
    }

    // end sequence → mission
    if (this.released && this.climbT > 2.6) {
      this.phase = "linger";
      // linger smoke briefly then complete
      if (this.climbT > 3.4) {
        this.running = false;
        this.stopAudio(false);
        if (this.onPerfSample) this.onPerfSample(this.perf.slice());
        this.onComplete();
        return;
      }
    }

    this.raf = requestAnimationFrame(this.tick.bind(this));
  };

  LiftoffEngine.prototype.start = function () {
    this.reset();
    this.running = true;
    this.t0 = performance.now();
    this.lastTs = 0;
    this.phase = "countdown";
    // AudioContext only after gesture — start() is called from click
    this.ensureAudio();
    if (this.audio && this.audio.ctx.state === "suspended") {
      this.audio.ctx.resume().catch(function () {});
    }
    this.setMuted(this.audioMuted);
    this.vibrate(20);
    this.raf = requestAnimationFrame(this.tick.bind(this));
  };

  global.RocketBayLiftoff = { LiftoffEngine: LiftoffEngine, TOD_GLOW: TOD_GLOW };
})(typeof window !== "undefined" ? window : globalThis);
