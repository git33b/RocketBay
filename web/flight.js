/* RocketBay FLIGHT MODE v1 / gp1-beta (preview) / flight2d live / bh1g
 * GP1-BETA s6b5: plume hold/morph + scenery crossfade across reveal; keep scale/lb/no-second-climb, tilt-on-thrust, BH purple/blue pull VFX, bigger crash,
 * deadly outlines, chrome tax (via index). BH knobs unchanged (bh1g global pull).
 * flight-pack-v1.3.2 + BLACKHOLE v1: native 216×212 BH, bh1g = global pull (any dist) + bh1f strong-G,
 * core-only hitbox, spin, soft falloff a=BH_G/(BH_FALL*r+BH_SOFT) (fights at range; no soft-R free zone),
 * swallow death (no crash boom on BH), L1 1–2 random BHs; depth scales draw+pullR ~1→1.25→1.5;
 * lab-only ~3 early burst.
 * Endless hold-to-thrust flight after the liftoff climb. Art: FLIGHT-PACK, manifest block
 * `flight-pack-v1.1` (files copied into web/flight/, masters untouched). All gameplay numbers are
 * the pack's placeholders unless noted. Canvas 2D, fixed-step sim (1/120 s), pooled objects,
 * NEAREST scaling, no allocations in the per-frame loop (HUD strings rebuild only on value change).
 */
