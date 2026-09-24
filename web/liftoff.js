/**
 * Rocket Bay — LIFTOFF-FEEL v2 (CoE rebuild)
 * Layered flame, ground+trail smoke, cover mapping, parallax, light interaction.
 * Timing preserved: T-5 countdown, T-2 ignition, 0.5s hold, t² climb.
 */
(function (global) {
  "use strict";

  const POOL_GROUND = 420;
  const POOL_TRAIL = 280;
  const BUF_DIV = 2; // low-res buffer → crisp upscale

  const TOD_GLOW = {
    "02": {
      flame: ["#fffce8", "#ffe090", "#ff9a28", "#e04008", "#901800"],
      smoke: ["#f0e4d8", "#c8b8a8", "#907868", "#584838"],
      smokeLit: ["#ffc090", "#e09060", "#c07040"],
      pad: "#ffb060", topHint: "#f0a878", deep: "#1a1030",
      parallax: "dawn",
    },
    "03": {
      flame: ["#fff0e0", "#ffb060", "#ff6020", "#c02808", "#801008"],
      smoke: ["#e0c8b8", "#b09080", "#705048", "#403028"],
      smokeLit: ["#ff9060", "#e06838", "#c04820"],
      pad: "#ff6030", topHint: "#c85840", deep: "#180818",
      parallax: "dusk",
    },
    "04": {
      flame: ["#fff8e0", "#ffe060", "#ff9018", "#e03800", "#a01800"],
      smoke: ["#d0d8e0", "#98a0b0", "#606878", "#383c48"],
      smokeLit: ["#ffb070", "#e87838", "#c05018"],
      pad: "#ff8820", topHint: "#0a1020", deep: "#02040c",
      parallax: "night",
    },
    "05": {
      flame: ["#fffef0", "#ffe8a0", "#ffb040", "#f06810", "#c04000"],
      smoke: ["#f0f2f4", "#c8ccd0", "#909498", "#585c60"],
      smokeLit: ["#ffc080", "#e89050", "#d06828"],
      pad: "#ffc060", topHint: "#5aa0d8", deep: "#020818",
      parallax: "day",
    },
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function snap(v, cell) { return Math.round(v / cell) * cell; }

  function makePool(n, kind) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = {
        alive: false, kind: kind || 0,
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, max: 1, size: 4, color: 0, lit: 0,
      };
    }
    return a;
  }

  function LiftoffEngine(opts) {
    this.getLetterbox = opts.getLetterbox;
    this.getSeat = opts.getSeat;
    this.getTodId = opts.getTodId;
    this.getWorldEl = opts.getWorldEl;
    this.getSkyEl = opts.getSkyEl;
    this.getFxCanvas = opts.getFxCanvas;
    this.getCountdownEl = opts.getCountdownEl;
    this.getStackEl = opts.getStackEl;
    this.getPlateEl = opts.getPlateEl;
    this.getParallaxEl = opts.getParallaxEl || function () { return null; };
    this.onComplete = opts.onComplete || function () {};
    this.onPerfSample = opts.onPerfSample || null;
    this.captureMode = !!opts.captureMode;

    this.ground = makePool(POOL_GROUND, 2);
    this.trail = makePool(POOL_TRAIL, 1);
    this.perf = [];
    this.audioMuted = true;
    this.audio = null;
    this._targetVol = 0;
    this._rng = 1;
    this._fxReady = false;
    this._buf = null;
    this._bctx = null;
    this._skyTile = null;
    this._stars = null;
    this._clouds = null;
    this.reset();
  }

  LiftoffEngine.prototype._rand = function () {
    this._rng = (this._rng * 1664525 + 1013904223) >>> 0;
    return (this._rng & 0xffff) / 0x10000;
  };

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
    this.lingerT = 0;
    this.flameIntensity = 0;
    this.releaseFlash = 0;
    this.perf.length = 0;
    this._fxReady = false;
    this._shakeX = 0;
    this._shakeY = 0;
    this._simTime = 0;
    this._lastRise = "";
    this._lastCamKey = "";
    this._skyFadeBucket = -1;
    for (let i = 0; i < this.ground.length; i++) this.ground[i].alive = false;
    for (let i = 0; i < this.trail.length; i++) this.trail[i].alive = false;
    const stack = this.getStackEl();
    if (stack) {
      stack.style.transform = "";
      stack.classList.remove("liftoff");
      stack.style.filter = "";
    }
    const world = this.getWorldEl();
    if (world) world.style.transform = "translate3d(0,0,0)";
    const sky = this.getSkyEl();
    if (sky) {
      sky.style.opacity = "0";
      sky.style.background = "transparent";
      sky.innerHTML = "";
    }
    const cd = this.getCountdownEl();
    if (cd) { cd.style.display = "none"; cd.textContent = ""; }
    const fx = this.getFxCanvas();
    if (fx) {
      fx.style.display = "none";
      fx.style.transform = "";
    }
    const plateEl = this.getPlateEl && this.getPlateEl();
    if (plateEl) { plateEl.style.webkitMaskImage = ""; plateEl.style.maskImage = ""; }
    const px = this.getParallaxEl();
    if (px) { px.style.display = "none"; }
    this.stopAudio(true);
  };

  LiftoffEngine.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /* ---------- plate top sample + seamless sky tile ---------- */
  LiftoffEngine.prototype.buildSkyTile = function () {
    const plate = this.getPlateEl();
    const tod = this.getTodId();
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const bandH = 100;
    const w = 256;
    const tileH = 512;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = tileH;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    if (plate && plate.naturalWidth) {
      try {
        // Sample top band of plate
        // Prefer a band slightly below absolute top (richer stars/nebula), then tile
        const srcY0 = Math.min(40, Math.max(0, plate.naturalHeight - bandH - 20));
        const srcH = Math.min(bandH, plate.naturalHeight - srcY0);
        ctx.drawImage(plate, 0, srcY0, plate.naturalWidth, srcH, 0, 0, w, bandH);
        // Mirror / tile upward
        for (let y = bandH; y < tileH; y += bandH) {
          const flip = ((y / bandH) | 0) % 2 === 1;
          if (flip) {
            ctx.save();
            ctx.translate(0, y + bandH);
            ctx.scale(1, -1);
            ctx.drawImage(c, 0, 0, w, bandH, 0, 0, w, bandH);
            ctx.restore();
          } else {
            ctx.drawImage(c, 0, 0, w, bandH, 0, y, w, bandH);
          }
        }
        // Soft vertical blend into deep space over 40+ px near top of tile
        // and grade the whole extension toward deep
        // Soft 48px+ crossfade at each tile junction
        for (let y = bandH - 48; y < bandH + 8; y++) {
          const t = clamp((y - (bandH - 48)) / 48, 0, 1);
          ctx.globalAlpha = t * 0.15;
          ctx.fillStyle = pal.topHint;
          ctx.fillRect(0, y, w, 1);
        }
        ctx.globalAlpha = 1;
        const grad = ctx.createLinearGradient(0, bandH, 0, tileH);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.25, this._rgba(pal.deep, 0.15));
        grad.addColorStop(0.6, this._rgba(pal.deep, 0.45));
        grad.addColorStop(1, this._rgba(pal.deep, 0.95));
        ctx.fillStyle = grad;
        ctx.fillRect(0, bandH, w, tileH - bandH);
      } catch (_) {
        ctx.fillStyle = pal.topHint;
        ctx.fillRect(0, 0, w, tileH);
      }
    } else {
      ctx.fillStyle = pal.topHint;
      ctx.fillRect(0, 0, w, tileH);
    }
    this._skyTile = c;
    return c;
  };

  LiftoffEngine.prototype._rgba = function (c, a) {
    if (c[0] === "#") {
      const h = c.slice(1);
      const n = h.length === 3
        ? [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)]
        : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      return "rgba(" + n[0] + "," + n[1] + "," + n[2] + "," + a + ")";
    }
    return c;
  };

  LiftoffEngine.prototype._mix = function (a, b, t) {
    function parse(c) {
      if (c[0] === "#") {
        const h = c.slice(1);
        return h.length === 3
          ? [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)]
          : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      }
      const m = String(c).match(/(\d+)/g);
      return m ? [+m[0], +m[1], +m[2]] : [20, 30, 50];
    }
    const A = parse(a), B = parse(b);
    return "rgb(" + ((A[0]+(B[0]-A[0])*t)|0) + "," + ((A[1]+(B[1]-A[1])*t)|0) + "," + ((A[2]+(B[2]-A[2])*t)|0) + ")";
  };

  LiftoffEngine.prototype.buildParallax = function () {
    const tod = this.getTodId();
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const mode = pal.parallax;
    const w = 320, h = 640;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (mode === "night" || mode === "dawn" || mode === "dusk") {
      // 3 star layers
      this._stars = [[], [], []];
      for (let layer = 0; layer < 3; layer++) {
        const n = 22 + layer * 28;
        for (let i = 0; i < n; i++) {
          this._stars[layer].push({
            x: this._rand() * w,
            y: this._rand() * h,
            s: layer === 2 ? 2 : 1,
            a: 0.35 + layer * 0.2 + this._rand() * 0.3,
          });
        }
      }
    }
    if (mode === "day" || mode === "dawn" || mode === "dusk") {
      this._clouds = [];
      for (let i = 0; i < 10; i++) {
        this._clouds.push({
          x: this._rand() * w,
          y: this._rand() * h * 0.7,
          w: 18 + this._rand() * 40,
          h: 8 + this._rand() * 16,
          a: 0.25 + this._rand() * 0.35,
        });
      }
    }
  };

  LiftoffEngine.prototype.prepareFx = function () {
    const lb = this.getLetterbox();
    if (!lb) return false;
    const wrap = this.getWorldEl();
    const wrapW = (wrap && wrap.clientWidth) || lb.cw || window.innerWidth || 844;
    const wrapH = (wrap && wrap.clientHeight) || lb.ch || window.innerHeight || 390;
    this._lb = {
      left: lb.left, top: lb.top, width: lb.width, height: lb.height,
      scale: lb.scale, nw: lb.nw, nh: lb.nh,
    };
    this._wrapW = wrapW;
    this._wrapH = wrapH;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._cell = 1; // in low-res buffer units
    const seat = this.getSeat() || { targetH: 500, width: 120 };
    this._stackHcss = Math.max(140, ((seat.targetH || 500) / lb.nh) * lb.height);
    this._stageW = Math.max(40, (seat.width || 120) / lb.nw * lb.width);

    // Display FX canvas (full wrap)
    const canvas = this.getFxCanvas();
    if (!canvas) return false;
    const bw = Math.round(wrapW * this._dpr);
    const bh = Math.round(wrapH * this._dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    canvas.style.left = "0px";
    canvas.style.top = "0px";
    canvas.style.width = wrapW + "px";
    canvas.style.height = wrapH + "px";
    canvas.style.display = "block";
    canvas.style.transform = ""; // never rises with rocket — world-space draw
    this._ctx = canvas.getContext("2d");
    this._ctx.imageSmoothingEnabled = false;

    // Low-res offscreen buffer
    const bufW = Math.max(160, Math.round(wrapW / BUF_DIV));
    const bufH = Math.max(80, Math.round(wrapH / BUF_DIV));
    if (!this._buf || this._buf.width !== bufW || this._buf.height !== bufH) {
      this._buf = document.createElement("canvas");
      this._buf.width = bufW;
      this._buf.height = bufH;
      this._bctx = this._buf.getContext("2d");
    }
    this._bufW = bufW;
    this._bufH = bufH;
    this._bScale = bufW / wrapW; // css → buf

    this.buildSkyTile();
    this.buildParallax();
    this.applySkyExtension(0);

    const px = this.getParallaxEl();
    if (px) {
      px.width = bw;
      px.height = bh;
      px.style.display = "block";
      px.style.width = wrapW + "px";
      px.style.height = wrapH + "px";
    }

    this._fxReady = true;
    return true;
  };

  LiftoffEngine.prototype.applySkyExtension = function (fade) {
    const sky = this.getSkyEl();
    if (!sky || !this._skyTile) return;
    const tod = this.getTodId();
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    sky.style.opacity = "1";
    sky.style.top = "-180%";
    sky.style.bottom = "-40%";
    // Place tiled sample as background, with deep fade
    const url = this._skyTile.toDataURL();
    const deep = this._mix(pal.topHint, pal.deep, 0.55 + fade * 0.4);
    // Tile dominates; only late altitude washes toward deep — kills hard black void
    const wash = clamp(0.1 + fade * 0.55, 0, 0.7);
    sky.style.background =
      "linear-gradient(to bottom, transparent 0%, transparent 50%, " + this._rgba(deep, wash) + " 100%)," +
      "url(" + url + ") center top / 100% auto repeat-y";
  };

  /* ---------- audio (unchanged light path) ---------- */
  LiftoffEngine.prototype.ensureAudio = function () {
    if (this.audio) return this.audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const bufSize = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass"; filt.frequency.value = 200;
    const nGain = ctx.createGain(); nGain.gain.value = 0.4;
    noise.connect(filt); filt.connect(nGain); nGain.connect(master);
    noise.start();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth"; osc.frequency.value = 40;
    const oFilt = ctx.createBiquadFilter();
    oFilt.type = "lowpass"; oFilt.frequency.value = 90;
    const oGain = ctx.createGain(); oGain.gain.value = 0.14;
    osc.connect(oFilt); oFilt.connect(oGain); oGain.connect(master);
    osc.start();
    this.audio = { ctx: ctx, master: master };
    return this.audio;
  };
  LiftoffEngine.prototype.setMuted = function (muted) {
    this.audioMuted = !!muted;
    if (!this.audio) return;
    const g = this.audio.master.gain;
    const now = this.audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.audioMuted ? 0 : this._targetVol, now + 0.06);
  };
  LiftoffEngine.prototype.setAudioLevel = function (level) {
    const next = clamp(level, 0, 0.55);
    if (Math.abs(next - (this._lastAudioLevel || 0)) < 0.03) { this._targetVol = next; return; }
    this._targetVol = next;
    this._lastAudioLevel = next;
    if (!this.audio || this.audioMuted) return;
    const g = this.audio.master.gain;
    const now = this.audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this._targetVol, now + 0.08);
  };
  LiftoffEngine.prototype.stopAudio = function (immediate) {
    if (!this.audio) return;
    const g = this.audio.master.gain;
    const now = this.audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    if (immediate) g.setValueAtTime(0, now);
    else g.linearRampToValueAtTime(0, now + 0.5);
  };
  LiftoffEngine.prototype.vibrate = function (pattern) {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);
      }
    } catch (_) {}
  };

  /* ---------- coords ---------- */
  LiftoffEngine.prototype.cssFromNative = function (nx, ny) {
    const lb = this._lb;
    return {
      x: lb.left + (nx / lb.nw) * lb.width,
      y: lb.top + (ny / lb.nh) * lb.height,
    };
  };

  LiftoffEngine.prototype.nozzleNative = function (seat) {
    const ny = (seat.nozzleY != null ? seat.nozzleY : seat.sitY) - this.rocketY;
    return { x: seat.cx, y: ny };
  };

  LiftoffEngine.prototype.spawn = function (pool, x, y, vx, vy, life, size, color, lit) {
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].alive) {
        const o = pool[i];
        o.alive = true;
        o.x = x; o.y = y; o.vx = vx; o.vy = vy;
        o.life = 0; o.max = life;
        o.size = size; o.color = color; o.lit = lit || 0;
        return o;
      }
    }
    return null;
  };

  /* ---------- emit ---------- */
  LiftoffEngine.prototype.emitGroundSmoke = function (seat, intensity) {
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
    const cx = seat.cx;
    const trenchW = Math.max(40, (seat.width || 100) * 1.2);
    const n = Math.max(3, Math.round(7 * intensity));
    for (let i = 0; i < n; i++) {
      const dir = this._rand() < 0.5 ? -1 : 1;
      const lit = this.flameIntensity * (0.4 + this._rand() * 0.6);
      this.spawn(
        this.ground,
        cx + (this._rand() - 0.5) * trenchW,
        deckY + (this._rand() - 0.3) * 18,
        dir * (30 + this._rand() * 90) * (0.6 + intensity),
        -8 - this._rand() * 22,
        2.2 + this._rand() * 2.8,
        10 + this._rand() * 22,
        (this._rand() * pal.smoke.length) | 0,
        lit
      );
    }
  };

  LiftoffEngine.prototype.emitTrail = function (seat) {
    const nz = this.nozzleNative(seat);
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    for (let n = 0; n < nozzles.length; n++) {
      const nx = nz.x + nozzles[n];
      for (let i = 0; i < 2; i++) {
        this.spawn(
          this.trail,
          nx + (this._rand() - 0.5) * 12,
          nz.y + this._rand() * 8,
          (this._rand() - 0.5) * 20,
          40 + this._rand() * 80,
          0.6 + this._rand() * 0.9,
          4 + this._rand() * 8,
          (this._rand() * pal.smoke.length) | 0,
          this.flameIntensity * 0.5
        );
      }
    }
  };

  LiftoffEngine.prototype.updateParticles = function (dt) {
    const update = (pool, ground) => {
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i];
        if (!o.alive) continue;
        o.life += dt;
        if (o.life >= o.max) { o.alive = false; continue; }
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        if (ground) {
          o.vx *= 0.99;
          o.vy -= 6 * dt;
          o.size += 4 * dt; // expand
        } else {
          o.vy += 30 * dt;
          o.vx *= 0.97;
        }
        o.lit *= 0.96;
      }
    };
    update(this.ground, true);
    update(this.trail, false);
  };

  /* ---------- layered flame into low-res buffer ---------- */
  LiftoffEngine.prototype.drawFlame = function (bctx, seat, pal) {
    const lb = this._lb;
    const bs = this._bScale;
    const nz = this.nozzleNative(seat);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const stageWnative = Math.max(80, seat.width || 120);
    const baseW = stageWnative * (1.7 + 0.35 * clamp(this.flameIntensity, 0, 1)); // ≥1.5–2×
    const grow = clamp(this.flameIntensity, 0.15, 1.5);
    const stackW = stageWnative;
    let lenNative;
    if (this.phase === "climb") {
      lenNative = stackW * (3.0 + grow * 2.8 + this.climbT * 1.8);
    } else if (this.phase === "hold") {
      lenNative = stackW * (1.6 + grow * 1.0);
    } else {
      lenNative = stackW * (1.35 + grow * 1.1); // ignition: tall tapered plume
    }
    const flickLen = 0.82 + 0.18 * Math.sin(this._simTime * 53.1) + (this._rand() - 0.5) * 0.14;
    const flickW = 0.88 + 0.12 * Math.sin(this._simTime * 37.7) + (this._rand() - 0.5) * 0.1;
    const lenF = lenNative * flickLen;
    const wF = baseW * flickW;

    bctx.globalCompositeOperation = "lighter";

    // 3 passes: outer red, mid orange, core white-yellow (drawn core last on top via lighter)
    const passes = [
      { t0: 0.0, t1: 1.0, wMul: 1.0, c0: 3, c1: 4, a: 0.55 },
      { t0: 0.0, t1: 0.85, wMul: 0.72, c0: 1, c1: 3, a: 0.75 },
      { t0: 0.0, t1: 0.4, wMul: 0.38, c0: 0, c1: 1, a: 1.0 },
    ];

    for (let ni = 0; ni < nozzles.length; ni++) {
      const isSide = nozzles.length > 1 && nozzles[ni] !== 0;
      const scaleN = isSide ? 0.42 : 1;
      const nx = nz.x + nozzles[ni];
      const css = this.cssFromNative(nx, nz.y);
      const bx = css.x * bs;
      const by = css.y * bs;
      const cols = Math.max(5, Math.round(wF * scaleN / lb.nw * lb.width * bs));
      const rows = Math.max(14, Math.round(lenF * scaleN / lb.nh * lb.height * bs));

      for (let p = 0; p < passes.length; p++) {
        const pass = passes[p];
        const r0 = Math.floor(rows * pass.t0);
        const r1 = Math.floor(rows * pass.t1);
        for (let row = r0; row < r1; row++) {
          const t = row / rows;
          const taper = Math.pow(1 - t, 1.15);
          const jitter = 0.85 + this._rand() * 0.3;
          const rowW = Math.max(1, Math.round(cols * pass.wMul * taper * jitter));
          const y = Math.round(by + row);
          const x0 = Math.round(bx - rowW / 2);
          const ci = pass.c0 + ((this._rand() * (pass.c1 - pass.c0 + 0.99)) | 0);
          bctx.globalAlpha = pass.a * grow * (1 - t * 0.4) * (isSide ? 0.8 : 1);
          bctx.fillStyle = pal.flame[Math.min(pal.flame.length - 1, ci)];
          for (let c = 0; c < rowW; c++) {
            if ((c === 0 || c === rowW - 1) && this._rand() < 0.4) continue;
            if (this._rand() < 0.03) continue;
            bctx.fillRect(x0 + c, y, 1, 1);
          }
        }
      }
    }
    bctx.globalAlpha = 1;
    bctx.globalCompositeOperation = "source-over";
  };

  LiftoffEngine.prototype.drawPuff = function (bctx, bx, by, r, color, alpha) {
    bctx.globalAlpha = alpha;
    bctx.fillStyle = color;
    // soft round pixel stamp (filled circle of pixels)
    const rr = Math.max(1, Math.round(r));
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dy * dy <= rr * rr + rr * 0.2) {
          bctx.fillRect(Math.round(bx + dx), Math.round(by + dy), 1, 1);
        }
      }
    }
  };

  LiftoffEngine.prototype.drawSmoke = function (bctx, seat, pal) {
    const bs = this._bScale;
    const nz = this.nozzleNative(seat);
    const drawPool = (pool) => {
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i];
        if (!o.alive) continue;
        const t = o.life / o.max;
        const css = this.cssFromNative(o.x, o.y);
        const bx = css.x * bs;
        const by = css.y * bs;
        const r = Math.max(1.5, (o.size / this._lb.nw * this._lb.width * bs) * 0.5);
        let col;
        if (o.lit > 0.15) {
          const li = Math.min(pal.smokeLit.length - 1, (o.lit * pal.smokeLit.length) | 0);
          col = pal.smokeLit[li];
        } else {
          // darker underside: pick darker tone for lower half of puff
          const base = o.color % pal.smoke.length;
          col = pal.smoke[Math.min(pal.smoke.length - 1, base + (this._rand() < 0.35 ? 1 : 0))];
        }
        this.drawPuff(bctx, bx, by, r * (1 - t * 0.3), col, (1 - t) * 0.85);
      }
    };
    drawPool(this.ground);
    drawPool(this.trail);
    bctx.globalAlpha = 1;
  };

  LiftoffEngine.prototype.drawPadGlow = function (bctx, seat, pal) {
    if (this.flameIntensity < 0.05) return;
    const bs = this._bScale;
    const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
    const css = this.cssFromNative(seat.cx, deckY);
    const bx = css.x * bs;
    const by = css.y * bs;
    const flick = 0.75 + 0.25 * Math.sin(this._simTime * 40);
    const str = this.flameIntensity * flick * (0.5 + this.releaseFlash * 1.5);
    const gw = Math.max(20, (seat.width || 100) / this._lb.nw * this._lb.width * bs * 1.8);
    bctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      bctx.globalAlpha = str * (1 - i / 5) * 0.35;
      bctx.fillStyle = pal.pad;
      const y = Math.round(by + i * 2);
      const w = Math.round(gw + i * 6);
      bctx.fillRect(Math.round(bx - w / 2), y, w, 2);
    }
    // release bloom — soft pixel disc, not a hard rectangle
    if (this.releaseFlash > 0.05) {
      const br = Math.round(18 + this.releaseFlash * 28);
      bctx.fillStyle = "#ffe8a0";
      for (let dy = -br; dy <= br; dy += 1) {
        for (let dx = -br; dx <= br; dx += 1) {
          const d2 = dx * dx + dy * dy * 1.4;
          if (d2 > br * br) continue;
          const fall = 1 - Math.sqrt(d2) / br;
          bctx.globalAlpha = this.releaseFlash * 0.45 * fall * fall;
          bctx.fillRect(Math.round(bx + dx), Math.round(by + dy * 0.5), 1, 1);
        }
      }
    }
    bctx.globalCompositeOperation = "source-over";
    bctx.globalAlpha = 1;
  };

  LiftoffEngine.prototype.drawFx = function (seat) {
    if (!this._fxReady) return;
    const bctx = this._bctx;
    const ctx = this._ctx;
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.imageSmoothingEnabled = false;
    bctx.clearRect(0, 0, this._bufW, this._bufH);

    this.drawPadGlow(bctx, seat, pal);
    this.drawSmoke(bctx, seat, pal);
    if (this.ignited && this.phase !== "linger") {
      this.drawFlameBuffered(bctx, seat, pal);
    }

    // Upscale smoke/glow/flame crisp
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this._wrapW, this._wrapH);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this._buf, 0, 0, this._bufW, this._bufH, 0, 0, this._wrapW, this._wrapH);
  };

  LiftoffEngine.prototype.drawFlameBuffered = function (ctx, seat, pal) {
    const lb = this._lb;
    const nz = this.nozzleNative(seat);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const stageW = Math.max(80, seat.width || 120);
    const grow = clamp(this.flameIntensity, 0.25, 1.5);
    const baseW = stageW * (1.8 + 0.35 * grow);
    let lenN;
    if (this.phase === "climb") lenN = stageW * (3.5 + grow * 3.2 + this.climbT * 2.2);
    else if (this.phase === "hold") lenN = stageW * (2.0 + grow * 1.1);
    else lenN = stageW * (1.6 + grow * 1.3);
    const flickL = 0.8 + 0.2 * Math.sin(this._simTime * 55) + (this._rand() - 0.5) * 0.15;
    const flickW = 0.88 + 0.12 * Math.sin(this._simTime * 41) + (this._rand() - 0.5) * 0.12;
    const cell = 1; // buffer px ≈ 2 CSS px after ×2 upscale
    ctx.globalCompositeOperation = "lighter";

    for (let ni = 0; ni < nozzles.length; ni++) {
      const isSide = nozzles.length > 1 && nozzles[ni] !== 0;
      const sc = isSide ? 0.4 : 1;
      const css = this.cssFromNative(nz.x + nozzles[ni], nz.y);
      const bs = this._bScale;
      const cols = Math.max(5, Math.round(baseW * flickW * sc / lb.nw * lb.width * bs / cell));
      const rows = Math.max(16, Math.round(lenN * flickL * sc / lb.nh * lb.height * bs / cell));
      const ox = Math.round(css.x * bs);
      const oy = Math.round(css.y * bs);

      for (let row = 0; row < rows; row++) {
        const t = row / rows; // 0 at nozzle → 1 at tip
        const taper = Math.pow(1 - t, 1.25);
        const jitter = 0.75 + this._rand() * 0.5;
        const rowW = Math.max(1, Math.round(cols * taper * jitter));
        const y = oy + row * cell;
        for (let c = 0; c < rowW; c++) {
          const u = (c + 0.5) / rowW; // 0..1 across
          const edge = Math.abs(u - 0.5) * 2; // 0 center → 1 edge
          // skip edge speckles for flicker
          if (edge > 0.7 && this._rand() < 0.4) continue;
          if (this._rand() < 0.06) continue;
          // heat: center+near nozzle hotter
          const heat = (1 - t) * (1 - edge * 0.65) + this._rand() * 0.15;
          let ci;
          if (heat > 0.75) ci = 0;
          else if (heat > 0.5) ci = 1;
          else if (heat > 0.28) ci = 2;
          else if (heat > 0.12) ci = 3;
          else ci = 4;
          ctx.globalAlpha = grow * (0.55 + heat * 0.45) * (isSide ? 0.75 : 1) * (1 - t * 0.35);
          ctx.fillStyle = pal.flame[Math.min(pal.flame.length - 1, ci)];
          const x = ox - Math.floor(rowW * cell / 2) + c * cell;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  /* ---------- rocket light (additive orange on lower stack) ---------- */
  LiftoffEngine.prototype.applyRocketLight = function () {
    const stack = this.getStackEl();
    if (!stack || !this.ignited) {
      if (stack) stack.style.filter = "";
      return;
    }
    const flick = 0.7 + 0.3 * Math.sin(this._simTime * 42);
    const str = clamp(this.flameIntensity * flick + this.releaseFlash * 1.2, 0, 1.8);
    // CSS approximation: drop-shadow glow under stack (true source-atop tint is heavier)
    const a = (0.25 + str * 0.55).toFixed(2);
    const y = Math.round(4 + str * 10);
    // Tight under-glow only — avoid huge soft rectangle behind stack
    const bloom = Math.round(3 + str * 6);
    stack.style.filter =
      "drop-shadow(0 " + Math.max(2, y) + "px " + bloom + "px rgba(255,130,25," + (0.2 + str * 0.35).toFixed(2) + "))";
  };

  /* ---------- parallax ---------- */
  LiftoffEngine.prototype.drawParallax = function () {
    const px = this.getParallaxEl();
    if (!px || !this._fxReady) return;
    const ctx = px.getContext("2d");
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this._wrapW, this._wrapH);
    const vel = this.released ? Math.min(12, 1 + this.rocketY / 80) : 0;
    const scroll = this.camY + this.rocketY * (this._lb.height / this._lb.nh) * 0.15;
    const tod = this.getTodId();
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const mode = pal.parallax;

    if (this._stars) {
      for (let layer = 0; layer < this._stars.length; layer++) {
        const speed = 0.35 + layer * 0.55;
        const streak = vel * (0.4 + layer * 0.8);
        for (let i = 0; i < this._stars[layer].length; i++) {
          const s = this._stars[layer][i];
          let y = (s.y / 640) * this._wrapH + scroll * speed;
          y = ((y % this._wrapH) + this._wrapH) % this._wrapH;
          const x = (s.x / 320) * this._wrapW;
          ctx.globalAlpha = s.a;
          ctx.fillStyle = "#e8f0ff";
          if (streak > 1.2) {
            ctx.fillRect(Math.round(x), Math.round(y), s.s, Math.round(streak * 2));
          } else {
            ctx.fillRect(Math.round(x), Math.round(y), s.s, s.s);
          }
        }
      }
    }
    if (this._clouds && (mode === "day" || mode === "dawn" || mode === "dusk")) {
      for (let i = 0; i < this._clouds.length; i++) {
        const c = this._clouds[i];
        const speed = 0.9;
        let y = (c.y / 640) * this._wrapH + scroll * speed;
        y = ((y % this._wrapH) + this._wrapH) % this._wrapH;
        const x = (c.x / 320) * this._wrapW;
        const streak = vel * 1.5;
        ctx.globalAlpha = c.a * (mode === "day" ? 0.7 : 0.45);
        ctx.fillStyle = mode === "day" ? "#e8eef4" : "#d0b8a8";
        const hw = (c.w / 320) * this._wrapW;
        const hh = Math.max(2, (c.h / 640) * this._wrapH + streak);
        // pixel cloud blob
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(hw * 0.6), Math.round(hh));
        ctx.fillRect(Math.round(x + hw * 0.2), Math.round(y - hh * 0.4), Math.round(hw * 0.5), Math.round(hh));
        ctx.fillRect(Math.round(x + hw * 0.4), Math.round(y), Math.round(hw * 0.45), Math.round(hh * 0.8));
      }
    }
    ctx.globalAlpha = 1;

    // Altitude color grade on skyExt
    const fade = clamp(this.camY / (this._wrapH * 0.9) + this.climbT * 0.12, 0, 1);
    const bucket = (fade * 16) | 0;
    if (bucket !== this._skyFadeBucket) {
      this._skyFadeBucket = bucket;
      this.applySkyExtension(fade);
    }
  };

  /* ---------- camera / transforms ---------- */
  LiftoffEngine.prototype.applyTransforms = function (seat) {
    const lb = this._lb;
    if (!lb) return;
    const scaleY = lb.height / lb.nh;
    const stack = this.getStackEl();
    const world = this.getWorldEl();
    const rise = "translate3d(0," + (-this.rocketY * scaleY).toFixed(2) + "px,0)";
    if (stack) {
      stack.style.transform = rise;
      stack.style.opacity = (this.phase === "linger" && this.rocketY * scaleY > this._wrapH * 0.5) ? "0" : "1";
    }
    // FX stays in world/plate space — no rise

    const sitCss = (seat.sitY / lb.nh) * lb.height;
    const stackH = this._stackHcss;
    const nozzleLocalY = lb.top + sitCss - this.rocketY * scaleY;
    const rocketTopLocal = nozzleLocalY - stackH;
    const wrapH = this._wrapH || 390;
    const desiredTop = wrapH * 0.10;
    let targetCam = desiredTop - rocketTopLocal;
    if (!this.released || this.climbT < 0.2) targetCam = 0;
    if (this.phase !== "linger") {
      targetCam = Math.max(0, targetCam);
      this.camY = lerp(this.camY, targetCam, 0.2);
      if (this.released && this.climbT >= 0.2) {
        const topAfter = rocketTopLocal + this.camY;
        if (topAfter < wrapH * 0.05) this.camY = wrapH * 0.05 - rocketTopLocal;
        if (topAfter > wrapH * 0.16) this.camY = Math.max(0, wrapH * 0.10 - rocketTopLocal);
        const maxCam = Math.max(0, lb.top + lb.height * 0.75);
        if (this.camY > maxCam) this.camY = maxCam;
        if (this.camY < 0) this.camY = 0;
      } else {
        this.camY = 0;
      }
    } else {
      this.camY = lerp(this.camY, 0, 0.12);
    }

    this._shakeX = this.shake ? (this._rand() - 0.5) * 2 * this.shake : 0;
    this._shakeY = this.shake ? (this._rand() - 0.5) * 2 * this.shake : 0;
    if (world) {
      world.style.transform =
        "translate3d(" + this._shakeX.toFixed(2) + "px," + (this.camY + this._shakeY).toFixed(2) + "px,0)";
    }
    // Soften plate top edge into sky extension (≥40px blend)
    const plate = this.getPlateEl && this.getPlateEl();
    if (plate) {
      if (this.camY > 8 && this.phase !== "linger") {
        const fadePx = Math.min(120, 56 + this.camY * 0.22);
        const m = "linear-gradient(to bottom, transparent 0px, #000 " + fadePx.toFixed(0) + "px, #000 100%)";
        plate.style.webkitMaskImage = m;
        plate.style.maskImage = m;
      } else {
        plate.style.webkitMaskImage = "";
        plate.style.maskImage = "";
      }
    }
    this.applyRocketLight();
  };

  LiftoffEngine.prototype.updateCountdown = function (elapsed) {
    const cd = this.getCountdownEl();
    if (!cd) return;
    if (elapsed < 5) {
      const n = Math.max(0, Math.ceil(5 - elapsed));
      this.countdown = n;
      cd.style.display = "block";
      cd.textContent = n > 0 ? ("T-" + n) : "T-0";
    } else if (elapsed < 5.6) {
      cd.style.display = "block";
      cd.textContent = "LIFTOFF";
    } else {
      cd.style.display = "none";
    }
  };

  LiftoffEngine.prototype.tickSim = function (dt) {
    if (!this.running) return;
    if (dt > 0.05) dt = 0.05;
    this._simTime += dt;
    this.perf.push(dt * 1000);
    if (this.perf.length > 300) this.perf.shift();
    try { global.__liftoffPerf = this.perf; } catch (_) {}

    if (!this._fxReady && !this.prepareFx()) return;

    const elapsed = this._simTime;
    const seat = this.getSeat() || {
      cx: 640, sitY: 548, deckY: 548, nozzleY: 548, smokeY: 548,
      width: 140, nozzles: [0], nw: 1280, nh: 720, targetH: 500,
    };
    seat.nw = this._lb.nw; seat.nh = this._lb.nh;

    this.updateCountdown(elapsed);
    try {
      global.__liftoffState = {
        elapsed: elapsed, phase: this.phase, countdown: this.countdown,
        ignited: this.ignited, released: this.released,
        rocketY: this.rocketY, camY: this.camY, climbT: this.climbT,
        lingerT: this.lingerT, flame: this.flameIntensity,
        app: "liftoff27",
      };
    } catch (_) {}

    if (this.releaseFlash > 0) this.releaseFlash = Math.max(0, this.releaseFlash - dt / 0.18);

    if (elapsed < 5) {
      this.phase = "countdown";
      if (elapsed >= 3 && !this.ignited) {
        this.ignited = true;
        this.shake = 5;
        this.vibrate([50, 30, 50]);
        this.setAudioLevel(0.28);
      }
      if (this.ignited) {
        this.phase = "burn";
        this.shake = lerp(this.shake, 7, 0.1);
        this.flameIntensity = lerp(this.flameIntensity, 0.55 + (elapsed - 3) * 0.35, 0.2);
        this.emitGroundSmoke(seat, 0.5 + this.flameIntensity);
        this.setAudioLevel(0.28 + (elapsed - 3) * 0.1);
      }
    } else {
      if (!this.released) {
        this.released = true;
        this.phase = "hold";
        this.climbT = 0;
        this.shake = 11;
        this.releaseFlash = 1;
        this.vibrate([90, 40, 70, 40, 90]);
        this.setAudioLevel(0.52);
      }
      const since = elapsed - 5;
      if (since < 0.5) {
        this.phase = "hold";
        this.rocketY = since * 6;
        this.shake = lerp(this.shake, 8, 0.12);
        this.flameIntensity = lerp(this.flameIntensity, 1.15, 0.15);
        this.emitGroundSmoke(seat, 1.1);
        this.emitTrail(seat);
      } else if (since < 0.5 + 2.6) {
        this.phase = "climb";
        this.climbT = since - 0.5;
        const a = 200;
        let y = 3 + a * this.climbT * this.climbT;
        const scaleY = this._lb.height / this._lb.nh;
        const wrapH = this._wrapH || 390;
        const sitCss = (seat.sitY / this._lb.nh) * this._lb.height;
        const maxCam = Math.max(0, this._lb.top + this._lb.height * 0.75);
        const maxRiseTip = this._lb.top + sitCss - this._stackHcss + maxCam - wrapH * 0.06;
        if (maxRiseTip > 0) y = Math.min(y, maxRiseTip / scaleY);
        this.rocketY = y;
        this.shake = Math.max(0, this.shake - 9 * dt);
        this.flameIntensity = lerp(this.flameIntensity, 1.35, 0.08);
        this.emitTrail(seat);
        if (this.climbT < 1.2) this.emitGroundSmoke(seat, Math.max(0.3, 1.0 - this.climbT * 0.5));
        this.setAudioLevel(clamp(0.5 - this.climbT * 0.12, 0.06, 0.5));
      } else {
        if (this.phase !== "linger") {
          this.phase = "linger";
          this.lingerT = 0;
        }
        this.lingerT += dt;
        this.shake = Math.max(0, this.shake - 12 * dt);
        this.flameIntensity = Math.max(0, this.flameIntensity - dt * 0.8);
        if (this.lingerT > 0.05 && (this._rng & 3) === 0) this.emitGroundSmoke(seat, 0.35);
        this.setAudioLevel(0.08);
        if (this.lingerT > 2.8) {
          this.running = false;
          this.stopAudio(false);
          if (this.onPerfSample) this.onPerfSample(this.perf.slice());
          this.onComplete();
          return;
        }
      }
    }

    this.updateParticles(dt);
    this.drawFx(seat);
    // Parallax every other tick — big win on mobile
    if ((this._rng & 1) === 0) this.drawParallax();
    this.applyTransforms(seat);
  };

  LiftoffEngine.prototype.tick = function (ts) {
    if (!this.running || this.captureMode) return;
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    this.tickSim(dt);
    if (this.running) this.raf = requestAnimationFrame(this._boundTick);
  };

  LiftoffEngine.prototype.start = function () {
    this.reset();
    this._boundTick = this.tick.bind(this);
    this.running = true;
    this.t0 = performance.now();
    this.lastTs = 0;
    this._simTime = 0;
    this.phase = "countdown";
    this._rng = this.captureMode ? 12345 : ((Date.now() & 0xffff) || 1);
    this.prepareFx();
    this.ensureAudio();
    if (this.audio && this.audio.ctx.state === "suspended") {
      this.audio.ctx.resume().catch(function () {});
    }
    this.setMuted(this.audioMuted);
    this.vibrate(15);
    try {
      global.__liftoffState = {
        elapsed: 0, phase: this.phase, countdown: 5,
        ignited: false, released: false, rocketY: 0, camY: 0,
        climbT: 0, lingerT: 0, flame: 0, app: "liftoff27",
      };
    } catch (_) {}
    if (!this.captureMode) {
      this.raf = requestAnimationFrame(this._boundTick);
    } else {
      // Draw first frame at t=0 for capture
      const seat = this.getSeat && this.getSeat();
      if (seat && this._fxReady) {
        this.drawFx(seat);
        this.drawParallax();
        this.applyTransforms(seat);
      }
    }
  };

  LiftoffEngine.prototype.startCapture = function () {
    this.captureMode = true;
    this.start();
  };

  LiftoffEngine.prototype.captureStep = function (dt) {
    if (!this.running) return;
    this.tickSim(dt || 1 / 60);
  };

  global.RocketBayLiftoff = { LiftoffEngine: LiftoffEngine, TOD_GLOW: TOD_GLOW };
})(typeof window !== "undefined" ? window : globalThis);
