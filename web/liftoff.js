/**
 * Rocket Bay — LIFTOFF-FEEL v3 polish + Phase C1 plume
 * Cellular flame (hull-scaled, altitude plume), dithered opaque smoke, long t² flight
 * with accelerating follow cam, altitude sky + parallax clouds / streaking stars.
 * Timing preserved: T-5 countdown, T-2 ignition, 0.5s hold, t² climb (now 6s + 1.5s exit).
 * Phase C1: PSP multi-layer plume (white→orange→red) + ignition flash + smoke shear + tower warm kiss.
 * keep-trial: flight2d pad→flight handoff/join unchanged (no overnight join rewrite).
 */
(function (global) {
  "use strict";

  const BUILD = "keep-trial";
  const POOL_GROUND = 260;
  const POOL_TRAIL = 160;
  const CLIMB_DUR = 6.0;   // seconds of powered climb on screen after the 0.5s hold
  const EXIT_DUR = 1.5;    // camera eases off, rocket exits top — flight ends on the flight
  const CLIMB_A = 140;
  const ZOOM_LAND_MIN = 0.80; // landscape follow zoom-out (ceiling of the adaptive target)
  const ZOOM_LAND_FLOOR = 0.58; // landscape zoom floor: adaptive per stack (tall stacks need room for the plume)
  const PLUME_MIN_CSS = 170;  // landscape follow: keep >=170 px of plume on screen below the nozzle
  const NOSE_FRAC = 0.10;     // portrait: nose ~10% below the top edge during follow
  const NOSE_FRAC_LAND = 0.05; // landscape: nose ~5% below the top edge
  const HULL_K = 1.3;         // flame sizing: modular core bottom width -> hull (fin-span) equivalent     // native px / s² (t² climb)
  const BUF_DIV = 2; // smoke/glow cells = 2 CSS px max (no mosaic)

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
  function smooth01(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hexRgb(c) {
    const h = c.slice(1);
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgbaStr(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a.toFixed(3) + ")"; }
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (v) { return (v + 0.5) / 16; });
  global.RocketBayLiftoffBuild = BUILD;

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
    this.audioMuted = false;
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

  // World -> screen (CSS px): screen = z * world + (tx, T). z<1 only during landscape follow.
  LiftoffEngine.prototype._w2s = function (x, y) {
    const z = this._zoom || 1;
    return { x: z * x + (this._tx || 0), y: z * y + (this._camYi || 0) };
  };
  // Inverse of the #world transform for layers that must stay screen-fixed (altSky, fx)
  LiftoffEngine.prototype._screenFixedTransform = function () {
    const z = this._zoom || 1, tx = this._tx || 0, T = this._camYi || 0;
    if (z === 1 && !tx) return T ? ("translate3d(0," + (-T) + "px,0)") : "";
    return "scale(" + (1 / z) + ") translate3d(" + (-tx) + "px," + (-T) + "px,0)";
  };

  LiftoffEngine.prototype._rand = function () {
    this._rng = (this._rng * 1664525 + 1013904223) >>> 0;
    return (this._rng & 0xffff) / 0x10000;
  };

  LiftoffEngine.prototype.reset = function () {
    this._zoomS = 1; this._zoomV = 0;
    this._altBlendT0 = null; this._altBlendU = 0;
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
    this.exitT = 0;
    this._exitCam0 = 0;
    this._exitV0 = 0;
    this._camVel = 0;
    this._prevCamY = 0;
    this._smokeAcc = 0;
    this.finished = false;
    this._zoom = 1;
    this._tx = 0;
    this._pickupT = -1;
    this._tipLocal0 = null;
    this.flameIntensity = 0;
    this.releaseFlash = 0;
    this._shearT = 0;       // C1: ignition smoke-shear window (seconds remaining)
    this._ignFlash = 0;     // C1: nozzle ignition flash strength
    this._towerKiss = null; // C1: cached native tower-face pixels for warm kiss
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
      stack.style.clipPath = "";
      stack.style.webkitClipPath = "";
    }
    const world = this.getWorldEl();
    if (world) { world.style.transform = "translate3d(0,0,0)"; world.style.transformOrigin = ""; }
    const sky = this.getSkyEl();
    if (sky) {
      sky.style.display = "";
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
    if (this._altCanvas) {
      this._altCanvas.style.display = "none";
      this._altCanvas.style.transform = "";
    }
    this._altClouds = null;
    this._altStars = null;
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
    const nw = plate.naturalWidth | 0;
    const nh = plate.naturalHeight | 0;
    // Day: one long reflection of top ~160 rows; night can use 120
    const N = (pal.parallax === "day") ? 160 : 128;
    const FALL = 96;
    const ext = (nh * 2.5) | 0;
    const c = document.createElement("canvas");
    c.width = nw;
    c.height = nh + ext;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    // Day empty-pad art has a removed-rocket ghost with hard horizontal bands in the
    // seat footprint; repair it on a plate COPY, then blit that copy once (contiguous).
    // v5 empty pads (CoE-passed) already fill the hull hole cleanly — runtime de-ghost disabled
    // (it would flatten v5's textured fill). Kept behind a flag for legacy v2 plates only.
    const src = (this.deghostLegacy && pal.parallax === "day") ? this._deghostPlate(plate, nw, nh) : plate;

    // Exact full plate — ONE contiguous blit; never overwrite [ext, ext+nh) later
    ctx.drawImage(src, 0, 0, nw, nh, 0, ext, nw, nh);

    // Band = top N rows (actual pixels)
    const band = document.createElement("canvas");
    band.width = nw;
    band.height = N;
    const bctx = band.getContext("2d", { willReadFrequently: true });
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(src, 0, 0, nw, Math.min(N, nh), 0, 0, nw, N);
    let bandData = null;
    try { bandData = bctx.getImageData(0, 0, nw, N).data; } catch (e) {
      console.warn("tallSky band read failed", e);
    }
    // Strip structure (tower spire etc.) from the mirror band so the reflection never
    // shows an inverted tower floating in the sky: replace dark/grey non-sky, non-cloud
    // pixels (+2px dilation) by linear interpolation between nearest sky pixels on the row.
    if (bandData && pal.parallax === "day") {
      const bd = bandData;
      const BLK = 64, nb = Math.ceil(nw / BLK);
      const refR = new Float32Array(nb), refG = new Float32Array(nb), refB = new Float32Array(nb);
      const okB = new Uint8Array(nb);
      const medOf = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
      const mask = new Uint8Array(nw);
      for (let y = 0; y < N; y++) {
        const r0 = y * nw * 4;
        // Row-global sky prior (sky dominates a full row) — rejects dark navy seen through lattice
        const gR = [], gG = [], gB = [];
        for (let x = 0; x < nw; x += 3) {
          const i = r0 + x * 4, r = bd[i], g = bd[i + 1], b = bd[i + 2];
          if (b > r * 1.35 + 10 && b > g * 1.05) { gR.push(r); gG.push(g); gB.push(b); }
        }
        const pR = gR.length ? medOf(gR) : 0, pG = gG.length ? medOf(gG) : 0, pB = gB.length ? medOf(gB) : 0;
        // local sky reference per 64px block (median of sky pixels near the row prior)
        for (let k = 0; k < nb; k++) {
          const R = [], G = [], B = [];
          for (let x = k * BLK; x < Math.min(nw, (k + 1) * BLK); x++) {
            const i = r0 + x * 4, r = bd[i], g = bd[i + 1], b = bd[i + 2];
            if (b > r * 1.35 + 10 && b > g * 1.05 &&
                Math.abs(r - pR) + Math.abs(g - pG) + Math.abs(b - pB) < 70) { R.push(r); G.push(g); B.push(b); }
          }
          const bw = Math.min(nw, (k + 1) * BLK) - k * BLK;
          okB[k] = R.length >= bw * 0.7 ? 1 : 0; // only mostly-sky blocks define the reference
          if (okB[k]) { refR[k] = medOf(R); refG[k] = medOf(G); refB[k] = medOf(B); }
        }
        for (let k = 0; k < nb; k++) if (!okB[k]) {
          let j = 1;
          while (j < nb && !(k - j >= 0 && okB[k - j]) && !(k + j < nb && okB[k + j])) j++;
          const src = (k - j >= 0 && okB[k - j]) ? k - j : (k + j < nb && okB[k + j] ? k + j : -1);
          if (src >= 0) { refR[k] = refR[src]; refG[k] = refG[src]; refB[k] = refB[src]; }
        }
        const isStruct = (x) => {
          const i = r0 + x * 4, r = bd[i], g = bd[i + 1], b = bd[i + 2];
          const k = Math.min(nb - 1, (x / BLK) | 0);
          const dist = Math.abs(r - refR[k]) + Math.abs(g - refG[k]) + Math.abs(b - refB[k]);
          const sum = r + g + b, refSum = refR[k] + refG[k] + refB[k];
          const cloud = sum > Math.max(540, refSum + 120);
          return dist > 55 && !cloud;
        };
        mask.fill(0);
        for (let x = 0; x < nw; x++) if (isStruct(x)) {
          for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < nw) mask[xx] = 1; }
        }
        // Fill masked pixels from clean-block sky refs (interpolated between block centres)
        // — never from neighbouring pixels, so tower fragments can't smear into streaks.
        for (let x = 0; x < nw; x++) {
          if (!mask[x]) continue;
          const fb = x / BLK - 0.5;
          const k0 = Math.max(0, Math.min(nb - 1, Math.floor(fb)));
          const k1 = Math.min(nb - 1, k0 + 1);
          const t = Math.max(0, Math.min(1, fb - k0));
          const di = r0 + x * 4;
          bd[di] = (refR[k0] * (1 - t) + refR[k1] * t) | 0;
          bd[di + 1] = (refG[k0] * (1 - t) + refG[k1] * t) | 0;
          bd[di + 2] = (refB[k0] * (1 - t) + refB[k1] * t) | 0;
        }
      }
    }

    // Dusk/night: the tower mast can reach the plate top (03). Grey/tan structure is low-chroma
    // against the saturated painted sky -> mask it (dilated) and fill from per-row block medians
    // of the unmasked sky, so the extension never repeats a floating mast. Skipped when the
    // mask would cover a large share of the band (e.g. desaturated night skies).
    if (bandData && pal.parallax !== "day") {
      const bd = bandData, BLK = 48, nb = Math.ceil(nw / BLK);
      const m0 = new Uint8Array(nw * N);
      let cnt = 0;
      for (let i = 0, p = 0; p < nw * N; p++, i += 4) {
        const r = bd[i], g = bd[i + 1], b = bd[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) < 22) { m0[p] = 1; cnt++; }
      }
      if (cnt > 0 && cnt < nw * N * 0.03) {
        const m = new Uint8Array(nw * N);
        for (let y = 0; y < N; y++) for (let x = 0; x < nw; x++) if (m0[y * nw + x]) {
          for (let dy = -3; dy <= 3; dy++) { const yy = y + dy; if (yy < 0 || yy >= N) continue;
            for (let dx = -4; dx <= 4; dx++) { const xx = x + dx; if (xx >= 0 && xx < nw) m[yy * nw + xx] = 1; } }
        }
        const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
        const rR = new Float32Array(nb), rG = new Float32Array(nb), rB = new Float32Array(nb), ok = new Uint8Array(nb);
        for (let y = 0; y < N; y++) {
          const r0 = y * nw;
          let any = false;
          for (let x = 0; x < nw; x++) if (m[r0 + x]) { any = true; break; }
          if (!any) continue;
          for (let k = 0; k < nb; k++) {
            const R = [], G = [], B = [];
            for (let x = k * BLK; x < Math.min(nw, (k + 1) * BLK); x++) if (!m[r0 + x]) {
              const i = (r0 + x) * 4; R.push(bd[i]); G.push(bd[i + 1]); B.push(bd[i + 2]);
            }
            ok[k] = R.length >= 8 ? 1 : 0;
            if (ok[k]) { rR[k] = med(R); rG[k] = med(G); rB[k] = med(B); }
          }
          for (let k = 0; k < nb; k++) if (!ok[k]) {
            let j = 1; while (j < nb && !(k - j >= 0 && ok[k - j]) && !(k + j < nb && ok[k + j])) j++;
            const sk = (k - j >= 0 && ok[k - j]) ? k - j : (k + j < nb && ok[k + j] ? k + j : -1);
            if (sk >= 0) { rR[k] = rR[sk]; rG[k] = rG[sk]; rB[k] = rB[sk]; }
          }
          for (let x = 0; x < nw; x++) {
            if (!m[r0 + x]) continue;
            const fb = x / BLK - 0.5, k0 = Math.max(0, Math.min(nb - 1, Math.floor(fb))), k1 = Math.min(nb - 1, k0 + 1);
            const t = Math.max(0, Math.min(1, fb - k0)), di = (r0 + x) * 4;
            bd[di] = (rR[k0] * (1 - t) + rR[k1] * t) | 0;
            bd[di + 1] = (rG[k0] * (1 - t) + rG[k1] * t) | 0;
            bd[di + 2] = (rB[k0] * (1 - t) + rB[k1] * t) | 0;
          }
        }
      }
    }

    this._cloudPalette = [[232, 238, 244], [210, 220, 230], [245, 248, 252]];
    if (bandData) {
      const clouds = [];
      for (let i = 0; i < bandData.length; i += 28) {
        const r = bandData[i], g = bandData[i + 1], b = bandData[i + 2], a = bandData[i + 3];
        if (a > 200 && r > 170 && g > 180 && b > 190 && r + g + b > 560) clouds.push([r, g, b]);
      }
      if (clouds.length) this._cloudPalette = clouds;
    }

    // v3: plate top-row sky colour (median) + clean-extension height for the altitude overlay
    this._tallSkyClean = N * 2;
    if (bandData) {
      const R = [], G = [], B = [];
      for (let yy = 0; yy < 3; yy++) for (let x = 0; x < nw; x += 2) {
        const i = (yy * nw + x) * 4; R.push(bandData[i]); G.push(bandData[i + 1]); B.push(bandData[i + 2]);
      }
      const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
      this._skyTopRgb = [med(R), med(G), med(B)];
      // per-row median of the plate's top band (painted sky gradient) for the 03 blend
      const rows = [];
      for (let yy = 0; yy < N; yy++) {
        const r = [], g = [], b = [];
        for (let x = 0; x < nw; x += 4) { const i = (yy * nw + x) * 4; r.push(bandData[i]); g.push(bandData[i + 1]); b.push(bandData[i + 2]); }
        rows.push([med(r), med(g), med(b)]);
      }
      this._skyRows = rows; this._skyRowsN = N;
      // full-height sky column (row medians of the plate, rows 0..0.55 nh) for the 03 gradient
      try {
        const pc = document.createElement("canvas"); pc.width = nw; pc.height = nh;
        const pg = pc.getContext("2d", { willReadFrequently: true }); pg.drawImage(plate, 0, 0);
        const pd = pg.getImageData(0, 0, nw, nh).data;
        const col = [];
        for (let yy = 0; yy < Math.round(nh * 0.55); yy++) {
          const r = [], g = [], b = [];
          for (let x = 0; x < nw; x += 4) { const i = (yy * nw + x) * 4; r.push(pd[i]); g.push(pd[i + 1]); b.push(pd[i + 2]); }
          col.push([med(r), med(g), med(b)]);
        }
        // vertical box blur (r=18 rows) -> painted cloud streaks don't turn into gradient bands
        const R = 18, sm = [];
        for (let yy = 0; yy < col.length; yy++) {
          let r = 0, g = 0, b2 = 0, n = 0;
          for (let k = -R; k <= R; k++) { const q = col[Math.max(0, Math.min(col.length - 1, yy + k))]; r += q[0]; g += q[1]; b2 += q[2]; n++; }
          sm.push([r / n, g / n, b2 / n]);
        }
        this._skyCol = sm;
        // SLOP-5: cloud tones sampled from the plate's own painted clouds (5 luminance quantiles)
        const lumOf = (i) => pd[i] * 0.3 + pd[i + 1] * 0.59 + pd[i + 2] * 0.11;
        const px = [];
        for (let yy = 0; yy < Math.round(nh * 0.45); yy += 3) for (let x = 0; x < nw; x += 3) {
          const i = (yy * nw + x) * 4, r = pd[i], g = pd[i + 1], b = pd[i + 2];
          if (pal.parallax === "day") { if (r > 150 && g > 165 && b > 190 && r + g + b > 520) px.push(i); }
          else px.push(i);
        }
        px.sort((p, q) => lumOf(p) - lumOf(q));
        let qs = null;
        if (pal.parallax === "day" && px.length > 50) qs = [0.04, 0.25, 0.5, 0.75, 0.97];
        else if (px.length > 50) qs = [0.55, 0.7, 0.82, 0.92, 0.985];
        this._cloudTones = qs ? qs.map((q) => { const i = px[Math.min(px.length - 1, Math.floor(q * px.length))]; return [pd[i], pd[i + 1], pd[i + 2]]; }) : null;
      } catch (e) { this._skyCol = null; this._cloudTones = null; }
    } else { this._skyTopRgb = null; this._skyRows = null; }

    function parseDeep(col) {
      if (col && col[0] === "#") {
        const h = col.slice(1);
        if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      }
      return [6, 10, 22];
    }
    const deep = parseDeep(pal.deep);

    // SLOP-4 (audio1): NO mirroring. The extension is a painted continuation of the plate's
    // own top sky: per-column top colour (structure-masked band, block medians + wide blur, so
    // no tower/spire/cloud can repeat), graded toward a zenith colour extrapolated from the
    // plate's vertical sky gradient, laid down in flat bands with 4x4 Bayer-dithered edges.
    const extImg = ctx.createImageData(nw, ext);
    const d = extImg.data;
    if (bandData) {
      const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
      const TR = 36, BLK = 48, nb = Math.ceil(nw / BLK);
      const bR = new Float32Array(nb), bG = new Float32Array(nb), bB = new Float32Array(nb);
      for (let k = 0; k < nb; k++) {
        const R = [], G = [], B = [];
        for (let y = 0; y < TR; y++) for (let x = k * BLK; x < Math.min(nw, (k + 1) * BLK); x++) {
          const i = (y * nw + x) * 4; R.push(bandData[i]); G.push(bandData[i + 1]); B.push(bandData[i + 2]);
        }
        bR[k] = med(R); bG[k] = med(G); bB[k] = med(B);
      }
      const top = new Float32Array(nw * 3);
      for (let x = 0; x < nw; x++) {
        const fb = x / BLK - 0.5, k0 = Math.max(0, Math.min(nb - 1, Math.floor(fb))), k1 = Math.min(nb - 1, k0 + 1);
        const t = Math.max(0, Math.min(1, fb - k0));
        top[x * 3] = bR[k0] * (1 - t) + bR[k1] * t; top[x * 3 + 1] = bG[k0] * (1 - t) + bG[k1] * t; top[x * 3 + 2] = bB[k0] * (1 - t) + bB[k1] * t;
      }
      { // wide horizontal box blur (r = 64) -> only the broad sun-side gradient survives
        const Rr = 64, tmp = new Float32Array(nw * 3);
        for (let x = 0; x < nw; x++) { let r = 0, g = 0, bb = 0, n = 0;
          for (let k = -Rr; k <= Rr; k += 4) { const xx = Math.max(0, Math.min(nw - 1, x + k)); r += top[xx * 3]; g += top[xx * 3 + 1]; bb += top[xx * 3 + 2]; n++; }
          tmp[x * 3] = r / n; tmp[x * 3 + 1] = g / n; tmp[x * 3 + 2] = bb / n; }
        top.set(tmp);
      }
      // zenith: extrapolate the plate's top-down sky gradient (row 4 vs ~row 0.2 nh)
      const col = this._skyCol;
      let zen = [0, 0, 0];
      const t0c = [0, 0, 0]; for (let x = 0; x < nw; x++) { t0c[0] += top[x * 3]; t0c[1] += top[x * 3 + 1]; t0c[2] += top[x * 3 + 2]; }
      t0c[0] /= nw; t0c[1] /= nw; t0c[2] /= nw;
      { // match the altitude overlay's base colour so the overlay hand-off never shows a step
        const ref = (tod === "03" && this._skyCol) ? this._skyCol[0] : this._skyTopRgb;
        if (ref) for (let c = 0; c < 3; c++) { const dv = ref[c] - t0c[c]; for (let x = 0; x < nw; x++) top[x * 3 + c] = clamp(top[x * 3 + c] + dv, 0, 255); t0c[c] = ref[c]; }
      }
      if (col && col.length > 40) {
        const r0 = col[Math.min(col.length - 1, 22)], r1 = col[Math.min(col.length - 1, Math.round(nh * 0.2))];
        const span = Math.max(1, Math.round(nh * 0.2) - 22);
        for (let c = 0; c < 3; c++) {
          let dv = (r0[c] - r1[c]) / span * ext * 0.14;
          dv = Math.max(-70, Math.min(70, dv));
          zen[c] = Math.max(0, Math.min(255, t0c[c] + dv));
        }
      } else zen = t0c.slice();
      zen = [zen[0] * 0.85 + deep[0] * 0.15, zen[1] * 0.85 + deep[1] * 0.15, zen[2] * 0.85 + deep[2] * 0.15];
      const BH = 40, J = 10;
      for (let y = 0; y < ext; y++) {
        const above = ext - 1 - y;
        for (let x = 0; x < nw; x++) {
          const bay = BAYER4[(((above >> 1) & 3) << 2) | ((x >> 1) & 3)];
          const band = Math.max(0, Math.floor((above + (bay - 0.5) * 10) / BH));
          const u = smooth01(0, ext * 0.7, (band + 0.5) * BH);
          const di = (y * nw + x) * 4;
          if (above < J && bay > above / J) { // dithered hand-off from the (masked) plate top row
            const si = x * 4; d[di] = bandData[si]; d[di + 1] = bandData[si + 1]; d[di + 2] = bandData[si + 2];
          } else {
            d[di] = top[x * 3] + (zen[0] - top[x * 3]) * u;
            d[di + 1] = top[x * 3 + 1] + (zen[1] - top[x * 3 + 1]) * u;
            d[di + 2] = top[x * 3 + 2] + (zen[2] - top[x * 3 + 2]) * u;
          }
          d[di + 3] = 255;
        }
      }
    } else {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = deep[0]; d[i + 1] = deep[1]; d[i + 2] = deep[2]; d[i + 3] = 255;
      }
    }

    // Slow deep grade only in upper extension (far from junction / plate)
    for (let y = 0; y < ext; y++) {
      const above = ext - 1 - y;
      for (let x = 0; x < nw; x++) {
        const bay = BAYER4[(((above >> 1) & 3) << 2) | ((x >> 1) & 3)];
        const aq = (Math.floor((above + (bay - 0.5) * 10) / 40) + 0.5) * 40;
        const t = aq / (ext * 0.9);
        if (t < 0.5) continue;
        const u = (t - 0.5) / 0.5;
        const deepW = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, u));
        const i = (y * nw + x) * 4;
        d[i] = (d[i] * (1 - deepW) + deep[0] * deepW) | 0;
        d[i + 1] = (d[i + 1] * (1 - deepW) + deep[1] * deepW) | 0;
        d[i + 2] = (d[i + 2] * (1 - deepW) + deep[2] * deepW) | 0;
      }
    }

    if (pal.parallax === "night" || pal.parallax === "dusk") {
      for (let i = 0; i < 180; i++) {
        const x = (this._rand() * nw) | 0;
        const y = (this._rand() * Math.max(1, (ext * 0.45) | 0)) | 0;
        const di = (y * nw + x) * 4;
        const a = 0.35 + this._rand() * 0.55;
        d[di] = Math.min(255, d[di] + ((210 * a) | 0));
        d[di + 1] = Math.min(255, d[di + 1] + ((225 * a) | 0));
        d[di + 2] = Math.min(255, d[di + 2] + ((255 * a) | 0));
      }
    }

    // Write extension ONLY — plate region [ext, ext+nh) untouched
    ctx.putImageData(extImg, 0, 0);

    this._tallSky = c;
    this._tallSkyExt = ext;
    this._tallSkyNh = nh;
    this._tallSkyNw = nw;
    return c;
  };

  // Replace blue-sky pixels inside the seat footprint with a per-row sky reference
  // (left/right strips), feathered at the edges. Tower/cloud/structure pixels are
  // never touched (hue test + outward stop on 3 consecutive non-sky pixels).
  LiftoffEngine.prototype._deghostPlate = function (plate, nw, nh) {
    const seat = (this.getSeat && this.getSeat()) || {};
    const cx = Math.round(seat.cx != null ? seat.cx : nw / 2);
    const sitY = Math.round(seat.sitY != null ? seat.sitY : nh * 0.76);
    const W = 118, S = 26, FE = 18, K = 16;
    if (cx - W - S < 0 || cx + W + S >= nw) return plate;
    const c = document.createElement("canvas");
    c.width = nw; c.height = nh;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(plate, 0, 0, nw, nh);
    let img;
    try { img = g.getImageData(0, 0, nw, nh); } catch (e) { return plate; }
    const d = img.data;
    const y1 = Math.min(nh, sitY + 34);
    const isSky = (i) => {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      return (b > r * 1.35 + 10 && b > gg * 1.05) || (r + gg + b > 430 && b > r + 25 && b >= gg);
    };
    const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
    const stripRef = (y, xa, xb) => {
      const R = [], G = [], B = [];
      for (let x = xa; x < xb; x++) {
        const i = (y * nw + x) * 4;
        if (isSky(i)) { R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]); }
      }
      return R.length >= 6 ? [med(R), med(G), med(B)] : null;
    };
    const Lr = [], Rr = [];
    let prevL = null;
    for (let y = 0; y < y1; y++) {
      let L = stripRef(y, cx - W - S, cx - W);
      let R = stripRef(y, cx + W, cx + W + S);
      if (!L) L = prevL || R;
      if (!R || (L && Math.abs(R[0] - L[0]) + Math.abs(R[1] - L[1]) + Math.abs(R[2] - L[2]) > 45)) R = L;
      prevL = L;
      Lr.push(L); Rr.push(R);
    }
    const smooth = (arr) => arr.map((_, y) => {
      if (!arr[y]) return null;
      const a0 = [], a1 = [], a2 = [];
      for (let k = Math.max(0, y - K); k <= Math.min(arr.length - 1, y + K); k++) {
        if (arr[k]) { a0.push(arr[k][0]); a1.push(arr[k][1]); a2.push(arr[k][2]); }
      }
      return [med(a0), med(a1), med(a2)];
    });
    const Ls = smooth(Lr), Rs = smooth(Rr);
    for (let y = 0; y < y1; y++) {
      if (!Ls[y]) continue;
      for (let dir = -1; dir <= 1; dir += 2) {
        let run = 0;
        for (let x = (dir < 0 ? cx : cx + 1); dir < 0 ? x >= cx - W : x <= cx + W; x += dir) {
          const i = (y * nw + x) * 4;
          if (!isSky(i)) { if (++run >= 3) break; continue; }
          run = 0;
          const t = (x - (cx - W)) / (2 * W);
          const e = Math.min(x - (cx - W), (cx + W) - x);
          let w = Math.min(1, e / FE); w = w * w * (3 - 2 * w);
          for (let ch = 0; ch < 3; ch++) {
            const ref = Ls[y][ch] * (1 - t) + Rs[y][ch] * t;
            d[i + ch] = (d[i + ch] * (1 - w) + ref * w) | 0;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  };

  // Modular stacks are composed gap-free from clean kit pieces (no streak clipping).
  // Measure the seated nose (camera framing) and hull width (flame sizing) only.
  LiftoffEngine.prototype._measureStack = function () {
    const st = this.getStackEl && this.getStackEl();
    const lb = this._lb;
    if (!st || !lb || !st.width || !st.height) return;
    st.style.clipPath = ""; st.style.webkitClipPath = "";
    const w = st.width, h = st.height;
    let data;
    try { data = st.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data; } catch (e) { return; }
    let top = -1;
    for (let y = 0; y < h && top < 0; y++) {
      for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 100) { top = y; break; }
    }
    if (top < 0) return;
    const cssH = parseFloat(st.style.height) || (h / (this._dpr || 1));
    const pxPerCss = h / cssH;
    this._tipLocal0 = (parseFloat(st.style.top) || 0) + top / pxPerCss;
    const seat = (this.getSeat && this.getSeat()) || {};
    if (seat.hullW) this._hullWcss = seat.hullW * HULL_K * (lb.width / lb.nw);
  };

  // Landscape follow zoom target: fit nose (5.5% from top) + rocket + >=PLUME_MIN_CSS plume
  LiftoffEngine.prototype._landZoomTarget = function () {
    const lb = this._lb, seat = (this.getSeat && this.getSeat()) || {};
    const wrapH = this._wrapH || 390;
    const hN = seat.stackH || seat.targetH || 500;
    const hCss = hN * (lb ? lb.height / lb.nh : 0.66);
    return clamp((wrapH * (1 - NOSE_FRAC_LAND) - PLUME_MIN_CSS) / Math.max(1, hCss), ZOOM_LAND_FLOOR, ZOOM_LAND_MIN);
  };

  LiftoffEngine.prototype._sidePad = function (tall, nw, H, padN, left) {
    const MIR = 12, EDGE = 24, WIDE = 240, BLUR = 90, XF = 40;
    let src;
    try {
      src = tall.getContext("2d", { willReadFrequently: true }).getImageData(left ? 0 : nw - EDGE, 0, EDGE, H).data;
    } catch (e) { return tall; }
    // per-row edge mean, then vertical box blur
    // per-row MEDIAN over a wide edge strip (by luminance) -> clouds / stars / spires are
    // outvoted by the sky, so nothing gets smeared sideways into streaks
    let wide;
    try {
      wide = tall.getContext("2d", { willReadFrequently: true }).getImageData(left ? 0 : nw - WIDE, 0, WIDE, H).data;
    } catch (e) { wide = null; }
    const row = new Float32Array(H * 3), blur = new Float32Array(H * 3);
    const lum = new Float32Array(WIDE), idx = new Array(WIDE);
    for (let y = 0; y < H; y++) {
      if (wide) {
        for (let x = 0; x < WIDE; x++) { const i = (y * WIDE + x) * 4; lum[x] = wide[i] * 0.3 + wide[i + 1] * 0.59 + wide[i + 2] * 0.11; idx[x] = x; }
        idx.sort((p, q) => lum[p] - lum[q]);
        // average the 35-55th percentile band (robust median)
        let r = 0, g = 0, b = 0, n = 0;
        for (let q = Math.floor(WIDE * 0.25); q < Math.floor(WIDE * 0.45); q++) { const i = (y * WIDE + idx[q]) * 4; r += wide[i]; g += wide[i + 1]; b += wide[i + 2]; n++; }
        row[y * 3] = r / n; row[y * 3 + 1] = g / n; row[y * 3 + 2] = b / n;
      } else {
        let r = 0, g = 0, b = 0;
        for (let x = 0; x < EDGE; x++) { const i = (y * EDGE + x) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; }
        row[y * 3] = r / EDGE; row[y * 3 + 1] = g / EDGE; row[y * 3 + 2] = b / EDGE;
      }
    }
    for (let y = 0; y < H; y++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = -BLUR; k <= BLUR; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; r += row[yy * 3]; g += row[yy * 3 + 1]; b += row[yy * 3 + 2]; n++; }
      blur[y * 3] = r / n; blur[y * 3 + 1] = g / n; blur[y * 3 + 2] = b / n;
    }
    // SLOP-4 (audio1): no mirrored columns. Seam colour = the outer 3 plate columns averaged per
    // row and blurred vertically (never a reflected image), dithered into the wide sky median.
    const edge = new Float32Array(H * 3);
    for (let y = 0; y < H; y++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = -6; k <= 6; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue;
        for (let q = 0; q < 3; q++) { const i = (yy * EDGE + (left ? q : EDGE - 1 - q)) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; } }
      edge[y * 3] = r / n; edge[y * 3 + 1] = g / n; edge[y * 3 + 2] = b / n;
    }
    const c = document.createElement("canvas"); c.width = padN; c.height = H;
    const g2 = c.getContext("2d");
    const img = g2.createImageData(padN, H), d = img.data;
    for (let y = 0; y < H; y++) {
      for (let j = 0; j < padN; j++) {
        // j = distance from the seam (0 = adjacent to the plate edge)
        const x = left ? padN - 1 - j : j;
        const o = (y * padN + x) * 4;
        const bay = BAYER4[(((y >> 1) & 3) << 2) | ((j >> 1) & 3)];
        const t = Math.min(1, j / (MIR + XF));
        const useBlur = bay < t * t * (3 - 2 * t);
        const k3 = y * 3;
        const src3 = useBlur ? blur : edge;
        d[o] = src3[k3]; d[o + 1] = src3[k3 + 1]; d[o + 2] = src3[k3 + 2]; d[o + 3] = 255;
      }
    }
    g2.putImageData(img, 0, 0);
    return c;
  };

  LiftoffEngine.prototype.drawTallSky = function () {
    // Tall sky lives INSIDE #world/#plateWrap so camY pans it with the stack.
    // Drawn once (full bitmap) — no per-frame source-rect (avoids sampling tears).
    const tall = this._tallSky;
    const lb = this._lb;
    if (!tall || !lb) return;

    const plateWrap = document.getElementById("plateWrap");
    const host = plateWrap || (this.getWorldEl && this.getWorldEl());
    if (!host) return;

    let canvas = this._tallSkyCanvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "tallSky";
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = "position:absolute;pointer-events:none;image-rendering:pixelated;image-rendering:crisp-edges;z-index:0;";
      if (host.firstChild) host.insertBefore(canvas, host.firstChild);
      else host.appendChild(canvas);
      this._tallSkyCanvas = canvas;
      this._tallSkyDrawnKey = "";
    }

    const dpr = this._dpr || 1;
    const ext = this._tallSkyExt | 0;
    const nh = this._tallSkyNh | 0;
    const nw = this._tallSkyNw | 0;
    const extCss = (ext / nh) * lb.height;
    const totalH = lb.height + extCss;
    // Landscape: mirror-padded side strips (continuous at the edge) so the follow zoom-out
    // never exposes empty margins. Portrait cover is already wider than the screen.
    const landscape = (this._wrapW || 844) > (this._wrapH || 390);
    const zPad = landscape ? (this._zoomLand || this._landZoomTarget()) : 1;
    const padCss = landscape ? Math.ceil(lb.width * (1 / zPad - 1) / 2) + 8 : 0;
    const centerW = Math.max(1, Math.round(lb.width * dpr));
    const padPx = Math.round(padCss * dpr);
    const cw = centerW + 2 * padPx;
    const ch = Math.max(1, Math.round(totalH * dpr));

    // INTEGER CSS box — fractional top/height causes a full-frame horizontal sampling tear
    canvas.style.left = (Math.round(lb.left) - padCss) + "px";
    canvas.style.top = Math.round(lb.top - extCss) + "px";
    canvas.style.width = (Math.round(lb.width) + 2 * padCss) + "px";
    canvas.style.height = Math.round(totalH) + "px";
    canvas.style.display = "block";

    const key = [cw, ch, nw, nh, ext, padPx, this.getTodId()].join(":");
    if (canvas.width !== cw || canvas.height !== ch || this._tallSkyDrawnKey !== key) {
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // ONE blit of the entire tall bitmap (extension + exact plate) — contiguous, no tear
      ctx.drawImage(tall, 0, 0, nw, nh + ext, padPx, 0, centerW, ch);
      if (padPx > 0) {
        // Side fill: a narrow mirror (12 native px) at the seam, then the edge colour per row
        // (mean of the outer 24 columns, vertically blurred) -> the plate's sun/tower can
        // never repeat in the margin, and no hard horizontal streaks.
        const padN = Math.min(nw, Math.ceil((padPx / centerW) * nw));
        const L = this._sidePad(tall, nw, nh + ext, padN, true), R = this._sidePad(tall, nw, nh + ext, padN, false);
        ctx.drawImage(L, 0, 0, padN, nh + ext, 0, 0, padPx, ch);
        ctx.drawImage(R, 0, 0, padN, nh + ext, padPx + centerW, 0, padPx, ch);
      }
      this._tallSkyDrawnKey = key;
    }

    // Hide plate — tall sky already contains exact plate pixels
    const plate = this.getPlateEl && this.getPlateEl();
    if (plate) {
      plate.style.display = "none";
      plate.style.visibility = "hidden";
      plate.style.opacity = "0";
      plate.style.webkitMaskImage = "";
      plate.style.maskImage = "";
    }
    const sky = this.getSkyEl && this.getSkyEl();
    if (sky) {
      sky.style.display = "none";
      sky.style.opacity = "0";
      sky.innerHTML = "";
      sky._skyCanvas = null;
    }
    const px = this.getParallaxEl && this.getParallaxEl();
    if (px) px.style.display = "none";
  };

  LiftoffEngine.prototype.updateTallSkyPan = function () {
    // World transform carries tallSky; just ensure canvas exists/hidden plate
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
    canvas.style.width = Math.round(wrapW) + "px";
    canvas.style.height = Math.round(wrapH) + "px";
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

    this._zoomLand = this._landZoomTarget();
    this.buildTallSky();
    this.buildParallax();
    this.drawTallSky();
    this._measureStack();

    const px = this.getParallaxEl();
    if (px) px.style.display = "none"; // v3: altitude layer (#altSky) owns stars/clouds
    this._altStars = null;
    this._altClouds = null;
    this._ensureAltCanvas();

    this._fxReady = true;
    return true;
  };


  /* ---------- audio v1 (web/audio.js: synthesized, scheduled on the sim timeline) ---------- */
  LiftoffEngine.prototype.ensureAudio = function () {
    if (this.audio) return this.audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    const RA = global.RocketBayAudio;
    if (!AC || !RA) return null;
    let ctx;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { try { ctx = new AC(); } catch (_) { return null; } }
    const chain = RA.makeChain(ctx, ctx.destination);
    chain.user.gain.value = this.audioMuted ? 0 : 1;
    this.audio = { ctx: ctx, chain: chain, master: chain.user, launch: null };
    return this.audio;
  };
  // Must run inside the GO tap (iOS): create/resume the context and play one silent sample.
  LiftoffEngine.prototype.unlockAudio = function () {
    const a = this.ensureAudio();
    if (!a) return;
    try { if (a.ctx.state !== "running") a.ctx.resume().catch(function () {}); } catch (_) {}
    try {
      const b = a.ctx.createBuffer(1, 1, a.ctx.sampleRate), s = a.ctx.createBufferSource();
      s.buffer = b; s.connect(a.ctx.destination); s.start(0);
    } catch (_) {}
  };
  LiftoffEngine.prototype.setMuted = function (muted) {
    this.audioMuted = !!muted;
    if (!this.audio) return;
    const g = this.audio.master.gain, now = this.audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.audioMuted ? 0 : 1, now + 0.06);
  };
  LiftoffEngine.prototype.setAudioLevel = function () { /* v1: levels are scheduled in audio.js */ };
  LiftoffEngine.prototype._scheduleLaunchAudio = function () {
    const a = this.audio, RA = global.RocketBayAudio;
    this._audioT0 = null;
    if (!a || !RA || this.captureMode) return;
    const seat = (this.getSeat && this.getSeat()) || {};
    const t0 = a.ctx.currentTime + 0.05;
    a.launch = RA.scheduleLaunch(a.ctx, a.chain.input, t0, { boosters: !!(seat.nozzles && seat.nozzles.length > 1) });
    this._audioT0 = t0;
  };
  LiftoffEngine.prototype.stopAudio = function (immediate) {
    this._audioT0 = null;
    if (!this.audio || !this.audio.launch) return;
    this.audio.launch.stop(this.audio.ctx.currentTime, immediate ? 0.03 : 0.5);
    this.audio.launch = null;
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
    // modular stack: nozzle row = first-stage feet (side boosters are flush with them)
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
    const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
    const cx = seat.cx;
    const trenchW = Math.max(40, (seat.width || 100) * 1.1);
    const shear = this._shearT > 0 ? clamp(this._shearT / 0.7, 0, 1) : 0; // C1 smoke shear
    this._smokeAcc += (38 + 55 * shear) * intensity * (this._lastDt || 1 / 60);
    let n = Math.floor(this._smokeAcc);
    this._smokeAcc -= n;
    if (n > (shear > 0.2 ? 10 : 6)) n = shear > 0.2 ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const dir = this._rand() < 0.5 ? -1 : 1;
      const spd = (25 + this._rand() * 95) * (0.6 + 0.5 * intensity) * (1 + 1.6 * shear);
      this.spawn(
        this.ground,
        cx + (this._rand() - 0.5) * trenchW * (1 + 0.4 * shear),
        deckY - 6 + (this._rand() - 0.25) * 30,
        dir * spd,
        -6 - this._rand() * 18 - shear * this._rand() * 12,
        1.8 + this._rand() * 2.4,
        22 + this._rand() * 18 + shear * 10,
        (this._rand() * 4) | 0,
        0
      );
    }
  };

  // C1: one-shot lateral smoke burst at ignition (reads as shear away from trench)
  LiftoffEngine.prototype.emitIgnitionShear = function (seat) {
    const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
    const cx = seat.cx;
    const trenchW = Math.max(40, (seat.width || 100) * 1.1);
    for (let i = 0; i < 28; i++) {
      const dir = i & 1 ? -1 : 1;
      this.spawn(
        this.ground,
        cx + dir * (trenchW * 0.15 + this._rand() * trenchW * 0.55),
        deckY - 4 + (this._rand() - 0.3) * 24,
        dir * (90 + this._rand() * 140),
        -4 - this._rand() * 22,
        1.2 + this._rand() * 1.6,
        18 + this._rand() * 22,
        (this._rand() * 4) | 0,
        0
      );
    }
  };

  LiftoffEngine.prototype.emitTrail = function (seat) {
    const nz = this.nozzleNative(seat);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    for (let n = 0; n < nozzles.length; n++) {
      const nx = nz.x + nozzles[n];
      if (this._rand() < 0.5) continue;
      this.spawn(
        this.trail,
        nx + (this._rand() - 0.5) * 12,
        nz.y + 20 + this._rand() * 30,
        (this._rand() - 0.5) * 30,
        20 + this._rand() * 40,
        0.7 + this._rand() * 0.8,
        8 + this._rand() * 10,
        (this._rand() * 4) | 0,
        0
      );
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
          o.vx *= Math.pow(0.55, dt);
          o.vy -= 5 * dt;
          o.size += 7 * dt; // billow
        } else {
          o.vx *= 0.97;
          o.size += 10 * dt;
        }
      }
    };
    update(this.ground, true);
    update(this.trail, false);
  };

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
      const isSide = ni > 0;
      const scaleN = seat.nozzleScales ? seat.nozzleScales[ni] : (isSide ? 0.42 : 1);
      const nx = nz.x + nozzles[ni];
      const css = this.cssFromNative(nx, nz.y + (seat.nozzleDy && seat.nozzleDy[ni] ? seat.nozzleDy[ni] : 0));
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
    const cxp = Math.round(bx), cyp = Math.round(by);
    if (rr <= 1) { bctx.fillRect(cxp, cyp, 1, 1); return; }
    for (let dy = -rr; dy <= rr; dy++) {
      const span = Math.round(Math.sqrt(Math.max(0, rr * rr + rr * 0.2 - dy * dy)));
      if (span <= 0) continue;
      bctx.fillRect(cxp - span, cyp + dy, span * 2 + 1, 1);
    }
  };

  LiftoffEngine.prototype.drawSmoke = function (bctx, seat, pal, cyB) {
    // Opaque pixel-dithered billows (4 grey tones, lit top-left), written straight into
    // the low-res buffer. Larger near the trench, smaller farther out. Orange underlight
    // only while the engine is close to the deck.
    const W = this._bufW, H = this._bufH;
    if (!this._smokeImg || this._smokeImg.width !== W || this._smokeImg.height !== H) {
      this._smokeImg = bctx.createImageData(W, H);
      this._smokeU32 = new Uint32Array(this._smokeImg.data.buffer);
    }
    const u32 = this._smokeU32;
    u32.fill(0);
    const pack = (c) => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
    const key = this.getTodId();
    if (this._smokeKey !== key) {
      this._smokeKey = key;
      this._smokeTones = pal.smoke.map(function (c) { return pack(hexRgb(c)); });
      this._smokeLitTones = pal.smokeLit.map(function (c) { return pack(hexRgb(c)); });
    }
    const tones = this._smokeTones, lits = this._smokeLitTones;
    const lb = this._lb, bs = this._bScale;
    const zs = this._zoom || 1;
    const pxN = (lb.width / lb.nw) * bs * zs; // native -> buffer px (zoomed)
    const riseCss = this.rocketY * (lb.height / lb.nh);
    const engineNear = clamp(1 - riseCss / 140, 0, 1) * clamp(this.flameIntensity, 0, 1);
    const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
    const trenchW = Math.max(40, (seat.width || 100) * 1.1);
    const flick = 0.85 + 0.15 * Math.sin(this._simTime * 31);
    // SLOP-1: keep-out columns so the flame + engine bells read through the smoke from the
    // first ignition frame (smoke still billows around/behind them). Dithered edge.
    const keep = [];
    if (this.ignited) {
      const nz = this.nozzleNative(seat), nzs = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
      const hullCss = Math.max(18, zs * (this._hullWcss || ((Math.max(80, seat.width || 120) / lb.nw) * lb.width * 0.76)));
      const flameLen = Math.max(hullCss * 0.9, this._flameLenCss || 0);
      for (let ni = 0; ni < nzs.length; ni++) {
        const sc = seat.nozzleScales ? seat.nozzleScales[ni] : (ni ? 0.42 : 1);
        const ndy = seat.nozzleDy && seat.nozzleDy[ni] ? seat.nozzleDy[ni] : 0;
        const cp = this.cssFromNative(nz.x + nzs[ni], nz.y + ndy), c = this._w2s(cp.x, cp.y);
        const hw = Math.max(2.5, hullCss * sc * 0.5) * bs;
        keep.push({ x: c.x * bs, y0: c.y * bs - hullCss * sc * 0.45 * bs, y: c.y * bs, y1: c.y * bs + flameLen * 0.95 * bs, hw: hw });
      }
    }
    this._smokeKeep = keep;
    const kept = (x, y, b) => {
      for (let k = 0; k < keep.length; k++) {
        const q = keep[k];
        if (y < q.y0 || y > q.y1) continue;
        const grow = y > q.y ? 1 + 0.35 * (y - q.y) / Math.max(1, q.y1 - q.y) : 1;
        const tail = y > q.y ? 1 - smooth01(0.7, 1, (y - q.y) / Math.max(1, q.y1 - q.y)) : 1;
        const dx = Math.abs(x - q.x) / (q.hw * grow);
        if (dx < (0.8 + 0.35 * b) * tail) return true;
      }
      return false;
    };
    const drawPool = (pool, isTrail) => {
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i];
        if (!o.alive) continue;
        const t = o.life / o.max;
        const dist = Math.abs(o.x - seat.cx) / (trenchW * 2.6);
        const sizeK = isTrail ? 1 : (1.25 - 0.6 * clamp(dist, 0, 1));
        const r = Math.max(1.5, o.size * 0.5 * sizeK * pxN);
        const ry = r * 0.78;
        const cw0 = this.cssFromNative(o.x, o.y);
        const css = this._w2s(cw0.x, cw0.y);
        const bx = css.x * bs, by = css.y * bs;
        if (bx + r < 0 || bx - r >= W || by + ry < 0 || by - ry >= H) continue;
        const fade = smooth01(0.68, 1, t);
        const seed = (i * 2654435761) >>> 0;
        const near = isTrail ? 0 : engineNear * clamp(1 - Math.abs(o.x - seat.cx) / (trenchW * 2.2), 0, 1)
          * clamp(1 - Math.abs(o.y - deckY) / 70, 0, 1) * flick;
        const x0 = Math.max(0, Math.floor(bx - r)), x1 = Math.min(W - 1, Math.ceil(bx + r));
        const y0 = Math.max(0, Math.floor(by - ry)), y1 = Math.min(H - 1, Math.ceil(by + ry));
        const ir = 1 / r, iry = 1 / ry;
        for (let y = y0; y <= y1; y++) {
          const ny = (y - by) * iry;
          const row = y * W;
          for (let x = x0; x <= x1; x++) {
            const nx = (x - bx) * ir;
            // lumpy edge: 3-lobe wobble so puffs aren't perfect circles
            const ang = Math.atan2(ny, nx);
            const lump = 1 + 0.12 * Math.sin(ang * 3 + (seed & 7)) + 0.06 * Math.sin(ang * 5 + (seed >> 5 & 7));
            const d = Math.sqrt(nx * nx + ny * ny) / lump;
            if (d > 1) continue;
            const b = BAYER4[((y & 3) << 2) | (x & 3)];
            if (d > 0.8 + 0.2 * b) continue; // dithered rim
            if (keep.length && kept(x, y, b)) continue;
            let h = (x * 374761393 + y * 668265263 + seed) >>> 0;
            h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
            const hn = (h & 1023) / 1023;
            if (fade > 0 && hn < fade) continue; // dithered dissolve with age
            // light from top-left; dark underside; slight noise
            const l = -0.5 * nx - 0.8 * ny + 0.25 * (1 - d) + (hn - 0.5) * 0.12;
            let ti = Math.floor(1.75 - l * 1.45 + (b - 0.5) * 0.55);
            ti = ti < 0 ? 0 : (ti > 3 ? 3 : ti);
            if (near > 0.02 && ny > -0.2) {
              // blotchy warm underlight: noise-broken, strongest low in the puff, never a stripe
              const s = near * (0.45 + 0.6 * ny) * (1 - 0.3 * Math.abs(nx)) * (1 - 0.35 * d);
              if (s + b * 0.35 + (hn - 0.5) * 0.7 > 0.62) {
                const li = Math.min(2, Math.max(0, Math.floor((1 - s) * 2.2 + (b - 0.5) * 0.6)));
                u32[row + x] = lits[li];
                continue;
              }
            }
            u32[row + x] = tones[ti];
          }
        }
      }
    };
    drawPool(this.ground, false);
    drawPool(this.trail, true);
    bctx.putImageData(this._smokeImg, 0, 0);
  };

  LiftoffEngine.prototype.drawPadGlow = function (bctx, seat, pal) {
    if (this.flameIntensity < 0.05) return;
    const bs = this._bScale;
    const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
    const css = this.cssFromNative(seat.cx, deckY);
    const bx = css.x * bs;
    const by = css.y * bs;
    const flick = 0.75 + 0.25 * Math.sin(this._simTime * 40);
    const riseCss = this.rocketY * (this._lb.height / this._lb.nh);
    const nearPad = clamp(1 - riseCss / 90, 0, 1); // glow only while nozzle is near deck
    const str = this.flameIntensity * flick * (0.5 + this.releaseFlash * 1.5) * nearPad;
    if (str < 0.02 && this.releaseFlash <= 0.05) return;
    const gw = Math.max(20, (seat.width || 100) / this._lb.nw * this._lb.width * bs * 1.8);
    // glow lights the smoke, not the engine bells (keep-out columns stay clean)
    const keep = this._smokeKeep || [];
    bctx.save();
    if (keep.length) {
      const m = bctx.getTransform();
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.beginPath(); bctx.rect(0, 0, this._bufW, this._bufH);
      for (let k = 0; k < keep.length; k++) { const q = keep[k]; bctx.rect(q.x - q.hw * 1.1, q.y0, q.hw * 2.2, q.y1 - q.y0); }
      bctx.clip("evenodd");
      bctx.setTransform(m);
    }
    bctx.globalCompositeOperation = "lighter";
    // Soft disc glow — avoid hard horizontal bars that read as flame geometry
    const rings = this.phase === "climb" ? 3 : 5;
    for (let i = 0; i < rings; i++) {
      bctx.globalAlpha = str * (1 - i / rings) * (this.phase === "climb" ? 0.08 : 0.14);
      bctx.fillStyle = pal.pad;
      const rx = Math.round((gw * 0.35) + i * 3);
      const ry = Math.max(1, Math.round(rx * 0.45));
      for (let yy = -ry; yy <= ry; yy++) {
        const span = Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))) * rx;
        bctx.fillRect(Math.round(bx - span), Math.round(by) + yy, Math.round(span * 2), 1);
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
          bctx.globalAlpha = this.releaseFlash * 0.3 * fall * fall;
          bctx.fillRect(Math.round(bx + dx), Math.round(by + dy * 0.5), 1, 1);
        }
      }
    }
    bctx.restore();
    bctx.globalCompositeOperation = "source-over";
    bctx.globalAlpha = 1;
  };

  LiftoffEngine.prototype.drawFx = function (seat) {
    if (!this._fxReady) return;
    const bctx = this._bctx;
    const ctx = this._ctx;
    const pal = TOD_GLOW[this.getTodId()] || TOD_GLOW["05"];
    // FX canvas is SCREEN-fixed (counter-translated against world camY) so the flame
    // can never be clipped at the canvas top on high pans; draw world coords with +camY.
    const fxEl = this.getFxCanvas();
    if (fxEl) { fxEl.style.transformOrigin = "0 0"; fxEl.style.transform = this._screenFixedTransform(); }
    const bs = this._bScale;
    const zz = this._zoom || 1;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.imageSmoothingEnabled = false;
    this.drawSmoke(bctx, seat, pal, 0);
    bctx.setTransform(zz, 0, 0, zz, (this._tx || 0) * bs, (this._camYi || 0) * bs);
    this.drawPadGlow(bctx, seat, pal);
    bctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this._wrapW, this._wrapH);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this._buf, 0, 0, this._bufW, this._bufH, 0, 0, this._wrapW, this._wrapH);

    if (this.ignited) {
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0); // flame computed in screen px
      this.drawFlameDisplay(ctx, seat, pal);
      this.drawIgnitionFlash(ctx, seat, pal);
      this.drawTowerWarmKiss(ctx, seat, pal);
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }
  };

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

  // Cellular fire: seed row 0 (nozzle), propagate down the plume with lateral
  // diffusion (dense body, no separate "tentacle" columns), length-aware cooling
  // (hot white/yellow spine persists), sparse breakup only in the outer ~30%.
  LiftoffEngine.prototype._tickFire = function (field, o) {
    // o: { seedHalf, heat, len (rows until the spine burns out), rows (rows to compute),
    //      expand (plume width multiplier reached at the tail) }
    const w = field.w, h = field.h, buf = field.buf;
    const cx = (w / 2) | 0;
    const rand = () => this._rand();
    const seedHalf = Math.max(3, o.seedHalf | 0), heat = o.heat;
    const len = Math.max(24, o.len);
    const rows = Math.max(2, Math.min(h, Math.ceil(o.rows || h)));
    // spread: sample slightly toward the axis each row -> plume expands downstream
    const spread = Math.log(Math.max(1, o.expand || 1)) / len;
    // Seed: dense hot core, noisy flanks (never a solid bar edge)
    buf.fill(0, 0, 2 * w);
    for (let x = Math.max(0, cx - seedHalf - 1); x <= Math.min(w - 1, cx + seedHalf + 1); x++) {
      const dd = Math.abs(x - cx) / seedHalf;
      let v = 0;
      if (dd <= 1) {
        if (dd < 0.5) v = heat - ((rand() * 3) | 0);
        else {
          const t = 1 - (dd - 0.5) / 0.5;
          v = Math.round(heat * (0.35 + 0.65 * t) * (0.55 + rand() * 0.45));
          if (rand() < 0.3 * (1 - t)) v = 0;
        }
      }
      buf[x] = v;
      buf[w + x] = Math.max(0, v - ((rand() * 2) | 0));
    }
    const baseCool = Math.min(1.8, (heat * 0.8) / len);
    let lo = Math.max(1, cx - seedHalf - 2), hi = Math.min(w - 2, cx + seedHalf + 2);
    let y = 2;
    for (; y < rows; y++) {
      const ry = (y - 1) * w, row = y * w;
      const yf = y / len;
      const halfW = seedHalf * Math.exp(spread * y);
      const nlo = Math.max(1, lo - 3), nhi = Math.min(w - 2, hi + 3);
      if (nlo > 0) buf.fill(0, row, row + nlo);
      if (nhi < w - 1) buf.fill(0, row + nhi + 1, row + w);
      let newLo = w, newHi = -1;
      for (let x = nlo; x <= nhi; x++) {
        let sx = x + (((rand() * 3) | 0) - 1);
        if (spread) sx = Math.floor(cx + (sx - cx) * (1 - spread) + rand()); // stochastic -> real expansion
        const x0 = sx < 1 ? 1 : (sx > w - 2 ? w - 2 : sx);
        const from = rand() < 0.5
          ? buf[ry + x0]
          : ((buf[ry + x0 - 1] + 2 * buf[ry + x0] + buf[ry + x0 + 1] + ((rand() * 4) | 0)) >> 2);
        let next = from;
        if (from > 0) {
          const edge = Math.abs(x - cx) / halfW;
          // white spine burns off early (less white-heavy), yellow/orange body lasts,
          // flanks + tail cool faster -> tapered tail
          let pc = baseCool * (from >= 28 ? 1.75 : from >= 14 ? 0.8 : 1.45)
            * (edge > 0.8 ? 1.6 : 1) * (1 + 1.8 * yf * yf * (0.35 + edge));
          if (o.cool) pc *= o.cool;
          while (pc > 0) { if (rand() < Math.min(1, pc)) next--; pc -= 1; }
          if (from < 16 && edge > 0.5 && rand() < 0.08) next -= 3 + ((rand() * 4) | 0);
          if (from >= 26 && rand() < 0.04) next = Math.min(heat, next + 2);
        }
        if (next > 0) { buf[row + x] = next; if (x < newLo) newLo = x; if (x > newHi) newHi = x; }
        else buf[row + x] = 0;
      }
      if (newHi < 0) { y++; break; }
      lo = newLo; hi = newHi;
    }
    if (y < h) buf.fill(0, y * w);
    field.activeRows = Math.min(h, y);
  };

  LiftoffEngine.prototype._paintFireBuf = function (field, pal) {
    const w = field.w, buf = field.buf, data = field.img.data;
    const h = field.activeRows != null ? field.activeRows : field.h;
    // SLOP-6: on the bright day sky the cool tail must not go dim red/brown: the day ramp keeps
    // the low end orange at full opacity and dissolves it with a sparse pixel breakup instead.
    const dayTail = pal && pal.parallax === "day";
    if (dayTail && !this._fireRampDay) {
      const ramp = [];
      // C1 PSP bands (day): orange body stays opaque; white core + red rim still read at scale
      const stops = [[255, 100, 28], [255, 120, 32], [255, 150, 36], [255, 180, 40], [255, 200, 56],
        [255, 220, 90], [255, 240, 150], [255, 250, 200], [255, 255, 230]];
      for (let i = 0; i <= 36; i++) {
        const seg = (i / 36) * (stops.length - 1);
        const i0 = Math.min(stops.length - 2, seg | 0), f = seg - i0;
        const c = mix3(stops[i0], stops[i0 + 1], f);
        ramp.push([c[0] | 0, c[1] | 0, c[2] | 0, i < 3 ? 0 : 255]);
      }
      this._fireRampDay = ramp;
    }
    if (!this._fireRamp) {
      const ramp = [];
      // C1 PSP bands matching _fx/plume-up: deep red → hot orange → white core (hard steps)
      const stops = [[0, 0, 0], [180, 40, 20], [180, 40, 20], [255, 90, 20], [255, 90, 20],
        [255, 180, 40], [255, 180, 40], [255, 255, 180], [255, 255, 230]];
      for (let i = 0; i <= 36; i++) {
        // Hard band pick (PSP-sharp): only 25% ease at band edges — no soft gaussian bloom
        const seg = (i / 36) * (stops.length - 1);
        const i0 = Math.min(stops.length - 2, seg | 0);
        const f = seg - i0;
        const c = f < 0.25 ? mix3(stops[i0], stops[i0 + 1], f / 0.25 * 0.35)
          : (f > 0.75 ? mix3(stops[i0], stops[i0 + 1], 0.65 + (f - 0.75) / 0.25 * 0.35) : stops[i0 + (f >= 0.5 ? 1 : 0)]);
        const a = i < 2 ? 0 : 255;
        ramp.push([c[0] | 0, c[1] | 0, c[2] | 0, a]);
      }
      this._fireRamp = ramp;
    }
    const ramp = dayTail ? this._fireRampDay : this._fireRamp;
    data.fill(0, 0, Math.min(data.length, (field.prevRows || field.h) * w * 4));
    for (let y = 0; y < h; y++) {
      // Non-cumulative per-row warp (±2-4 cells), mostly on cooler outer cells -> tongues
      const warpRow = Math.sin(y * 0.29 + this._simTime * 12.0) * 2.2 + Math.sin(y * 0.11 - this._simTime * 7.0) * 1.3
        + (this._rand() - 0.5) * 1.2;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const v0 = buf[row + x];
        const ew0 = 1 - Math.min(36, v0) / 36;
        const sx = clamp(x - Math.round(warpRow * (0.25 + 0.75 * ew0 * ew0)), 0, w - 1);
        let v = buf[row + sx];
        if (v > 36) v = 36;
        if (v <= 0) continue;
        if (dayTail) { if (v < 14 && this._rand() * 14 > v + 2) continue; }
        else if (v < 9 && this._rand() < 0.28) continue;
        const c = ramp[v];
        const pi = (row + x) * 4;
        data[pi] = c[0]; data[pi + 1] = c[1]; data[pi + 2] = c[2]; data[pi + 3] = c[3];
      }
    }
    field.prevRows = Math.max(1, h);
    field.canvas.getContext("2d").putImageData(field.img, 0, 0, 0, 0, w, Math.max(1, Math.max(h, field.prevRowsPainted || 0)));
    field.prevRowsPainted = h;
  };

  LiftoffEngine.prototype.drawFlameDisplay = function (ctx, seat, pal) {
    const lb = this._lb;
    const nz = this.nozzleNative(seat);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const stageW = Math.max(80, seat.width || 120);
    // Everything scales from the hull (fin-span) width in CSS px — identical proportions
    // in landscape and portrait (never from the viewport).
    const zf = this._zoom || 1;
    // (screen px) flame is simulated/rendered at the zoomed size -> 1 cell = 1 screen px
    const hullW = Math.max(18, Math.round(zf * (this._hullWcss || ((stageW / lb.nw) * lb.width * 0.76))));
    const grow = clamp(this.flameIntensity, 0.2, 1.5);
    const u = this.phase === "climb" ? smooth01(0, 5, this.climbT)
      : (this.phase === "exit" ? 1 : 0);
    let lenRatio;
    if (this.phase === "climb" || this.phase === "exit") lenRatio = 1.9 + 1.1 * u;
    else if (this.phase === "hold") lenRatio = 1.8;
    else lenRatio = 0.8 + 1.0 * clamp((grow - 0.2) / 1.0, 0, 1);
    // Length flicker (not only edges): layered fast oscillation + noise
    const t = this._simTime;
    const flick = 1 + 0.11 * Math.sin(t * 43.0) + 0.07 * Math.sin(t * 27.3 + 1.7) + (this._rand() - 0.5) * 0.12;
    const cssW0 = this.cssFromNative(nz.x, nz.y);
    const css0 = this._w2s(cssW0.x, cssW0.y); // screen px
    const wrapH = this._wrapH || 390;
    const nozzleScreenY = css0.y;
    const visRows = Math.max(8, Math.ceil(wrapH - nozzleScreenY + 4));
    // Plume may run off the bottom edge during follow (camera frames the whole rocket)
    let lenBase = hullW * lenRatio;
    if ((this._wrapW || 844) > wrapH && (this.phase === "climb" || this.phase === "exit")) {
      // landscape follow: plume scales with the rocket's on-screen height so the >=150 px of
      // room below the nozzle actually carries plume (it widens with altitude below)
      const rocketCss = (seat.stackH || seat.targetH || 480) * (lb.height / lb.nh) * zf;
      lenBase = Math.max(lenBase, rocketCss * (0.8 + 0.35 * u));
      // once zoomed out, the plume always runs past the frame bottom (>=170 px room carries flame)
      const zw = clamp((1 - zf) / 0.15, 0, 1);
      if (zw > 0) lenBase = Math.max(lenBase, visRows * (1 + 0.6 * zw));
    }
    const longMode = lenBase > hullW * lenRatio + 1;
    const lenCss = lenBase * (longMode ? 1 + (flick - 1) * 0.4 : flick);
    const seedHalf = Math.round(hullW * 0.34 * (1 + 0.25 * u));
    // Plume widens with altitude (lower ambient pressure): per-row horizontal stretch at blit
    const expand = 1.2 + 1.5 * u;
    const fw = Math.round(hullW * 4.8);
    const fh = Math.ceil(wrapH * 1.05);
    const field = this._ensureFireField(fw, fh);
    const rows = Math.min(fh, visRows, Math.ceil(lenCss * 1.2));
    // long landscape plume: slower cooling so the narrow modular hull still burns the full length
    const cool = lenBase > hullW * lenRatio + 1 ? clamp((hullW * lenRatio * 0.5) / lenBase, 0.08, 1) : 1;
    this._tickFire(field, { seedHalf: cool < 1 ? Math.round(seedHalf * 1.1) : seedHalf, heat: cool < 1 ? 40 : 36, len: lenCss, rows: rows, expand: 1, cool: cool });
    this._paintFireBuf(field, pal);
    const ar = Math.max(1, field.activeRows || rows);
    this._flameLenCss = Math.min(lenCss, visRows);
    try { global.__liftoffFlameDbg = { hullW: hullW, lenCss: lenCss, seedHalf: seedHalf, rows: ar, fw: fw, u: u }; } catch (_) {}

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "source-over";
    // SLOP-2: with strap-on boosters keep a clear gap between the core plume and each side
    // plume (tighten the core per row; side plumes keep their own width/position).
    const seedUsed = cool < 1 ? Math.round(seedHalf * 1.1) : seedHalf;
    const cf = (seedUsed + 3) / fw;               // plume content half-width / drawn width
    let sideDx = 0, sideSc = 0;
    if (nozzles.length > 1) {
      const c0 = this.cssFromNative(nz.x + nozzles[0], nz.y);
      sideDx = 1e9;
      for (let ni = 1; ni < nozzles.length; ni++) {
        const c1 = this.cssFromNative(nz.x + nozzles[ni], nz.y);
        sideDx = Math.min(sideDx, Math.abs(c1.x - c0.x) * zf);
        sideSc = Math.max(sideSc, seat.nozzleScales ? seat.nozzleScales[ni] : 0.42);
      }
    }
    const gapPx = Math.max(5, hullW * 0.17);
    for (let ni = 0; ni < nozzles.length; ni++) {
      const isSide = ni > 0;
      const sc = seat.nozzleScales ? seat.nozzleScales[ni] : (isSide ? 0.42 : 1);
      const ndy = seat.nozzleDy && seat.nozzleDy[ni] ? seat.nozzleDy[ni] : 0;
      const cw0 = this.cssFromNative(nz.x + nozzles[ni], nz.y + ndy);
      const css = this._w2s(cw0.x, cw0.y);
      ctx.globalAlpha = 1;
      // side flames: own width, but a long plume of their own (not a scaled-down stub)
      const sy = isSide ? Math.max(sc, 0.72) : 1;
      const x0c = css.x, y0c = Math.round(css.y);
      const BAND = 2;
      for (let y = 0; y < ar; y += BAND) {
        const yf = y / lenBase;
        const wsc = 1 + (expand - 1) * smooth01(0, 0.6, yf) * (1 - 0.45 * smooth01(0.72, 1.05, yf));
        let dw = Math.round(field.w * sc * wsc);
        if (!isSide && sideDx > 0) {
          const hs = cf * field.w * sideSc * wsc;
          const maxHalf = Math.max(hullW * 0.18, sideDx - gapPx - hs);
          dw = Math.min(dw, Math.round(maxHalf / cf));
        }
        const bh = Math.min(BAND, ar - y);
        ctx.drawImage(field.canvas, 0, y, field.w, bh,
          Math.round(x0c - dw / 2), y0c + Math.round(y * sy), dw, Math.max(1, Math.round((y + bh) * sy) - Math.round(y * sy)));
      }
    }

    // Exhaust trail toward pad — cooler, faster decay (early climb only)
    if (this.phase === "climb" && this.climbT < 2.6) {
      const deckY = seat.smokeY != null ? seat.smokeY : (seat.deckY != null ? seat.deckY : seat.sitY);
      const padCssY = this._w2s(0, lb.top + (deckY / lb.nh) * lb.height).y;
      const trailLen = Math.max(16, padCssY - css0.y);
      const fade = clamp(1 - this.climbT / 2.4, 0, 1);
      if (fade > 0.06 && trailLen > 10) {
        const tw = Math.max(14, Math.round(hullW * 0.9));
        const th = Math.max(28, Math.min(Math.round(trailLen), Math.ceil(wrapH * 2)));
        const trail = this._ensureTrailField(tw, th);
        this._tickFire(trail, { seedHalf: Math.round(tw * 0.35), heat: 23, len: th, rows: th, expand: 1.3 });
        this._paintFireBuf(trail, pal);
        ctx.globalAlpha = 0.5 * fade;
        ctx.drawImage(trail.canvas, 0, 0, tw, th, Math.round(css0.x - tw / 2), Math.round(css0.y), tw, Math.round(trailLen));
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };


  // C1: bright white/cream ignition oval at nozzle (PSP-sharp — no soft bloom)
  LiftoffEngine.prototype.drawIgnitionFlash = function (ctx, seat, pal) {
    const flash = Math.max(this._ignFlash || 0, (this.releaseFlash || 0) * 0.85);
    if (flash < 0.04 || !this._lb) return;
    const lb = this._lb;
    const nz = this.nozzleNative(seat);
    const nozzles = seat.nozzles && seat.nozzles.length ? seat.nozzles : [0];
    const zf = this._zoom || 1;
    const stageW = Math.max(80, seat.width || 120);
    const hullW = Math.max(18, Math.round(zf * (this._hullWcss || ((stageW / lb.nw) * lb.width * 0.76))));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "lighter";
    for (let ni = 0; ni < nozzles.length; ni++) {
      const isSide = ni > 0;
      const sc = seat.nozzleScales ? seat.nozzleScales[ni] : (isSide ? 0.42 : 1);
      const ndy = seat.nozzleDy && seat.nozzleDy[ni] ? seat.nozzleDy[ni] : 0;
      const cw0 = this.cssFromNative(nz.x + nozzles[ni], nz.y + ndy);
      const css = this._w2s(cw0.x, cw0.y);
      const rx = Math.max(3, Math.round(hullW * (isSide ? 0.28 : 0.48) * sc * (0.75 + 0.55 * flash)));
      const ry = Math.max(2, Math.round(rx * 0.38));
      const cx = Math.round(css.x), cy = Math.round(css.y + 1);
      for (let dy = -ry; dy <= ry; dy++) {
        const t = 1 - (dy * dy) / (ry * ry + 0.01);
        const span = Math.round(rx * Math.sqrt(Math.max(0, t)));
        if (span <= 0) continue;
        ctx.globalAlpha = flash * 0.55 * t;
        ctx.fillStyle = "#ffe8a0";
        ctx.fillRect(cx - span, cy + dy, span * 2 + 1, 1);
        const span2 = Math.max(1, Math.round(span * 0.55));
        ctx.globalAlpha = flash * 0.95 * t;
        ctx.fillStyle = "#fffef0";
        ctx.fillRect(cx - span2, cy + dy, span2 * 2 + 1, 1);
      }
      for (let k = 0; k < 6; k++) {
        if (this._rand() > flash) continue;
        const ang = this._rand() * Math.PI * 2;
        const rad = rx * (0.7 + this._rand() * 0.9);
        ctx.globalAlpha = flash * 0.7;
        ctx.fillStyle = this._rand() < 0.5 ? "#ffffff" : "#ffd070";
        ctx.fillRect(cx + Math.round(Math.cos(ang) * rad), cy + Math.round(Math.sin(ang) * rad * 0.45), 1, 1);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  // C1: warm orange light-kiss on tower face toward the plume (silhouette unchanged)
  LiftoffEngine.prototype._ensureTowerKiss = function (seat) {
    if (this._towerKiss && this._towerKiss.tod === this.getTodId()) return this._towerKiss;
    const plate = this.getPlateEl && this.getPlateEl();
    const pts = [];
    let tod = this.getTodId();
    try {
      if (plate && plate.naturalWidth) {
        const nw = plate.naturalWidth, nh = plate.naturalHeight;
        const c = document.createElement("canvas");
        c.width = nw; c.height = nh;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(plate, 0, 0);
        const d = g.getImageData(0, 0, nw, nh).data;
        const cx = seat.cx != null ? seat.cx : nw * 0.55;
        const sitY = seat.sitY != null ? seat.sitY : nh * 0.76;
        const x1 = Math.floor(cx - (seat.width || 100) * 0.35);
        const x0 = Math.max(0, Math.floor(cx - (seat.width || 100) * 2.4));
        const y0 = Math.max(0, Math.floor(sitY - (seat.stackH || seat.targetH || 480) * 1.05));
        const y1 = Math.min(nh - 1, Math.floor(sitY - 8));
        for (let y = y0; y <= y1; y += 2) {
          for (let x = x0; x <= x1; x += 2) {
            const i = (y * nw + x) * 4;
            const r = d[i], gv = d[i + 1], b = d[i + 2], a = d[i + 3];
            if (a < 200) continue;
            const mx = Math.max(r, gv, b), mn = Math.min(r, gv, b);
            if (mx - mn > 28) continue;
            if (mx < 22 || mx > 110) continue;
            const face = 1 - (x1 - x) / Math.max(1, x1 - x0);
            if (face < 0.35 && this._rand() > 0.15) continue;
            if (((x * 17 + y * 31) & 7) > 3 + (face * 3) | 0) continue;
            pts.push(x, y);
          }
        }
      }
    } catch (_) {}
    this._towerKiss = { tod: tod, pts: pts };
    return this._towerKiss;
  };

  LiftoffEngine.prototype.drawTowerWarmKiss = function (ctx, seat, pal) {
    if (!this.ignited || !this._lb || this.flameIntensity < 0.08) return;
    const riseCss = this.rocketY * (this._lb.height / this._lb.nh);
    const near = clamp(1 - riseCss / 160, 0, 1);
    const str = clamp(this.flameIntensity, 0, 1.4) * near * (0.55 + 0.7 * (this._ignFlash || 0) + 0.35 * (this.releaseFlash || 0));
    if (str < 0.05) return;
    const kiss = this._ensureTowerKiss(seat);
    const pts = kiss.pts;
    if (!pts || pts.length < 8) return;
    const flick = 0.75 + 0.25 * Math.sin(this._simTime * 37.0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "lighter";
    const warm = pal && pal.smokeLit && pal.smokeLit[0] ? pal.smokeLit[0] : "#ffb070";
    const hot = "#ffe0a0";
    for (let i = 0; i < pts.length; i += 2) {
      const cw = this.cssFromNative(pts[i], pts[i + 1]);
      const s = this._w2s(cw.x, cw.y);
      const x = Math.round(s.x), y = Math.round(s.y);
      if (x < -2 || y < -2 || x > this._wrapW + 2 || y > this._wrapH + 2) continue;
      const h = (pts[i] * 13 + pts[i + 1] * 7 + ((this._simTime * 20) | 0)) & 7;
      if (h > 5 + str * 2) continue;
      ctx.globalAlpha = str * flick * (h < 3 ? 0.55 : 0.28);
      ctx.fillStyle = h < 2 ? hot : warm;
      ctx.fillRect(x, y, 1, 1);
      if (h < 2 && str > 0.45) ctx.fillRect(x + 1, y, 1, 1);
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

    // No CSS drop-shadow bands on the body (read as heat scanlines). Glow is FX-only near nozzle.
    stack.style.filter = "";
  };

  /* ---------- parallax ---------- */
  LiftoffEngine.prototype.drawParallax = function () { /* v3: replaced by drawAltSky */ };

  LiftoffEngine.prototype._ensureAltCanvas = function () {
    const plateWrap = document.getElementById("plateWrap");
    if (!plateWrap) return null;
    let c = this._altCanvas;
    if (!c) {
      c = document.createElement("canvas");
      c.id = "altSky";
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;image-rendering:crisp-edges;z-index:0;display:none;";
      this._altCanvas = c;
    }
    // directly above #tallSky, below #stack
    const tall = this._tallSkyCanvas;
    if (c.parentNode !== plateWrap || (tall && c.previousSibling !== tall)) {
      if (tall && tall.parentNode === plateWrap) plateWrap.insertBefore(c, tall.nextSibling);
      else plateWrap.insertBefore(c, plateWrap.firstChild);
    }
    const W = Math.round(this._wrapW), H = Math.round(this._wrapH);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    c.style.width = W + "px";
    c.style.height = H + "px";
    return c;
  };

  LiftoffEngine.prototype._buildAltSprites = function (mode) {
    const W = this._wrapW, H = this._wrapH;
    this._altStars = [];
    for (let i = 0; i < 240; i++) {
      const depth = 0.25 + this._rand() * 0.75;
      this._altStars.push({
        x: Math.round(this._rand() * W), y: this._rand() * H, depth: depth,
        a: 0.35 + 0.65 * this._rand() * depth, s: depth > 0.85 && this._rand() < 0.5 ? 2 : 1,
      });
    }
    this._altClouds = [];
    if (mode === "night") return;
    // SLOP-5 (audio1): painted clouds that match the plates — long, wispy, slightly tilted
    // streaks built from value-noise at 2 native-px clusters, 5 tones sampled from the plate's
    // own clouds (lit from the top/sun side), dithered translucent rims, drawn at the plate's
    // native pixel scale (no chunky upscaled lobes).
    const tones = this._cloudTones || (mode === "day"
      ? [[176, 198, 226], [205, 220, 238], [226, 236, 248], [240, 245, 252], [255, 255, 255]]
      : [[120, 80, 130], [150, 96, 140], [180, 110, 130], [214, 130, 120], [240, 170, 140]]);
    const seedBase = (this._rand() * 1e6) | 0;
    const hash = (x, y, sd) => { let h = (x * 374761393 + y * 668265263 + sd * 2246822519) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) & 0xffff) / 0xffff; };
    const vnoise = (x, y, sd) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = hash(xi, yi, sd), b = hash(xi + 1, yi, sd), c = hash(xi, yi + 1, sd), d = hash(xi + 1, yi + 1, sd);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const lbS = this._lb ? this._lb.width / this._lb.nw : 1;
    for (let i = 0; i < 8; i++) {
      const cw = Math.round(110 + this._rand() * 150), ch = Math.round(26 + this._rand() * 26);
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const g = c.getContext("2d");
      const img = g.createImageData(cw, ch);
      const d = img.data;
      const sd = seedBase + i * 101;
      const tilt = -(0.08 + this._rand() * 0.16);
      for (let y = 0; y < ch; y += 2) for (let x = 0; x < cw; x += 2) {
        const xr = (x - cw / 2) / (cw / 2), yr0 = (y - ch / 2) / (ch / 2);
        const yr = yr0 - tilt * xr * (cw / ch) * 0.35;
        const env = 1 - (xr * xr * 0.9 + yr * yr * 1.25);
        if (env < -0.25) continue;
        const nA = vnoise(x / 18, y / 7, sd) * 0.55 + vnoise(x / 7, y / 4, sd + 7) * 0.3 + vnoise(x / 3, y / 2.5, sd + 13) * 0.15;
        const dens = env * 0.95 + (nA - 0.5) * 1.1;
        const bay = BAYER4[(((y >> 1) & 3) << 2) | ((x >> 1) & 3)];
        if (dens < 0.08 + 0.22 * bay) continue;
        const light = 0.55 * dens - 0.55 * yr - 0.15 * xr + (nA - 0.5) * 0.6;
        const ti = clamp(Math.floor(1.6 + light * 2.4 + (bay - 0.5) * 0.9), 0, tones.length - 1);
        const a = dens < 0.2 + 0.2 * bay ? 150 : 255; // translucent dithered rim
        for (let yy = y; yy < Math.min(ch, y + 2); yy++) for (let xx = x; xx < Math.min(cw, x + 2); xx++) {
          const p = (yy * cw + xx) * 4;
          d[p] = tones[ti][0]; d[p + 1] = tones[ti][1]; d[p + 2] = tones[ti][2]; d[p + 3] = a;
        }
      }
      g.putImageData(img, 0, 0);
      const depth = 0.45 + this._rand() * 0.9;
      this._altClouds.push({
        c: c, x: this._rand() * W - cw * lbS, y: this._rand() * H * 1.2 - H * 0.2,
        depth: depth, scale: lbS * (0.75 + depth * 0.35),
      });
    }
  };

  LiftoffEngine.prototype.drawAltSky = function (dt) {
    if (!this._fxReady || !this._lb) return;
    const c = this._ensureAltCanvas();
    if (!c) return;
    const lb = this._lb;
    const scaleY = lb.height / lb.nh;
    const cy = this._camYi || 0;
    const tod = this.getTodId();
    const pal = TOD_GLOW[tod] || TOD_GLOW["05"];
    const mode = pal.parallax;
    if (!this._altStars) this._buildAltSprites(mode);
    const zA = this._zoom || 1;
    const alt = (this.camY / zA) / scaleY; // native px of camera climb (world units)
    const v = Math.max(0, this._camVel || 0); // css px / s
    try { global.__liftoffAlt = { alt: alt, v: v }; } catch (_) {}
    if (cy <= 0 && !this.released) { c.style.display = "none"; return; }
    c.style.display = "block";
    c.style.transformOrigin = "0 0";
    c.style.transform = this._screenFixedTransform(); // screen-fixed (inverse of world zoom/pan)
    const W = c.width, H = c.height;
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);

    // 1) Sky overlay. The tall-sky extension is only clean for 2N native rows above the
    //    plate top (plate row + one mirror); above that it repeats a row (vertical streaks).
    //    Per-row alpha keyed to the extension row under that screen row -> fully opaque
    //    before the repeat. Base colour = measured plate top-row sky, so the hand-off is
    //    seamless; it then darkens with altitude toward deep blue / navy (day) or black-navy.
    const clean = this._tallSkyClean || 256;
    const base = this._skyTopRgb || (mode === "day" ? [40, 110, 210] : [8, 12, 30]);
    const a = smooth01(clean * 0.35, clean * 1.2, alt); // global (used for stars)
    let k, upA, loA;
    if (mode === "day") {
      k = smooth01(500, 4600, alt);
      const k1 = clamp(k * 2, 0, 1), k2 = clamp(k * 2 - 1, 0, 1);
      upA = mix3(mix3(base, [11, 42, 120], k1), [5, 12, 48], k2);
      loA = mix3(mix3(base, [26, 66, 156], k1), [10, 26, 80], k2);
    } else if (mode === "night") {
      k = smooth01(400, 3000, alt);
      upA = mix3(base, [1, 2, 8], k);
      loA = mix3(base, [5, 9, 24], k);
    } else {
      k = smooth01(600, 4200, alt);
      upA = mix3(mix3(base, [20, 20, 70], clamp(k * 2, 0, 1)), [4, 6, 24], clamp(k * 2 - 1, 0, 1));
      loA = mix3(mix3(base, [40, 36, 100], clamp(k * 2, 0, 1)), [10, 14, 44], clamp(k * 2 - 1, 0, 1));
    }
    // 03 sunset: the painted sky cross-fades over ~1.5 s into a vertical gradient that starts
    // from the plate's own top-band colours (row medians, mirrored like the extension), which
    // then darkens with altitude — no jump to a flat colour.
    const blendPlate = tod === "03" && this._skyRows;
    let tBlend = 1;
    if (blendPlate) {
      const topAbove = (lb.top - (4 - cy) / zA) / scaleY; // extension row at the top screen band
      if (this._altBlendT0 == null && topAbove > clean * 0.2) this._altBlendT0 = this._simTime;
      tBlend = this._altBlendT0 == null ? 0 : smooth01(0, 1.5, this._simTime - this._altBlendT0);
      this._altBlendU = tBlend;
    }
    {
      // SLOP-3 (audio1): the overlay is painted, not smooth — flat colour bands (~BAND css px)
      // whose edges are 4x4 Bayer-dithered, rendered on a half-res grid (2 css px cells) and
      // upscaled nearest-neighbour. Per-row coverage (rowA) is a dithered dissolve too.
      const f0 = clean * 0.2, f1 = Math.min(clean * 0.5, 128) + 6; // opaque before the mirror fold (N)
      const CELL = 2, BAND = 22;
      const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
      if (!this._skyLo || this._skyLo.width !== gw || this._skyLo.height !== gh) {
        this._skyLo = document.createElement("canvas"); this._skyLo.width = gw; this._skyLo.height = gh;
        this._skyLoImg = this._skyLo.getContext("2d").createImageData(gw, gh);
        this._skyLoU32 = new Uint32Array(this._skyLoImg.data.buffer);
      }
      const sc = blendPlate ? (this._skyCol || this._skyRows) : null;
      const seamY = zA * lb.top + cy;
      const warm = smooth01(H * 0.5, H * 1.1, seamY);
      const colAt = (y) => {
        const yy = clamp(y / H, 0, 1);
        if (!blendPlate) return mix3(upA, loA, yy);
        // screen-space sunset gradient: top = plate top colour; the lower screen warms toward the
        // plate's mid-sky (magenta/orange) once the plate's top edge has left the screen; the
        // upper frame deepens first with altitude (k) -> painterly, not a flat wash
        const rMax = (sc.length - 1) * 0.95 * (1 - 0.6 * k * k);
        const ri = Math.round(warm * rMax * Math.pow(yy, 1.25));
        const pc = sc[Math.max(0, Math.min(sc.length - 1, ri))];
        const kRow = clamp(k * (1.2 - 0.95 * yy * yy), 0, 1);
        return mix3(pc, mix3(upA, loA, yy), kRow);
      };
      const rowAAt = (y) => {
        const aboveN = (lb.top - (y + 4 - cy) / zA) / scaleY; // extension row (native) at this screen row
        let rowA = smooth01(f0, f1, aboveN);
        if (blendPlate) rowA = Math.max(rowA * tBlend, smooth01(clean - 48, clean - 8, aboveN)); // repeat-row streaks never show
        return rowA;
      };
      const nBands = Math.ceil(H / BAND) + 2;
      const bandCol = new Uint32Array(nBands);
      for (let bi = 0; bi < nBands; bi++) {
        const c = colAt((bi + 0.5) * BAND);
        bandCol[bi] = ((255 << 24) | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0)) >>> 0;
      }
      const u32 = this._skyLoU32;
      let any = false;
      for (let gy = 0; gy < gh; gy++) {
        const y = gy * CELL, rowA = rowAAt(y), row = gy * gw;
        if (rowA <= 0.003) { u32.fill(0, row, row + gw); continue; }
        any = true;
        for (let gx = 0; gx < gw; gx++) {
          const bay = BAYER4[((gy & 3) << 2) | (gx & 3)];
          const bi = clamp(Math.floor((y + (bay - 0.5) * BAND * 0.55) / BAND), 0, nBands - 1);
          // coverage stays a smooth per-row alpha (a dithered dissolve reads as a dot screen)
          u32[row + gx] = rowA < 0.999 ? (((bandCol[bi] & 0x00ffffff) | (((rowA * 255) | 0) << 24)) >>> 0) : bandCol[bi];
        }
      }
      if (any) {
        this._skyLo.getContext("2d").putImageData(this._skyLoImg, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(this._skyLo, 0, 0, gw, gh, 0, 0, gw * CELL, gh * CELL);
      }
      g.globalAlpha = 1;
    }

    // Stars + clouds render on an offscreen layer, then are masked by the same per-row
    // overlay alpha -> they never float over the plate's tower / painted clouds.
    if (!this._altFg || this._altFg.width !== W || this._altFg.height !== H) {
      this._altFg = document.createElement("canvas");
      this._altFg.width = W; this._altFg.height = H;
    }
    const mainG = g;
    const fg = this._altFg.getContext("2d");
    fg.setTransform(1, 0, 0, 1, 0, 0);
    fg.imageSmoothingEnabled = false;
    fg.globalCompositeOperation = "source-over";
    fg.clearRect(0, 0, W, H);
    {
    const g = fg;
    // 2) Stars (night: always; dusk/dawn: mid; day: only near the top of the climb)
    let starA;
    if (mode === "night") starA = 0.3 + 0.7 * a;
    else if (mode === "day") starA = smooth01(3000, 4800, alt);
    else starA = smooth01(1500, 3800, alt);
    const stars = this._altStars;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y += v * s.depth * 0.3 * dt;
      if (s.y > H) { s.y -= H + 6; s.x = Math.round(this._rand() * W); }
      if (starA < 0.02) continue;
      const streak = Math.round(Math.min(5, v * s.depth * 0.005));
      g.fillStyle = s.depth > 0.8 ? "#ffffff" : "#cfdcff";
      const sy = Math.round(s.y);
      if (streak > 0) { // faint short tail, bright head
        g.globalAlpha = starA * s.a * 0.4;
        g.fillRect(s.x, sy - streak, s.s, streak);
      }
      g.globalAlpha = starA * s.a;
      g.fillRect(s.x, sy, s.s, s.s);
    }
    g.globalAlpha = 1;

    // 3) Parallax clouds (day/dawn/dusk): slide down faster as velocity rises
    const clouds = this._altClouds;
    if (clouds && clouds.length) {
      const cloudA = clamp((v - 20) / 160, 0, 1) * (1 - smooth01(2000, 3600, alt)) * (mode === "day" ? 0.95 : 0.7);
      for (let i = 0; i < clouds.length; i++) {
        const cl = clouds[i];
        const stretch = 1 + Math.min(0.3, (v * cl.depth) / 4000);
        const dw = Math.round(cl.c.width * cl.scale), dh = Math.round(cl.c.height * cl.scale * stretch);
        cl.y += v * cl.depth * 0.55 * dt;
        if (cl.y > H + 4) {
          cl.y = -dh - this._rand() * H * 0.5;
          cl.x = this._rand() * (W + dw) - dw;
        }
        if (cloudA < 0.02) continue;
        g.globalAlpha = cloudA * clamp(0.55 + cl.depth * 0.4, 0, 1);
        g.drawImage(cl.c, 0, 0, cl.c.width, cl.c.height, Math.round(cl.x), Math.round(cl.y), dw, dh);
      }
      g.globalAlpha = 1;
    }
    }
    // mask: alpha follows overlay coverage (screen y where extension row crosses f0..f1)
    {
      const clean2 = this._tallSkyClean || 256;
      const yAt = (aboveN) => zA * (lb.top - aboveN * scaleY) + cy; // screen y for an extension row
      const yTop = yAt(clean2 * 0.5 + 6), yBot = yAt(clean2 * 0.2);
      if (yBot < H) {
        fg.globalCompositeOperation = "destination-in";
        if (yBot <= 0) { fg.clearRect(0, 0, W, H); }
        else {
          const gr = fg.createLinearGradient(0, Math.max(-1e5, yTop), 0, yBot);
          gr.addColorStop(0, "rgba(0,0,0,1)");
          gr.addColorStop(1, "rgba(0,0,0,0)");
          fg.fillStyle = gr;
          fg.fillRect(0, 0, W, H);
        }
        fg.globalCompositeOperation = "source-over";
      }
    }
    mainG.drawImage(this._altFg, 0, 0);
  };

  LiftoffEngine.prototype.applyTransforms = function (seat) {
    const lb = this._lb;
    if (!lb) return;
    const scaleY = lb.height / lb.nh;
    const stack = this.getStackEl();
    const world = this.getWorldEl();
    const rise = "translate3d(0," + (-this.rocketY * scaleY).toFixed(2) + "px,0)";
    if (stack) {
      stack.style.transform = rise;
      stack.style.opacity = "1";
    }
    const wrapH = this._wrapH || 390, wrapW = this._wrapW || 844;
    const landscape = wrapW > wrapH;
    const riseCss = this.rocketY * scaleY;
    if (this._tipLocal0 == null) {
      const sitCss0 = (seat.sitY / lb.nh) * lb.height;
      this._tipLocal0 = lb.top + sitCss0 - (this._stackHcss || 300);
    }
    const noseLocal = this._tipLocal0 - riseCss;       // world-local CSS y of the nose
    const noseSeat = this._tipLocal0;                   // seated nose screen y (z=1, T=0)
    const plateBottom = lb.top + lb.height;
    let z = this._zoom || 1;
    let T;
    if (this.phase === "exit") {
      // Camera eases off (exponential decel) at the settled zoom — rocket accelerates out, no cut
      const kk = 1.3;
      T = this._exitCam0 + (this._exitV0 / kk) * (1 - Math.exp(-kk * this.exitT));
    } else if (this.released) {
      // Follow = keep the WHOLE rocket framed: nose ~10% below the top edge, plume runs off
      // the bottom. Landscape can't fit stack + plume -> gentle zoom-out eased over ~1 s
      // after pickup (smoothstep: zero slope at both ends -> no jerk).
      const zoomU = this._pickupT >= 0 ? smooth01(0, 1.0, this.climbT - this._pickupT) : 0;
      // Landscape zoom (v49b): stay at 1.0 while ANY plate / clean-extension pixel can be on
      // screen. Zoom-out is bounded so the opaque altitude-sky line (extension row f1 above the
      // plate top) stays below the bottom edge: z >= (H + M - tgt) / D, D = nose -> opaque line.
      // On 03 also wait for the 1.5 s sky cross-fade to finish. Smoothed (never below bound).
      let zAllowed = 1;
      if (landscape) {
        const clean = this._tallSkyClean || 256;
        const opaqueLocal = lb.top - (Math.min(clean * 0.5, 128) + 6) * scaleY; // = drawAltSky f1
        const D = opaqueLocal - noseLocal;
        const tgtL = wrapH * NOSE_FRAC_LAND;
        const blendOk = this.getTodId() !== "03" || (this._altBlendU || 0) >= 0.999;
        if (D > 1 && blendOk) zAllowed = clamp((wrapH + 8 - tgtL) / D, this._zoomLand || ZOOM_LAND_MIN, 1);
      }
      {
        // Critically damped spring toward the allowed zoom (~0.6 s settle, C1: velocity starts
        // at 0 -> no jerk). A lagging spring on a falling bound stays above it -> plate never shows.
        const dtz = Math.min(0.05, this._lastDt || 1 / 60), W = 8.4; // ~0.6 s settle
        let zs = this._zoomS || 1, vz = this._zoomV || 0;
        const acc = W * W * (zAllowed - zs) - 2 * W * vz;
        vz += acc * dtz; zs += vz * dtz;
        if (zs < zAllowed) { zs = zAllowed; vz = Math.max(0, vz); }
        if (zs > 1) { zs = 1; vz = 0; }
        this._zoomS = zs; this._zoomV = vz;
        z = zs;
      }
      const noseTarget = wrapH * (landscape ? NOSE_FRAC_LAND : NOSE_FRAC);
      // never push the camera during the hold: start from the seated nose, glide to 10%
      // C1 soft pickup of width 2*Wp that converges EXACTLY on tgt; starts when the nose is
      // Wp below tgt, so the seated rocket never moves the camera during the hold.
      const Wp = clamp(noseSeat * 0.5, 8, 40);
      const tgt0 = Math.min(noseTarget, noseSeat - Wp);
      const tgt = lerp(tgt0, noseTarget, zoomU);
      const d = tgt - z * noseLocal;                     // >0: nose would sit above tgt
      T = d <= -Wp ? 0 : (d < Wp ? ((d + Wp) * (d + Wp)) / (4 * Wp) : d);
      if (this._pickupT < 0 && T > 0.25) this._pickupT = this.climbT;
      // never expose below the plate bottom while zoomed out
    } else {
      T = 0; z = 1;
    }
    z = Math.round(z * 10000) / 10000;
    this._zoom = z;
    this._tx = z === 1 ? 0 : Math.round((1 - z) * wrapW / 2);
    this.camY = T;
    const dt = this._lastDt || 1 / 60;
    const inst = (this.camY - (this._prevCamY || 0)) / dt;
    this._prevCamY = this.camY;
    this._camVel = this.phase === "exit" ? inst : lerp(this._camVel || 0, inst, 0.5);

    this._camYi = Math.round(this.camY);
    this._shakeX = this.shake ? Math.round((this._rand() - 0.5) * 2 * this.shake) : 0;
    this._shakeY = 0;
    if (world) {
      world.style.transformOrigin = "0 0";
      world.style.transform =
        "translate3d(" + (this._tx + this._shakeX) + "px," + this._camYi + "px,0)" +
        (this._zoom !== 1 ? " scale(" + this._zoom + ")" : "");
    }
    this.applyRocketLight();
    if (this.ignited || this.released) {
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
    this._lastDt = dt;
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
        rocketY: this.rocketY, camY: this.camY, camVel: this._camVel, climbT: this.climbT,
        zoom: this._zoom, pickupT: this._pickupT,
        noseScreenY: this._tipLocal0 != null ? (this._zoom || 1) * (this._tipLocal0 - this.rocketY * (this._lb.height / this._lb.nh)) + (this._camYi || 0) : null,
        exitT: this.exitT, flame: this.flameIntensity, finished: this.finished,
        zoomLand: this._zoomLand, skyBlendU: this._altBlendU || 0,
        nozzleScreenY: this._lb ? (this._zoom || 1) * (this._lb.top + (seat.sitY - this.rocketY) * (this._lb.height / this._lb.nh)) + (this._camYi || 0) : null,
        app: BUILD,
        audio: this.audio ? { state: this.audio.ctx.state, scheduled: this._audioT0 != null, muted: this.audioMuted } : null,
      };
    } catch (_) {}

    if (this.releaseFlash > 0) this.releaseFlash = Math.max(0, this.releaseFlash - dt / 0.18);
    if (this._shearT > 0) this._shearT = Math.max(0, this._shearT - dt);
    if (this._ignFlash > 0) {
      const target = this.phase === "burn" ? 0.7 : (this.phase === "hold" ? 0.55 : 0.22);
      this._ignFlash = Math.max(this.releaseFlash * 0.9, lerp(this._ignFlash, target, 0.08));
      if (this.phase === "climb" && this.climbT > 1.2) this._ignFlash = Math.max(0, this._ignFlash - dt * 0.35);
    }

    if (elapsed < 5) {
      this.phase = "countdown";
      if (elapsed >= 3 && !this.ignited) {
        this.ignited = true;
        this.shake = 5;
        this.vibrate([50, 30, 50]);
        this.setAudioLevel(0.28);
        this._shearT = 0.85;   // C1 smoke shear window
        this._ignFlash = 1.0;  // C1 ignition flash
        this.emitIgnitionShear(seat);
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
        this._ignFlash = Math.max(this._ignFlash, 1);
        this._shearT = Math.max(this._shearT, 0.55);
        this.emitIgnitionShear(seat);
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
      } else if (since < 0.5 + CLIMB_DUR + EXIT_DUR) {
        const t = since - 0.5;
        this.climbT = t;
        this.rocketY = 3 + CLIMB_A * t * t;
        if (t < CLIMB_DUR) {
          this.phase = "climb";
        } else {
          if (this.phase !== "exit") {
            this.phase = "exit";
            this._exitCam0 = this.camY;
            this._exitV0 = this._camVel || 0;
          }
          this.exitT = t - CLIMB_DUR;
        }
        this.shake = Math.max(0, this.shake - 9 * dt);
        this.flameIntensity = lerp(this.flameIntensity, 1.35, 0.08);
        if (t < 1.2) this.emitGroundSmoke(seat, Math.max(0.3, 1.0 - t * 0.5));
        this.setAudioLevel(clamp(0.5 - t * 0.06, 0.08, 0.5) * (this.phase === "exit" ? clamp(1 - this.exitT / EXIT_DUR, 0, 1) : 1));
      } else {
        // End on the flight: freeze the last frame (sky + departing plume), no cut to the pad
        this.running = false;
        this.finished = true;
        this.phase = "done";
        this.stopAudio(false);
        try { global.__liftoffState = Object.assign({}, global.__liftoffState, { phase: "done", finished: true, running: false }); } catch (_) {}
        if (this.onPerfSample) this.onPerfSample(this.perf.slice());
        this.onComplete();
        return;
      }
    }

    this.updateParticles(dt);
    this.applyTransforms(seat);
    this.drawFx(seat);
    this.drawAltSky(dt);
  };

  LiftoffEngine.prototype.tick = function (ts) {
    if (!this.running || this.captureMode) return;
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    // Keep the picture locked to the scheduled audio (audio clock is the master while running)
    const a = this.audio;
    if (a && this._audioT0 != null && a.ctx.state === "running") {
      const target = a.ctx.currentTime - this._audioT0 - (a.ctx.outputLatency || a.ctx.baseLatency || 0);
      if (target > 0) dt = clamp(target - this._simTime, 0, 0.1);
    }
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
    this._scheduleLaunchAudio();
    this.vibrate(15);
    try {
      global.__liftoffState = {
        elapsed: 0, phase: this.phase, countdown: 5,
        ignited: false, released: false, rocketY: 0, camY: 0,
        climbT: 0, lingerT: 0, flame: 0, app: BUILD,
      };
    } catch (_) {}
    if (!this.captureMode) {
      this.raf = requestAnimationFrame(this._boundTick);
    } else {
      // Draw first frame at t=0 for capture
      const seat = this.getSeat && this.getSeat();
      if (seat && this._fxReady) {
        this.applyTransforms(seat);
        this.drawFx(seat);
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
