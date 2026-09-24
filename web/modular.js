/**
 * RocketBay modular stack runtime — JS port of modular-kit v1.5.3
 * (modular_join.py + compose_proofs_v153.py light/seat/contact_shadow, profile v153).
 * Pure pixel math on RGBA arrays so web renders match the architect's proofs.
 */
(function (global) {
  "use strict";
  const BUTT_TOL_PX = 3, FRUSTUM_H = 7, MAX_FRUSTUM_DW = 30;
  const MAX_OVERHANG_UPPER = 8, MAX_OVERHANG_PAYLOAD = 10, SIDE_OVERLAP_PX = 6;

  // Python round(): half-to-even
  function pyRound(x) {
    const f = Math.floor(x);
    const d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }
  function median(arr) {
    const a = Array.from(arr).sort((p, q) => p - q);
    const n = a.length;
    if (!n) return NaN;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }
  // piece = {w, h, data: Uint8ClampedArray RGBA}
  function rowRun(p, y) {
    const w = p.w, d = p.data, base = y * w * 4;
    let x0 = -1, x1 = -1, n = 0;
    for (let x = 0; x < w; x++) if (d[base + x * 4 + 3] > 0) { if (x0 < 0) x0 = x; x1 = x; n++; }
    return x0 < 0 ? null : { x0, x1, n };
  }
  function widthAt(p, y) { const r = rowRun(p, y); return r ? r.x1 - r.x0 + 1 : 0; }

  function bodyCx(p, mode) {
    mode = mode || "mid";
    const H = p.h;
    let y0, y1;
    if (mode === "join_bottom") { y0 = Math.max(0, H - Math.max(4, Math.floor(H / 5))); y1 = H; }
    else if (mode === "join_top") { y0 = 0; y1 = Math.max(4, Math.floor(H / 5)); }
    else { y0 = Math.trunc(H * 0.25); y1 = Math.max(y0 + 1, Math.trunc(H * 0.75)); }
    const rows = [];
    for (let y = y0; y < y1 && y < H; y++) {
      const r = rowRun(p, y);
      if (!r) continue;
      if (r.n >= 2) rows.push([0.5 * (r.x0 + r.x1), r.x1 - r.x0 + 1]);
      else rows.push([r.x0, 1]);
    }
    if (!rows.length) {
      let mn = 1e9, mx = -1;
      for (let y = 0; y < H; y++) { const r = rowRun(p, y); if (r) { mn = Math.min(mn, r.x0); mx = Math.max(mx, r.x1); } }
      return mx < 0 ? p.w / 2 : 0.5 * (mn + mx);
    }
    let mids;
    if (mode === "mid" && rows.length >= 4) {
      const medW = median(rows.map((r) => r[1]));
      mids = rows.filter((r) => Math.abs(r[1] - medW) <= Math.max(2, 0.15 * medW)).map((r) => r[0]);
      if (mids.length < 3) mids = rows.map((r) => r[0]);
    } else mids = rows.map((r) => r[0]);
    return median(mids);
  }

  function joinWidth(p, top) {
    const H = p.h;
    const ys = [];
    if (top) for (let y = 0; y < Math.min(5, H); y++) ys.push(y);
    else for (let y = Math.max(0, H - 5); y < H; y++) ys.push(y);
    const ws = ys.map((y) => widthAt(p, y)).filter((w) => w > 0);
    return ws.length ? Math.trunc(median(ws)) : Math.max(4, Math.floor(p.w / 2));
  }

  function edgeRowMid(p, top, minW) {
    minW = minW == null ? 3 : minW;
    const H = p.h;
    let fallback = null;
    for (let i = 0; i < H; i++) {
      const y = top ? i : H - 1 - i;
      const r = rowRun(p, y);
      if (!r) continue;
      if (r.n >= minW) return 0.5 * (r.x0 + r.x1);
      if (r.n >= 2 && fallback == null) fallback = 0.5 * (r.x0 + r.x1);
    }
    if (fallback != null) return fallback;
    return bodyCx(p, top ? "join_top" : "join_bottom");
  }

  function spanRow(p, y) {
    const r = rowRun(p, y);
    const n = r.x1 - r.x0 + 1, out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const j = (y * p.w + r.x0 + i) * 4;
      out[i * 3] = p.data[j]; out[i * 3 + 1] = p.data[j + 1]; out[i * 3 + 2] = p.data[j + 2];
    }
    return { n, v: out };
  }
  // np.linspace(0, n-1, w) + np.interp per channel
  function resample(row, w) {
    const n = row.n, out = new Float64Array(w * 3);
    const step = w > 1 ? (n - 1) / (w - 1) : 0;
    for (let i = 0; i < w; i++) {
      let x = i * step;
      if (w > 1 && i === w - 1) x = n - 1;
      for (let c = 0; c < 3; c++) {
        let val;
        if (x >= n - 1) val = row.v[(n - 1) * 3 + c];
        else {
          const j = Math.floor(x);
          const slope = row.v[(j + 1) * 3 + c] - row.v[j * 3 + c];
          val = x === j ? row.v[j * 3 + c] : slope * (x - j) + row.v[j * 3 + c];
        }
        out[i * 3 + c] = val;
      }
    }
    return out;
  }

  function makeFrustum(topP, botP, h) {
    h = h || FRUSTUM_H;
    const wUp = joinWidth(topP, false), wLo = joinWidth(botP, true);
    const ru = spanRow(topP, topP.h - 2), rl = spanRow(botP, 1);
    const W = Math.max(wUp, wLo) + 4;
    const data = new Uint8ClampedArray(W * h * 4);
    for (let i = 0; i < h; i++) {
      const t = (i + 0.5) / h;
      const w = pyRound(wUp * (1 - t) + wLo * t);
      const a = resample(ru, w), b = resample(rl, w);
      const x0 = Math.floor((W - w) / 2);
      for (let k = 0; k < w; k++) {
        const o = (i * W + x0 + k) * 4;
        for (let c = 0; c < 3; c++) {
          const v = a[k * 3 + c] * (1 - t) + b[k * 3 + c] * t;
          data[o + c] = Math.trunc(Math.min(255, Math.max(0, v)));
        }
        data[o + 3] = 255;
      }
    }
    return { w: W, h, data, wUp, wLo };
  }

  function sameSourceAdjacent(t, b) {
    const a = t.sourceRows, c = b.sourceRows;
    return !!(t.family === b.family && a && c && Math.abs(a[1] - c[0]) <= 2);
  }
  function joinRule(t, b) {
    if (sameSourceAdjacent(t, b)) return "butt";
    return Math.abs(t.joinBottomWidth - b.joinTopWidth) <= BUTT_TOL_PX ? "butt" : "frustum";
  }
  const ALLOWED = { "first_stage>upper": 1, "upper>payload": 1 };
  function checkPair(t, b) {
    const tt = t.type, bt = b.type;
    if (tt === "side_booster" || bt === "side_booster") return [false, "side boosters attach laterally (inner_edge), never in the stack"];
    if (b.selfTopped) return [false, `${b.id} is selfTopped (nothing may sit on it)`];
    if (tt === "payload" && b.fairingIncompatible) return [false, `${b.id} is fairingIncompatible`];
    if (!ALLOWED[bt + ">" + tt]) return [false, `order ${bt} -> ${tt} not allowed (stack = first_stage + upper [+ payload])`];
    const wt = t.joinBottomWidth, wb = b.joinTopWidth, over = wt - wb;
    const lim = tt === "payload" ? MAX_OVERHANG_PAYLOAD : MAX_OVERHANG_UPPER;
    if (over > lim) return [false, `${t.id} (${wt}px) overhangs ${b.id} (${wb}px) by ${over}px > ${lim}px`];
    if (joinRule(t, b) === "frustum" && Math.abs(wt - wb) > MAX_FRUSTUM_DW)
      return [false, `width step ${Math.abs(wt - wb)}px > ${MAX_FRUSTUM_DW}px (frustum would read as a shelf)`];
    return [true, "ok"];
  }
  function checkStack(metas, ids, sides) {
    const m = ids.map((i) => metas[i]);
    if (m.length < 2) return [false, "a first stage alone is not a stack"];
    if (m[0].type !== "first_stage") return [false, "stack must start with a first_stage"];
    for (let i = 1; i < m.length; i++) { const r = checkPair(m[i], m[i - 1]); if (!r[0]) return r; }
    const top = m[m.length - 1];
    if (!(top.type === "payload" || top.selfTopped)) return [false, "stack must end with a payload or a selfTopped upper"];
    if (sides && m[0].strapOns) return [false, `${m[0].id} already carries native strap-ons; use its -bare variant`];
    return [true, "ok"];
  }

  /** ids bottom->top. Returns {w,h,data,owner,layers,axisX,joins,height}. owner: layer index+1 per px. */
  function composeStack(pieces, metas, ids, sides) {
    const layers = [];
    const joins = [];
    const s1 = pieces[ids[0]];
    const axis = bodyCx(s1, "mid");
    const x0 = 0 - axis, ytop = -s1.h;
    layers.push({ p: s1, x: x0, y: ytop, name: ids[0], kind: "piece" });
    let curTopMid = x0 + edgeRowMid(s1, true), curTopY = ytop;
    for (let i = 1; i < ids.length; i++) {
      const lo = pieces[ids[i - 1]], up = pieces[ids[i]];
      const rule = joinRule(metas[ids[i]], metas[ids[i - 1]]);
      const j = { lower: ids[i - 1], upper: ids[i], rule, wLowerTop: joinWidth(lo, true), wUpperBottom: joinWidth(up, false) };
      if (rule === "frustum") {
        const sk = makeFrustum(up, lo);
        const sx = curTopMid - edgeRowMid(sk, false);
        layers.push({ p: sk, x: sx, y: curTopY - sk.h, name: "frustum" + i, kind: "frustum", joinOf: ids[i] });
        curTopMid = sx + edgeRowMid(sk, true); curTopY -= sk.h;
      }
      const ux = curTopMid - edgeRowMid(up, false);
      j.joinYCanvas = curTopY;
      layers.push({ p: up, x: ux, y: curTopY - up.h, name: ids[i], kind: "piece" });
      curTopMid = ux + edgeRowMid(up, true); curTopY -= up.h;
      joins.push(j);
    }
    const sideLayers = [];
    if (sides) {
      const core = layers[0];
      for (const sid of sides) {
        const b = pieces[sid], h = b.h;
        const left = metas[sid].side === "left";
        const vals = [];
        for (let y = Math.trunc(0.30 * h); y <= Math.trunc(0.50 * h); y++) {
          const r = rowRun(b, y); if (r) vals.push(left ? r.x1 : r.x0);
        }
        const inner = median(vals);
        const attach = Math.floor(h / 2), by0 = -h;
        const cy = attach + by0 - core.y;
        const r = rowRun(core.p, Math.trunc(cy));
        let bx;
        if (left) bx = core.x + r.x0 + (SIDE_OVERLAP_PX - 1) - inner;
        else bx = core.x + r.x1 - (SIDE_OVERLAP_PX - 1) - inner;
        sideLayers.push({ p: b, x: bx, y: by0, name: sid, kind: "side" });
      }
    }
    const all = layers.concat(sideLayers);
    const xmin = Math.min(...all.map((l) => Math.floor(l.x))) - 2;
    const xmax = Math.max(...all.map((l) => Math.ceil(l.x) + l.p.w)) + 2;
    const ymin = Math.min(...all.map((l) => l.y));
    const W = xmax - xmin, H = -ymin;
    const data = new Uint8ClampedArray(W * H * 4);
    const owner = new Uint8Array(W * H);
    all.forEach((l, li) => {
      const X = pyRound(l.x) - xmin, Y = l.y - ymin;
      l.cx = X; l.cy = Y; l.w = l.p.w; l.h = l.p.h;
      const s = l.p.data;
      for (let y = 0; y < l.p.h; y++) {
        for (let x = 0; x < l.p.w; x++) {
          const si = (y * l.p.w + x) * 4;
          if (s[si + 3] === 0) continue;
          const di = ((Y + y) * W + X + x);
          data[di * 4] = s[si]; data[di * 4 + 1] = s[si + 1]; data[di * 4 + 2] = s[si + 2]; data[di * 4 + 3] = s[si + 3];
          owner[di] = li + 1;
        }
      }
    });
    joins.forEach((j) => { j.joinY = j.joinYCanvas - ymin; });
    const layerInfo = all.map((l) => ({ name: l.name, kind: l.kind, joinOf: l.joinOf, x: l.cx, y: l.cy, w: l.w, h: l.h }));
    return { w: W, h: H, data, owner, layers: layerInfo, axisX: -xmin, joins, height: H };
  }

  // ---------- OpenCV-compatible 8-bit Lab (sRGB, D65) ----------
  const GAMMA = new Float64Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; GAMMA[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const Xn = 0.950456, Zn = 1.088754;
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  function rgb2lab8(r, g, b, out) {
    const R = GAMMA[r], G = GAMMA[g], B = GAMMA[b];
    const X = (0.412453 * R + 0.357580 * G + 0.180423 * B) / Xn;
    const Y = 0.212671 * R + 0.715160 * G + 0.072169 * B;
    const Z = (0.019334 * R + 0.119193 * G + 0.950227 * B) / Zn;
    const fy = fLab(Y);
    const L = Y > 0.008856 ? 116 * fy - 16 : 903.3 * Y;
    const a = 500 * (fLab(X) - fy), bb = 200 * (fy - fLab(Z));
    out[0] = Math.min(255, Math.max(0, Math.round(L * 255 / 100)));
    out[1] = Math.min(255, Math.max(0, Math.round(a + 128)));
    out[2] = Math.min(255, Math.max(0, Math.round(bb + 128)));
  }
  function invGamma(v) { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function lab82rgb(L8, a8, b8, out) {
    const L = L8 * 100 / 255, a = a8 - 128, b = b8 - 128;
    let y, fy;
    if (L <= 7.9996) { y = L / 903.3; fy = 7.787 * y + 16 / 116; }
    else { fy = (L + 16) / 116; y = fy * fy * fy; }
    const fx = a / 500 + fy, fz = fy - b / 200;
    const x = fx > 0.206893 ? fx * fx * fx : (fx - 16 / 116) / 7.787;
    const z = fz > 0.206893 ? fz * fz * fz : (fz - 16 / 116) / 7.787;
    const X = x * Xn, Y = y, Z = z * Zn;
    const R = 3.240479 * X - 1.53715 * Y - 0.498535 * Z;
    const G = -0.969256 * X + 1.875991 * Y + 0.041556 * Z;
    const B = 0.055648 * X - 0.204043 * Y + 1.057311 * Z;
    out[0] = Math.round(invGamma(R) * 255); out[1] = Math.round(invGamma(G) * 255); out[2] = Math.round(invGamma(B) * 255);
  }

  /** compose_proofs_v153.light(). stack: {w,h,data}. cfg: tod lighting entry. Returns new RGBA. */
  function light(stack, cfg, kitMean, kitStd) {
    const W = stack.w, H = stack.h, src = stack.data;
    const n = W * H;
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = src[i * 4 + 3] > 0 ? 1 : 0;
    const gm = cfg.gm, gs = cfg.gs, km = kitMean, ks = kitStd;
    const Ls = Math.min(1.4, Math.max(0.6, gs[0] / ks[0]));
    const hc = cfg.hiCompress;
    const f32 = Math.fround;
    const out = new Float32Array(n * 3);
    const lab = [0, 0, 0], rgb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      if (!m[i]) continue;
      rgb2lab8(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], lab);
      let L = f32(f32(f32(lab[0] - km[0]) * f32(Ls)) + f32(gm[0]));
      if (hc && L > f32(gm[0])) L = f32(f32(gm[0]) + f32(f32(L - f32(gm[0])) * f32(hc)));
      const A = f32(f32(f32(lab[1] - km[1]) + f32(gm[1])) + cfg.nudge[0]);
      const B = f32(f32(f32(lab[2] - km[2]) + f32(gm[2])) + cfg.nudge[1]);
      const q = (v) => Math.trunc(Math.min(255, Math.max(0, v)));
      lab82rgb(q(L), q(A), q(B), rgb);
      out[i * 3] = rgb[0]; out[i * 3 + 1] = rgb[1]; out[i * 3 + 2] = rgb[2];
    }
    // distance to nearest background px (within array), only needs <= 3.5
    const dist = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!m[i]) { dist[i] = 0; continue; }
      let best = 99;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          if (!m[yy * W + xx]) { const d = dx * dx + dy * dy; if (d < best) best = d; }
        }
      }
      dist[i] = best === 99 ? 99 : Math.sqrt(best);
    }
    const key = cfg.keyRgb.map((v) => f32(f32(v / 255) * 255));
    for (let y = 0; y < H; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < W; x++) if (m[y * W + x]) { if (l < 0) l = x; r = x; }
      if (l < 0) continue;
      const w = Math.max(1, r - l);
      for (let x = l; x <= r; x++) {
        const u = (x - l) / w;
        const k = cfg.key === "right" ? u : 1 - u;
        const g = 1 + cfg.grad * (k - 0.5) * 2;
        const i = y * W + x;
        const rim = Math.min(1, Math.max(0, 1 - (dist[i] - 1) / 2.5)) * (k > 0.6 ? 1 : 0) * cfg.rim;
        for (let c = 0; c < 3; c++) {
          let v = f32(out[i * 3 + c] * g);
          v = f32(v + rim * key[c] * (0.35 + 0.65 * k));
          out[i * 3 + c] = v;
        }
      }
    }
    const res = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < H; y++) {
      const ao = y > H - 24 ? 1 - (1 - cfg.ao) * (y - (H - 24)) / 24 : 1;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!m[i]) continue;
        for (let c = 0; c < 3; c++) res[i * 4 + c] = Math.trunc(Math.min(255, Math.max(0, f32(out[i * 3 + c] * ao))));
        res[i * 4 + 3] = src[i * 4 + 3];
      }
    }
    return res;
  }

  /** seat convention: top = sit-(foot+1); left = round(cx - axis) */
  function seatPos(stack, cx, sit) {
    let foot = -1;
    for (let y = stack.h - 1; y >= 0 && foot < 0; y--)
      for (let x = 0; x < stack.w; x++) if (stack.data[(y * stack.w + x) * 4 + 3] > 0) { foot = y; break; }
    return { top: sit - (foot + 1), left: pyRound(cx - stack.axisX), foot };
  }

  /** contact shadow factors: list of {x,y,f} (multiply pad rgb by f). maskFn(x,y) -> rocket covers plate px */
  function contactShadow(maskFn, sit, strength) {
    strength = strength == null ? 0.45 : strength;
    let xs0 = 1e9, xs1 = -1;
    for (let y = sit - 6; y < sit; y++) for (let x = 0; x < 1280; x++) if (maskFn(x, y)) { if (x < xs0) xs0 = x; if (x > xs1) xs1 = x; }
    if (xs1 < 0) return [];
    const x0 = xs0 - 4, x1 = xs1 + 4, cxm = 0.5 * (x0 + x1), hw = 0.5 * (x1 - x0);
    const out = [];
    for (let y = sit - 2; y < sit + 3; y++) {
      const vy = 1 - Math.abs(y - (sit - 0.5)) / 3;
      for (let x = x0; x <= x1; x++) {
        if (maskFn(x, y)) continue;
        const vx = Math.max(0, 1 - Math.pow((x - cxm) / hw, 4));
        const f = 1 - strength * vy * vx;
        if (f < 0.999) out.push({ x, y, f });
      }
    }
    return out;
  }

  // ---------- kit loading ----------
  function loadImg(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(src)); im.src = src; });
  }
  async function loadKit(base, ver) {
    base = base || "kit/modular/";
    const q = ver ? "?v=" + ver : "";
    const kit = await (await fetch(base + "kit.json" + q)).json();
    const metas = {}, pieces = {};
    kit.pieces.forEach((p) => { metas[p.id] = p; });
    await Promise.all(kit.pieces.map(async (p) => {
      const im = await loadImg(base + p.file + q);
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      // hard alpha kit: premultiplied canvas round-trip is exact only for a in {0,255}
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) d[i] = d[i] >= 128 ? 255 : 0;
      pieces[p.id] = { w: c.width, h: c.height, data: d, src: base + p.file + q };
    }));
    const disallowed = {};
    (kit.compatibility.pairsDisallowed || []).forEach((e) => { disallowed[e.top + "|" + e.bottom] = e.reason; });
    return { kit, metas, pieces, disallowed, lighting: kit.lighting };
  }

  global.RocketBayModular = {
    pyRound, median, bodyCx, joinWidth, edgeRowMid, makeFrustum, joinRule, checkPair, checkStack,
    composeStack, light, seatPos, contactShadow, loadKit, rgb2lab8, lab82rgb,
    FRUSTUM_H, BUTT_TOL_PX,
  };
})(typeof window !== "undefined" ? window : globalThis);