(function (global) {
  "use strict";

  /* ---------------- tunables (named constants; CoE tunes at playtest) ---------------- */
  const WORLD_H = 720;                       // play band height (design px) - same on every device
  const MIN_VIEW_W = 760;                    // narrower screens (portrait) letterbox the band to show >= 760 px ahead
  const PLAYER_X = 285;                      // rocket centre x after pitch-over
  const ROCKET_LEN = 208;                    // flight sprite length (pack)
  const CLIMB_T = 3.4, PITCH_T = 1.85;       // climb kept for non-seam paths; pitch after settle
  const SEAM_ZOOM0 = 1.82;                   // legacy pad-column framing (unused when seamFromPad)
  const SEAM_ZOOM1 = 1.28;                   // legacy end-of-climb zoom
  // v6b: camZoom seeded from handoff.rocketScreenH / (ROCKET_LEN*s) — no ZOOM_PORT_REF map
  const SETTLE_T = 1.00;                     // v6b5: room for 0.55s plume morph after reveal before pitch
  const SETTLE_ZOOM0 = 1.00;                 // v6: pad hands off at play scale → seed 1.0 (no 0.70→1.00 / 1.06 tug)
  const HUD_ZOOM_ON = 1.04;                  // game HUD appears once camZoom reaches gameplay scale
  const SETTLE_FALL = 40;                    // v6: gentler fall (matched mid-air; was 55 pop-feel)
  const LB_EASE_START = 0.00;                // letterbox continues from pad seamLbA (no snap-in box)
  const LB_EASE_END = 0.90;                  // v6: finish box toss during settle (pad arrives ~0.62 co-eased)
  // (removed PITCH_XFADE — no alpha crossfade of two unrelated worlds)
  const SPEED0 = 360, SPEED_RAMP = 0.8, SPEED_CAP = 620;  // +8 px/s per 10 s
  const GRAVITY = 1400, THRUST = 2600, VY_MAX = 520;     // px/s^2, px/s^2, px/s
  const TILT_MAX = 8 * Math.PI / 180, TILT_RATE = 7;     // gp1: ~0–8° nose-up while thrusting only
  const CLIMB_PLUME = 2.35;                  // climb flame length vs flight (match pad power)
  const CLIMB_SHAKE = 3.2;                   // climb cam shake amp (design px)
  const FUEL_DRAIN = 1 / 11;                 // tank fraction per second of thrust held (placeholder)
  const FUEL_REFILL = 0.5;                   // fuel pickup
  const KM_PER_PX = 1500 / 15360;            // 1 zone (1500 km) == one zone-art segment (3840 art px at 0.25x)
  const DEPLOY_MIN_KM = 300;
  const BONUS_K = 50, BONUS_EXP = 1.5;       // bonus = round(K * (km/100)^EXP)
  const COIN_PTS = 5;                        // score per coin
  const GEM_COINS = 10;                      // a gem counts as 10 coins (placeholder)
  const LIGHT_THRUST = 1.25, LIGHT_GRAVITY = 0.85, LIGHT_TILT = 1.3, LIGHT_FUEL = 0.8; // after deploy
  const DEPLOY_FRAME_S = 1 / 12, CRASH_FRAME_S = 0.067;
  const CRASH_DIM_AT = 0.6, CRASH_DIM_RAMP = 0.2, CRASH_DIM = 0.4, GAMEOVER_AT = 0.85;
  const MAGNET_S = 8, MAGNET_R = 230, SHIELD_GRACE = 1.0;
  // BLACKHOLE v1 / bh1g (named tunables — CoE playtest; lab-only global pull + strong-G)
  // Native 216×212 gated into sprites/hazard-blackhole.png — BH_DRAW_SCALE=1 (no interim 2×).
  // Base size as-is at early depth; draw+pullR grow with depth (pullR = debug/vignette/spawn only).
  // BH_GLOBAL_PULL = true — while BH active, player+hazards feel pull at ANY distance
  // (no soft-R "free outside R"). BH_PULL_R kept for vignette / hitbox ring / spawn clog escape.
  // Force law (equiv 1/r² feel that fights at range): a = BH_G / (BH_FALL*r + BH_SOFT)
  // With BH_G=6.7M + BH_FALL=12, a at r~400–600 is hundreds of px/s² (vs GRAVITY=1400).
  const BH_GLOBAL_PULL = true;           // bh1g: acceleration never gated by pullR
  const BH_DRAW_SCALE = 1.0;             // native art — do NOT interim-upscale (would double-size)
  const BH_DRAW_W = 208;                 // base early-depth draw width (depth scale applies on top)
  const BH_PULL_R = 520;                 // debug ring / vignette / spawn clog only — NOT an accel gate
  // bh1e BH_G=2235600. bh1f: ×3 → 6706800. bh1g keeps strong-G; removes soft-R free zone.
  const BH_G_PREV = 2235600;             // bh1e player pull (document before)
  const BH_G_MULT = 3;                   // × vs bh1e BH_G (exact 3× strong-G lab)
  const BH_G = Math.round(BH_G_PREV * BH_G_MULT); // 6706800 — kept; falloff via BH_FALL
  const BH_FALL = 12;                    // linear falloff scale: a = BH_G/(BH_FALL*r+BH_SOFT); challenges at hundreds of px
  const BH_SOFT = 3200;                  // epsilon so force doesn't explode at r→0 (soft core)
  const BH_OTHER = 0.40;                 // was 0.38 @ bh1e; stay ~0.25–0.4× player; nudge with G
  const BH_SPIN = 0.9;                   // rad/s continuous ring/arms spin (core hitbox unrotated)
  const BH_SWALLOW_S = 0.55;             // suck-in: spin+shrink into core, then result (0.4–0.7s; no boom/debris)
  const BH_MIN_KM = 0;                   // bh1e: L1 allowed (was 95); no early wipe
  const BH_GAP0 = 26, BH_GAP1 = 12;      // full-path seconds between BH (L1 → deep); nextBhAt ≈ max(8, gap)
  // Depth visual/pull scale (same art): early ~1.0 → mid ~1.25 → deep ~1.5
  const BH_SCALE0 = 1.0, BH_SCALE1 = 1.25, BH_SCALE2 = 1.5;
  const BH_LAB_BURST = 3;                // lab-only: ~3 early sequential BHs (one-at-a-time)
  const BH_LAB_BURST_GAP0 = 3.2, BH_LAB_BURST_GAP1 = 5.8; // lab burst spacing after prev leaves
  const SIM_DT = 1 / 120;
  // depth u (0..1 from speed) → draw/pull scale ~1.0 → 1.25 → 1.5
  function bhDepthScale(u) {
    const x = clamp(u, 0, 1);
    if (x < 0.5) return BH_SCALE0 + (BH_SCALE1 - BH_SCALE0) * (x / 0.5);
    return BH_SCALE1 + (BH_SCALE2 - BH_SCALE1) * ((x - 0.5) / 0.5);
  }
  const PAR = { stars: 0.1, zone: 0.25, farPlanets: 0.2, mid: 0.5, planets: 0.7, game: 1.0, dust: 1.3 };
  const SEG_TILE = 2560, SEG_TRANS = 1280, SEG = SEG_TILE + SEG_TRANS; // zone art segment (art px)
  const TIERS = [ // pack tiers (speed band -> density) — gp1 light density bump
    { max: 420, spacing: 600, gap: 290, extra: 1.85, shift: 160, arcs: 1.35, fuelN: 5, shield: 0.06, magnet: 0.06, gem: 0.02 },
    { max: 490, spacing: 600, gap: 255, extra: 2.05, shift: 180, arcs: 1.2, fuelN: 5, shield: 0.07, magnet: 0.07, gem: 0.03 },
    { max: 560, spacing: 560, gap: 225, extra: 2.4, shift: 190, arcs: 1.1, fuelN: 4, shield: 0.08, magnet: 0.07, gem: 0.04 },
    { max: 1e9, spacing: 530, gap: 200, extra: 2.85, shift: 200, arcs: 1.0, fuelN: 4, shield: 0.10, magnet: 0.06, gem: 0.05 },
  ];
  // flight-pack-v1.3.1 spacing + escape-gap (Ateeb): spread default, cluster occasional, gap always
  const CLUSTER_P = 0.20;                 // ~15-25% of walls are dense packs
  const SPREAD_HX = [180, 320];           // loose horizontal between pieces when n>1
  const GAP_START = 240;                  // ~1/3 of WORLD_H at the start of the run
  // per-zone debris palette (hazards participate in the same wall/gap system as asteroids)
  const DEBRIS_MIX = [
    ["hazard-satellite", "hazard-telescope", "asteroid_0", "asteroid_2", "asteroid_4"],           // orbit edge
    ["hazard-wreckage_0", "hazard-wreckage_1", "hazard-wreckage_2", "hazard-station", "asteroid_1", "asteroid_3"], // belt
    ["hazard-station", "hazard-satellite", "hazard-telescope", "hazard-wreckage_1", "asteroid_2"], // nebula
    ["hazard-station", "hazard-satellite", "asteroid_0", "asteroid_3"],                            // gas giant
    ["hazard-wreckage_0", "hazard-wreckage_2", "hazard-telescope", "asteroid_1", "asteroid_4"],     // ice
    ["hazard-wreckage_1", "hazard-wreckage_0", "asteroid_2", "asteroid_4"],                        // red sun (embers via extras)
  ];
  const DEBRIS_DRAW = { // typical draw widths from qa-flight-pack-v1.3-debris.json
    "hazard-station": 140, "hazard-telescope": 110, "hazard-satellite": 84,
    "hazard-wreckage_0": 70, "hazard-wreckage_1": 72, "hazard-wreckage_2": 64,
    "hazard-meteor": 64, "hazard-blackhole": BH_DRAW_W,
  };

  const ZONES = [
    { name: "ORBIT EDGE", tile: "bg-orbit-edge-tile.png", accent: "#6ec8ff", mix: { asteroid: 1, planet: 0, comet: 0, ember: 0 }, small: true, body: "earth-limb.png", bodyY: 105, bodySide: 1 },
    { name: "ASTEROID BELT", tile: "zones/bg-zone-asteroid-belt-tile.png", accent: "#e8a860", mix: { asteroid: 1.8, planet: 0, comet: 0, ember: 0 } },
    { name: "NEBULA", tile: "bg-deepspace-tile.png", accent: "#c492ff", mix: { asteroid: 1, planet: 0.35, comet: 0, ember: 0 } },
    { name: "GAS GIANT", tile: "zones/bg-zone-gas-giant-tile.png", accent: "#7ed6c4", mix: { asteroid: 0.6, planet: 0.6, comet: 0, ember: 0 }, body: "zones/gas-giant-body.png", bodyY: 300, bodySide: 1 },
    { name: "ICE FIELD", tile: "zones/bg-zone-ice-comet-tile.png", accent: "#d6f4ff", mix: { asteroid: 0.5, planet: 0, comet: 1, ember: 0 }, ice: true },
    { name: "RED SUN", tile: "zones/bg-zone-red-sun-tile.png", accent: "#ff8040", mix: { asteroid: 0.7, planet: 0, comet: 0, ember: 1 }, body: "zones/red-sun-body.png", bodyY: 0, bodySide: -1 },
  ];
  const TRANS = ["zones/zone-trans-12.png", "zones/zone-trans-23.png", "zones/zone-trans-34.png", "zones/zone-trans-45.png", "zones/zone-trans-56.png", "zones/zone-trans-61.png"];
  // manifest flight-pack-v1 hazards.sprites: native size, hitbox circle (deadly already 0.8 x visible r)
  const SPR = {
    coin_f0: [127, 133, 63.6, 66.3, 65.6], coin_f1: [112, 133, 55.7, 66.4, 65.6], coin_f2: [49, 133, 23.9, 66.3, 65.6],
    coin_f3: [103, 133, 50.8, 66.3, 65.6], coin_f4: [128, 133, 63.5, 66.4, 65.6],
    fuel: [102, 148, 50.7, 77.2, 66.1], shield: [131, 143, 65.1, 65.5, 67.6], magnet: [125, 128, 62.0, 62.0, 60.9], gem: [171, 132, 85.3, 52.5, 66.5],
    asteroid_0: [139, 121, 69.9, 62.7, 50.0], asteroid_1: [156, 137, 78.3, 70.8, 57.2], asteroid_2: [136, 125, 68.2, 63.5, 50.6],
    asteroid_3: [160, 136, 80.6, 71.1, 56.7], asteroid_4: [129, 112, 64.3, 58.7, 45.7],
    planet_gas: [162, 162, 80.6, 80.6, 65.0], planet_moon: [155, 155, 76.8, 77.4, 61.8], planet_ringed: [233, 147, 116.7, 72.8, 58.8],
    comet: [293, 156, 70.4, 94.2, 51.3], ember: [155, 179, 65.3, 125.3, 46.2],
    // flight-pack-v1.3 debris (hitbox = body only; station wings NON-colliding)
    "hazard-station": [172, 96, 85.8, 49.1, 40.0],
    "hazard-telescope": [112, 74, 56.8, 30.3, 31.0],
    "hazard-satellite": [116, 63, 58.0, 32.8, 28.6],
    "hazard-wreckage_0": [94, 50, 44.7, 24.5, 18.5],
    "hazard-wreckage_1": [100, 50, 53.5, 22.3, 22.0],
    "hazard-wreckage_2": [71, 50, 33.0, 24.6, 16.2],
    // flight-pack-v1.3.2 meteor (rock body hitbox; fiery tail NON-colliding)
    "hazard-meteor": [64, 40, 22.0, 22.0, 12.0],
    // BLACKHOLE v1: native 216×212; hitbox = dark CORE only (~r40 = 2× prior); arms/ring NON-colliding
    "hazard-blackhole": [216, 212, 108.0, 106.0, 40.0],
  };
  // pack deploy / crash frame sets (manifest flight-pack-v1.deploy / .crash; steel regenerated in v1.1)
  const PACK_STACKS = {
    "steel-booster,steel-ship|0": { key: "steel", crash: true, origin: [0, 59.9] },
    "gridfin-booster-s1,pencil-upper,gridfin-fairing|1": { key: "gridside", crash: false, origin: [0, 59.9] },
    "moon-giant-s1,pencil-upper,orange-fairing|0": { key: "moonmix", crash: true, origin: [0, 60.2] },
    "pencil-core-s1,euro-upper,euro-fairing|0": { key: "pencileuro", crash: false, origin: [0, 59.8] },
  };
  const RING_R = [0, 12, 20, 27, 33, 38, 42, 45];          // v1.1 deploy puff ring (screen px)
  const PAY_FWD = [0, 6, 14, 24, 35, 46, 57, 68], PAY_SIDE = [0, 6, 11, 15, 18, 20, 21, 22];
  const BURST_R = [32, 64, 96, 118, 136, 136, 122, 104];   // gp1: Moon Giant–class crash punch
  const BURST_COL = ["#FFFFEE", "#FFDE40", "#FF8C1C", "#D6301C", "#563A46"];
  const HUD = { navy: "rgba(10,28,58,0.8)", cyan: "#64D2FF", inner: "#3C6385", text: "#E1F2FF" };

  function bonusFor(km) { return km >= DEPLOY_MIN_KM ? Math.round(BONUS_K * Math.pow(km / 100, BONUS_EXP)) : 0; }
  function scoreFor(distKm, bonus, coins) { return distKm + bonus + coins * COIN_PTS; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }
  function mod(a, n) { return ((a % n) + n) % n; }

  /* ---------------- sprite prep (runs once per run start, outside the loop) ---------------- */
  function cv(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  // nose-up composed stack (RGBA arrays) -> nose-right canvas, NN-scaled to ROCKET_LEN
  function toFlightSprite(st, lit, predicate, len) {
    const up = cv(st.w, st.h), ux = up.getContext("2d"), id = ux.createImageData(st.w, st.h);
    for (let i = 0; i < st.w * st.h; i++) {
      const o = st.owner[i]; if (!o || (predicate && !predicate(o - 1))) continue;
      id.data[i * 4] = lit[i * 4]; id.data[i * 4 + 1] = lit[i * 4 + 1]; id.data[i * 4 + 2] = lit[i * 4 + 2]; id.data[i * 4 + 3] = 255;
    }
    ux.putImageData(id, 0, 0);
    const k = len / st.h, W = len, H = Math.max(1, Math.round(st.w * k));
    const c = cv(W, H), x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    x.translate(W, 0); x.rotate(Math.PI / 2);       // clockwise: nose (top) -> right
    x.drawImage(up, 0, 0, st.w, st.h, 0, 0, H, W);   // rotated frame: width H (was w), height W (was h)
    return { canvas: c, w: W, h: H, axisY: st.axisX * k, scale: k };
  }
  // 7-node capsule chain (pack rule): central 85 %, node r = 0.70 x local core half-thickness (min over segment)
  function buildChain(spr) {
    const { canvas, w, h } = spr, d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const ay = clamp(Math.round(spr.axisY), 0, h - 1);
    const run = (x) => { // opaque run through the axis row at column x -> [centre, half]
      if (!d[(ay * w + x) * 4 + 3]) return [ay, 0];
      let a = ay, b = ay;
      while (a > 0 && d[((a - 1) * w + x) * 4 + 3]) a--;
      while (b < h - 1 && d[((b + 1) * w + x) * 4 + 3]) b++;
      return [(a + b + 1) / 2, (b - a + 1) / 2];
    };
    const nodes = [], x0 = 0.075 * w, x1 = 0.925 * w, step = (x1 - x0) / 6;
    for (let i = 0; i < 7; i++) {
      const cx = x0 + i * step, s0 = Math.max(0, Math.floor(cx - step / 2)), s1 = Math.min(w - 1, Math.ceil(cx + step / 2));
      let mh = 1e9, cy = ay;
      for (let x = s0; x <= s1; x++) { const r = run(x); if (r[1] < mh) { mh = r[1]; } }
      cy = run(Math.round(cx))[0];
      nodes.push({ x: cx, y: cy, r: Math.max(0.5, 0.7 * (mh === 1e9 ? 0 : mh)) });
    }
    return nodes;
  }
  function loadImg(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }

  /* ---------------- engine ---------------- */
  function FlightEngine(opts) {
    this.o = opts;
    this.base = opts.base || "flight/";
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.img = {};
    this.running = false; this.paused = false; this.captureMode = !!opts.captureMode;
    this.events = [];
    // pools
    this.haz = []; for (let i = 0; i < 160; i++) this.haz.push({ on: false, im: null, x: 0, y: 0, vx: 0, vy: 0, r: 0, dw: 0, dh: 0, ox: 0, oy: 0, par: 1, kind: 0, rot: 0 });
    this.pick = []; for (let i = 0; i < 220; i++) this.pick.push({ on: false, kind: 0, x: 0, y: 0, r: 0, ph: 0, im: null, dw: 0, dh: 0, ox: 0, oy: 0 });
    this.fx = []; for (let i = 0; i < 90; i++) this.fx.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, c: 0 });
    this.decor = []; for (let i = 0; i < 24; i++) this.decor.push({ on: false, im: null, x: 0, y: 0, par: 0.5, w: 0, h: 0 });
    this.dust = []; for (let i = 0; i < 18; i++) this.dust.push({ x: 0, y: 0 });
    this.nodesW = []; for (let i = 0; i < 7; i++) this.nodesW.push({ x: 0, y: 0, r: 0 });
    this._hud = { km: -1, kmS: "", coins: -1, coinsS: "" };
    this._boundFrame = this._frame.bind(this);
    this._layout();
    window.addEventListener("resize", () => this._layout());
  }
  const P = FlightEngine.prototype;

  P._src = function (rel) { return this.base + rel; };
  P._get = function (rel) { // lazy image cache (returns null until loaded)
    let e = this.img[rel];
    if (!e) { e = this.img[rel] = { im: null, p: loadImg(this._src(rel)).then((i) => { e.im = i; return i; }) }; }
    return e.im;
  };
  P._need = function (rels) { rels.forEach((r) => this._get(r)); return Promise.all(rels.map((r) => this.img[r].p)); };

  // Everything the first seconds need (climb bridge for this TOD, orbit tile, earth limb, hazards, HUD)
  P.preload = function (tod) {
    const core = ["climb-bridge-" + tod + ".png", "bg-orbit-edge-tile.png", "earth-limb.png", "parallax/far-stars-tile.png",
      "hud/deploy-icon.png", "fuel.png", "shield.png", "magnet.png", "gem.png", "zones/zone-trans-12.png", "parallax/setpiece-comet.png",
      "hazard-meteor.png", "hazard-blackhole.png", "tutorial/FT-first-flight-overlay.png"];
    for (let i = 0; i < 5; i++) core.push("coin_f" + i + ".png", "asteroid_" + i + ".png");
    this._padSrc = this.o.padPlate ? this.o.padPlate(tod) : null;
    const p = this._need(core);
    const padP = this._padSrc ? loadImg(this._padSrc).then((i) => { this._pad = i; }) : Promise.resolve();
    return Promise.all([p, padP]);
  };
  // background preload of later zones (non-blocking)
  P._preloadRest = function () {
    const rest = ["planet_gas.png", "planet_moon.png", "planet_ringed.png", "comet.png", "ember.png"];
    ZONES.forEach((z) => { rest.push(z.tile); if (z.body) rest.push(z.body); });
    TRANS.forEach((t) => rest.push(t));
    for (let z = 1; z <= 6; z++) {
      rest.push("parallax/decor-gas-z" + z + ".png", "parallax/decor-moon-z" + z + ".png", "parallax/setpiece-station-z" + z + ".png");
      for (let i = 0; i < 8; i++) rest.push("parallax/decor-planets/z" + z + "-mid-" + i + ".png");
      for (let i = 0; i < 4; i++) rest.push("parallax/decor-planets/z" + z + "-far-" + i + ".png");
    }
    for (let i = 0; i < 5; i++) rest.push("zones/ice-hazard-variants/asteroid_" + i + ".png");
    ["hazard-station","hazard-telescope","hazard-satellite","hazard-wreckage_0","hazard-wreckage_1","hazard-wreckage_2","hazard-meteor","hazard-blackhole"].forEach((n) => rest.push(n + ".png"));
    let i = 0; const next = () => { if (i >= rest.length) return; const r = rest[i++]; this._get(r); this.img[r].p.then(next); };
    next(); next(); next();
  };

  P._layout = function () {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = window.innerWidth, ch = window.innerHeight;
    this.cssW = cw; this.cssH = ch; this.dpr = dpr;
    this.canvas.width = Math.round(cw * dpr); this.canvas.height = Math.round(ch * dpr);
    let s = ch / WORLD_H, viewW = cw / s;
    if (viewW < MIN_VIEW_W) { s = cw / MIN_VIEW_W; viewW = MIN_VIEW_W; }
    this.s = s; this.viewW = viewW;
    this.bandH = WORLD_H * s;
    this.oy = Math.round((ch - this.bandH) / 2);
    this.letterbox = this.oy > 4;
    this.hs = clamp(s * 1.15, 0.62, 1);             // HUD css px per design px
    // Outside settle/pitch(/legacy climb), letterbox amount tracks layout (seam drives lbA itself)
    if (this.phase && this.phase !== "climb" && this.phase !== "pitch" && this.phase !== "settle") {
      this.lbA = this.letterbox ? 1 : 0;
    }
    if (this.o.onLayout) this.o.onLayout({ oy: this.oy, bandH: this.bandH, letterbox: this.letterbox, hs: this.hs, cssW: cw, cssH: ch });
    this.ctx.imageSmoothingEnabled = false;
  };

  /* ---- run setup ---- */
  // sprites: { rocket, post, payload (canvas|null), packKey, mode } built by prepareStack()
  P.start = function (cfg) {
    this.cfg = cfg;
    this.sp = cfg.sprites;
    this.chain = buildChain(this.sp.rocket);
    this.chainPost = this.sp.post ? buildChain(this.sp.post) : this.chain;
    this.seed = cfg.seed >>> 0 || 1; this._r = this.seed;
    this.t = 0; this.phase = "climb"; this.phaseT = 0;
    this.cam = -1; this.camY = 2160; this.speed = 0; this.dist = 0; // dist = world px since km 0
    this.camZoom = SEAM_ZOOM0; this.lbA = 0; this.climbExit = 0; // continuous seam camera
    this.px = 640; this.py = 430; this.vy = 0; this.tilt = -Math.PI / 2; this.holding = false; this._botHold = false;
    this.fuel = 1; this.coins = 0; this.deployed = false; this.deployKm = 0; this.bonus = 0; this.deployT = -1;
    this.crashed = false; this.crashT = 0; this.deathKind = null; this.swallowScale = 1; this.swallowBh = null; this.shield = false; this.shieldGrace = 0; this.magnetT = 0;
    this.nextGateX = 900; this.gateN = 0; this.lastGapC = 360; this.nextExtraX = 1200;
    this.planetBlock = { top0: 0, top1: -1, topY: 0, bot0: 0, bot1: -1, botY: 720 };
    this.zoneIdx = 0; this.bannerT = -10; this.bannerZone = 0; this.comet = { on: false, x: 0, y: 0 }; this.cometZone = -1;
    this.wantTutorial = !!(cfg && cfg.tutorial);
    this.tutorialDone = !this.wantTutorial;
    this.practiceT = 0; this.hazardsOn = !this.wantTutorial;
    this.nextMeteorAt = 0; this.meteorN = 0;
    this.nextBhAt = 1e9; this.bhN = 0; this._bhInPull = false; this._climbShake = 0; this._crashSparked = false;
    this.lastGateSig = ""; this.gapJitter = 0;
    this.nextDecorX = 0; this.popT = -10; this.gameOverFired = false; this.result = null; this.events.length = 0;
    this.bodyY = 720; this.accum = 0; this.lastTs = 0; this.fps = []; this._flash = 0;
    for (const a of [this.haz, this.pick, this.fx, this.decor]) for (const o of a) o.on = false;
    for (const d of this.dust) { d.x = this._rand() * 1600; d.y = 40 + this._rand() * 640; }
    this.bot = cfg.bot || null;
    this.running = true; this.paused = false;
    this._hudOn = false; this._hudNotified = false;
    this.canvas.style.display = "block";
    this._layout();
    this._preloadRest();
    this._audioStart();
    // bh-lab: skip climb / pitch / tutorial / practice — endless scroller immediately
    if (cfg && cfg.lab) {
      this.phase = "flight"; this.phaseT = 0;
      this.cam = 0; this.camY = 0; this.dist = 0;
      this.camZoom = 1; this.lbA = this.letterbox ? 1 : 0; this.climbExit = 1;
      this.px = PLAYER_X; this.py = 360; this.vy = 0; this.tilt = 0;
      this.speed = SPEED0; this.hazardsOn = true;
      this.wantTutorial = false; this.tutorialDone = true;
      this._hudOn = true; this._hudNotified = true;
      this.nextGateX = this.cam + Math.max(this.viewW, 760) * 0.4 + 80;
      this.nextMeteorAt = this.t + 1.2 + this._rand() * 0.8;
      // bh1d: first of lab burst on-screen by ~5s (timer 2–3.5s; X in-view); then ~2 more sequential
      this.nextBhAt = this.t + 2 + this._rand() * 1.5;
      this.bodyY = 720;
      this._log("lab", this.t);
    } else if (cfg && (cfg.seamFromPad || cfg.skipClimb)) {
      // v6 composite seam: pad already at play scale + co-eased letterbox. Seed from handoff so
      // first flight frame matches pad last (zoom/lb/rocketY/plume) — never climb, never teleport.
      this.phase = "settle"; this.phaseT = 0;
      this.cam = -120; this.camY = 0; this.dist = 0;
      const ho = (cfg && cfg.handoff) || {};
      // v6b: seed camZoom from pad rocket SCREEN HEIGHT so join size matches (fixes ~3× pop).
      // playCssH = ROCKET_LEN * layoutS; z0 = rocketScreenH / playCssH (≥1 if pad still larger).
      let z0 = SETTLE_ZOOM0;
      const playCssH = ROCKET_LEN * this.s;
      if (ho.rocketScreenH != null && ho.rocketScreenH > 0 && playCssH > 1) {
        z0 = clamp(ho.rocketScreenH / playCssH, 1.0, 4.5);
      } else if (ho.zoom != null && ho.zoom > 0 && ho.stackHcss > 0 && playCssH > 1) {
        z0 = clamp((ho.stackHcss * ho.zoom) / playCssH, 1.0, 4.5);
      }
      // Prefer full letterbox at join when pad arrived at play framing (lb≈1).
      const lb0 = (this.letterbox && ho.seamLbA != null) ? clamp(ho.seamLbA, 0, 1) : (this.letterbox ? 0.85 : 0);
      this.camZoom = z0; this._settleZoom0 = z0;
      this.lbA = lb0; this._settleLb0 = lb0; this.climbExit = 1;
      this.px = this.viewW * 0.5;
      // Seed rocket Y from pad nose screen position so first settle frame doesn't teleport.
      let py0 = 360;
      if (ho.noseScreenY != null && ho.wrapH > 0 && this.letterbox) {
        const ch = ho.wrapH, cw = ho.wrapW || 390;
        // Use live layout s/oy so nose maps into the same band flight draws.
        const s = this.s, oy = this.oy;
        const bar = oy * lb0;
        // Nose screen Y → design py (rocket axis below nose by ~0.42 len at current z0).
        const noseInBand = (ho.noseScreenY - bar) / Math.max(1e-3, s);
        // Account for camZoom scale around py: nose is above axis by (axisFrac * ROCKET_LEN * z0)
        // With tilt=-PI/2, sprite is vertical; axis≈0.42 from nose along length.
        py0 = clamp(noseInBand + ROCKET_LEN * 0.42 * z0, 180, 520);
      }
      this.py = py0; this.vy = -70; this.tilt = -Math.PI / 2;
      this.speed = 0; this.hazardsOn = false; this._climbShake = 0;
      this._hudOn = false; this._settlePy0 = py0;
      this.bodyY = 720;
      this._seamHideBody = true; // v6b: suppress earth until after reveal / pitch
      this._seamRevealed = false; // index sets true on snap — HUD + flight plume wait on this
      this._seamSuppressFlame = true; // pad FX plume stays on top across the join
      // Continue pad plume intensity (handoff.flame) for after pad FX releases
      const fl = (ho.flame != null && ho.flame > 0) ? clamp(ho.flame / 1.35, 0.55, 1) : 0.9;
      this._seamPlume = fl;
      this._log("settle", this.t);
    }
    if (!this.captureMode) { this.lastTs = 0; this._raf = requestAnimationFrame(this._boundFrame); }
    else this._draw();
  };
  P._rand = function () { // mulberry32 (deterministic per seed)
    let t = (this._r = (this._r + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  P.stop = function () {
    this.running = false; cancelAnimationFrame(this._raf);
    this._audioStop(0.2);
    this.canvas.style.display = "none";
  };

  /* ---- audio (shares the liftoff AudioContext + master chain; synth only) ---- */
  P._audioStart = function () {
    this.voice = null;
    const a = this.o.getAudio && this.o.getAudio(), RA = global.RocketBayAudio;
    this._log("flight", 0);
    if (!a || !RA || this.captureMode) return;
    try { this.voice = RA.flightVoice(a.ctx, a.chain.input, a.ctx.currentTime + 0.02); this.voice.setThrust(true, a.ctx.currentTime); } catch (e) { this.voice = null; }
  };
  P._audioStop = function (fade) { if (this.voice) { try { this.voice.stop(0, fade); } catch (_) {} this.voice = null; } };
  P._sfx = function (kind) {
    this._log(kind, this.t);
    const a = this.o.getAudio && this.o.getAudio(), RA = global.RocketBayAudio;
    if (!a || !RA || this.captureMode) return;
    const t = a.ctx.currentTime + 0.005;
    try {
      if (kind === "deploy") RA.deployPop(a.ctx, a.chain.input, t);
      else if (kind === "crash") { RA.crashBoom(a.ctx, a.chain.input, t); this._audioStop(0.25); }
      else if (kind === "bh_swallow") {
        // short descending whoosh — no crash boom
        const ctx = a.ctx, dest = a.chain.input;
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = "sawtooth"; f.type = "lowpass"; f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(120, t + 0.45);
        o.frequency.setValueAtTime(380, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.5);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(f); f.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.58);
      }
    } catch (_) {}
  };
  P._log = function (type, t, on) { if (this.events.length < 4000) this.events.push({ type: type, t: +t.toFixed(4), on: on }); };
  P._notifyHud = function () {
    if (this._hudOn && !this._hudNotified) {
      this._hudNotified = true;
      if (this.o && this.o.onHudReveal) try { this.o.onHudReveal(); } catch (_) {}
    }
  };
  P.hudVisible = function () { return !!this._hudOn; };
  P.markSeamRevealed = function () {
    // Index calls mid hold — flight morph plume starts under fading pad FX; HUD still waits a beat.
    this._seamRevealed = true;
    this._seamSuppressFlame = false;
    this._seamMorphT0 = this.t;
    this._seamMorphDur = 0.65; // ease pad-like plume → flight size over ~0.65s
  };

  /* ---- input ---- */
  P.setHold = function (on) {
    on = !!on;
    if (this.phase === "tutorial" && on) { this.dismissTutorial(); return; }
    if (on === this.holding) return;
    this.holding = on;
  };
  P.canDeploy = function () { return this.running && this.phase === "flight" && !this.crashed && !this.deployed && this.km() >= DEPLOY_MIN_KM; };
  P.deploy = function () {
    if (!this.canDeploy()) return false;
    this.deployed = true; this.deployKm = Math.floor(this.km()); this.bonus = bonusFor(this.deployKm); this.deployT = this.t; this.popT = this.t;
    this._sfx("deploy");
    return true;
  };
  P.km = function () { return Math.max(0, this.dist * KM_PER_PX); };
  P.setPaused = function (p) {
    if (!this.running || this.crashed && this.gameOverFired) return;
    this.paused = !!p;
    const a = this.o.getAudio && this.o.getAudio();
    if (a && !this.captureMode) { try { if (this.paused) a.ctx.suspend(); else a.ctx.resume(); } catch (_) {} }
    if (!this.paused) this.lastTs = 0;
    this._draw();
  };

  /* ---- loop ---- */
  P._frame = function (ts) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._boundFrame);
    if (!this.lastTs) { this.lastTs = ts; this._draw(); return; }
    let dt = (ts - this.lastTs) / 1000; this.lastTs = ts;
    if (this.paused) return;
    if (this.fps.length < 20000) this.fps.push(dt);
    if (dt > 0.1) dt = 0.1;
    this.accum += dt;
    while (this.accum >= SIM_DT) { this._step(SIM_DT); this.accum -= SIM_DT; }
    this._draw();
  };
  P.captureStep = function (dt) { // deterministic capture: advance dt with fixed sub-steps, then draw
    if (!this.running) return;
    this.accum += dt;
    while (this.accum >= SIM_DT - 1e-9) { this._step(SIM_DT); this.accum -= SIM_DT; }
    this._draw();
  };

  P._step = function (dt) {
    this.t += dt; this.phaseT += dt;
    if (this.bot) this._botStep();
    const hold = this.bot ? this._botHold : this.holding;
    if (this.phase === "settle") {
      // Mid-air composite: finish zoom-OUT + letterbox ease from pad-seeded values; HUD; fall-back.
      // v6b: if pad handed off still-large (z0>1), take longer to ease to play so join isn't a tug.
      const z0 = this._settleZoom0 != null ? this._settleZoom0 : SETTLE_ZOOM0;
      const settleDur = z0 > 1.15 ? SETTLE_T * clamp(z0 / 1.15, 1, 2.2) : SETTLE_T;
      this._settleDur = settleDur;
      const u = clamp(this.phaseT / settleDur, 0, 1);
      const eu = ease(u);
      this.camZoom = z0 + (1 - z0) * eu;
      const lb0 = this._settleLb0 != null ? this._settleLb0 : 0;
      const lbU = clamp((u - LB_EASE_START) / Math.max(1e-6, LB_EASE_END - LB_EASE_START), 0, 1);
      this.lbA = this.letterbox ? (lb0 + (1 - lb0) * ease(lbU)) : 0;
      this.climbExit = 1; this.camY = 0; this._climbShake = 0;
      this.tilt = -Math.PI / 2;
      this.px = this.viewW * 0.5;
      const py0 = this._settlePy0 != null ? this._settlePy0 : 360;
      this.py = py0 + SETTLE_FALL * eu;
      this.vy = (1 - eu) * -90 + eu * 40;
      this.speed = SPEED0 * 0.15 * eu;
      this.cam += this.speed * dt;
      this.bodyY = 720;
      // v6b: NEVER pop FLIGHT HUD with the canvas swap — wait until after snap reveal + beat.
      if (this.cfg && this.cfg.seamFromPad) {
        if (this._seamRevealed && this.phaseT >= (this._settleDur || SETTLE_T) * 0.75) this._hudOn = true;
      } else if (this.camZoom <= HUD_ZOOM_ON) {
        this._hudOn = true;
      }
      this._notifyHud();
      if (this.phaseT >= (this._settleDur || SETTLE_T)) {
        this.phase = "pitch"; this.phaseT = 0;
        this.camZoom = 1; this._pitchZoom0 = 1; this._climbShake = 0;
        this._pitchFromPy = py0 + SETTLE_FALL;
        this.py = this._pitchFromPy; this.vy = 0;
        this.lbA = this.letterbox ? 1 : 0;
        this._hudOn = true; this._notifyHud();
      }
      return;
    }
    if (this.phase === "climb") {
      // Legacy path only (no seamFromPad). Pad→flight must NEVER enter here.
      const u = this.phaseT / CLIMB_T;
      const eu = ease(u);
      this.camY = 2160 * (1 - eu);
      this.camZoom = SEAM_ZOOM0 + (SEAM_ZOOM1 - SEAM_ZOOM0) * eu;
      this.lbA = 0; this.climbExit = 0; this._hudOn = false;
      this.px = this.viewW * 0.5; this.py = 430; this.tilt = -Math.PI / 2;
      this._climbShake = CLIMB_SHAKE * (0.55 + 0.45 * Math.sin(this.t * 38)) * (1 - eu);
      if (this.phaseT >= CLIMB_T) {
        this.phase = "pitch"; this.phaseT = 0; this.camY = 0; this.cam = -180;
        this.camZoom = SEAM_ZOOM1; this._pitchZoom0 = SEAM_ZOOM1; this._climbShake = 0;
        this._pitchFromPy = 430;
        this._hudOn = true; this._notifyHud();
      }
      return;
    }
    if (this.phase === "pitch") {
      const u = clamp(this.phaseT / PITCH_T, 0, 1);
      const eu = ease(u);
      const z0 = this._pitchZoom0 != null ? this._pitchZoom0 : SEAM_ZOOM1;
      // Continue any remaining zoom-out; after settle z0===1 so framing stays at gameplay scale.
      this.camZoom = z0 + (1 - z0) * eu;
      if (z0 > 1.02) {
        const lbU = clamp((u - LB_EASE_START) / Math.max(1e-6, LB_EASE_END - LB_EASE_START), 0, 1);
        this.lbA = this.letterbox ? ease(lbU) : 0;
      } else {
        this.lbA = this.letterbox ? 1 : 0;
      }
      this.climbExit = 1;
      this.speed = SPEED0 * eu;
      this.cam += this.speed * dt;
      this.px = this.viewW * 0.5 + (PLAYER_X - this.viewW * 0.5) * eu;
      if (this._pitchFromPy == null) this._pitchFromPy = this.py;
      this.py = this._pitchFromPy + (360 - this._pitchFromPy) * eu;
      this.tilt = -Math.PI / 2 * (1 - eu);
      this.bodyY = 720 + (105 - 720) * easeOut(u);
      this._climbShake = 0;
      this._hudOn = true; this._notifyHud();
      if (this.phaseT >= PITCH_T) {
        this.cam = 0; this.dist = 95 / KM_PER_PX; this.px = PLAYER_X; this.tilt = 0; this.py = 360; this.vy = 0;
        this.camZoom = 1; this.lbA = this.letterbox ? 1 : 0; this.climbExit = 1;
        this.phaseT = 0; this._log("thrust", this.t, hold); this._lastHold = hold;
        if (this.wantTutorial) { this.phase = "tutorial"; this.hazardsOn = false; this.nextGateX = 1e9; this.speed = SPEED0 * 0.35; }
        else { this.phase = "flight"; this.hazardsOn = true; this.speed = SPEED0; this.nextGateX = Math.max(this.nextGateX, this.cam + this.viewW * 0.45 + 120); this.nextMeteorAt = this.t + 2.0 + this._rand() * 1.5; this.nextBhAt = this.t + (this.cfg && this.cfg.forceBh ? 0.6 : 5 + this._rand() * 8);
        }
      }
      return;
    }
    // ---- first-flight tutorial (overlay) ----
    if (this.phase === "tutorial") {
      this.speed = SPEED0 * 0.28;
      this.cam += this.speed * dt; this.dist = this.cam;
      // gentle idle mid-screen
      this.py += (360 - this.py) * Math.min(1, 2.2 * dt);
      this.vy *= 0.9;
      this.tilt += (0.08 - this.tilt) * Math.min(1, 4 * dt);
      this._stepObjects(dt);
      // auto-advance ~7s if no tap
      if (this.phaseT >= 7.0) this.dismissTutorial();
      return;
    }
    // ---- open practice (~4s, no hazards) ----
    if (this.phase === "practice") {
      this.practiceT += dt;
      this.speed = Math.min(SPEED0, SPEED0 * 0.55 + 40 * this.practiceT);
      this.cam += this.speed * dt; this.dist = this.cam;
      const thrusting = hold && this.fuel > 0;
      if (thrusting !== this._lastHold) { this._lastHold = thrusting; this._log("thrust", this.t, thrusting); if (this.voice) { const a = this.o.getAudio(); this.voice.setThrust(thrusting, a.ctx.currentTime); } }
      this.vy += (GRAVITY - (thrusting ? THRUST : 0)) * dt;
      this.vy = clamp(this.vy, -VY_MAX, VY_MAX);
      this.py += this.vy * dt;
      if (thrusting) this.fuel = Math.max(0, this.fuel - FUEL_DRAIN * dt);
      const tt = thrusting ? -TILT_MAX * (0.55 + 0.45 * clamp(-this.vy / VY_MAX, 0, 1)) : 0;
      this.tilt += (tt - this.tilt) * Math.min(1, TILT_RATE * dt);
      // keep in band
      if (this.py < 40) { this.py = 40; this.vy = Math.max(0, this.vy); }
      if (this.py > WORLD_H - 40) { this.py = WORLD_H - 40; this.vy = Math.min(0, this.vy); }
      this._stepObjects(dt);
      if (this.practiceT >= 4.0) {
        this.phase = "flight"; this.phaseT = 0; this.hazardsOn = true;
        this.nextGateX = this.cam + this.viewW * 0.45 + 120;
        this.nextMeteorAt = this.t + 1.8 + this._rand() * 1.2;
        this.nextBhAt = this.t + (this.cfg && this.cfg.forceBh ? 0.5 : 5 + this._rand() * 8); // bh1e: post-tutorial early window
        this._log("hazards", this.t);
      }
      return;
    }
    // ---- flight / crash ----
    if (this.crashed) {
      this.crashT += dt;
      if (this.deathKind === "swallow") {
        const bh = this.swallowBh;
        const hx = bh && bh.on ? (bh.x - this.cam * (bh.par || 1)) : this.swallowPx;
        const hy = bh && bh.on ? bh.y : this.swallowPy;
        const u = clamp(this.crashT / BH_SWALLOW_S, 0, 1);
        const e = u * u * (3 - 2 * u); // smoothstep
        this.px = this.swallowPx + (hx - this.swallowPx) * e;
        this.py = this.swallowPy + (hy - this.swallowPy) * e;
        // Visible suck-in spin: ~2.75 turns, accelerates as it shrinks (Ateeb clarify)
        const spin = u * u * (Math.PI * 2 * 2.75);
        this.tilt = this.swallowTilt + spin;
        this.swallowScale = 1 - 0.96 * e; // shrink to nearly gone — no debris pop
        this.speed = Math.max(0, this.speed * (1 - clamp(this.crashT / 0.35, 0, 1)));
        this.cam += this.speed * dt; this.dist = this.cam;
        // keep BH spinning during suck-in
        if (bh && bh.on) bh.rot = (bh.rot || 0) + BH_SPIN * dt;
        if (this.crashT >= BH_SWALLOW_S && !this.gameOverFired) { this.gameOverFired = true; this._gameOver(); }
        this._stepObjects(dt);
        return;
      }
      this.speed = Math.max(0, this.speed * (1 - clamp(this.crashT / 0.53, 0, 1)));
      this.cam += this.speed * dt; this.dist = this.cam;
      if (this.crashT >= GAMEOVER_AT && !this.gameOverFired) { this.gameOverFired = true; this._gameOver(); }
      this._stepObjects(dt);
      return;
    }
    const light = this.deployed;
    this.speed = Math.min(SPEED_CAP, SPEED0 + SPEED_RAMP * this.phaseT);
    this.cam += this.speed * dt; this.dist = this.cam;
    const thrusting = hold && this.fuel > 0;
    if (thrusting !== this._lastHold) { this._lastHold = thrusting; this._log("thrust", this.t, thrusting); if (this.voice) { const a = this.o.getAudio(); this.voice.setThrust(thrusting, a.ctx.currentTime); } }
    const g = GRAVITY * (light ? LIGHT_GRAVITY : 1), th = THRUST * (light ? LIGHT_THRUST : 1);
    this.vy += (g - (thrusting ? th : 0)) * dt;
    this._bhPullPlayer(dt);
    this.vy = clamp(this.vy, -VY_MAX * 1.15, VY_MAX * 1.15);
    this.py += this.vy * dt;
    if (thrusting) this.fuel = Math.max(0, this.fuel - FUEL_DRAIN * (light ? LIGHT_FUEL : 1) * dt);
    // gp1: flat ~0° while coasting; nose-up only while thrusting (ease with hold). Never sit ~45°.
    const tt = thrusting ? -TILT_MAX * (0.55 + 0.45 * clamp(-this.vy / VY_MAX, 0, 1)) : 0;
    const k = TILT_RATE * (light ? LIGHT_TILT : 1) * (thrusting ? 1 : 1.35);
    this.tilt += (tt - this.tilt) * Math.min(1, k * dt);
    if (this.shieldGrace > 0) this.shieldGrace -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    // earth limb drops out over 0-600 km; zone edge bodies slide per zone
    this._spawn();
    this._stepObjects(dt);
    this._collide();
    // zone banner (zone index follows the art strip so the banner lands at the transition's end)
    const U = this._artU(), z = Math.floor(U / SEG);
    if (z !== this.zoneIdx) { this.zoneIdx = z; this.bannerT = this.t; this.bannerZone = mod(z, 6); this.cometZone = -1; }
  };
  P._artU = function () { return PAR.zone * this.cam + this._u0(); };
  P._u0 = function () { return Math.max(0, (1280 - this.viewW) / 2); };

  /* ---- world generation (deterministic per seed; RNG order independent of screen size) ---- */
  P._tier = function () { const s = this.speed; for (let i = 0; i < TIERS.length; i++) if (s <= TIERS[i].max) return TIERS[i]; return TIERS[3]; };
  P._zoneAtX = function (wx) { return mod(Math.floor((PAR.zone * wx + 260) / SEG), 6); };
  P.dismissTutorial = function () {
    if (this.phase !== "tutorial") return;
    this.phase = "practice"; this.phaseT = 0; this.practiceT = 0; this.tutorialDone = true;
    this._log("tutorial_dismiss", this.t);
    if (this.o.onTutorialDone) try { this.o.onTutorialDone(); } catch (_) {}
  };
  P._spawn = function () {
    // decor always
    while (this.nextDecorX < this.cam * PAR.mid + this.viewW + 200) this._decor();
    if (!this.hazardsOn || this.phase !== "flight") return;
    const ahead = this.cam + Math.max(this.viewW, 1600) + 260;
    let guard = 0;
    while (this.nextGateX < ahead && guard++ < 12) {
      const at = this.nextGateX;
      try { this._gate(this.nextGateX); }
      catch (err) {
        // never stall the spawn cursor — advance and keep going
        if (this.nextGateX <= at) this.nextGateX = at + 560;
        if (typeof console !== "undefined") console.warn("[flight2b] gate spawn", err);
      }
      if (this.nextGateX <= at) this.nextGateX = at + 560;
    }
    try { this._spawnMeteors(); }
    catch (err) { if (typeof console !== "undefined") console.warn("[flight2b] meteor spawn", err); }
    // bh1c watchdog: if lab/forceBh and no BH on screen by ~7s, hard-fire spawn now
    if ((this.cfg && (this.cfg.forceBh || this.cfg.lab)) && this.t >= 7 && this.bhN === 0) {
      let any = false;
      for (let i = 0; i < this.haz.length; i++) if (this.haz[i].on && this.haz[i].kind === 3) { any = true; break; }
      if (!any) this.nextBhAt = Math.min(this.nextBhAt, this.t);
    }
    try { this._spawnBlackholes(); }
    catch (err) { if (typeof console !== "undefined") console.warn("[bh1] blackhole spawn", err); }
  };
  // v1.3.2 meteors: spawn OFF the right edge, cross LEFT at 540–760 px/s screen-relative
  // (faster than scroll). Body hitbox only; fiery tail is non-colliding art.
  P._spawnMeteors = function () {
    if (this.t < this.nextMeteorAt) return;
    const R = () => this._rand();
    const u = clamp((this.speed - SPEED0) / (SPEED_CAP - SPEED0), 0, 1);
    // rate rises with depth: ~5.5s → ~1.4s between waves
    const gap = (5.5 - 3.8 * u) * (0.75 + R() * 0.5);
    this.nextMeteorAt = this.t + Math.max(1.0, gap);
    const burst = 1 + (R() < 0.28 + 0.35 * u ? 1 : 0) + (R() < 0.15 * u ? 1 : 0);
    for (let i = 0; i < burst; i++) {
      const drawW = 52 + R() * 28; // ~48–80 pack range
      const y = 84 + R() * (WORLD_H - 168);
      // just past the right edge of the current view
      const x = this.cam + this.viewW + 80 + i * (90 + R() * 110);
      // screen-relative leftward speed 540–760 px/s (faster than scroll)
      const cross = 540 + R() * 220;
      const vx = this.speed - cross; // d(sx)/dt = vx - speed = -cross
      const vy = (R() * 2 - 1) * (40 + 60 * u);
      const h = this._hazard("hazard-meteor", x, y, drawW, 1, vx, vy, this._zoneAtX(x));
      if (h) { h.rot = -0.35 - R() * 0.55; h.kind = 2; /* meteor mover */ this.meteorN++; }
    }
  };

  // BLACKHOLE v1 / bh1g: rare well ahead of camera. Escape = skirt above/below.
  // Core-only death; arms/ring spin. Global BH_FALL pull while BH alive (BH_GLOBAL_PULL; pullR visual/spawn).
  // Full path: random gaps, one-at-a-time, L1 gets 1–2. Lab: ~3 early sequential only.
  P._spawnBlackholes = function () {
    if (this.t < this.nextBhAt) return;
    const R = () => this._rand();
    const u = clamp((this.speed - SPEED0) / (SPEED_CAP - SPEED0), 0, 1);
    const force = !!(this.cfg && this.cfg.forceBh);
    const lab = !!(this.cfg && this.cfg.lab);
    const labBurst = lab && this.bhN < BH_LAB_BURST;
    // bh1e: L1 allowed (BH_MIN_KM=0; no phaseT wipe). Keep one-at-a-time.
    // only one active BH at a time (keeps escape readable; no overlapping wells)
    for (let i = 0; i < this.haz.length; i++) {
      if (this.haz[i].on && this.haz[i].kind === 3) {
        // lab burst: poll soon so next fires right after current leaves; else defer
        this.nextBhAt = labBurst ? Math.min(this.nextBhAt, this.t + 0.35) : (this.t + 6 + R() * 6);
        return;
      }
    }
    // Deeper = more often (gap 26→12). Random jitter keeps gaps unpredictable (not on a beat).
    const gap = (BH_GAP0 + (BH_GAP1 - BH_GAP0) * u) * (0.8 + R() * 0.5);
    this.nextBhAt = this.t + Math.max(8, gap);
    // First full-path BH always lands when due (guarantee L1 ≥1); later: mild random skip, less deep.
    if (!force && !lab && this.bhN > 0 && R() > (0.55 + 0.35 * u)) return;

    const dScale = bhDepthScale(u); // ~1.0 early → 1.25 mid → 1.5 deep
    const pullR = BH_PULL_R * dScale;
    const drawW = BH_DRAW_W * dScale * (0.92 + R() * 0.16);
    const yMin = 110, yMax = WORLD_H - 110;

    // lab/forceBh place ON SCREEN (in front of rocket). Normal rare BH stays ahead of view.
    let x;
    if (force || lab) {
      // Fixed-ish fraction of viewW so BH is visible without scrolling (~viewW*0.55–0.75)
      const frac = this.bhN === 0 ? 0.62 : (0.55 + R() * 0.2);
      x = this.cam + this.viewW * frac;
    } else {
      x = this.cam + this.viewW + 140 + R() * 120;
    }

    // Pick Y with skirt escape; for force/lab RETRY immediately — never defer past window
    function clogAt(self, xx, yy, pr) {
      let clogTop = 0, clogBot = 0;
      for (let i = 0; i < self.haz.length; i++) {
        const o = self.haz[i]; if (!o.on || o.par !== 1 || o.kind === 3) continue;
        if (Math.abs(o.x - xx) > pr * 0.85) continue;
        if (o.y < WORLD_H * 0.45) clogTop++; else clogBot++;
      }
      return { clogTop, clogBot };
    }
    let y = yMin + R() * (yMax - yMin);
    if (R() < 0.6) y = R() < 0.5 ? (yMin + R() * 160) : (yMax - R() * 160);
    let { clogTop, clogBot } = clogAt(this, x, y, pullR);
    if (clogTop >= 2 && clogBot < 2) y = Math.max(y, WORLD_H * 0.58);
    else if (clogBot >= 2 && clogTop < 2) y = Math.min(y, WORLD_H * 0.42);
    if (force || lab) {
      // up to 6 Y retries; if still clogged both skirts, force upper or lower skirt spawn
      for (let attempt = 0; attempt < 6; attempt++) {
        ({ clogTop, clogBot } = clogAt(this, x, y, pullR));
        if (clogTop < 2 || clogBot < 2) break;
        y = attempt % 2 === 0 ? (yMin + R() * 140) : (yMax - R() * 140);
      }
      ({ clogTop, clogBot } = clogAt(this, x, y, pullR));
      if (clogTop >= 2 && clogBot >= 2) {
        // hard skirt: place in less-clogged third so ONE escape path stays open
        y = clogTop <= clogBot ? (yMin + 40 + R() * 80) : (yMax - 40 - R() * 80);
      }
    }

    const h = this._hazard("hazard-blackhole", x, y, drawW, 1, 0, 0, this._zoneAtX(x));
    if (h) {
      h.kind = 3;
      h.rot = R() * Math.PI * 2;
      h.pullR = pullR;
      h.dScale = dScale;
      this.bhN++;
      this._log("bh_spawn", this.t);
      // lab burst: schedule next soon (~3–6s); one-at-a-time gate above waits until current leaves
      if (lab && this.bhN < BH_LAB_BURST) {
        this.nextBhAt = this.t + BH_LAB_BURST_GAP0 + R() * (BH_LAB_BURST_GAP1 - BH_LAB_BURST_GAP0);
      }
    } else if (force || lab) {
      // Pool exhausted — retry very soon rather than wait full gap (must show BH by ~8s)
      this.nextBhAt = this.t + 0.25;
    }
  };
  P._bhPullPlayer = function (dt) {
    this._bhInPull = false;
    if (this.crashed || this.phase !== "flight") return;
    const cam = this.cam;
    for (let i = 0; i < this.haz.length; i++) {
      const h = this.haz[i]; if (!h.on || h.kind !== 3) continue;
      const hx = h.x - cam * h.par;
      const dx = hx - this.px, dy = h.y - this.py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue; // tiny epsilon only — BH_GLOBAL_PULL: no soft-R free zone
      const pullR = h.pullR || BH_PULL_R;
      // vignette stays soft-R scoped (visual); acceleration applies at any distance
      if (dist < pullR) this._bhInPull = true;
      // radial accel toward core; player X is fixed so only vertical component fights thrust
      // a = BH_G/(BH_FALL*r+BH_SOFT) — equiv that fights at range; soft-core epsilon at r→0
      const a = BH_G / (BH_FALL * dist + BH_SOFT);
      this.vy += a * (dy / dist) * dt;
    }
  };

  P._hazard = function (name, x, y, drawW, par, vx, vy, zone) {
    let h = null; for (let i = 0; i < this.haz.length; i++) if (!this.haz[i].on) { h = this.haz[i]; break; }
    if (!h) return null;
    const m = SPR[name]; if (!m) return null;
    const sc = drawW / m[0];
    const rel = (zone === 4 && name.indexOf("asteroid") === 0) ? "zones/ice-hazard-variants/" + name + ".png" : name + ".png";
    h.on = true; h.im = rel; h.x = x; h.y = y; h.vx = vx || 0; h.vy = vy || 0; h.par = par || 1;
    h.r = m[4] * sc; h.dw = m[0] * sc; h.dh = m[1] * sc; h.ox = m[2] * sc; h.oy = m[3] * sc; h.rot = 0; h.kind = 0;
    return h;
  };
  P._pickup = function (kind, x, y) { // kind: 0 coin, 1 fuel, 2 shield, 3 magnet, 4 gem
    let p = null; for (let i = 0; i < this.pick.length; i++) if (!this.pick[i].on) { p = this.pick[i]; break; }
    if (!p) return;
    const name = kind === 0 ? "coin_f0" : kind === 1 ? "fuel" : kind === 2 ? "shield" : kind === 3 ? "magnet" : "gem";
    const m = SPR[name], sc = (kind === 0 ? 34 : 46) / m[1];
    p.on = true; p.kind = kind; p.x = x; p.y = y; p.r = m[4] * sc; p.ph = this._rand() * 5;
    p.im = name + ".png"; p.dw = m[0] * sc; p.dh = m[1] * sc; p.ox = m[2] * sc; p.oy = m[3] * sc; p.sc = sc;
  };
  P._gate = function (gx) {
    // v1.3.2-anywhere-density: continuous Y, rate+density progression, escape gap,
    // spread default / occasional cluster, unpredictability (no mirrored walls).
    const T = this._tier(), R = () => this._rand();
    const zone = this._zoneAtX(gx), Z = ZONES[zone];
    this.gateN++;
    const u = clamp((this.speed - SPEED0) / (SPEED_CAP - SPEED0), 0, 1);

    // Progression = rate + density (not fixed patterns)
    const spacing = Math.max(420, T.spacing + (R() * 2 - 1) * (40 + 30 * u) - Math.floor(40 * u));
    const gapFloor = T.gap;
    const gapH = Math.max(gapFloor, Math.round(GAP_START + (gapFloor - GAP_START) * u) + Math.floor(R() * (55 + 40 * (1 - u))) - Math.floor(20 * u));

    // Continuous Y anywhere on playable screen (exclude HUD / bottom chrome only)
    const yMin = 84, yMax = WORLD_H - 40;
    let lo = gapH / 2 + yMin, hi = yMax - gapH / 2;
    const pb = this.planetBlock;
    if (gx >= pb.top0 && gx <= pb.top1) lo = Math.max(lo, pb.topY + gapH / 2 + 30);
    if (gx >= pb.bot0 && gx <= pb.bot1) hi = Math.min(hi, pb.botY - gapH / 2 - 30);
    if (lo > hi) { const mid = (lo + hi) / 2; lo = hi = mid; }

    let c = yMin + gapH / 2 + R() * Math.max(1, (yMax - yMin - gapH));
    c = clamp(c, lo, hi);
    if (Math.abs(c - this.lastGapC) < 35 && Math.abs(gapH - this.gapJitter) < 25) {
      c = clamp(c + (R() < 0.5 ? -1 : 1) * (80 + R() * 120), lo, hi);
    }
    // Never spawn a layout that starts with zero escape vs an active BH (closing over time OK)
    for (let i = 0; i < this.haz.length; i++) {
      const bh = this.haz[i]; if (!bh.on || bh.kind !== 3) continue;
      if (Math.abs(bh.x - gx) > (bh.pullR || BH_PULL_R) + 80) continue;
      // push gap centre away from BH core so a skirt lane exists at spawn
      const away = c < bh.y ? -1 : 1;
      const need = bh.r + gapH * 0.35 + 36;
      if (Math.abs(c - bh.y) < need) c = clamp(bh.y + away * need, lo, hi);
    }
    this.gapJitter = gapH;
    const g0 = c - gapH / 2, g1 = c + gapH / 2;

    // Density: L1 prefer 1; later denser; cluster ~15–25% scaled by depth
    const cluster = R() < (CLUSTER_P * (0.55 + 0.9 * u));
    let n;
    if (cluster) n = 2 + (R() < (0.35 + 0.4 * u) ? 1 : 0);
    else n = (R() < (0.38 - 0.2 * u)) ? 1 : 2; // L1 often 2; later almost always 2+

    const pool = DEBRIS_MIX[zone];
    const used = [];
    const pickName = () => {
      let name = pool[Math.floor(R() * pool.length)], tries = 0;
      while (tries++ < 5 && used.indexOf(name) >= 0) name = pool[Math.floor(R() * pool.length)];
      return name;
    };
    const drawWFor = (name) => {
      if (DEBRIS_DRAW[name] != null) return DEBRIS_DRAW[name] * (0.85 + R() * 0.35);
      return (Z.small ? 44 + R() * 26 : 50 + R() * 70);
    };

    // Place fully OUTSIDE the escape gap; Y continuous (soft mid bias only)
    const place = (name, x, preferSide) => {
      const w = drawWFor(name), m = SPR[name]; if (!m) return false;
      const sc = w / m[0], rr = m[4] * sc, visR = rr / 0.8;
      let side = preferSide;
      if (side == null) {
        const b = R();
        side = b < 0.18 ? -1 : b < 0.82 ? (c < WORLD_H / 2 ? 1 : -1) : (R() < 0.5 ? -1 : 1);
      }
      const edgePad = Math.max(yMin + visR, visR + 4);
      const edgePadBot = Math.min(yMax - visR, WORLD_H - visR - 4);
      let cy;
      if (side < 0) {
        const maxY = g0 - visR - 4;
        if (maxY < edgePad) return false;
        cy = edgePad + R() * Math.max(1, maxY - edgePad);
      } else {
        const minY = g1 + visR + 4;
        if (minY > edgePadBot) return false;
        cy = minY + R() * Math.max(1, edgePadBot - minY);
      }
      for (let i = 0; i < this.decor.length; i++) {
        const d = this.decor[i]; if (!d.on) continue;
        const dx = (d.x - this.cam * d.par) - (x - this.cam);
        if (Math.abs(dx) > 120) continue;
        if (Math.abs(d.y - cy) < 50) cy += (cy < d.y ? -1 : 1) * (30 + R() * 25);
      }
      cy = clamp(cy, edgePad, edgePadBot);
      if (cy + visR > g0 && cy - visR < g1) return false;
      for (let bi = 0; bi < this.haz.length; bi++) {
        const bh = this.haz[bi]; if (!bh.on || bh.kind !== 3) continue;
        const dx = bh.x - x, dy = bh.y - cy;
        // satellites/debris must not sit on accretion ring (pullR), only clear past core before
        const ringKeep = (name.indexOf("satellite") >= 0 || name.indexOf("telescope") >= 0 || name.indexOf("station") >= 0)
          ? ((bh.pullR || BH_PULL_R) * 0.55 + rr)
          : (bh.r + rr + 28);
        if (dx * dx + dy * dy < ringKeep * ringKeep) return false;
      }
      this._hazard(name, x, cy, w, 1, 0, 0, zone);
      used.push(name);
      return true;
    };

    let placed = 0;
    if (cluster) {
      const side = R() < 0.5 ? -1 : 1;
      let x0 = gx - (n - 1) * (25 + R() * 20);
      for (let i = 0; i < n; i++) {
        const s = (i === n - 1 && R() < 0.35) ? -side : side;
        if (place(pickName(), x0 + i * (36 + R() * 40), s)) placed++;
      }
    } else if (n === 1) {
      if (place(pickName(), gx + (R() * 2 - 1) * (15 + R() * 40), null)) placed++;
    } else {
      const hx = SPREAD_HX[0] + R() * (SPREAD_HX[1] - SPREAD_HX[0]);
      const side0 = R() < 0.5 ? -1 : 1;
      if (place(pickName(), gx - hx * (0.25 + R() * 0.25), side0)) placed++;
      if (place(pickName(), gx + hx * (0.3 + R() * 0.35), R() < 0.78 ? -side0 : side0)) placed++;
    }
    // Guarantee at least one hazard on this gate (retry opposite side if empty)
    if (placed === 0) {
      place(pickName(), gx, c < WORLD_H / 2 ? 1 : -1) || place(pickName(), gx, c < WORLD_H / 2 ? -1 : 1);
    }

    if (!this.gates) this.gates = [];
    if (this.gates.length > 24) this.gates.shift();
    this.gates.push({ x: gx, c: c, gapH: gapH, n: n, cluster: cluster, g0: g0, g1: g1, placed: placed });

    // big parallax planets (non denser-than-gate; stay out of escape bookkeeping)
    const mix = Z.mix;
    if (mix.planet > 0 && R() < 0.22 * mix.planet && this.gateN > 2) {
      const pk = R();
      const name = zone === 3 ? (pk < 0.5 ? "planet_ringed" : "planet_moon") : (pk < 0.6 ? "planet_gas" : "planet_moon");
      const drawW = name === "planet_ringed" ? 420 + R() * 100 : name === "planet_gas" ? 220 + R() * 100 : 140 + R() * 80;
      const m = SPR[name];
      if (m) {
        const r = m[4] * (drawW / m[0]);
        const top = R() < 0.5, cy = top ? -r * 0.35 : WORLD_H + r * 0.35;
        const lead = gx + spacing * 1.5;
        const camAt = lead - PLAYER_X;
        const xp = PAR.planets * camAt + PLAYER_X;
        const gA = (xp - PLAYER_X - r - 60) / PAR.planets + PLAYER_X;
        const gB = (xp - PLAYER_X + r + 60) / PAR.planets + PLAYER_X;
        if (!(top ? (pb.top1 > gx) : (pb.bot1 > gx))) {
          this._hazard(name, xp, cy, drawW, PAR.planets, 0, 0, zone);
          if (top) { pb.top0 = gA; pb.top1 = gB; pb.topY = cy + r; }
          else { pb.bot0 = gA; pb.bot1 = gB; pb.botY = cy - r; }
        }
      }
    }

    // pickups along escape lane
    const prevX = gx - spacing, pc = this.lastGapC;
    if (R() < Math.min(1, T.arcs * spacing / 1000)) {
      const nn = 6 + Math.floor(R() * 5), x0 = prevX + spacing * 0.3, step = 36, amp = 30 + R() * 40;
      for (let i = 0; i < nn; i++) {
        const uu = i / Math.max(1, nn - 1), x = x0 + i * step;
        let yy = pc + (c - pc) * clamp((x - prevX) / spacing, 0, 1) - Math.sin(uu * Math.PI) * amp;
        // don't bait coin trails straight into an unmarked well
        for (let bi = 0; bi < this.haz.length; bi++) {
          const bh = this.haz[bi]; if (!bh.on || bh.kind !== 3) continue;
          const dx = bh.x - x, dy = bh.y - yy, pr = (bh.pullR || BH_PULL_R) * 0.7;
          if (dx * dx + dy * dy < pr * pr) {
            const away = yy < bh.y ? -1 : 1;
            yy = clamp(bh.y + away * (pr + 36), 90, WORLD_H - 90);
          }
        }
        this._pickup(0, x, yy);
      }
    }
    if (this.gateN % T.fuelN === 0) this._pickup(1, gx, c);
    else {
      const q = R();
      if (q < T.shield) this._pickup(2, gx, c);
      else if (q < T.shield + T.magnet) this._pickup(3, gx, c);
      else if (q < T.shield + T.magnet + T.gem) this._pickup(4, gx, c);
    }

    // extras between gates (stray rocks / ember / comet) — never invade escape gap
    const extraN = T.extra * spacing / 1000 * (0.22 + 0.2 * u) * (mix.asteroid + mix.comet + mix.ember);
    let nE = Math.floor(extraN) + (R() < (extraN % 1) ? 1 : 0);
    for (let e = 0; e < nE; e++) {
      const x = prevX + spacing * (0.25 + R() * 0.5);
      const typeR = R() * (mix.asteroid + mix.comet + mix.ember + 0.001);
      if (typeR < mix.asteroid) {
        const name = pickName();
        const w = drawWFor(name), m = SPR[name]; if (!m) continue;
        const rr = m[4] * (w / m[0]);
        const above = R() < 0.5;
        const y = above
          ? (yMin + rr + R() * Math.max(1, g0 - rr - 8 - (yMin + rr)))
          : (g1 + rr + 8 + R() * Math.max(1, yMax - rr - (g1 + rr + 8)));
        if (y - rr > 0 && y + rr < WORLD_H) this._hazard(name, x, y, w, 1, 0, 0, zone);
      } else if (typeR < mix.asteroid + mix.comet) {
        this._hazard("comet", x + 420, -60 - R() * 120, 120 + R() * 50, 1, -170, 150, zone);
      } else {
        this._hazard("ember", x + 160, -40 - R() * 160, 48 + R() * 24, 1, -20, 70 + R() * 40, zone);
      }
    }

    this.lastGapC = c;
    this.nextGateX = gx + spacing;
  };

  P._decor = function () {
    const R = () => this._rand();
    const wx = this.nextDecorX;
    let d = null; for (let i = 0; i < this.decor.length; i++) if (!this.decor[i].on) { d = this.decor[i]; break; }
    const zone = this._zoneAtX(wx / PAR.mid) + 1;
    if (d) {
      const q = R();
      if (q < 0.12) { d.im = "parallax/setpiece-station-z" + zone + ".png"; d.par = PAR.mid; d.w = 184; d.h = 80; d.y = 200 + R() * 260; }
      else if (q < 0.62) { d.im = "parallax/decor-planets/z" + zone + "-mid-" + Math.floor(R() * 8) + ".png"; d.par = PAR.mid; d.w = 0; d.h = 0; d.y = 84 + R() * 520; }
      else if (q < 0.8) { d.im = "parallax/decor-planets/z" + zone + "-far-" + Math.floor(R() * 4) + ".png"; d.par = PAR.farPlanets; d.w = 0; d.h = 0; d.y = 84 + R() * 520; }
      else { d.im = "parallax/decor-" + (R() < 0.5 ? "gas" : "moon") + "-z" + zone + ".png"; d.par = PAR.mid; d.w = 0; d.h = 0; d.y = 84 + R() * 520; }
      d.on = true;
      d.x = d.par === PAR.mid ? wx : (wx / PAR.mid) * PAR.farPlanets + 100; // x in its own parallax space
    }
    this.nextDecorX = wx + 300 + R() * 360;
  };

  P._stepObjects = function (dt) {
    const cam = this.cam;
    // BLACKHOLE: spin rings/arms; lighter radial pull on other deadly hazards + meteors
    const bhs = [];
    for (let i = 0; i < this.haz.length; i++) {
      const h = this.haz[i]; if (!h.on) continue;
      if (h.kind === 3) { h.rot += BH_SPIN * dt; bhs.push(h); }
    }
    for (let i = 0; i < this.haz.length; i++) {
      const h = this.haz[i]; if (!h.on) continue;
      if (h.kind !== 3 && h.par === 1 && bhs.length) {
        for (let b = 0; b < bhs.length; b++) {
          const bh = bhs[b];
          const dx = bh.x - h.x, dy = bh.y - h.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) continue; // BH_GLOBAL_PULL: hazards feel pull at any distance
          const a = (BH_G * BH_OTHER) / (BH_FALL * dist + BH_SOFT);
          h.vx += a * (dx / dist) * dt;
          h.vy += a * (dy / dist) * dt;
        }
      }
      h.x += h.vx * dt; h.y += h.vy * dt;
      const sx = h.x - cam * h.par;
      // keep right-entering movers alive until well past the left edge
      if (sx < -h.dw - 300 || sx > this.viewW + 900 || h.y > WORLD_H + 400 || h.y < -400) h.on = false;
    }
    const mag = this.magnetT > 0 && !this.crashed;
    for (let i = 0; i < this.pick.length; i++) {
      const p = this.pick[i]; if (!p.on) continue;
      p.ph += dt * 10;
      if (mag && p.kind === 0) {
        const dx = cam + this.px - p.x, dy = this.py - p.y, d2 = dx * dx + dy * dy;
        if (d2 < MAGNET_R * MAGNET_R) { const d = Math.sqrt(d2) || 1; p.x += dx / d * 520 * dt; p.y += dy / d * 520 * dt; }
      }
      if (p.x - cam < -120) p.on = false;
    }
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i]; if (!f.on) continue;
      f.t += dt; if (f.t >= f.life) { f.on = false; continue; }
      f.x += f.vx * dt; f.y += f.vy * dt;
    }
    for (let i = 0; i < this.decor.length; i++) { const d = this.decor[i]; if (d.on && d.x - cam * d.par < -260) d.on = false; }
    if (this.comet.on) { this.comet.x += 520 * dt; this.comet.y += 92 * dt; if (this.comet.x > this.viewW + 200) this.comet.on = false; }
    else if (this.cometZone !== this.zoneIdx && this.phase === "flight" && this.phaseT > 3) {
      this.cometZone = this.zoneIdx;
      if (this._rand() < 0.3) { this.comet.on = true; this.comet.x = -180; this.comet.y = 60 + this._rand() * 200; }
    }
  };
  P._spark = function (x, y, c, n, spd) {
    for (let k = 0; k < n; k++) {
      let f = null; for (let i = 0; i < this.fx.length; i++) if (!this.fx[i].on) { f = this.fx[i]; break; }
      if (!f) return;
      const a = this._rand() * Math.PI * 2, v = spd * (0.4 + this._rand() * 0.6);
      f.on = true; f.kind = 0; f.x = x; f.y = y; f.vx = Math.cos(a) * v; f.vy = Math.sin(a) * v; f.t = 0; f.life = 0.35 + this._rand() * 0.25; f.c = c;
    }
  };

  P._playerNodes = function () {
    const ch = (this.deployed && this.deployT >= 0 && this.t - this.deployT > DEPLOY_FRAME_S * 8) ? this.chainPost : this.chain;
    const spr = this.sp.rocket, cx = spr.w / 2, cy = spr.axisY;
    const c = Math.cos(this.tilt), s = Math.sin(this.tilt);
    for (let i = 0; i < 7; i++) {
      const n = ch[i], dx = n.x - cx, dy = n.y - cy, o = this.nodesW[i];
      o.x = this.px + c * dx - s * dy; o.y = this.py + s * dx + c * dy; o.r = n.r;
    }
    return this.nodesW;
  };
  P._collide = function () {
    const N = this._playerNodes(), cam = this.cam;
    // band edges
    for (let i = 0; i < 7; i++) { const n = N[i]; if (n.y - n.r < 0 || n.y + n.r > WORLD_H) { this._crash(i, n.y < 360 ? -1 : 1); return; } }
    for (let j = 0; j < this.haz.length; j++) {
      const h = this.haz[j]; if (!h.on) continue;
      const hx = h.x - cam * h.par; // screen-space (design) x
      if (hx + h.r < this.px - 130 || hx - h.r > this.px + 130) continue;
      for (let i = 0; i < 7; i++) {
        const n = N[i], dx = n.x - hx, dy = n.y - h.y, rr = n.r + h.r;
        if (dx * dx + dy * dy < rr * rr) {
          if (this.shieldGrace > 0) break;
          if (this.shield) {
            this.shield = false; this.shieldGrace = SHIELD_GRACE;
            // BH is not destroyable by shield — just burn the shield
            if (h.kind !== 3) h.on = false;
            this._spark(hx, h.y, 1, 14, 260); break;
          }
          if (h.kind === 3) { this._swallow(h); return; }
          this._crash(i, 0); return;
        }
      }
    }
    for (let j = 0; j < this.pick.length; j++) {
      const p = this.pick[j]; if (!p.on) continue;
      const pxs = p.x - cam;
      if (pxs + p.r < this.px - 130 || pxs - p.r > this.px + 130) continue;
      for (let i = 0; i < 7; i++) {
        const n = N[i], dx = n.x - pxs, dy = n.y - p.y, rr = n.r + p.r;
        if (dx * dx + dy * dy < rr * rr) {
          p.on = false;
          if (p.kind === 0) this.coins = Math.min(100000, this.coins + 1);
          else if (p.kind === 1) this.fuel = Math.min(1, this.fuel + FUEL_REFILL);
          else if (p.kind === 2) this.shield = true;
          else if (p.kind === 3) this.magnetT = MAGNET_S;
          else this.coins = Math.min(100000, this.coins + GEM_COINS);
          this._spark(pxs, p.y, p.kind === 1 ? 2 : 0, 6, 140);
          break;
        }
      }
    }
  };
  P._crash = function (nodeIdx, edge) {
    if (this.crashed) return;
    this.crashed = true; this.crashT = 0; this.crashEdge = edge; this.deathKind = "crash"; this._crashSparked = false;
    // crash point = the nose (pack frames put it at (230,150))
    const spr = this.sp.rocket, c = Math.cos(this.tilt), s = Math.sin(this.tilt), dx = spr.w / 2 - 4;
    this.crashX = this.px + c * dx; this.crashY = this.py + s * dx;
    this.crashTilt = this.tilt;
    this._sfx("crash");
    if (this.o.onCrash) this.o.onCrash();
  };
  // BH core death: suck-in / swallow (no explosion boom). ~BH_SWALLOW_S then result screen.
  P._swallow = function (bh) {
    if (this.crashed) return;
    this.crashed = true; this.crashT = 0; this.crashEdge = 0; this.deathKind = "swallow";
    this.swallowBh = bh;
    this.swallowPx = this.px; this.swallowPy = this.py; this.swallowTilt = this.tilt;
    this.swallowScale = 1;
    this.crashX = this.px; this.crashY = this.py; this.crashTilt = this.tilt;
    this._sfx("bh_swallow"); // whoosh — never crashBoom on this path
    this._audioStop(0.2);
    if (this.o.onCrash) this.o.onCrash(); // still notify host; scoring uses normal SUCCESS/FAILED
  };
  P._gameOver = function () {
    const distanceKm = Math.floor(this.km());
    const r = {
      distanceKm, deployed: this.deployed, deployKm: this.deployed ? this.deployKm : 0, bonus: this.deployed ? this.bonus : 0,
      coins: this.coins, coinPts: this.coins * COIN_PTS,
      result: this.deployed ? "SUCCESS" : "FAILED",
    };
    // deploy is only possible after 300 km and before the crash, so deployKm <= distanceKm holds
    r.score = scoreFor(r.distanceKm, r.bonus, r.coins);
    this.result = r;
    this._log("end", this.t);
    this._audioStop(0.3);
    if (this.o.onGameOver) this.o.onGameOver(r);
  };

  /* ---- autopilot (capture / perf runs only: ?bot=1 or capture API) ---- */
  P._botStep = function () {
    const b = this.bot;
    if (this.phase === "tutorial") {
      // linger so first-flight overlay is visible; evidence/bots dismiss after ~1.4s
      if (this.phaseT >= 1.4) this.dismissTutorial();
      this._botHold = false; return;
    }
    if (this.phase === "practice") {
      // gentle mid hold during practice
      this._botHold = this.py > 360 + 8; return;
    }
    if (this.phase !== "flight" || this.crashed) { this._botHold = false; return; }
    const km = this.km();
    if (b.deployAtKm && !this.deployed && km >= b.deployAtKm) this.deploy();
    if (b.crashAtKm && km >= b.crashAtKm) { // stop flying: drift down into the next wall / the edge
      this._botHold = b.crashMode === "up"; return;
    }
    // target: gap centre of the next gate ahead of the nose; dodge any hazard on the predicted line
    let target = this.lastGapC;
    const wx = this.cam + this.px;
    let best = 1e9;
    for (let i = 0; i < this.gates.length; i++) { const g = this.gates[i]; if (g.x > wx - 40 && g.x < best) { best = g.x; target = g.c; } }
    // coins + fuel slightly pull the target
    const py = this.py + this.vy * 0.16 + 0.5 * (GRAVITY * (this.deployed ? LIGHT_GRAVITY : 1)) * 0.0;
    let dodge = 0;
    for (let j = 0; j < this.haz.length; j++) {
      const h = this.haz[j]; if (!h.on) continue;
      const hx = h.x - this.cam * h.par, ahead = hx - this.px;
      if (ahead < -60 || ahead > 300) continue;
      const tAhead = Math.max(0, ahead) / Math.max(1, this.speed), yh = h.y + h.vy * tAhead;
      const yp = this.py + this.vy * tAhead;
      if (h.kind === 3) {
        // skirt: aim for the nearer open band away from core (don't coast into middle)
        const preferUp = yh > WORLD_H * 0.5;
        const skirt = preferUp ? Math.min(yh - 140, 150) : Math.max(yh + 140, WORLD_H - 150);
        target = skirt;
        if (Math.abs(yp - yh) < (h.pullR || BH_PULL_R) * 0.55) dodge += (yp < yh ? -1 : 1) * 120;
        continue;
      }
      if (Math.abs(yp - yh) < h.r + 34) dodge += (yp < yh ? -1 : 1) * (h.r + 60);
    }
    target += dodge;
    this._botHold = py > target + 4;
  };

  /* ---------------- rendering ---------------- */
  P._draw = function () {
    try {
      global.__flightState = {
        phase: this.phase, phaseT: this.phaseT, t: this.t,
        camZoom: this.camZoom, camY: this.camY, lbA: this.lbA,
        rocketScreenH: (ROCKET_LEN * (this.s || 1) * (this.camZoom || 1)),
        px: this.px, py: this.py, tilt: this.tilt, hudOn: !!this._hudOn,
        seamFromPad: !!(this.cfg && this.cfg.seamFromPad),
      };
    } catch (_) {}
    const x = this.ctx, s = this.s * this.dpr, oy = this.oy * this.dpr, VW = this.viewW;
    const lb = this.lbA == null ? (this.letterbox ? 1 : 0) : this.lbA;
    const seam = this.phase === "climb" || this.phase === "pitch" || this.phase === "settle";
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.imageSmoothingEnabled = false;
    x.fillStyle = "#050a18"; x.fillRect(0, 0, this.canvas.width, this.canvas.height);
    x.setTransform(s, 0, 0, s, 0, oy);
    // Play world (climb + pitch + flight) stays strictly in the axis-aligned band — never under letterbox.
    x.save();
    x.beginPath(); x.rect(0, 0, VW, WORLD_H); x.clip();
    x.fillStyle = "#050a18"; x.fillRect(0, 0, VW, WORLD_H); // voids from seamZoom stay navy rects, not wedges
    if (seam) this._drawSeam(x);
    else this._drawFlight(x);
    x.restore();
    // Opaque growing bars ON TOP (no alpha fade over world, no mirrored strip).
    if (this.letterbox && lb > 0.001) this._drawLetterbox(x, lb);
    if (this.letterbox && lb > 0.55) { // band edges = crash lines (only once letterbox has settled)
      const a = clamp((lb - 0.55) / 0.45, 0, 1) * 0.55;
      x.fillStyle = "rgba(100,210,255," + a.toFixed(3) + ")";
      x.fillRect(0, -3, VW, 3); x.fillRect(0, WORLD_H, VW, 3);
    }
    this._drawHud(x);
    this._drawTutorial(x);
  };
  P._drawLetterbox = function (x, lbA) {
    // Opaque axis-aligned bars whose height grows with lbA. Hard horizontal play-band edge; no translucency / soft mask / mirrored strip.
    const VW = this.viewW, ext = this.oy / this.s + 4;
    const u = lbA == null ? 1 : lbA;
    const h = ext * u;
    if (h <= 0) return;
    x.fillStyle = "#050a18";
    x.fillRect(0, -h, VW, h);
    x.fillRect(0, WORLD_H, VW, h);
  };
  // Continuous climb→pitch→flight: one camZoom. Climb column through ascent; pitch continues on flight
  // strip at the same zoom (orbit already reads as stars — no stacked climb overlay / hard seam line).
  P._drawSeam = function (x) {
    const VW = this.viewW;
    const zoom = this.camZoom || 1;
    // Caller already clipped to rect(0,0,VW,WORLD_H) — no pad into letterbox (pad caused zoomed void wedges under fading bars).
    if (this.phase === "climb") {
      this._drawClimb(x, true);
    } else {
      // settle + pitch: flight world under shared camZoom (no climb-bridge / pad column)
      this._drawFlight(x, true);
    }
    // Single rocket in seam camera space — scale tracks camZoom continuously (still inside play clip)
    const seamHoldFlame = this.phase === "settle" && this._seamSuppressFlame;
    // v6b5: settle plume morph — start near pad warm footprint, ease to flight size (no 16k→1.5k cliff)
    const thrusting = !seamHoldFlame && (this.phase === "climb" || this.phase === "pitch" || this.phase === "settle");
    let plume = seamHoldFlame ? 0
      : this.phase === "climb" ? CLIMB_PLUME
      : this.phase === "settle" ? ((this._seamPlume != null ? this._seamPlume : 0.9) * CLIMB_PLUME * (1 - 0.35 * clamp(this.phaseT / SETTLE_T, 0, 1)))
      : (1.4 + 0.6 * (1 - clamp(this.phaseT / PITCH_T, 0, 1)));
    if (!seamHoldFlame && this._seamMorphT0 != null) {
      const mu = clamp((this.t - this._seamMorphT0) / (this._seamMorphDur || 0.55), 0, 1);
      const ease = mu * mu * (3 - 2 * mu); // smoothstep
      this._seamMorphU = ease;
      // ~4× length at morph start (pad-like), → 1× at end; survives brief settle→pitch overlap
      if (this.phase === "settle" || (this.phase === "pitch" && ease < 0.999)) {
        // Strong early, still ~1.8× at mid — avoids cliff once pad FX releases
        plume *= 1 + (1 - ease) * 3.6;
      }
    } else {
      this._seamMorphU = (this.phase === "settle" && this._seamRevealed) ? 1 : 0;
    }
    const sh = this._climbShake || 0;
    const rx = this.px + (sh ? Math.sin(this.t * 47) * sh : 0);
    const ry = this.py + (sh ? Math.cos(this.t * 53) * sh * 0.55 : 0);
    x.save();
    x.translate(rx, ry); x.scale(zoom, zoom); x.translate(-rx, -ry);
    this._drawRocket(x, rx, ry, this.tilt, 1, thrusting, plume);
    if (sh > 0.4) {
      x.save(); x.globalAlpha = 0.18; x.fillStyle = "#FF8C1C";
      x.fillRect(rx - 10, ry + 90, 20, 70 + sh * 8);
      x.restore();
    }
    x.restore();
  };
  // zone art strip at 0.25x: [tile 2560][transition 1280] per zone, looping 6 -> 1
  P._strip = function (x, U, VW, y, zoom) {
    let sx = 0, u = Math.floor(U);
    const lim = VW / zoom;
    while (sx < lim) {
      const k = Math.floor(u / SEG), o = u - k * SEG, z = mod(k, 6);
      let w, im;
      if (o < SEG_TILE) {
        im = this._get(ZONES[z].tile);
        const tw = im ? im.width : 2560, col = o % tw;
        w = Math.min(tw - col, SEG_TILE - o, Math.ceil(lim - sx));
        if (im) x.drawImage(im, col, 0, w, 720, sx * zoom, y, w * zoom, 720 * zoom);
        else { x.fillStyle = "#0b1430"; x.fillRect(sx * zoom, y, w * zoom, 720 * zoom); }
      } else {
        im = this._get(TRANS[z]);
        const col = o - SEG_TILE;
        w = Math.min(SEG_TRANS - col, Math.ceil(lim - sx));
        if (im) x.drawImage(im, col, 0, w, 720, sx * zoom, y, w * zoom, 720 * zoom);
        else { x.fillStyle = "#0b1430"; x.fillRect(sx * zoom, y, w * zoom, 720 * zoom); }
      }
      sx += w; u += w;
    }
  };
  P._drawClimb = function (x, worldOnly) {
    // world column [orbit tile 720 | climb bridge 1440 | pad plate 720]; camera top 2160 -> 0
    // Zoom comes from continuous seam cam (camZoom), not a separate competing curve.
    const VW = this.viewW, colScale = Math.max(1, VW / 1280);
    const zoom = this.camZoom || 1;
    const ox = (VW - 1280 * colScale) / 2;
    const sh = this._climbShake || 0;
    const rx = (this.px || VW / 2) + (sh ? (Math.sin(this.t * 47) * sh) : 0);
    const ry = (this.py || 430) + (sh ? (Math.cos(this.t * 53) * sh * 0.55) : 0);
    x.save();
    x.translate(rx, ry); x.scale(zoom, zoom); x.translate(-rx, -ry);
    const top = -this.camY * colScale;
    const orbit = this._get("bg-orbit-edge-tile.png"), bridge = this._get("climb-bridge-" + this.cfg.tod + ".png");
    if (orbit) x.drawImage(orbit, ox, top, 1280 * colScale, 720 * colScale);
    if (bridge) x.drawImage(bridge, ox, top + 720 * colScale, 1280 * colScale, 1440 * colScale);
    if (this._pad) x.drawImage(this._pad, 0, 0, this._pad.width, this._pad.height, ox, top + 2160 * colScale, 1280 * colScale, 720 * colScale);
    if (!worldOnly) {
      this._drawRocket(x, rx, ry, this.tilt || -Math.PI / 2, 1, true, CLIMB_PLUME);
      if (sh > 0.4) {
        x.save(); x.globalAlpha = 0.18; x.fillStyle = "#FF8C1C";
        x.fillRect(rx - 10, ry + 90, 20, 70 + sh * 8);
        x.restore();
      }
    }
    x.restore();
  };
  P._drawFlight = function (x, worldOnly) {
    const VW = this.viewW, cam = this.cam;
    // 1) zone art (0.25x); pitch uses continuous seam camZoom pivoted on rocket (matches climb column)
    const zoom = (this.phase === "pitch" || this.phase === "settle") ? (this.camZoom || 1) : 1;
    const seamZoom = zoom !== 1;
    if (seamZoom) { x.save(); x.translate(this.px, this.py); x.scale(zoom, zoom); x.translate(-this.px, -this.py); }
    this._strip(x, this._artU(), VW, 0, 1);
    // 2) far stars 0.1x (translucent; the pack's luma<90 mask is approximated by alpha)
    const st = this._get("parallax/far-stars-tile.png");
    if (st) {
      x.globalAlpha = 0.5;
      const off = mod(Math.floor(cam * PAR.stars), 1280);
      for (let sx = -off; sx < VW; sx += 1280) x.drawImage(st, sx, 0);
      x.globalAlpha = 1;
    }
    // 3) zone edge body (x fixed): earth limb rises in the pitch-over and drops out over 0-600 km
    this._drawBody(x);
    // 4) set-piece comet (far layer, own velocity)
    if (this.comet.on) { const c = this._get("parallax/setpiece-comet.png"); if (c) { x.save(); x.translate(this.comet.x, this.comet.y); x.rotate(0.176); x.drawImage(c, -88, -20); x.restore(); } }
    // 5) decor: far planets 0.2x, mid decor 0.5x
    for (let i = 0; i < this.decor.length; i++) {
      const d = this.decor[i]; if (!d.on) continue;
      const im = this._get(d.im); if (!im) continue;
      x.drawImage(im, Math.round(d.x - cam * d.par), Math.round(d.y));
    }
    // 6) near dust (1.3x): drawn under the gameplay layer so it never covers sprite or HUD pixels
    if (this.phase === "flight") {
      const Z = ZONES[this.bannerZone] || ZONES[0];
      x.fillStyle = Z.accent; x.globalAlpha = 0.55;
      const len = clamp(this.speed / 40, 6, 18);
      for (let i = 0; i < this.dust.length; i++) { const d = this.dust[i], sx = mod(d.x - cam * PAR.dust, VW + 40) - 20; x.fillRect(Math.round(sx), Math.round(d.y), len, 2); }
      x.globalAlpha = 1;
    }
    // 7) gameplay: planets (0.7x) first, then rocks/comets/embers, pickups
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.haz.length; i++) {
        const h = this.haz[i]; if (!h.on || (pass === 0) !== (h.par !== 1)) continue;
        const im = this._get(h.im); if (!im) continue;
        const sx = h.x - cam * h.par;
        if (sx + h.dw < -50 || sx - h.dw > VW + 50) continue;
        const deadly = h.par === 1 && (h.kind === 3 || h.kind === 2 || (h.im && (h.im.indexOf("asteroid") === 0 || h.im.indexOf("hazard-") === 0)));
        const decorPlanet = h.par !== 1;
        if (h.kind === 3 || h.rot) {
          x.save(); x.translate(sx, h.y); x.rotate(h.rot || 0);
          if (deadly && h.kind !== 3) { // silhouette before sprite (BH has own core ring in pull VFX)
            x.strokeStyle = "rgba(255, 210, 140, 0.55)"; x.lineWidth = 3;
            x.beginPath(); x.arc(0, 0, Math.max(h.r * 1.15, h.dw * 0.28), 0, Math.PI * 2); x.stroke();
          }
          x.drawImage(im, Math.round(-h.ox), Math.round(-h.oy), Math.round(h.dw), Math.round(h.dh));
          if (h.kind === 3) { // always-on core/ring telegraph at phone size
            x.strokeStyle = "rgba(200,160,255,0.75)"; x.lineWidth = 2.5;
            x.beginPath(); x.arc(0, 0, Math.max(16, h.r * 1.05), 0, Math.PI * 2); x.stroke();
            x.strokeStyle = "rgba(120,80,220,0.35)"; x.lineWidth = 1.5;
            x.beginPath(); x.arc(0, 0, Math.max(28, h.dw * 0.42), 0, Math.PI * 2); x.stroke();
          }
          x.restore();
        } else {
          if (deadly) {
            x.save();
            x.strokeStyle = "rgba(255, 200, 120, 0.5)"; x.lineWidth = 2.5;
            x.beginPath(); x.arc(sx, h.y, Math.max(h.r * 1.1, Math.min(h.dw, h.dh) * 0.32), 0, Math.PI * 2); x.stroke();
            x.restore();
          }
          x.globalAlpha = decorPlanet ? 0.92 : 1;
          x.drawImage(im, Math.round(sx - h.ox), Math.round(h.y - h.oy), Math.round(h.dw), Math.round(h.dh));
          x.globalAlpha = 1;
        }
        if (this.cfg && this.cfg.debugHitbox && h.kind === 3) {
          x.save();
          x.strokeStyle = "rgba(255,80,120,0.9)"; x.lineWidth = 2;
          x.beginPath(); x.arc(sx, h.y, h.r, 0, Math.PI * 2); x.stroke(); // CORE death
          x.strokeStyle = "rgba(180,100,255,0.35)"; x.lineWidth = 1;
          x.beginPath(); x.arc(sx, h.y, h.pullR || BH_PULL_R, 0, Math.PI * 2); x.stroke(); // pullR ref ring (accel is global)
          x.restore();
        }
      }
    }
    for (let i = 0; i < this.pick.length; i++) {
      const p = this.pick[i]; if (!p.on) continue;
      const sx = p.x - cam; if (sx < -60 || sx > VW + 60) continue;
      if (p.kind === 0) {
        const f = Math.floor(p.ph) % 5, m = SPR["coin_f" + f], im = this._get(COIN_IMG[f]); if (!im) continue;
        x.drawImage(im, Math.round(sx - m[2] * p.sc), Math.round(p.y - m[3] * p.sc), Math.round(m[0] * p.sc), Math.round(m[1] * p.sc));
      } else {
        const im = this._get(p.im); if (!im) continue;
        const bob = Math.sin(p.ph * 0.4) * 3;
        x.drawImage(im, Math.round(sx - p.ox), Math.round(p.y - p.oy + bob), Math.round(p.dw), Math.round(p.dh));
      }
    }
    if (seamZoom) x.restore();
    // 8) rocket / deploy / crash (skipped when seam draws the rocket once under shared camZoom)
    if (!worldOnly) {
      if (!this.crashed) {
        if (this.shield || this.shieldGrace > 0) {
          if (!(this.shieldGrace > 0 && Math.floor(this.t * 12) % 2)) {
            x.strokeStyle = "rgba(120,220,255,0.8)"; x.lineWidth = 3;
            x.beginPath(); x.ellipse(this.px, this.py, ROCKET_LEN * 0.58, 34, this.tilt, 0, Math.PI * 2); x.stroke();
          }
        }
        const seamHoldFlame = this.phase === "settle" && this._seamSuppressFlame;
        const thrusting = !seamHoldFlame && ((this.phase === "climb" || this.phase === "pitch" || this.phase === "settle" || this.phase === "tutorial") || ((this.phase === "flight" || this.phase === "practice") && (this.bot ? this._botHold : this.holding) && this.fuel > 0));
        this._drawRocket(x, this.px, this.py, this.tilt, 1, thrusting, seamHoldFlame ? 0 : (this.phase === "pitch" ? (1.4 + 0.6 * (1 - clamp(this.phaseT / PITCH_T, 0, 1))) : 1));
        // exhaust sparks from engine nozzles only (gp1 P1#11)
        if (thrusting && (this.phase === "flight" || this.phase === "practice") && (Math.floor(this.t * 40) % 2 === 0)) {
          const nos = (this.sp && this.sp.nozzles) || [{ y: 0, s: 1 }];
          const c = Math.cos(this.tilt), s = Math.sin(this.tilt);
          const w = this.sp.rocket.w;
          for (let ni = 0; ni < nos.length; ni++) {
            const lx = -w / 2 - 8, ly = nos[ni].y;
            const wx = this.px + c * lx - s * ly, wy = this.py + s * lx + c * ly;
            this._spark(wx, wy, 0, 1, 90);
          }
        }
      } else if (this.deathKind === "swallow") {
        // Spinning shrink into core — rocket only, no crash frames / debris / boom art
        if (this.swallowScale > 0.04) {
          x.save();
          x.translate(this.px, this.py);
          x.rotate(this.tilt);
          x.scale(this.swallowScale, this.swallowScale);
          this._drawRocket(x, 0, 0, 0, 1, false);
          x.restore();
        }
      } else this._drawCrash(x);
      this._drawDeployFx(x);
      // FX sparks
      for (let i = 0; i < this.fx.length; i++) {
        const f = this.fx[i]; if (!f.on) continue;
        x.fillStyle = f.c === 1 ? "#a0ebff" : f.c === 2 ? "#7cff7c" : "#ffe36a";
        x.fillRect(Math.round(f.x) - 2, Math.round(f.y) - 2, 4, 4);
      }
      // BH pull cue: dark vignette + purple/blue swirl (NOT brown/orange dirt wash) — soft-R scoped
      if (this._bhInPull && !this.crashed) this._drawBhPullVfx(x, VW);
      // crash dim
      if (this.crashed && this.deathKind === "swallow") {
        // mild vignette as we fall in — no explosion dim
        const u = clamp(this.crashT / BH_SWALLOW_S, 0, 1);
        x.fillStyle = "rgba(10,0,20," + (0.18 + 0.55 * u * u).toFixed(3) + ")";
        x.fillRect(0, 0, VW, WORLD_H);
      } else if (this.crashed && this.crashT > CRASH_DIM_AT) { x.fillStyle = "rgba(0,0,0," + (CRASH_DIM * clamp((this.crashT - CRASH_DIM_AT) / CRASH_DIM_RAMP, 0, 1)).toFixed(3) + ")"; x.fillRect(0, 0, VW, WORLD_H); }
    }
  };
  const COIN_IMG = ["coin_f0.png", "coin_f1.png", "coin_f2.png", "coin_f3.png", "coin_f4.png"];
  P._drawBody = function (x) {
    const VW = this.viewW;
    let im = null, y = 720;
    const U = this._artU(), k = Math.floor(U / SEG), o = U - k * SEG, z = mod(k, 6), Z = ZONES[z];
    // v6: during pad→flight settle, keep earth limb hidden (pad last frame is starfield) so
    // first visible flight frame matches pad — limb eases in during pitch.
    if (this.phase === "settle" && this._seamHideBody) return;
    if (this.phase === "pitch" || (z === 0 && k === 0)) {
      im = this._get("earth-limb.png");
      if (this.phase === "pitch") y = this.bodyY;
      else y = 105 + (720 - 105) * ease(this.km() / 600);
      if (o > SEG_TILE) y = 720; // gone by the transition
    } else if (Z.body) {
      im = this._get(Z.body);
      const inU = clamp(o / 1280, 0, 1), outU = clamp((o - SEG_TILE) / 1280 / 0.4, 0, 1);
      const rest = Z.bodyY;
      if (z === 0) { y = 105 + (720 - 105) * (1 - easeOut(inU)); } // 6->1 loop: limb slides back in
      else if (Z.bodySide > 0) y = 720 + (rest - 720) * easeOut(inU) + (720 - rest) * ease(outU);
      else { const h = im ? im.height : 224; y = -h + h * easeOut(inU) - h * ease(outU); }
    }
    if (!im || y >= 720) return;
    const w = Math.max(1280, VW), ox = (VW - w) / 2;
    x.drawImage(im, 0, 0, im.width, im.height, Math.round(ox), Math.round(y), w, im.height);
  };
  P._drawRocket = function (x, cx, cy, ang, a, flame, plumeScale) {
    const sp = this.sp, rk = sp.rocket;
    let im = rk.canvas, w = rk.w, h = rk.h, ay = rk.axisY, fx = 0;
    let frame = -1;
    if (this.deployed && this.deployT >= 0) {
      const dt = this.t - this.deployT; frame = Math.floor(dt / DEPLOY_FRAME_S);
      if (frame >= 8) { frame = -1; if (sp.postImg) { const pi = this._get(sp.postImg); if (pi) { im = pi; fx = 1; } } else if (sp.post) { im = sp.post.canvas; } }
    }
    x.save(); x.translate(cx, cy); x.rotate(ang);
    if (flame) this._drawFlame(x, -w / 2, plumeScale || 1);
    if (frame >= 0 && sp.frames) { // pack frames: stack tail at x=0, stack top at origin y
      const f = this._get(sp.frames[frame]);
      if (f) x.drawImage(f, -w / 2, -ay - sp.origin[1]);
      else x.drawImage(im, -w / 2, -ay);
    } else if (frame >= 0) { // runtime fallback deploy: puff ring + separating payload, post sprite from f1
      if (frame >= 1 && sp.post) x.drawImage(sp.post.canvas, -w / 2, -ay); else x.drawImage(im, -w / 2, -ay);
      const nx = w / 2 - (sp.payloadInset || 0);
      const rr = RING_R[frame];
      if (rr > 0) {
        x.fillStyle = frame < 4 ? "#e8eef4" : frame < 6 ? "#b8c2cc" : "#8a939c";
        for (let k = 0; k < 16; k++) { if ((k + frame) % 3 === 0 && frame > 4) continue; const a2 = k / 16 * Math.PI * 2; x.fillRect(Math.round(nx + Math.cos(a2) * rr * 0.55) - 2, Math.round(Math.sin(a2) * rr) - 2, 4, 4); }
      }
      const pd = this._payloadDrawable();
      if (pd) x.drawImage(pd, Math.round(nx + PAY_FWD[frame] - pd.width / 2), Math.round(-PAY_SIDE[frame] - pd.height / 2));
      if (frame === 1) { x.fillStyle = "rgba(255,255,230,0.8)"; x.fillRect(nx - 6, -6, 12, 12); }
    } else if (fx) x.drawImage(im, -w / 2, -ay - sp.origin[1]);
    else x.drawImage(im, -w / 2, -ay);
    x.restore();
  };
  P._payloadDrawable = function () { const sp = this.sp; if (sp.payload) return sp.payload.canvas; return sp.payloadImg ? this._get(sp.payloadImg) : null; };
  // Flames in rocket-local space (after rotate) so side boosters track nozzles, not world-vertical.
  P._drawFlame = function (x, tailX, plumeScale) {
    const ps = plumeScale || 1;
    const nos = (this.sp && this.sp.nozzles && this.sp.nozzles.length) ? this.sp.nozzles : [{ y: 0, s: 1 }];
    const fl = (Math.floor(this.t * 30) % 3);
    // v6b5 morph: pixel-cell plume (not stub rects) while scale is boosted — warmPx continuity
    const morph = this._seamMorphT0 != null
      ? (1 - clamp(this._seamMorphU != null ? this._seamMorphU : 0, 0, 1)) : 0;
    const organic = morph > 0.04 || ps > 2.2;
    for (let i = 0; i < nos.length; i++) {
      const n = nos[i], y = n.y, sc = (n.s || 1) * Math.min(ps, organic ? ps : 1);
      const L = (26 + fl * 5) * sc * (ps > 1.5 ? 1.15 : 1) * (organic ? (1.05 + 0.7 * morph) : 1);
      const hw = Math.max(4, 6 * sc), hh = Math.max(3, 5 * sc);
      if (organic) {
        // Cellular-ish: small squares along tapered length (reads closer to pad FX than big lobes)
        const cell = Math.max(2, Math.round(2 + 2 * morph));
        const cols = Math.max(6, Math.round((hw * (1.3 + 1.1 * morph)) / cell));
        const rows = Math.max(10, Math.round(L / cell));
        const seed = (Math.floor(this.t * 37) + i * 17) | 0;
        for (let r = 0; r < rows; r++) {
          const u = r / (rows - 1);
          const half = Math.max(1, Math.round(cols * (1 - u * (0.55 + 0.3 * morph)) * 0.5));
          const xBase = tailX - (r + 1) * cell;
          for (let c = -half; c <= half; c++) {
            const h = (seed + r * 31 + c * 17) & 255;
            if (h < 40 + u * 70) continue; // sparse breakup toward tip
            const heat = 1 - u * 0.85 - Math.abs(c) / (half + 1) * 0.35;
            x.fillStyle = heat > 0.75 ? "#FFF8D0" : heat > 0.55 ? "#FFDE40" : heat > 0.32 ? "#FF8C1C" : "#D6301C";
            x.fillRect(xBase + ((h % 3) - 1), y + c * cell, cell, cell);
          }
        }
      } else {
        x.fillStyle = "#D6301C"; x.fillRect(tailX - L, y - hw, L, hw * 2);
        x.fillStyle = "#FF8C1C"; x.fillRect(tailX - L * 0.72, y - hh, L * 0.72, hh * 2);
        x.fillStyle = "#FFDE40"; x.fillRect(tailX - L * 0.42, y - Math.max(2, 3 * sc), L * 0.42, Math.max(4, 6 * sc));
        if (ps > 1.6) {
          x.fillStyle = "#FFF8D0"; x.fillRect(tailX - L * 0.22, y - 2 * sc, L * 0.22, 4 * sc);
        }
      }
    }
  };
  P._drawBhPullVfx = function (x, VW) {
    // Find nearest BH for localized swirl (soft-R). Dark vignette + purple/blue — never dirt wash.
    let best = null, bestD = 1e9;
    const cam = this.cam;
    for (let i = 0; i < this.haz.length; i++) {
      const h = this.haz[i]; if (!h.on || h.kind !== 3) continue;
      const hx = h.x - cam * h.par, dx = hx - this.px, dy = h.y - this.py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = h; }
    }
    // screen-wide soft darkening (cool purple, low alpha)
    x.fillStyle = "rgba(18, 6, 42, 0.16)";
    x.fillRect(0, 0, VW, WORLD_H);
    if (!best) return;
    const hx = best.x - cam * best.par, hy = best.y;
    const pr = best.pullR || BH_PULL_R;
    const g = x.createRadialGradient(hx, hy, best.r * 0.6, hx, hy, pr);
    g.addColorStop(0, "rgba(40, 0, 70, 0.0)");
    g.addColorStop(0.35, "rgba(90, 40, 180, 0.14)");
    g.addColorStop(0.7, "rgba(40, 80, 200, 0.18)");
    g.addColorStop(1, "rgba(10, 20, 50, 0.0)");
    x.fillStyle = g;
    x.beginPath(); x.arc(hx, hy, pr, 0, Math.PI * 2); x.fill();
    // spinning arc cues (readable at phone size)
    x.save();
    x.translate(hx, hy);
    x.rotate((best.rot || 0) * 1.6 + this.t * 1.8);
    x.strokeStyle = "rgba(160, 120, 255, 0.45)"; x.lineWidth = 2.5;
    x.beginPath(); x.arc(0, 0, pr * 0.55, 0.15, 1.4); x.stroke();
    x.strokeStyle = "rgba(80, 160, 255, 0.4)"; x.lineWidth = 2;
    x.beginPath(); x.arc(0, 0, pr * 0.78, 2.0, 3.4); x.stroke();
    x.strokeStyle = "rgba(200, 160, 255, 0.28)"; x.lineWidth = 1.5;
    x.beginPath(); x.arc(0, 0, pr * 0.92, 4.0, 5.5); x.stroke();
    // bright core ring so BH doesn't blend into dust
    x.strokeStyle = "rgba(220, 180, 255, 0.7)"; x.lineWidth = 2;
    x.beginPath(); x.arc(0, 0, Math.max(18, best.r * 1.15), 0, Math.PI * 2); x.stroke();
    x.restore();
  };
  P._drawDeployFx = function (x) {
    if (!this.deployed || this.deployT < 0) return;
    const dt = this.t - this.deployT, rel = dt - DEPLOY_FRAME_S * 8;
    // released payload: +40 px/s forward, fades in 0.5 s with a coin burst
    const pd = this._payloadDrawable();
    if (rel >= 0 && rel < 0.5 && pd) {
      x.globalAlpha = 1 - rel / 0.5;
      x.drawImage(pd, Math.round(this.px + ROCKET_LEN / 2 + 68 + 40 * rel - pd.width / 2), Math.round(this.py - 22 - pd.height / 2));
      x.globalAlpha = 1;
      if (!this._burstDone) { this._burstDone = true; this._spark(this.px + ROCKET_LEN / 2 + 68, this.py - 22, 0, 16, 220); }
    }
    if (rel < 0) this._burstDone = false;
    // "+N BONUS" pop
    const pt = this.t - this.popT;
    if (pt >= 0 && pt < 1.6) {
      const sc = pt < 0.15 ? 0.6 + pt / 0.15 * 0.5 : pt < 0.3 ? 1.1 - (pt - 0.15) / 0.15 * 0.1 : 1;
      x.save(); x.translate(this.px + 40, this.py - 70 - pt * 24); x.scale(sc, sc);
      x.globalAlpha = pt > 1.2 ? 1 - (pt - 1.2) / 0.4 : 1;
      x.font = "bold 38px 'DejaVu Sans', 'Verdana', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 6; x.strokeStyle = "#0A1C3A"; x.strokeText(this._popText, 0, 0);
      x.fillStyle = "#7CFF9A"; x.fillText(this._popText, 0, 0);
      x.restore(); x.globalAlpha = 1;
    }
  };
  P._drawCrash = function (x) {
    const f = Math.min(7, Math.floor(this.crashT / CRASH_FRAME_S));
    const fr = this.sp.crash;
    const sc = 1.35; // gp1: bigger punch for Moon Giant–class stacks
    x.save(); x.translate(this.crashX, this.crashY); x.rotate(this.crashTilt); x.scale(sc, sc);
    if (fr) { const im = typeof fr[f] === "string" ? this._get(fr[f]) : fr[f]; if (im) x.drawImage(im, -230, -150); }
    // extra flash bloom first frames
    if (f < 3) {
      const R = BURST_R[f] * 1.1;
      x.fillStyle = f === 0 ? "rgba(255,255,230,0.55)" : "rgba(255,140,40,0.28)";
      x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
    }
    x.restore();
    // world-space spark burst once
    if (!this._crashSparked) {
      this._crashSparked = true;
      this._spark(this.crashX, this.crashY, 0, 28, 420);
      this._spark(this.crashX, this.crashY, 1, 12, 320);
    }
  };

  /* ---- first-flight overlay (art still; runtime dims + tip) ---- */
  P._drawTutorial = function (x) {
    if (this.phase !== "tutorial") return;
    const im = this._get("tutorial/FT-first-flight-overlay.png");
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // soft dim
    x.fillStyle = "rgba(0,0,0,0.26)"; x.fillRect(0, 0, this.cssW, this.cssH);
    if (im) {
      // cover play band (letterbox-aware)
      const bw = this.viewW * this.s, bh = this.bandH;
      const bx = (this.cssW - bw) / 2, by = this.oy;
      x.imageSmoothingEnabled = true;
      x.globalAlpha = 0.92;
      x.drawImage(im, bx, by, bw, bh);
      x.globalAlpha = 1; x.imageSmoothingEnabled = false;
    }
    // pulsing tip (art has tip; reinforce for phone)
    const pulse = 0.7 + 0.3 * Math.sin(this.t * Math.PI * 2 * 1.2);
    x.font = "bold " + Math.round(16 * this.hs) + "px 'DejaVu Sans', Verdana, sans-serif";
    x.textAlign = "center"; x.textBaseline = "bottom";
    x.fillStyle = "rgba(225,242,255," + pulse.toFixed(2) + ")";
    x.fillText("tap screen to continue", this.cssW / 2, this.cssH - 18 - (this.letterbox ? 4 : 0));
    x.textAlign = "left";
  };
  /* ---- HUD (canvas: chips, fuel bar, zone banner; deploy + pause are DOM buttons) ---- */
  P._chip = function (x, X, Y, W, H) {
    x.fillStyle = HUD.navy; x.fillRect(X, Y, W, H);
    x.strokeStyle = HUD.cyan; x.lineWidth = 2; x.strokeRect(X + 1, Y + 1, W - 2, H - 2);
    x.strokeStyle = HUD.inner; x.lineWidth = 1; x.strokeRect(X + 3.5, Y + 3.5, W - 7, H - 7);
  };
  P._drawHud = function (x) {
    if (this.phase === "climb") return;
    if (this.phase === "settle" && !this._hudOn) return;
    const hs = this.hs * this.dpr;
    // HUD anchor: top-left of the band (landscape) or of the screen (portrait letterbox)
    const top = this.letterbox ? Math.max(8, this.oy - 96 * this.hs - 8) : 8;
    x.setTransform(hs, 0, 0, hs, 8 * this.dpr, top * this.dpr + (this.letterbox ? 0 : 0));
    const km = Math.floor(this.km());
    if (km !== this._hud.km) { this._hud.km = km; this._hud.kmS = km.toLocaleString("en-US") + " km"; }
    if (this.coins !== this._hud.coins) { this._hud.coins = this.coins; this._hud.coinsS = String(this.coins); }
    x.font = "bold 22px 'DejaVu Sans', 'Verdana', sans-serif"; x.textBaseline = "middle"; x.textAlign = "left";
    const kmW = Math.max(150, x.measureText(this._hud.kmS).width + 34);
    this._chip(x, 6, 6, kmW, 42); x.fillStyle = HUD.text; x.fillText(this._hud.kmS, 22, 28);
    const cx0 = 6 + kmW + 8, cw = Math.max(96, x.measureText(this._hud.coinsS).width + 70);
    this._chip(x, cx0, 6, cw, 42);
    const ci = this._get("coin_f0.png"); if (ci) x.drawImage(ci, cx0 + 10, 14, 25, 26);
    x.fillStyle = HUD.text; x.fillText(this._hud.coinsS, cx0 + 44, 28);
    // phase chip — endless flight shows FLIGHT (never GROUNDED)
    const phaseLabel = (this.phase === "tutorial") ? "HOW TO FLY" : (this.phase === "practice") ? "PRACTICE" : "FLIGHT";
    const plW = Math.max(100, x.measureText(phaseLabel).width + 28);
    const plX = cx0 + cw + 8;
    this._chip(x, plX, 6, plW, 42); x.fillStyle = HUD.text; x.fillText(phaseLabel, plX + 14, 28);
    // fuel bar: 10 segments, green > 35 % > amber > 15 % > red
    this._chip(x, 6, 56, 200, 34);
    const fi = this._get("fuel.png"); if (fi) x.drawImage(fi, 14, 61, 17, 24);
    const segs = Math.ceil(this.fuel * 10 - 1e-6), col = this.fuel > 0.35 ? "#4ED45A" : this.fuel > 0.15 ? "#F2B233" : "#E8483A";
    for (let i = 0; i < 10; i++) { x.fillStyle = i < segs ? col : "#1c2f4c"; x.fillRect(38 + i * 16, 66, 13, 14); }
    if (this.shield || this.magnetT > 0) {
      let ix = 214;
      if (this.shield) { const im = this._get("shield.png"); if (im) x.drawImage(im, ix, 52, 40, 42); ix += 46; }
      if (this.magnetT > 0) { const im = this._get("magnet.png"); if (im) x.drawImage(im, ix, 58, 29, 30); }
    }
    // zone banner: in 0.25 s / hold 1.5 s / out 0.25 s
    const bt = this.t - this.bannerT;
    if (bt >= 0 && bt < 2 && this.phase === "flight" && this.hazardsOn) {
      const a = bt < 0.25 ? bt / 0.25 : bt > 1.75 ? (2 - bt) / 0.25 : 1;
      const Z = ZONES[this.bannerZone];
      const label = BANNERS[this.bannerZone];
      x.setTransform(hs, 0, 0, hs, 0, 0);
      x.font = "bold 22px 'DejaVu Sans', 'Verdana', sans-serif"; x.textAlign = "center";
      const W = x.measureText(label).width + 70, cxs = this.cssW / this.hs / 2;
      const by = this.letterbox ? (this.oy / this.hs) + 12 : 10;
      x.globalAlpha = a;
      this._chip(x, cxs - W / 2, by, W, 40);
      x.fillStyle = Z.accent; x.fillRect(cxs - W / 2 + 10, by + 10, 5, 20); x.fillRect(cxs + W / 2 - 15, by + 10, 5, 20);
      x.fillStyle = HUD.text; x.fillText(label, cxs, by + 21);
      x.globalAlpha = 1; x.textAlign = "left";
    }
    if (this.paused) {
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(0, 0, this.cssW, this.cssH);
    }
  };
  const BANNERS = ZONES.map((z, i) => "ZONE " + (i + 1) + " \u00b7 " + z.name);

  /* ---------------- stack -> flight sprites (once per run) ---------------- */
  // KIT/MB from index.html. Pack frames when the stack is one of the 4 proven pack stacks,
  // otherwise runtime equivalents built from the same kit pixels (documented fallback).
  function prepareStack(KIT, MB, build, base) {
    base = base || "flight/";
    const ids = [build.s1, build.upper, build.payload].filter(Boolean);
    const sides = build.sides ? ["side-booster-left", "side-booster-right"] : null;
    const L = KIT.lighting, lc = L.tods["05"];            // pack flight sprites are lit with TOD 05
    const st = MB.composeStack(KIT.pieces, KIT.metas, ids, sides);
    const lit = MB.light(st, lc, L.kitMean, L.kitStd);
    const rocket = toFlightSprite(st, lit, null, ROCKET_LEN);
    const key = ids.join(",") + "|" + (build.sides ? 1 : 0), pack = PACK_STACKS[key] || null;
    // nozzle Y offsets in flight-local space (nose-right): upright +x → flight +y after CW rotate
    const nozzles = [{ y: 0, s: 1 }];
    if (build.sides) {
      const k = rocket.scale;
      for (let li = 0; li < st.layers.length; li++) {
        const Ly = st.layers[li]; if (Ly.kind !== "side") continue;
        const midX = Ly.x + Ly.w / 2;
        nozzles.push({ y: (midX - st.axisX) * k, s: 0.55 });
      }
    }
    const out = { rocket, post: null, payload: null, frames: null, origin: null, crash: null, packKey: pack ? pack.key : null, mode: "", nozzles };
    // layer index -> piece id: payload layers are the payload piece + its frustum join
    const isPayloadLayer = (i) => { const Ly = st.layers[i]; return build.payload && (Ly.name === build.payload || (Ly.kind === "frustum" && Ly.joinOf === build.payload)); };
    if (pack) {
      out.frames = []; for (let i = 0; i < 8; i++) out.frames.push("deploy/" + pack.key + "/f" + i + ".png");
      out.origin = pack.origin; out.mode = "pack:" + pack.key;
      out.postImg = "deploy/" + pack.key + "/post-rocket.png"; out.payloadImg = "deploy/" + pack.key + "/payload.png";
    }
    if (build.payload) {
      out.post = toFlightSprite(st, lit, (i) => !isPayloadLayer(i), ROCKET_LEN);
      out.post.axisY = rocket.axisY; // same canvas geometry
      // payload piece on its own (same scale), cropped
      const pl = toFlightSprite(st, lit, (i) => isPayloadLayer(i), ROCKET_LEN);
      out.payload = cropAlpha(pl.canvas);
      out.payloadInset = out.payload ? Math.round(out.payload.w / 2) : 0;
      if (!pack) out.mode = "runtime:payload-split";
    } else if (!pack) { out.mode = "runtime:selftopped (generic capsule)"; out.payloadImg = "deploy/steel/payload.png"; }
    if (pack) out.post = null; // pack post-rocket.png is drawn in frame space
    out.crash = pack && pack.crash ? CRASH_PACK(pack.key) : buildCrashFrames(rocket);
    return out;
  }
  function CRASH_PACK(key) { const a = []; for (let i = 0; i < 8; i++) a.push("crash/" + key + "/f" + i + ".png"); return a; }
  function cropAlpha(c) {
    const x = c.getContext("2d"), d = x.getImageData(0, 0, c.width, c.height).data;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let X = 0; X < c.width; X++) if (d[(y * c.width + X) * 4 + 3]) { if (X < x0) x0 = X; if (X > x1) x1 = X; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const o = cv(x1 - x0 + 1, y1 - y0 + 1); o.getContext("2d").drawImage(c, -x0, -y0);
    return { canvas: o, w: o.width, h: o.height };
  }
  // Runtime crash frames (same language as the pack's fp_crash_hud: 4-px cells, 17-spike star,
  // 5 colours, radius 20/42/62/74/80/80/74/64, ordered hole-punching, real-sprite debris). 400x300, nose at (230,150).
  function buildCrashFrames(spr) {
    const frames = [], rnd = (() => { let s = 99991; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const deb = []; for (let i = 0; i < 20; i++) { const a = rnd() * Math.PI * 2, v = 30 + rnd() * 70; deb.push({ a, v, sx: Math.floor(rnd() * Math.max(1, spr.w - 10)), sy: Math.floor(spr.axisY - 5 + rnd() * 6), sz: 6 + Math.floor(rnd() * 5), fire: i % 2 }); }
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let f = 0; f < 8; f++) {
      const c = cv(400, 300), x = c.getContext("2d"); x.imageSmoothingEnabled = false;
      if (f === 0) { x.drawImage(spr.canvas, 230 - spr.w, 150 - spr.axisY); x.fillStyle = BURST_COL[0]; x.fillRect(226, 146, 8, 8); frames.push(c); continue; }
      const R = BURST_R[f], hole = (f - 1) / 6 * 0.66;
      for (let gy = -R; gy <= R; gy += 4) for (let gx = -R; gx <= R; gx += 4) {
        const d = Math.hypot(gx, gy), ang = Math.atan2(gy, gx), spike = 0.78 + 0.22 * Math.cos(ang * 17);
        if (d > R * spike) continue;
        const cell = ((gx / 4) & 3) + (((gy / 4) & 3) << 2);
        if (BAYER[cell] / 16 < hole) continue;
        const age = clamp(d / R * 0.8 + f / 9, 0, 0.999);
        x.fillStyle = BURST_COL[Math.floor(age * 5)];
        x.fillRect(230 + gx - 2, 150 + gy - 2, 4, 4);
      }
      for (const b of deb) {
        const t = f * CRASH_FRAME_S * 1.6, px = 230 + Math.cos(b.a) * b.v * t * 3, py = 150 + Math.sin(b.a) * b.v * t * 3 + 40 * t * t;
        if (b.fire) { x.fillStyle = BURST_COL[Math.min(4, 1 + Math.floor(f / 2))]; x.fillRect(Math.round(px), Math.round(py), 4, 4); }
        else x.drawImage(spr.canvas, b.sx, Math.max(0, b.sy), b.sz, b.sz, Math.round(px), Math.round(py), b.sz, b.sz);
      }
      frames.push(c);
    }
    return frames;
  }

  // gate bookkeeping for the autopilot (ring buffer of recent gate centres)
  // gate bookkeeping is done inside P._gate (escape-gap evidence fields included)
  const _startOrig = P.start;
  P.start = function (cfg) { this.gates = []; this._popText = ""; _startOrig.call(this, cfg); };
  const _deployOrig = P.deploy;
  P.deploy = function () { const ok = _deployOrig.call(this); if (ok) this._popText = "+" + this.bonus.toLocaleString("en-US") + " BONUS"; return ok; };

  global.RocketBayFlight = {
    FlightEngine, prepareStack, bonusFor, scoreFor,
    CONST: {
      WORLD_H, MIN_VIEW_W, KM_PER_PX, DEPLOY_MIN_KM, BONUS_K, BONUS_EXP, COIN_PTS, GEM_COINS,
      LIGHT_THRUST, LIGHT_GRAVITY, LIGHT_TILT, LIGHT_FUEL, GRAVITY, THRUST, VY_MAX, SPEED0, SPEED_CAP,
      FUEL_DRAIN, FUEL_REFILL,
      // gp1-beta seam / tilt (continuous scale-in)
      CLIMB_T, PITCH_T, SEAM_ZOOM0, SEAM_ZOOM1, SETTLE_T, SETTLE_ZOOM0, HUD_ZOOM_ON, SETTLE_FALL, LB_EASE_START, LB_EASE_END, TILT_MAX, TILT_RATE, CLIMB_PLUME, CLIMB_SHAKE,
      // BLACKHOLE tunables (bh1g dump) — force a=BH_G/(BH_FALL*r+BH_SOFT)
      BH_GLOBAL_PULL, BH_DRAW_W, BH_PULL_R, BH_G_PREV, BH_G_MULT, BH_G, BH_FALL, BH_SOFT, BH_OTHER, BH_SPIN, BH_SWALLOW_S,
      BH_MIN_KM, BH_GAP0, BH_GAP1, BH_SCALE0, BH_SCALE1, BH_SCALE2, BH_LAB_BURST, BH_LAB_BURST_GAP0, BH_LAB_BURST_GAP1,
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
