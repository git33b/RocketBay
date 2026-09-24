/**
 * Rocket Bay — LIFTOFF-FEEL v2 (CoE rebuild)
 * Layered flame, ground+trail smoke, cover mapping, parallax, light interaction.
 * Timing preserved: T-5 countdown, T-2 ignition, 0.5s hold, t² climb.
 */
(function (global) {
  "use strict";

  const POOL_GROUND = 420;
  const POOL_TRAIL = 280;
  const BUF_DIV = 2.5; // ~display/2.5 nearest upscale

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
      sky._skyCanvas = null;
    }
    const cd = this.getCountdownEl();
    if (cd) { cd.style.display = "none"; cd.textContent = ""; }
    const fx = this.getFxCanvas();
    if (fx) {
      fx.style.display = "none";
      fx.style.transform = "";
    }
    const plateEl = this.getPlateEl && this.getPlateEl();
    if (plateEl) {
      plateEl.style.display = "";
      plateEl.style.visibility = "";
      plateEl.style.opacity = "1";
      plateEl.style.webkitMaskImage = "";
      plateEl.style.maskImage = "";
    }
    if (this._tallSkyCanvas) {
      this._tallSkyCanvas.style.display = "none";
    }
    this._fireField = null;
    this._fireTrail = null;
    const px = this.getParallaxEl();
    if (px) { px.style.display = "none"; }
    this.stopAudio(true);
  };

  LiftoffEngine.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /* ---------- tall sky: [mirrored extension][exact plate] — sole backdrop in liftoff ---------- */
  LiftoffEngine.prototype.buildTallSky = function () {
    const plate = this.getPlateEl();
    const tod = this.getTodId();
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    if (!plate || !plate.naturalWidth) return null;
    const nw = plate.naturalWidth;
    const nh = plate.naturalHeight;
    const N = 120; // mirror band: top ~120 rows of plate (actual pixels)
    const FALL = 128; // wide cosine falloff across each tile edge
    const ext = Math.round(nh * 2.8);
    const c = document.createElement("canvas");
    c.width = nw;
    c.height = nh + ext;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    // Exact full plate at bottom of tall canvas
    ctx.drawImage(plate, 0, ext);

    // Capture top N rows as the mirror source (actual plate pixels)
    const band = document.createElement("canvas");
    band.width = nw;
    band.height = N;
    const bctx = band.getContext("2d", { willReadFrequently: true });
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(plate, 0, 0, nw, Math.min(N, nh), 0, 0, nw, N);
    let bandData;
    try { bandData = bctx.getImageData(0, 0, nw, N).data; } catch (e) {
      console.warn("tallSky band read failed", e);
      bandData = null;
    }

    // Cloud palette from band for day parallax (optional)
    this._cloudPalette = [[232, 238, 244], [210, 220, 230], [245, 248, 252]];
    if (bandData) {
      const clouds = [];
      for (let i = 0; i < bandData.length; i += 28) {
        const r = bandData[i], g = bandData[i + 1], b = bandData[i + 2], a = bandData[i + 3];
        if (a > 200 && r > 170 && g > 180 && b > 190 && r + g + b > 560) clouds.push([r, g, b]);
      }
      if (clouds.length) this._cloudPalette = clouds;
    }

    function parseDeep(col) {
      if (col && col[0] === "#") {
        const h = col.slice(1);
        if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      }
      return [6, 10, 22];
    }
    const deep = parseDeep(pal.deep);

    // Fill extension by repeated vertical mirror of band (actual pixels)
    // Layout: canvas y=0 is deepest space; canvas y=ext-1 is just above plate top.
    // above=0 ⇒ immediately above plate ⇒ band row 0 (plate top).
    const extImg = ctx.createImageData(nw, ext);
    const d = extImg.data;
    if (bandData) {
      const maxCycles = 1; // one mirror tile then soft-hold (minimize flip V-seams)
      for (let y = 0; y < ext; y++) {
        const above = ext - 1 - y; // 0 at junction
        let srcRow;
        if (above < N * maxCycles) {
          const cycle = (above / N) | 0;
          const local = above % N;
          srcRow = (cycle % 2 === 0) ? local : (N - 1 - local);
        } else {
          // Hold the last mirrored edge row (actual plate pixels), later deep-grade softens it
          srcRow = (maxCycles % 2 === 0) ? (N - 1) : 0;
        }
        for (let x = 0; x < nw; x++) {
          const di = (y * nw + x) * 4;
          const si = (srcRow * nw + x) * 4;
          d[di] = bandData[si];
          d[di + 1] = bandData[si + 1];
          d[di + 2] = bandData[si + 2];
          d[di + 3] = 255;
        }
      }
      // 64px cosine falloff at each tile boundary (and at plate junction)
      const boundaries = [];
      for (let b = 0; b <= ext; b += N) boundaries.push(b); // above-distances
      // Also blend at plate junction (above=0) is automatic since band row 0 == plate row 0
      for (let bi = 0; bi < boundaries.length; bi++) {
        const aboveBound = boundaries[bi];
        if (aboveBound === 0) continue; // junction already matches plate
        for (let dy = -FALL; dy <= FALL; dy++) {
          const above = aboveBound + dy;
          if (above < 0 || above >= ext) continue;
          const y = ext - 1 - above;
          // Mix with neighbor across boundary
          const above2 = aboveBound - dy;
          if (above2 < 0 || above2 >= ext) continue;
          const y2 = ext - 1 - above2;
          const t = (dy + FALL) / (FALL * 2); // 0..1
          const wMix = 0.5 - 0.5 * Math.cos(Math.PI * t); // smooth
          // Soften: pull toward average of the two sides
          // Full cosine crossfade across the boundary (hides diagonal flip kink)
          const mix = wMix * (1 - Math.abs(dy) / FALL);
          for (let x = 0; x < nw; x++) {
            const i0 = (y * nw + x) * 4;
            const i1 = (y2 * nw + x) * 4;
            d[i0] = (d[i0] * (1 - mix) + d[i1] * mix) | 0;
            d[i0 + 1] = (d[i0 + 1] * (1 - mix) + d[i1 + 1] * mix) | 0;
            d[i0 + 2] = (d[i0 + 2] * (1 - mix) + d[i1 + 2] * mix) | 0;
          }
        }
      }
      // Force junction rows (above 0..FALL) to exact plate top so no seam vs plate copy
      for (let k = 0; k < FALL; k++) {
        const above = k;
        const y = ext - 1 - above;
        const srcRow = Math.min(N - 1, k);
        const w = 0.5 + 0.5 * Math.cos(Math.PI * (k / FALL)); // 1 at junction → 0
        for (let x = 0; x < nw; x++) {
          const di = (y * nw + x) * 4;
          const si = (srcRow * nw + x) * 4;
          d[di] = (d[di] * (1 - w) + bandData[si] * w) | 0;
          d[di + 1] = (d[di + 1] * (1 - w) + bandData[si + 1] * w) | 0;
          d[di + 2] = (d[di + 2] * (1 - w) + bandData[si + 2] * w) | 0;
        }
      }
    } else {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = deep[0]; d[i + 1] = deep[1]; d[i + 2] = deep[2]; d[i + 3] = 255;
      }
    }

    // Slow grade to deep space across the upper half of the extension (keep near-junction as plate)
    for (let y = 0; y < ext; y++) {
      const above = ext - 1 - y;
      const t = clamp(above / (ext * 0.9), 0, 1);
      // Keep mirrored plate sky for most of the extension; deep only near the top
      if (t < 0.55) continue;
      const u = (t - 0.55) / 0.45;
      const deepW = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, u));
      for (let x = 0; x < nw; x++) {
        const i = (y * nw + x) * 4;
        d[i] = (d[i] * (1 - deepW) + deep[0] * deepW) | 0;
        d[i + 1] = (d[i + 1] * (1 - deepW) + deep[1] * deepW) | 0;
        d[i + 2] = (d[i + 2] * (1 - deepW) + deep[2] * deepW) | 0;
      }
    }

    // Sparse stars only in deep (far from junction)
    if (pal.parallax === "night" || pal.parallax === "dusk" || pal.parallax === "dawn") {
      for (let i = 0; i < 200; i++) {
        const x = (this._rand() * nw) | 0;
        const y = (this._rand() * Math.max(1, ext * 0.55)) | 0;
        const di = (y * nw + x) * 4;
        const a = 0.35 + this._rand() * 0.55;
        d[di] = Math.min(255, d[di] + ((210 * a) | 0));
        d[di + 1] = Math.min(255, d[di + 1] + ((225 * a) | 0));
        d[di + 2] = Math.min(255, d[di + 2] + ((255 * a) | 0));
      }
    }

    ctx.putImageData(extImg, 0, 0);

    // Bit-identical junction: copy exact plate rows (already drawn at y=ext+) into extension bottom
    try {
      const plateTop = ctx.getImageData(0, ext, nw, Math.min(FALL, nh));
      const jH = Math.min(FALL, plateTop.height);
      const junc = ctx.getImageData(0, ext - jH, nw, jH);
      for (let k = 0; k < jH; k++) {
        // plate row k → extension row just above plate (k=0 at junction)
        const srcOff = k * nw * 4;
        const dstOff = (jH - 1 - k) * nw * 4;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * (k / Math.max(1, jH - 1))); // 1 at junction
        for (let x = 0; x < nw; x++) {
          const si = srcOff + x * 4;
          const di = dstOff + x * 4;
          junc.data[di] = (junc.data[di] * (1 - w) + plateTop.data[si] * w) | 0;
          junc.data[di + 1] = (junc.data[di + 1] * (1 - w) + plateTop.data[si + 1] * w) | 0;
          junc.data[di + 2] = (junc.data[di + 2] * (1 - w) + plateTop.data[si + 2] * w) | 0;
          junc.data[di + 3] = 255;
        }
      }
      ctx.putImageData(junc, 0, ext - jH);
    } catch (_) {}

    this._tallSky = c;
    this._tallSkyExt = ext;
    this._tallSkyNh = nh;
    this._tallSkyNw = nw;
    return c;
  };

  LiftoffEngine.prototype.drawTallSky = function () {
    const tall = this._tallSky;
    const lb = this._lb;
    if (!tall || !lb) return;

    const stage = document.getElementById("stage");
    if (!stage) return;

    let canvas = this._tallSkyCanvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "tallSky";
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;z-index:0;";
      const world = this.getWorldEl && this.getWorldEl();
      if (world && world.parentElement === stage) stage.insertBefore(canvas, world);
      else stage.insertBefore(canvas, stage.firstChild);
      this._tallSkyCanvas = canvas;
    }

    const dpr = this._dpr || 1;
    const wrapW = this._wrapW || lb.width;
    const wrapH = this._wrapH || lb.height;
    const cw = Math.max(1, Math.round(wrapW * dpr));
    const ch = Math.max(1, Math.round(wrapH * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    canvas.style.width = wrapW + "px";
    canvas.style.height = wrapH + "px";
    canvas.style.display = "block";

    // Source-rect: single bitmap follows camera. Plate is HIDDEN — tall sky owns pad+sky.
    const ext = this._tallSkyExt;
    const nw = this._tallSkyNw;
    const scaleY = lb.nh / lb.height;
    const scaleX = nw / lb.width;
    // Viewport top in plate-local css, accounting for world camY (world moves down ⇒ look higher)
    const viewTopPlateCss = -lb.top - (this.camY || 0);
    let srcY = ext + viewTopPlateCss * scaleY;
    const srcH = wrapH * scaleY;
    let srcX = (-lb.left) * scaleX;
    const srcW = wrapW * scaleX;
    if (srcX < 0) srcX = 0;
    if (srcX + srcW > nw) srcX = Math.max(0, nw - srcW);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    ctx.fillStyle = pal.deep || "#050814";
    ctx.fillRect(0, 0, cw, ch);

    if (srcY + srcH > 0) {
      let dy = 0, sy = srcY, sh = srcH;
      if (sy < 0) {
        const skip = -sy;
        dy = (skip / srcH) * ch;
        sh = srcH - skip;
        sy = 0;
      }
      if (sy + sh > tall.height) sh = tall.height - sy;
      if (sh > 0) {
        ctx.drawImage(tall, srcX, sy, srcW, sh, 0, dy, cw, (sh / srcH) * ch);
      }
    }

    // Hide plate completely during liftoff — no scrolling plate edge against extension
    const plate = this.getPlateEl && this.getPlateEl();
    if (plate) {
      plate.style.display = "none";
      plate.style.visibility = "hidden";
      plate.style.opacity = "0";
      plate.style.webkitMaskImage = "";
      plate.style.maskImage = "";
    }
    const sky = this.getSkyEl && this.getSkyEl();
    if (sky) { sky.style.opacity = "0"; sky.innerHTML = ""; sky._skyCanvas = null; }
    const px = this.getParallaxEl && this.getParallaxEl();
    if (px) { px.style.display = "none"; }
  };

  LiftoffEngine.prototype.updateTallSkyPan = function () {
    if (!this._tallSky || !this._lb) return;
    this.drawTallSky();
  };

  LiftoffEngine.prototype.clearTallSky = function () {
    if (this._tallSkyCanvas) this._tallSkyCanvas.style.display = "none";
    const plate = this.getPlateEl && this.getPlateEl();
    if (plate) {
      plate.style.display = "";
      plate.style.visibility = "";
      plate.style.opacity = "1";
    }
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
      const palC = this._cloudPalette || [[232, 238, 244], [210, 220, 230], [245, 248, 252]];
      for (let i = 0; i < 8; i++) {
        const col = palC[(this._rand() * palC.length) | 0];
        this._clouds.push({
          x: this._rand() * w,
          y: this._rand() * h * 0.65,
          w: 22 + this._rand() * 48,
          h: 10 + this._rand() * 18,
          a: 0.22 + this._rand() * 0.3,
          r: col[0], g: col[1], b: col[2],
          blobs: 3 + ((this._rand() * 3) | 0),
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

    this.buildTallSky();
    this.buildParallax();
    this.drawTallSky();

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
    // Soft disc glow — avoid hard horizontal bars that read as flame geometry
    const rings = this.phase === "climb" ? 3 : 5;
    for (let i = 0; i < rings; i++) {
      bctx.globalAlpha = str * (1 - i / rings) * (this.phase === "climb" ? 0.18 : 0.32);
      bctx.fillStyle = pal.pad;
      const rr = Math.round((gw * 0.35) + i * 3);
      for (let dy = -rr; dy <= rr; dy++) {
        const span = Math.sqrt(Math.max(0, 1 - (dy * dy) / (rr * rr))) * rr;
        bctx.fillRect(Math.round(bx - span), Math.round(by + dy * 0.45), Math.round(span * 2), 1);
      }
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

    // Upscale smoke/glow only
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this._wrapW, this._wrapH);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this._buf, 0, 0, this._bufW, this._bufH, 0, 0, this._wrapW, this._wrapH);

    // Flame drawn crisp on display at 2px grid (avoids mosaic from buffer upscale)
    if (this.ignited && this.phase !== "linger") {
      this.drawFlameDisplay(ctx, seat, pal);
    }
  };

  /* ---------- classic cellular pixel fire ---------- */
  LiftoffEngine.prototype._ensureFireField = function (fw, fh) {
    if (!this._fireField || this._fireField.w !== fw || this._fireField.h !== fh) {
      this._fireField = {
        w: fw, h: fh,
        buf: new Uint8Array(fw * fh),
        canvas: document.createElement("canvas"),
        img: null,
      };
      this._fireField.canvas.width = fw;
      this._fireField.canvas.height = fh;
      this._fireField.img = this._fireField.canvas.getContext("2d").createImageData(fw, fh);
    }
    return this._fireField;
  };

  LiftoffEngine.prototype._ensureTrailField = function (fw, fh) {
    if (!this._fireTrail || this._fireTrail.w !== fw || this._fireTrail.h !== fh) {
      this._fireTrail = {
        w: fw, h: fh,
        buf: new Uint8Array(fw * fh),
        canvas: document.createElement("canvas"),
        img: null,
      };
      this._fireTrail.canvas.width = fw;
      this._fireTrail.canvas.height = fh;
      this._fireTrail.img = this._fireTrail.canvas.getContext("2d").createImageData(fw, fh);
    }
    return this._fireTrail;
  };

  // Doom-style fire: seed row 0 (nozzle), propagate to higher rows (down the plume)
  LiftoffEngine.prototype._tickFire = function (field, seedHalf, heat) {
    const w = field.w, h = field.h, buf = field.buf;
    const cx = (w / 2) | 0;
    // Seed nozzle rows with noisy hot values (no solid bar — broken edges)
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x - cx);
      let v = 0;
      if (d <= seedHalf) {
        const t = 1 - d / Math.max(1, seedHalf);
        // Soft gaussian-ish, lots of nozzle noise — avoid a hard bar
        const fall = t * t;
        v = Math.round(heat * fall * (0.5 + this._rand() * 0.5));
        if (t < 0.35 && this._rand() < 0.45) v = 0;
        else if (this._rand() < 0.12) v = Math.round(v * (0.2 + this._rand() * 0.5));
        if (t > 0.7 && this._rand() < 0.25) v = heat; // hot sparks in core
      } else if (d <= seedHalf + 3 && this._rand() < 0.25) {
        v = Math.round(heat * 0.2 * this._rand());
      }
      buf[x] = v;
      if (h > 1) buf[w + x] = Math.max(0, v - ((this._rand() * 4) | 0));
    }
    // Propagate downward (row y samples from row y-1)
    for (let y = 2; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rnd = (this._rand() * 3) | 0; // 0..2 classic
        const srcX = clamp(x + (rnd - 1), 0, w - 1);
        const from = buf[(y - 1) * w + srcX];
        // Cool slowly so plume fills the buffer (not just a nozzle bar)
        let next = from - (rnd > 1 ? 1 : 0);
        if (this._rand() < 0.04 && from > 18) next = Math.min(36, from + 3);
        if (this._rand() < 0.03) next = Math.max(0, next - 1);
        buf[y * w + x] = next > 0 ? next : 0;
      }
    }
  };

  LiftoffEngine.prototype._paintFireBuf = function (field, pal) {
    const w = field.w, h = field.h, buf = field.buf, data = field.img.data;
    // 37-step fire palette white→yellow→orange→red→dark→transparent
    const ramp = [];
    function lerp3(a, b, t) {
      return [(a[0]+(b[0]-a[0])*t)|0, (a[1]+(b[1]-a[1])*t)|0, (a[2]+(b[2]-a[2])*t)|0];
    }
    const stops = [
      [0, 0, 0],
      [40, 8, 0],
      [120, 20, 0],
      [200, 40, 0],
      [255, 90, 10],
      [255, 160, 30],
      [255, 220, 80],
      [255, 255, 200],
      [255, 255, 255],
    ];
    for (let i = 0; i <= 36; i++) {
      const t = i / 36;
      const seg = t * (stops.length - 1);
      const i0 = Math.min(stops.length - 2, seg | 0);
      const f = seg - i0;
      const c = lerp3(stops[i0], stops[i0 + 1], f);
      const a = i < 2 ? 0 : Math.min(255, 40 + i * 7);
      ramp.push([c[0], c[1], c[2], a]);
    }
    // Prefer palette endpoints if provided
    const pf = pal.flame || [];
    // paint
    // Clear
    for (let i = 0; i < data.length; i++) data[i] = 0;
    // Paint with per-row horizontal warp for tongue flicker
    for (let y = 0; y < h; y++) {
      const warp = ((Math.sin(y * 0.41 + this._simTime * 11.0) * 1.6)
        + (Math.sin(y * 0.17 + this._simTime * 6.2) * 1.1)) | 0;
      for (let x = 0; x < w; x++) {
        let v = buf[y * w + x];
        if (v > 36) v = 36;
        if (v <= 0) continue;
        const dx = clamp(x + warp, 0, w - 1);
        const c = ramp[v];
        const pi = (y * w + dx) * 4;
        if (v < 9 && ((x * 13 + y + v) & 3) === 0) continue; // broken edge
        data[pi] = Math.max(data[pi], c[0]);
        data[pi + 1] = Math.max(data[pi + 1], c[1]);
        data[pi + 2] = Math.max(data[pi + 2], c[2]);
        data[pi + 3] = Math.max(data[pi + 3], c[3]);
      }
    }
    field.canvas.getContext("2d").putImageData(field.img, 0, 0);
  };

  LiftoffEngine.prototype.drawFlameDisplay = function (ctx, seat, pal) {
    const lb = this._lb;
    const nz = this.nozzleNative(seat);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const stageW = Math.max(80, seat.width || 120);
    const stackH = Math.max(stageW * 4, (seat.targetH || 420));
    const grow = clamp(this.flameIntensity, 0.25, 1.5);

    // 2–3 CSS px per fire cell
    const CELL = 1.5;
    let lenMul;
    if (this.phase === "climb") lenMul = 2.6 + grow * 0.5 + Math.min(1.2, this.climbT) * 0.55;
    else if (this.phase === "hold") lenMul = 1.35 + grow * 0.3;
    else lenMul = 0.8 + grow * 0.35;

    const lenCss = Math.min(
      (stackH * lenMul / lb.nh) * lb.height,
      Math.max(64, (this._wrapH || 390) - 20)
    );
    const baseCss = (stageW * (1.7 + 0.35 * grow) / lb.nw) * lb.width;
    const fw = Math.max(28, Math.round(baseCss / CELL));
    const fh = Math.max(40, Math.round(lenCss / CELL));
    const field = this._ensureFireField(fw, fh);

    const heat = 36; // full-hot seed; cool handles length
    const seedHalf = Math.max(5, Math.round(fw * 0.48));
    // One tick per frame — double-tick was over-cooling into a flat nozzle bar
    this._tickFire(field, seedHalf, heat);
    this._paintFireBuf(field, pal);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "lighter";

    const blit = (cssX, cssY, scale, alpha) => {
      const dw = field.w * CELL * scale;
      const dh = field.h * CELL * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(field.canvas, Math.round(cssX - dw / 2), Math.round(cssY), Math.round(dw), Math.round(dh));
    };

    for (let ni = 0; ni < nozzles.length; ni++) {
      const isSide = nozzles.length > 1 && nozzles[ni] !== 0;
      const sc = isSide ? 0.42 : 1;
      const css = this.cssFromNative(nz.x + nozzles[ni], nz.y);
      blit(css.x, css.y, sc, isSide ? 0.75 : 1);
    }

    // Exhaust trail toward pad — cooler, faster decay
    if (this.phase === "climb" && this.climbT < 2.6) {
      const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
      const css = this.cssFromNative(nz.x, nz.y);
      const padCssY = lb.top + (deckY / lb.nh) * lb.height;
      const trailLen = Math.max(16, padCssY - css.y);
      const fade = clamp(1 - this.climbT / 2.4, 0, 1);
      if (fade > 0.06 && trailLen > 10) {
        const tw = Math.max(14, Math.round(fw * 0.45));
        const th = Math.max(28, Math.round(trailLen / CELL));
        const trail = this._ensureTrailField(tw, th);
        this._tickFire(trail, Math.round(tw * 0.35), Math.round(heat * 0.65));
        this._paintFireBuf(trail, pal);
        ctx.globalAlpha = 0.5 * fade;
        ctx.drawImage(
          trail.canvas,
          Math.round(css.x - (tw * CELL) / 2),
          Math.round(css.y),
          Math.round(tw * CELL),
          Math.round(trailLen)
        );
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  LiftoffEngine.prototype.applyRocketLight = function () {
    const stack = this.getStackEl();
    if (!stack || !this.ignited) {
      if (stack) {
        stack.style.filter = "";
        if (stack._lightCanvas) { stack._lightCanvas.style.display = "none"; }
      }
      return;
    }
    // Hide any prior overlay canvas (source-atop overlay caused stack holes)
    if (stack._lightCanvas) stack._lightCanvas.style.display = "none";

    const flick = 0.72 + 0.28 * Math.sin(this._simTime * 42) + (this._rand() - 0.5) * 0.06;
    const str = clamp(this.flameIntensity * flick + this.releaseFlash * 1.15, 0, 1.8);
    const bloom = Math.round(2 + str * 4);
    const y = Math.round(2 + str * 7);
    // Tight under-glow + slight brightness to suggest lower-stack heat without overlay
    stack.style.filter =
      "drop-shadow(0 " + y + "px " + bloom + "px rgba(255,120,20," + (0.22 + str * 0.38).toFixed(2) + "))" +
      " drop-shadow(0 " + Math.round(y * 0.4) + "px 2px rgba(255,180,60," + (0.12 + str * 0.2).toFixed(2) + "))";
  };

  /* ---------- parallax ---------- */
  LiftoffEngine.prototype.drawParallax = function () {
    const px = this.getParallaxEl();
    if (!px || !this._fxReady) return;
    // Soft stars only — no streak layers that read as a second sky seam
    if (this.camY < 4) {
      const ctx0 = px.getContext("2d");
      ctx0.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx0.clearRect(0, 0, this._wrapW, this._wrapH);
      return;
    }
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
          ctx.globalAlpha = s.a * 0.55;
          ctx.fillRect(Math.round(x), Math.round(y), s.s, s.s);
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
        const streak = vel * 1.2;
        const r = c.r != null ? c.r : 232;
        const g = c.g != null ? c.g : 238;
        const b = c.b != null ? c.b : 244;
        ctx.globalAlpha = c.a * (mode === "day" ? 0.75 : 0.45);
        ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
        const hw = (c.w / 320) * this._wrapW;
        const hh = Math.max(3, (c.h / 640) * this._wrapH + streak);
        const blobs = c.blobs || 3;
        for (let k = 0; k < blobs; k++) {
          const ox = hw * (0.15 + k * 0.22);
          const oy = hh * ((k % 2) * -0.25);
          const rw = hw * (0.35 + (k % 3) * 0.08);
          const rh = hh * (0.7 + (k % 2) * 0.2);
          // Soft pixel ellipse via scanlines
          const rx = Math.max(2, rw / 2), ry = Math.max(1, rh / 2);
          for (let dy = -ry; dy <= ry; dy++) {
            const t = 1 - (dy * dy) / (ry * ry);
            if (t <= 0) continue;
            const span = Math.sqrt(t) * rx;
            ctx.fillRect(Math.round(x + ox - span), Math.round(y + oy + dy), Math.round(span * 2), 1);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

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
    // Frame so nozzle sits ~42% down — leaves room below for a long tapered plume
    const desiredNozzle = wrapH * 0.42;
    let targetCam = desiredNozzle - nozzleLocalY;
    if (!this.released || this.climbT < 0.15) targetCam = 0;
    if (this.phase !== "linger") {
      targetCam = Math.max(0, targetCam);
      this.camY = lerp(this.camY, targetCam, 0.18);
      if (this.released && this.climbT >= 0.15) {
        const nzAfter = nozzleLocalY + this.camY;
        // Keep nozzle in the mid band so flame (below) stays on-screen
        if (nzAfter < wrapH * 0.34) this.camY = wrapH * 0.34 - nozzleLocalY;
        if (nzAfter > wrapH * 0.52) this.camY = Math.max(0, wrapH * 0.42 - nozzleLocalY);
        // Tip may leave top — stack canvas has headroom; don't pull flame off bottom
        const maxCam = Math.max(0, lb.top + lb.height * 0.85);
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
    this.applyRocketLight();
    if (this.ignited || this.phase === "climb" || this.phase === "hold" || this.phase === "linger" || this.phase === "burn") {
      this.updateTallSkyPan();
    }
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
        app: "liftoff41",
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
        climbT: 0, lingerT: 0, flame: 0, app: "liftoff41",
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
