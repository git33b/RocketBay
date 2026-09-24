/**
 * Rocket Bay — heavy liftoff feel (LIFTOFF-FEEL v3)
 * Big pixel plumes, camera follow (rocket stays framed), linger smoke, no mid-seq resize.
 */
(function (global) {
  "use strict";

  const POOL = 580;

  const TOD_GLOW = {
    "02": {
      flame: ["#fff8e8", "#ffe090", "#ff9a28", "#e05000", "#a02800"],
      smoke: ["#e8d8c8", "#b0a090", "#786858", "#4a4038", "#2a2420"],
      pad: "#ffb060", tower: "#ff9030", topHint: "#f0a878",
    },
    "03": {
      flame: ["#ffe8d0", "#ffb060", "#ff6020", "#c02808", "#801008"],
      smoke: ["#d0b0a0", "#907060", "#5a4038", "#382820", "#1c1410"],
      pad: "#ff6030", tower: "#ff4010", topHint: "#c85840",
    },
    "04": {
      flame: ["#fff4cc", "#ffc040", "#ff8010", "#e04000", "#a02000"],
      smoke: ["#a0b0c0", "#687888", "#405060", "#283040", "#141820"],
      pad: "#ff8820", tower: "#ff7010", topHint: "#0a1020",
    },
    "05": {
      flame: ["#fffce8", "#ffe8a0", "#ffb040", "#f07010", "#c04800"],
      smoke: ["#e8ecef", "#b8 greys", "#989ca0", "#686c70", "#404448"],
      pad: "#ffc060", tower: "#ffa030", topHint: "#5aa0d8",
    },
  };
  // fix typo in 05 smoke
  TOD_GLOW["05"].smoke = ["#e8ecef", "#c0c4c8", "#989ca0", "#686c70", "#404448"];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function snap(v, cell) { return Math.round(v / cell) * cell; }

  function makePool(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = {
        alive: false, kind: 0,
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, max: 1, size: 4, color: 0, cell: 4,
        attach: 0, // 1 = follow nozzle (trail)
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
    this.getPlateEl = opts.getPlateEl || function () { return null; };
    this.onComplete = opts.onComplete || function () {};
    this.onPerfSample = opts.onPerfSample || null;

    this.particles = makePool(POOL);
    this.running = false;
    this.raf = 0;
    this.t0 = 0;
    this.phase = "idle";
    this.countdown = 5;
    this.rocketY = 0; // native px up
    this.camY = 0; // css px — world translateY
    this.shake = 0;
    this.ignited = false;
    this.released = false;
    this.climbT = 0;
    this.lingerT = 0;
    this.perf = [];
    this.lastTs = 0;
    this.audio = null;
    this.audioMuted = true;
    this._targetVol = 0;

    // Precomputed / cached (no mid-sequence resize)
    this._lb = null;
    this._dpr = 1;
    this._cell = 4;
    this._fxReady = false;
    this._skyTop = "#4a90d0";
    this._stackHcss = 200; // approx stack content height in css px
    this._plumeH = 80;
    this._shakeX = 0;
    this._shakeY = 0;
    this._rng = 1;
  }

  LiftoffEngine.prototype._rand = function () {
    // cheap LCG — no Math.random allocation pressure difference, but stable
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
    this.perf.length = 0;
    this._fxReady = false;
    this._shakeX = 0;
    this._shakeY = 0;
    const p = this.particles;
    for (let i = 0; i < p.length; i++) p[i].alive = false;
    const stack = this.getStackEl();
    if (stack) {
      stack.style.transform = "";
      stack.classList.remove("liftoff");
    }
    const world = this.getWorldEl();
    if (world) world.style.transform = "translate3d(0,0,0)";
    const sky = this.getSkyEl();
    if (sky) {
      sky.style.opacity = "0";
      sky.style.background = "transparent";
      sky.style.transform = "";
    }
    const cd = this.getCountdownEl();
    if (cd) {
      cd.style.display = "none";
      cd.textContent = "";
      cd.className = "countdownHud";
    }
    const fx = this.getFxCanvas();
    if (fx) {
      const ctx = this._ctx || fx.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, fx.width, fx.height);
      fx.style.display = "none";
      fx.style.transform = "";
    }
    const plate = this.getPlateEl();
    if (plate) { plate.style.webkitMaskImage = ""; plate.style.maskImage = ""; }
    this.stopAudio(true);
  };

  LiftoffEngine.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  LiftoffEngine.prototype.samplePlateTop = function () {
    const plate = this.getPlateEl();
    const tod = this.getTodId();
    const hint = (TOD_GLOW[tod] || TOD_GLOW["05"]).topHint;
    if (!plate || !plate.naturalWidth) return hint;
    try {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 8;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(plate, 0, 0, plate.naturalWidth, 24, 0, 0, 64, 8);
      const d = ctx.getImageData(0, 0, 64, 8).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      if (!n) return hint;
      return "rgb(" + ((r / n) | 0) + "," + ((g / n) | 0) + "," + ((b / n) | 0) + ")";
    } catch (_) {
      return hint;
    }
  };

  LiftoffEngine.prototype.prepareFx = function () {
    const lb = this.getLetterbox();
    if (!lb) return false;
    const wrap = this.getWorldEl();
    const wrapW = (wrap && wrap.clientWidth) || window.innerWidth || 844;
    const wrapH = (wrap && wrap.clientHeight) || window.innerHeight || 390;
    this._lb = {
      left: lb.left, top: lb.top, width: lb.width, height: lb.height,
      scale: lb.scale, nw: lb.nw, nh: lb.nh,
    };
    this._wrapW = wrapW;
    this._wrapH = wrapH;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._cell = Math.max(6, Math.round(lb.width / 95));
    const seat = this.getSeat() || { width: 120 };
    const th = (this.getSeat() && this.getSeat().targetH) || 500;
    this._stackHcss = Math.max(140, (th / lb.nh) * lb.height);
    this._plumeH = Math.round(this._stackHcss * 0.32);
    this._skyTop = this.samplePlateTop();

    const canvas = this.getFxCanvas();
    if (!canvas) return false;
    // Full plateWrap coverage so climbing nozzle never leaves the FX surface
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
    if (!this._ctx || this._ctx.canvas !== canvas) {
      this._ctx = canvas.getContext("2d", { alpha: true });
    }
    const ctx = this._ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this._fxReady = true;
    this._skyFadeBucket = -1;
    this._lastAudioLevel = -1;
    this._lastRise = "";
    this._lastCamKey = "";

    const sky = this.getSkyEl();
    if (sky) {
      sky.style.opacity = "1";
      sky.style.top = "-120%";
      sky.style.bottom = "-30%";
      sky.style.left = "0";
      sky.style.right = "0";
      sky.style.position = "absolute";
      // Transparent star overlay (painted ABOVE gradient) so pan never reads as flat black
      if (!this._starBg) {
        const sc = document.createElement("canvas");
        sc.width = 256; sc.height = 512;
        const sctx = sc.getContext("2d");
        sctx.clearRect(0, 0, 256, 512);
        for (let i = 0; i < 160; i++) {
          const x = (this._rand() * 256) | 0;
          const y = (this._rand() * 512) | 0;
          const r = this._rand() < 0.18 ? 2 : 1;
          sctx.globalAlpha = 0.45 + this._rand() * 0.5;
          sctx.fillStyle = "#e8f0ff";
          sctx.fillRect(x, y, r, r);
        }
        this._starBg = sc.toDataURL("image/png");
      }
      const tod = this.getTodId();
      const nightish = tod === "02" || tod === "04";
      const baseGrad =
        "linear-gradient(to bottom, " +
        this._skyTop + " 0%, " +
        this._skyTop + " 70%, " +
        this._mixSky(this._skyTop, nightish ? "#0a1020" : this._skyTop, 0.2) + " 90%, " +
        this._mixSky(this._skyTop, nightish ? "#070b14" : this._mixSky(this._skyTop, "#2a4a6a", 0.35), 0.45) + " 100%)";
      // stars first = on top of opaque gradient
      sky.style.background = nightish
        ? ("url(" + this._starBg + ") center / 256px 512px repeat, " + baseGrad)
        : baseGrad;
    }
    return true;
  };

  LiftoffEngine.prototype._mixSky = function (a, b, t) {
    function parse(c) {
      if (c[0] === "#") {
        const h = c.slice(1);
        const n = h.length === 3
          ? [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)]
          : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
        return n;
      }
      const m = c.match(/(\d+)/g);
      return m ? [ +m[0], +m[1], +m[2] ] : [20, 30, 50];
    }
    const A = parse(a), B = parse(b);
    const r = (A[0] + (B[0]-A[0])*t) | 0;
    const g = (A[1] + (B[1]-A[1])*t) | 0;
    const bl = (A[2] + (B[2]-A[2])*t) | 0;
    return "rgb(" + r + "," + g + "," + bl + ")";
  };

  /* ---------- audio ---------- */
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
    noise.buffer = buf;
    noise.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 200;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.4;
    noise.connect(filt); filt.connect(nGain); nGain.connect(master);
    noise.start();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 40;
    const oFilt = ctx.createBiquadFilter();
    oFilt.type = "lowpass";
    oFilt.frequency.value = 90;
    const oGain = ctx.createGain();
    oGain.gain.value = 0.14;
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
    if (Math.abs(next - (this._lastAudioLevel || 0)) < 0.03 && this._targetVol === next) {
      this._targetVol = next;
      return;
    }
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

  /* ---------- particles ---------- */
  LiftoffEngine.prototype.spawn = function (kind, x, y, vx, vy, life, size, color, attach) {
    const p = this.particles;
    for (let i = 0; i < p.length; i++) {
      if (!p[i].alive) {
        const o = p[i];
        o.alive = true;
        o.kind = kind;
        o.x = x; o.y = y; o.vx = vx; o.vy = vy;
        o.life = 0; o.max = life;
        o.size = size; o.color = color;
        o.cell = this._cell;
        o.attach = attach || 0;
        return o;
      }
    }
    return null;
  };

  /** Nozzle position in FX-canvas local css px (letterbox-relative). */
  LiftoffEngine.prototype.nozzleLocal = function (seat) {
    // Pad-seat coords in plateWrap space. FX canvas shares stack's translate3d(-rocketY),
    // so plume stays glued under the nozzle without baking rocketY into draw coords.
    const lb = this._lb;
    const ny = (seat.nozzleY != null ? seat.nozzleY : seat.sitY);
    const sx = lb.left + (seat.cx / lb.nw) * lb.width;
    const sy = lb.top + (ny / lb.nh) * lb.height;
    return { x: sx, y: sy };
  };

  /** Deck / smoke origin in FX-canvas css px (does not rise with rocket). */
  LiftoffEngine.prototype.deckLocal = function (seat) {
    const lb = this._lb;
    const dy = seat.smokeY != null ? seat.smokeY
      : (seat.deckY != null ? seat.deckY : seat.sitY);
    return {
      x: lb.left + (seat.cx / lb.nw) * lb.width,
      y: lb.top + (dy / lb.nh) * lb.height,
    };
  };

  LiftoffEngine.prototype.emitBurn = function (seat, intensity) {
    const lb = this._lb;
    const cell = this._cell;
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    const nz = this.nozzleLocal(seat);
    const scale = lb.width / lb.nw;
    const plumeW = Math.max(cell * 6, seat.width * scale * 0.7);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const nFire = Math.max(10, Math.round(18 * intensity));
    const nSmoke = Math.max(10, Math.round(16 * intensity));

    for (let n = 0; n < nozzles.length; n++) {
      const nx = nz.x + nozzles[n] * scale;
      for (let i = 0; i < nFire; i++) {
        const side = (this._rand() - 0.5) * plumeW;
        this.spawn(
          1,
          nx + side * 0.4,
          nz.y + this._rand() * cell,
          (this._rand() - 0.5) * 70,
          90 + this._rand() * 160,
          0.22 + this._rand() * 0.35,
          cell + (this._rand() < 0.45 ? cell : 0),
          (this._rand() * pal.flame.length) | 0,
          1 // attach — re-base each frame relative? we emit every frame at nozzle
        );
      }
      const deck = this.deckLocal(seat);
      // On pad: smoke along deckY; climbing: smoke near nozzle
      const smokeY = (this.phase === "climb") ? (nz.y + cell * 2) : deck.y;
      for (let i = 0; i < nSmoke; i++) {
        const dir = this._rand() < 0.5 ? -1 : 1;
        this.spawn(
          2,
          nx + (this._rand() - 0.5) * plumeW * 0.3,
          smokeY + (this._rand() - 0.3) * cell * 2,
          dir * (50 + this._rand() * 120),
          -5 + this._rand() * 25,
          1.2 + this._rand() * 1.8,
          cell * 2,
          (this._rand() * pal.smoke.length) | 0,
          0
        );
      }
    }
  };

  LiftoffEngine.prototype.emitTrail = function (seat) {
    // Continuous exhaust under climbing rocket (local to current nozzle)
    this.emitBurn(seat, 1.25);
  };

  LiftoffEngine.prototype.emitPadLinger = function (seat) {
    const lb = this._lb;
    const cell = this._cell;
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    // Deck line from pad-config (smoke stays on deck, not on climbing nozzle)
    const deck = this.deckLocal(seat);
    const sx = deck.x;
    const sy = deck.y;
    const plumeW = Math.max(cell * 10, seat.width * (lb.width / lb.nw) * 1.2);
    for (let i = 0; i < 12; i++) {
      const dir = this._rand() < 0.5 ? -1 : 1;
      this.spawn(
        2,
        sx + (this._rand() - 0.5) * plumeW,
        sy + this._rand() * cell * 3,
        dir * (20 + this._rand() * 60),
        -15 - this._rand() * 25,
        2.8 + this._rand() * 2.2,
        cell * 2 + (this._rand() < 0.5 ? cell : 0),
        (this._rand() * pal.smoke.length) | 0,
        0
      );
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
        o.vx *= 0.988;
        o.vy -= 12 * dt;
      } else if (o.kind === 1) {
        o.vy += 50 * dt;
        o.vx *= 0.96;
      }
    }
  };

  /** Draw a solid pixel plume under the nozzle (guaranteed visible). */
  LiftoffEngine.prototype.drawSolidPlume = function (ctx, seat, pal) {
    const lb = this._lb;
    const cell = this._cell;
    const nz = this.nozzleLocal(seat);
    const scale = lb.width / lb.nw;
    const plumeW = Math.max(cell * 7, seat.width * scale * 0.65);
    const plumeH = this._plumeH;
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const flicker = 0.85 + 0.15 * Math.sin(performance.now() * 0.04);

    for (let n = 0; n < nozzles.length; n++) {
      const nx = nz.x + nozzles[n] * scale;
      const cols = Math.max(3, Math.round(plumeW / cell));
      const rows = Math.max(10, Math.round(plumeH / cell));
      for (let row = 0; row < rows; row++) {
        const t = row / rows;
        const rowW = Math.max(2, Math.round(cols * (1 - t * 0.5) * flicker));
        const y = snap(nz.y + row * cell, cell);
        const ci = Math.min(pal.flame.length - 1, (t * (pal.flame.length - 1) + this._rand() * 0.25) | 0);
        ctx.globalAlpha = (1 - t * 0.5);
        ctx.fillStyle = pal.flame[ci];
        const x0 = snap(nx - (rowW * cell) / 2, cell);
        for (let c = 0; c < rowW; c++) {
          if (this._rand() < 0.03) continue;
          ctx.fillRect(x0 + c * cell, y, cell, cell);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  LiftoffEngine.prototype.drawPadGlow = function (ctx, seat, pal, strength, climbMode) {
    const lb = this._lb;
    const cell = this._cell;
    const nz = this.nozzleLocal(seat);
    const deck = this.deckLocal(seat);
    const scale = lb.width / lb.nw;
    const gw = Math.max(cell * 8, seat.width * scale * 1.05);
    // Glow sits on configured deck line while on pad; follows nozzle when climbing
    const glowY = climbMode ? nz.y : deck.y;
    const gy = snap(glowY + cell, cell);
    const gx = snap(nz.x - gw / 2, cell);
    const rows = climbMode ? 4 : 8;
    for (let row = 0; row < rows; row++) {
      ctx.globalAlpha = strength * (1 - row / rows) * (climbMode ? 0.35 : 0.55);
      ctx.fillStyle = pal.pad;
      ctx.fillRect(gx - row * cell * 0.6, gy + row * cell, gw + row * cell * 1.2, cell);
    }
    // No tower wash bars — they read as brown ladder artifacts under CoE review.
    ctx.globalAlpha = 1;
  };

  LiftoffEngine.prototype.drawFx = function (seat) {
    if (!this._fxReady) return;
    const ctx = this._ctx || this.getFxCanvas().getContext("2d");
    this._ctx = ctx;
    const lb = this._lb;
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this._wrapW || lb.width, this._wrapH || lb.height);

    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];

    if (this.ignited) {
      const onPad = this.phase === "burn" || this.phase === "hold" || (this.phase === "climb" && this.climbT < 0.35) || this.phase === "linger";
      const glowStr = this.phase === "linger" ? 0.35 : (this.phase === "climb" ? 0.45 : 1.0);
      if (onPad || this.phase === "climb") this.drawPadGlow(ctx, seat, pal, glowStr, this.phase === "climb");
      if (this.phase !== "linger") this.drawSolidPlume(ctx, seat, pal);
    }

    const p = this.particles;
    const cell = this._cell;
    for (let i = 0; i < p.length; i++) {
      const o = p[i];
      if (!o.alive) continue;
      const t = o.life / o.max;
      const colors = o.kind === 2 ? pal.smoke : pal.flame;
      ctx.globalAlpha = o.kind === 2 ? (1 - t) * 0.9 : (1 - t * t);
      ctx.fillStyle = colors[o.color % colors.length];
      const px = snap(o.x, cell);
      const py = snap(o.y, cell);
      ctx.fillRect(px, py, o.size, o.size);
    }
    ctx.globalAlpha = 1;
  };

  /* ---------- camera / rocket ---------- */
  LiftoffEngine.prototype.applyTransforms = function (seat) {
    const lb = this._lb;
    const stack = this.getStackEl();
    const world = this.getWorldEl();
    const sky = this.getSkyEl();
    if (!lb) return;

    const scaleY = lb.height / lb.nh;
    // Rocket rises in world space
    const rise = "translate3d(0," + (-this.rocketY * scaleY).toFixed(2) + "px,0)";
    if (stack) {
      if (rise !== this._lastRise) stack.style.transform = rise;
      // Hide stack once it's well off the top during linger (avoids black canvas rect)
      stack.style.opacity = (this.phase === "linger" && this.rocketY * scaleY > this._wrapH * 0.6) ? "0" : "1";
    }
    const fx = this.getFxCanvas();
    if (fx) {
      if (this.phase === "linger") {
        if (this._lastRise !== "L") { fx.style.transform = "translate3d(0,0,0)"; this._lastRise = "L"; }
      } else if (rise !== this._lastRise) {
        fx.style.transform = rise;
        this._lastRise = rise;
      }
    }

    // Camera: keep rocket roughly in upper-middle of the letterbox/viewport.
    // Nozzle local Y in plateWrap (before cam): lb.top + sitCss - rocketY*scaleY
    // After world camY: nozzleViewportY = that + camY
    // Want nozzle around 58% of letterbox height from top of plateWrap content,
    // and rocket top never above ~8% of viewport.
    const sitCss = (seat.sitY / lb.nh) * lb.height;
    const stackH = this._stackHcss;
    const nozzleLocalY = lb.top + sitCss - this.rocketY * scaleY;
    const rocketTopLocal = nozzleLocalY - stackH;

    // Stack ≈0.7× viewport — must frame TIP (not nozzle mid-frame) or tip clips.
    // Tip ~10% from top → nozzle ~80%; solid plume still reads in lower band.
    const wrapH = plateWrapHeight(this);
    const desiredTop = wrapH * 0.10;
    let targetCam = desiredTop - rocketTopLocal;
    if (!this.released || this.climbT < 0.2) targetCam = 0;
    if (this.phase !== "linger") {
      targetCam = Math.max(0, targetCam);
      this.camY = lerp(this.camY, targetCam, 0.22);
      if (this.released && this.climbT >= 0.2) {
        const topAfter = rocketTopLocal + this.camY;
        if (topAfter < wrapH * 0.06) this.camY = wrapH * 0.06 - rocketTopLocal;
        if (topAfter > wrapH * 0.18) this.camY = Math.max(0, wrapH * 0.10 - rocketTopLocal);
        const maxCam = Math.max(0, this._lb.top + this._lb.height * 0.72);
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
      const camKey = this._shakeX.toFixed(1) + "," + (this.camY + this._shakeY).toFixed(1);
      if (camKey !== this._lastCamKey) {
        this._lastCamKey = camKey;
        world.style.transform =
          "translate3d(" + this._shakeX.toFixed(2) + "px," + (this.camY + this._shakeY).toFixed(2) + "px,0)";
      }
    }

    if (sky) {
      const fade = clamp(this.camY / (this._wrapH * 1.15), 0, 1);
      const bucket = (fade * 20) | 0;
      if (bucket !== this._skyFadeBucket) {
        this._skyFadeBucket = bucket;
        const tod = this.getTodId();
        const nightish = tod === "02" || tod === "04";
        const deep = this._mixSky(this._skyTop, nightish ? "#050814" : "#1a3355", 0.4 + fade * 0.35);
        const mid = this._mixSky(this._skyTop, nightish ? "#0a1220" : this._skyTop, fade * 0.3);
        const hold = Math.round(lerp(68, 40, fade));
        const midPct = Math.round(lerp(84, 62, fade));
        sky.style.opacity = "1";
        const grad =
          "linear-gradient(to bottom," +
          this._skyTop + " 0%," +
          this._skyTop + " " + hold + "%," +
          mid + " " + midPct + "%," +
          deep + " 100%)";
        sky.style.background = (nightish && this._starBg)
          ? ("url(" + this._starBg + ") center / 256px 512px repeat, " + grad)
          : grad;
      }
    }

    // Soften plate top edge into skyExt (kills hard rectangular seam)
    const plate = this.getPlateEl && this.getPlateEl();
    if (plate) {
      if (this.camY > 12 && this.phase !== "linger") {
        const fadePx = Math.min(48, 12 + this.camY * 0.12);
        plate.style.webkitMaskImage =
          "linear-gradient(to bottom, transparent 0px, #000 " + fadePx.toFixed(0) + "px, #000 100%)";
        plate.style.maskImage = plate.style.webkitMaskImage;
      } else {
        plate.style.webkitMaskImage = "";
        plate.style.maskImage = "";
      }
    }
  };

  function plateWrapHeight(eng) {
    const w = eng.getWorldEl();
    if (w && w.clientHeight) return w.clientHeight;
    return window.innerHeight || 390;
  }

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

  LiftoffEngine.prototype.tick = function (ts) {
    if (!this.running) return;
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    this.perf.push(dt * 1000);
    if (this.perf.length > 300) this.perf.shift();
    try { global.__liftoffPerf = this.perf; } catch (_) {}

    if (!this._fxReady && !this.prepareFx()) {
      this.raf = requestAnimationFrame(this._boundTick);
      return;
    }

    const elapsed = (ts - this.t0) / 1000;
    const seat = this.getSeat() || { cx: 640, sitY: 548, deckY: 548, nozzleY: 548, smokeY: 548, width: 140, nozzles: [0], nw: 1280, nh: 720 };
    seat.nw = this._lb.nw; seat.nh = this._lb.nh;

    this.updateCountdown(elapsed);
    try {
      global.__liftoffState = {
        elapsed: elapsed,
        phase: this.phase,
        countdown: this.countdown,
        ignited: this.ignited,
        released: this.released,
        rocketY: this.rocketY,
        camY: this.camY,
        climbT: this.climbT,
        lingerT: this.lingerT,
        app: "liftoff20",
      };
    } catch (_) {}

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
        // Ramp hard so T-2 plume is clearly ~0.25–0.4× stack
        const inten = 1.05 + (elapsed - 3) * 0.35;
        this.emitBurn(seat, inten);
        this.setAudioLevel(0.28 + (elapsed - 3) * 0.1);
      }
    } else {
      if (!this.released) {
        this.released = true;
        this.phase = "hold";
        this.climbT = 0;
        this.shake = 11;
        this.vibrate([90, 40, 70, 40, 90]);
        this.setAudioLevel(0.52);
      }
      const since = elapsed - 5;
      if (since < 0.5) {
        this.phase = "hold";
        this.rocketY = since * 6;
        this.shake = lerp(this.shake, 8, 0.12);
        this.emitBurn(seat, 1.4);
      } else if (since < 0.5 + 2.4) {
        this.phase = "climb";
        this.climbT = since - 0.5;
        const a = 200;
        let y = 3 + a * this.climbT * this.climbT;
        // Cap rise so tip stays >=8% and nozzle <=72% at maxCam
        const scaleY = this._lb.height / this._lb.nh;
        const wrapH = this._wrapH || 390;
        const sitCss = (seat.sitY / this._lb.nh) * this._lb.height;
        const maxCam = Math.max(0, this._lb.top + this._lb.height * 0.62);
        const maxRiseTip = this._lb.top + sitCss - this._stackHcss + maxCam - wrapH * 0.08;
        if (maxRiseTip > 0) y = Math.min(y, maxRiseTip / scaleY);
        this.rocketY = y;
        this.shake = Math.max(0, this.shake - 9 * dt);
        this.emitTrail(seat);
        // Reinforce solid trail every frame via emitBurn inside emitTrail
        if (this.climbT < 1.0 && (this._rng & 3) === 0) this.emitPadLinger(seat);
        this.setAudioLevel(clamp(0.5 - this.climbT * 0.12, 0.06, 0.5));
      } else {
        // Linger: ease camera back, pad smoke visible
        if (this.phase !== "linger") {
          this.phase = "linger";
          this.lingerT = 0;
        }
        this.lingerT += dt;
        this.shake = Math.max(0, this.shake - 12 * dt);
        // Spread linger smoke — skip first ~2 frames to avoid phase-edge hitch
        if (this.lingerT > 0.04 && (this._rng & 3) === 0) this.emitPadLinger(seat);
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
    this.applyTransforms(seat);

    this.raf = requestAnimationFrame(this._boundTick);
  };

  LiftoffEngine.prototype.start = function () {
    this.reset();
    this._boundTick = this.tick.bind(this);
    this.running = true;
    this.t0 = performance.now();
    this.lastTs = 0;
    this.phase = "countdown";
    this._rng = (Date.now() & 0xffff) || 1;
    this.prepareFx(); // preload canvas size + sky sample before first ticks
    this.ensureAudio();
    if (this.audio && this.audio.ctx.state === "suspended") {
      this.audio.ctx.resume().catch(function () {});
    }
    this.setMuted(this.audioMuted);
    this.vibrate(15);
    this.raf = requestAnimationFrame(this._boundTick);
  };

  global.RocketBayLiftoff = { LiftoffEngine: LiftoffEngine, TOD_GLOW: TOD_GLOW };
})(typeof window !== "undefined" ? window : globalThis);
