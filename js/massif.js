// The mountain below the peak: cut-outs on a turntable.
//
// The peak's spire is carried on down as the core. Round it stand more
// spires, and below them wooded ridges, further out the lower they start.
// Each is painted once, flat, the way the peak is painted. The turntable
// turns as the page scrolls, and it turns so that the ridge at your own
// height is always the one facing you: the route down the mountain winds
// round it, and you follow the route.
//
// Size is distance. A ridge below the one you are on stands in front of it
// and is drawn larger; one above stands behind and is drawn smaller; and
// on a ridge, a tree lower down its face is nearer than one on its crest.
// Nothing is drawn with fewer characters to make it small: it is the same
// drawing, set smaller. A cut-out going round the side shrinks back and
// fades into haze. Which stands in front of which never changes.

import { clamp, smooth, mulberry32, wrapPi, edge, mixHex } from './util.js';
import { D } from './direction.js';

const TILE = 256;   // a tile's side, in device pixels

// straight runs between points [[x, y], ...]
const line = (pts) => (x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
};

export class Massif {
  constructor(sc) {
    this.sc = sc;
    const S = sc.screenRows, cols = sc.cols, L = D.layout, M = D.massif;
    const ref = Math.min(cols, 170), kx = this.kx = ref / 60;
    const rnd = mulberry32(3);

    // the core's outline: half-width in columns, by screens below the summit
    const pts = [[L.seam - L.summit, sc.seamHalf], [1.35, 0.24 * ref], [2.1, 0.31 * ref], [3.1, 0.39 * ref], [4.2, 0.52 * ref], [5.2, 0.74 * ref], [6.3, 1.15 * ref]];
    for (let i = 1; i < pts.length; i++) pts[i][1] = Math.max(pts[i][1], pts[i - 1][1] * 1.08);
    const R = line(pts);
    const coreHalf = (n) => R((sc.bodyTop + n - sc.summitRow) / S) * (1 - 0.25 * smooth(0, 0.9 * S, n));
    const spire = (n) => kx * (0.3 * Math.min(n, 14) + 0.105 * Math.max(0, n - 14));
    const ridge = (n) => kx * 3.1 * n ** 0.62;

    const mode = sc.stack ? 'stack' : 'side', lead = D.rest[mode] + M.lead, still = sc.reduced.matches;
    this.leadRows = lead * S;                                   // you are this far above the middle of the screen
    const face = (row) => sc.yawAt(row / S + lead);             // the turn of the table when you are at this row
    this.reach = kx * 34;
    const out = (at) => kx * (15 + 4.3 * (at - 5.4));           // how far out a ridge stands, by the height of its top
    const half = (c, pow) => (n) => kx * c * n ** pow;

    const marked = sc.stops.filter((s) => s.mark && s.mark !== 'hut');
    const defs = [{ core: true, route: true, th: 0, off: 0, d: 0, apex: sc.bodyTop, half: coreHalf, rag: 2, seed: 1, stop: marked.find((s) => s.at <= L.ice) }];
    // spires: steep, snow-topped, close in. Each stands off to one side when you are level with it.
    [[0.98, 9, 1.25], [1.22, 15, -1.2], [1.5, 12, 1.4], [1.78, 20, -1.35], [2.05, 17, 1.2], [2.3, 23, -1.1]].forEach(([s, d, off], i) => {
      const apex = Math.round(sc.summitRow + s * S);
      defs.push({ th: face(apex) + off, off, d: d * kx, apex, half: spire, rag: 3, seed: 10 + i * 7 });
    });

    // The ridges the route runs over. One that carries a stop has its top a
    // little above the stop's waypoint.
    const stopTops = marked.filter((s) => s.at > L.ice).map((s) => {
      const rest = s.at + D.rest[mode], d = out(s.at - 0.14), size = still ? 1 : 1 + M.depth * 0.5 * d / this.reach;
      return { at: Math.round(rest * S + (s.hy - rest * S) / size - 0.14 * S) / S, stop: s, rest, d };
    });
    // Down to `sparse` they come one after another. From there on they are
    // few and long, a walk through the forest between one bridge and the next.
    const sparse = (stopTops.find((t) => t.stop.id === M.sparse)?.at ?? L.forest) - 1e-3;
    const anchors = [{ at: L.treeline - 0.1 }, ...stopTops, { at: L.ground - 0.42 }];
    const tops = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i], b = anchors[i + 1], n = Math.max(1, Math.round((b.at - a.at) / M.stride[a.at < sparse ? 0 : 1]));
      for (let k = 0; k < n; k++) tops.push(k ? { at: a.at + (b.at - a.at) * k / n } : a);
    }
    tops.push(anchors[anchors.length - 1]);
    // the long ones are no two alike: a hill, a broad hilltop, a hillside whose top is away to the left, a low hill.
    // [left side, right side, level top, how fast it widens, how wide, how far its top is off centre]
    const FORMS = [[1.0, 1.35, 2, 0.62, 3.1, 0], [1.5, 1.15, 8, 0.6, 4.4, 0], [0.9, 2.5, 3, 0.66, 3.5, -22], [1.25, 1.0, 5, 0.6, 3.8, 0]];
    let long = 0;
    tops.forEach((t, i) => {
      const apex = Math.round(t.at * S), span = tops[i + 1] ? Math.round(tops[i + 1].at * S) - apex : sc.groundRow - apex;
      // it faces you when you are a little way down it, not at its top
      const turn = face(apex + 0.3 * Math.max(0, span - 0.3 * S)), th = turn + (t.stop ? 0 : (rnd() - 0.5) * 0.2), d = t.d ?? out(t.at) * (0.92 + rnd() * 0.16);
      const def = { ridge: true, route: true, th, off: th - turn, d, apex, span, half: ridge, rag: 5, seed: 100 + i * 13, stop: t.stop };
      if (t.at >= sparse) { const [wl, wr, flat, pow, c, lean] = FORMS[long++ % FORMS.length]; Object.assign(def, { wl, wr, flat: flat * kx, lean: Math.round(lean * kx), half: half(c, pow), folds: true }); }
      if (t.stop) {
        // the stop's waypoint, as a place on the cut-out, for how the cut-out stands when the stop's card is open
        const mid = t.rest * S, p = this.pose(def, sc.yawAt(t.rest), mid);
        def.way = [(t.stop.hx + 0.5 - p.X) / p.s, mid + (t.stop.hy - mid) / p.s];
      }
      defs.push(def);
    });
    // more ridges off the route, standing to one side and the other, down to `sparse`: after it the long ridges are the whole view
    for (let i = 0, at = L.forest - 0.35; at < sparse + 0.2; i++, at += 0.5 + rnd() * 0.2) {
      const apex = Math.round(at * S), off = (i % 2 ? -1 : 1) * (0.8 + rnd() * 0.4);
      defs.push({ ridge: true, th: face(apex) + off, off, d: out(at) * (1.05 + rnd() * 0.2), apex, span: Math.round(0.45 * S), half: ridge, rag: 5, seed: 400 + i * 17 });
    }
    // Which stands in front of which never changes. Spires stand behind the
    // core, so the rope down it is never hidden. A ridge off the route stands
    // behind the route's ridge you are on when you are level with its top, so
    // the path is never hidden either. Otherwise lower stands in front of higher.
    const under = (d) => Math.max(...defs.filter((r) => r.ridge && r.route && r.apex <= d.apex).map((r) => r.apex), d.apex - 0.45 * S);
    const rank = (d) => d.core ? -1 : !d.ridge ? d.apex - 1e6 : d.route ? d.apex : Math.min(under(d), d.apex - 0.3 * S) - 0.5;
    defs.sort((a, b) => rank(a) - rank(b));
    this.lobes = defs.map((d) => this.shape(d));

    // the route: over each of its cut-outs from where it arrives to where it steps onto the next
    const route = this.route = this.lobes.filter((l) => l.route);
    route.forEach((l, i) => { l.arrive = l.core ? [l.cx + 1, sc.bodyTop] : this.onCrest(l, l.cx - Math.round((3 + rnd() * 3) * kx)); });
    route.forEach((l, i) => {
      const next = route[i + 1];
      if (!next) {
        // the last ridge: the path runs down it to the hut, where the hut stands at the end of the page
        const end = this.pose(l, sc.yawAt(99), sc.end + S / 2), G = sc.groundRow;
        l.depart = [this.inside(l, Math.round(l.cx + (sc.ground.door[0] * sc.ground.k - end.X) / end.s), G - 1), G - 1];
        return;
      }
      // where the next one's arrival shows on this one, as you come to the next one's top
      const mid = (l.core ? next.apex : next.apex - 0.15 * S) + lead * S, yaw = l.core ? next.th - 0.2 : sc.yawAt(mid / S);
      const a = this.pose(l, yaw, mid), b = this.pose(next, yaw, mid);
      const x = b.X + (next.arrive[0] - next.cx) * b.s, y = (next.arrive[1] - mid) * b.s;
      const r = Math.max(l.arrive[1] + 3, Math.round(mid + y / a.s) - 3);
      // it leaves a little way back from there, so there is always a gap for the bridge to cross
      const gap = Math.min(9, Math.round((4 + rnd() * 2) * kx));
      l.depart = [this.inside(l, Math.round(l.cx + (x - a.X) / a.s) - gap, r), r];
    });
    this.lobes.forEach((l, i) => { l.index = i; this.trace(l); });
    this.lamps = [];
  }

  // a cut-out's outline: a crest row for every column
  shape(def) {
    const sc = this.sc, G = sc.groundRow, n = sc.noise;
    const wl = def.wl ?? 1, wr = def.wr ?? 1, flat = def.flat ?? 0;   // how wide each side is against the usual, and a level top
    const lean = def.lean ?? 0;                                       // how far its top is from its middle
    const tall = G - def.apex, wmax = Math.min(Math.ceil(def.half(tall) * Math.max(wl, wr) + flat + Math.abs(lean)), Math.ceil(sc.cols / 2 + this.reach) + 6) + 3, W = 2 * wmax + 1, cx = wmax;
    const peak = new Float32Array(W).fill(Infinity);
    for (let c = 0; c < W; c++) {
      const a = Math.max(0, Math.abs(c - cx - lean) - flat) / (c < cx + lean ? wl : wr); if (def.half(tall) < a) continue;
      let lo = 0, hi = tall;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (def.half(m) >= a) hi = m; else lo = m; }
      peak[c] = def.apex + hi + (n.fbm(c * 0.21 + def.seed, 3.3, 2) - 0.5) * def.rag * Math.min(1, hi / 5);
    }
    return { ...def, W, cx, peak, vis: 0, s: 1, X: 0 };
  }
  onCrest(l, c) { c = clamp(c, 2, l.W - 3); while (!Number.isFinite(l.peak[c])) c += c < l.cx ? 1 : -1; return [c, Math.ceil(l.peak[c])]; }
  inside(l, c, r) { c = clamp(c, 1, l.W - 2); for (let i = 0; i < l.W && !(l.peak[c] <= r - 1); i++) c += c < l.cx ? 1 : -1; return c; }

  // How much larger a thing is drawn for standing `rows` below you: what is
  // below you is in front of you, what is above you is behind.
  gain(rows) { return Math.exp(D.massif.near * clamp(rows / this.sc.screenRows, -1.6, 1.6)); }

  // where a cut-out stands and how large it is drawn, for a turn of the table and a place on the page
  pose(l, yaw, centreRow) {
    const sc = this.sc, M = D.massif, still = sc.reduced.matches, you = centreRow - this.leadRows;
    if (l.core) return { vis: 1, tone: 1, s: 1, X: sc.ax, ref: you };
    const phi = still ? l.off : wrapPi(l.th - yaw), [h0, h1] = M.haze, cos = Math.cos(phi);
    // a ridge is as near as the part of it nearest your height: all of it in front while you are above its top, all of it behind once you are off its foot
    const ref = l.ridge ? clamp(you, l.apex, l.apex + l.span) : you;
    const s = still ? 1 : !l.ridge ? 1 + M.depth * l.d * cos / this.reach : (1 + M.depth * 0.5 * l.d / this.reach) * this.gain(ref - you) * (0.82 + 0.18 * cos);
    // tone: the cut-out that faces you is the brightest; one turning away dims, so what is in front reads against what is behind
    return { vis: 1 - smooth(h0, h1, Math.abs(phi)), tone: M.far + (1 - M.far) * smooth(0.3, 1, cos), s, X: sc.ax + l.d * Math.sin(phi), ref };
  }
  // A tree's size. Down a ridge's face is nearer, by the same rule as from
  // ridge to ridge, so across the whole view what is lower is larger. A
  // ridge behind you stays behind: nothing on it is larger than its foot.
  grown(l, t) {
    if (this.sc.reduced.matches) return l.s * t.k;
    return Math.min(2, l.s * t.k * this.gain((l.ridge ? clamp(t.row, l.apex, l.apex + l.span) : t.row) - l.ref));   // never larger than twice the page's type
  }

  // the route across a cut-out: arrive, by the waypoint if it has one, depart
  trace(l) {
    const sc = this.sc, { W, cx } = l, path = l.path = [], kept = l.kept = new Set();   // kept: cells the route needs clear
    if (!l.route) return;
    const via = [l.arrive];
    if (l.stop) {
      // the stop's waypoint, as a place on this cut-out: [column, row], fractions allowed
      const way = l.way ?? [sc.stops.find((x) => x === l.stop).hx + 0.5 - sc.ax, l.stop.hy];
      l.mark = [cx + 0.5 + way[0], way[1] + 0.5];
      l.stop.lobe = l;
      via.push([Math.round(cx + way[0]), Math.round(way[1])]);
    }
    if (l.depart) via.push(l.depart);
    for (let k = 0; k + 1 < via.length; k++) {
      const [x0, r0] = via[k], [x1, r1] = via[k + 1], rows = Math.max(1, r1 - r0), bends = Math.max(1, Math.round(rows / 9));
      let x = x0;
      for (let i = 0; i <= rows; i++) {
        const t = i / rows, r = r0 + i;
        // switchbacks: a swing to either side that dies out at both ends
        const want = this.inside(l, Math.round(x0 + (x1 - x0) * t + Math.sin(t * Math.PI * bends) * Math.min(3.2 * this.kx, rows / 4) * Math.sin(t * Math.PI) ** 0.5), r);
        const dir = Math.sign(want - x);
        for (; x !== want; x += dir) path.push([x, r]);
        path.push([x, r]);
      }
    }
    for (const [c, r] of path) for (let dr = -1; dr <= 1; dr++) for (let dc = -2; dc <= 2; dc++) kept.add((r + dr) * W + c + dc);
    // a clearing where the bridge lands: no trees on the crest there, so the bridge and the path coming to it are not behind them
    if (!l.core) for (let dr = -7; dr <= 1; dr++) for (let dc = -13; dc <= 3; dc++) kept.add((l.arrive[1] + dr) * W + l.arrive[0] + dc);
  }

  // paint one cut-out: snow, rock or trees, and the route's marks. Done the first time it is needed.
  paint(l) {
    const sc = this.sc, S = sc.screenRows, P = sc.P, G = sc.groundRow, n = sc.noise, rnd = mulberry32(l.seed), Y = D.layout, { W, cx, peak, path, kept } = l, index = l.index;
    const base = l.base = l.apex - 7, rowsN = l.rowsN = G - base + 14;
    const cells = l.cells = Array.from({ length: rowsN }, () => new Array(W).fill(null)), mask = l.mask = Array.from({ length: rowsN }, () => new Uint8Array(W));
    const slope = new Float32Array(W);
    for (let c = 1; c < W - 1; c++) slope[c] = Number.isFinite(peak[c - 1]) && Number.isFinite(peak[c + 1]) ? (peak[c + 1] - peak[c - 1]) / 2 : c < cx ? -2 : 2;

    // --- arêtes: walks downhill from the top, as the peak has them ---
    const onRidge = new Map(), crossings = new Map();
    const walk = (c, r, lean, len) => {
      for (let i = 0; i < len && r < G - 2; i++) {
        const v = n.noise(c * 0.11 + i * 0.05 + l.seed, r * 0.05 + lean * 7);
        const dc = (v < 0.42 - lean * 0.12 ? -1 : v > 0.58 - lean * 0.12 ? 1 : 0) * (rnd() < 0.7 ? 1 : 0);
        r++; c = clamp(c + dc, 1, W - 2);
        if (r < peak[c] + 1) break;
        onRidge.set(r * W + c, dc < 0 ? '/' : dc > 0 ? '\\' : '|');
        if (!crossings.has(r)) crossings.set(r, []);
        crossings.get(r).push(c);
      }
    };
    walk(cx, Math.round(peak[cx]), 0, 9999);
    if (!l.core) { walk(cx - 1, Math.round(peak[cx]) + 5, -1.6, l.ridge ? 26 : 80); walk(cx + 1, Math.round(peak[cx]) + 8, 1.6, l.ridge ? 22 : 70); }
    else { walk(cx - 2, sc.bodyTop + Math.round(S * 0.35), -1.3, S * 1.1); walk(cx + 2, sc.bodyTop + Math.round(S * 0.6), 1.3, S); }

    // --- the body, row by row. Light comes from the left: the face to the
    // left of an arête is lit, the face to its right is in shadow, and where
    // a shadowed face meets the next lit one there is a fold. ---
    // the ground itself is a soft wash, one pixel to a cell, brightest just under the crest and gone a few rows below it:
    // it is what makes a ridge a shape and not only the trees on it
    const img = new ImageData(W, rowsN), px = img.data, rgb = (h) => [1, 3, 5].map((n) => parseInt(h.slice(n, n + 2), 16)), tones = [rgb(P.pineDark), rgb(P.rockDark)];
    const moss = mixHex(P.pine, P.leafOlive, 0.45), GRASS = [',', '.', "'", '"', ',', '`'];
    const snowAbs = (c) => (Y.seam + 0.34) * S + (n.fbm(c * 0.09 + l.seed, 2.2, 3) - 0.5) * 16;   // above this row everything is white
    const deep = Math.round(Math.max(S * 1.25, (l.span || 0) + S * 0.6));
    // A long face is not one slope: shoulders run across it, each a line
    // with the ground lit under it, falling one way and then the other.
    const folds = [], kx = this.kx;
    if (l.folds) for (let down = 17 + rnd() * 6, k = 0; down < deep - 6; down += 15 + rnd() * 9, k++) {
      const len = Math.round((30 + rnd() * 28) * kx), mid = cx + Math.round((rnd() - 0.5) * 34 * kx), tilt = ((k + l.seed) % 2 ? 1 : -1) * (0.1 + rnd() * 0.2) / kx;
      const c0 = Math.max(1, mid - (len >> 1)), c1 = Math.min(W - 2, mid + (len >> 1)), rows = new Float32Array(W).fill(NaN), on = new Float32Array(W), taper = 8 * kx;
      for (let c = c0; c <= c1; c++) {
        const r = l.apex + down + tilt * (c - mid) + (n.fbm(c * 0.13 + l.seed + k * 9, 5.5, 2) - 0.5) * 6;
        on[c] = smooth(c0, c0 + taper, c) * (1 - smooth(c1 - taper, c1, c)) * smooth(6, 18, r - peak[c]);   // it dies away at either end, and where it comes up to the crest
        if (on[c] > 0.02) rows[c] = r;
      }
      folds.push({ rows, tilt, on });
    }
    for (let r = Math.ceil(Math.min(...peak)); r < G + 14; r++) {
      const i = r - base, at = r / S, wood = smooth(Y.treeline + 0.05, Y.forest, at);   // under the trees the ground is dark
      const cross = (crossings.get(r) || []).slice().sort((p, q) => p - q);
      let c = 0;
      while (c < W) {
        if (!(peak[c] <= r)) { c++; continue; }
        let e = c; while (e + 1 < W && peak[e + 1] <= r) e++;           // one run of this row: c..e
        for (let x = c; x <= e; x++) {
          mask[i][x] = 1;
          const depth = r - peak[x];
          if (r >= G) continue;
          // the ground itself: a wash that is strongest at the crest and gone a few rows under it
          if (depth < 26 && !(l.core && r <= sc.seamRow + sc.blend + 2)) {
            const p4 = (i * W + x) * 4, k = wood > 0.5 ? 0 : 1;
            px[p4] = tones[k][0]; px[p4 + 1] = tones[k][1]; px[p4 + 2] = tones[k][2];
            px[p4 + 3] = 255 * (k ? 0.2 : 0.32) * Math.exp(-depth / 6.5) * Math.min(1, depth + 0.3);
          }
          // the same under each shoulder
          let ledge = null;
          for (const f of folds) {
            const under = r - f.rows[x]; if (!(under >= 0 && under < 22)) continue;
            const p4 = (i * W + x) * 4, on = f.on[x], a = 255 * 0.3 * Math.exp(-under / 6) * Math.min(1, under + 0.3) * on;
            if (a > px[p4 + 3]) { px[p4] = tones[0][0]; px[p4 + 1] = tones[0][1]; px[p4 + 2] = tones[0][2]; px[p4 + 3] = a; }
            if (under < 9 && !ledge) ledge = [f, under, on];
          }
          if (depth > deep || kept.has(r * W + x)) continue;
          if (wood > 0.6 && ledge && depth >= 1) {
            const [f, under, on] = ledge;
            if (under < 1) { if (rnd() < on * 1.3) cells[i][x] = [edge(f.rows[x] - Math.floor(f.rows[x]), f.tilt * 3), f.tilt < 0 ? moss : P.pine, 0.9 * on]; }
            else if (rnd() < 0.28 * (1 - under / 9) * on) cells[i][x] = [GRASS[Math.floor(rnd() * GRASS.length)], P.pine, 0.8 - under * 0.05];
            continue;
          }
          if (wood > 0.6) {
            // under the trees: the crest as a line, and ground cover thinning out below it
            if (depth < 1) cells[i][x] = [edge(peak[x] - Math.floor(peak[x]), slope[x]), slope[x] < 0.05 ? moss : P.pine, 0.95];
            else if (depth < 11 && rnd() < 0.3 * (1 - depth / 11)) cells[i][x] = [GRASS[Math.floor(rnd() * GRASS.length)], slope[x] < 0.05 ? P.pine : P.pineDark, 0.85 - depth * 0.05];
            continue;
          }
          let k = 0; while (k < cross.length && cross[k] < x) k++;       // which face: count the arêtes to the left
          const isArete = cross[k] === x, left = k > 0 ? cross[k - 1] : c, right = k < cross.length ? cross[k] : e;
          const lit = cross.length ? (k === 0 ? 1 : x < (left + right) / 2 ? 0 : k < cross.length ? 1 : 0) : (slope[x] < 0 ? 1 : 0);
          const patch = n.fbm(x * 0.17 + 4.2 + l.seed, r * 0.11 + 1.1, 3), fine = n.noise(x * 0.9, r * 0.9 + l.seed);
          const cap = l.ridge || l.core ? 0 : 16 + (n.noise(x * 0.3 + l.seed, 1) - 0.3) * 12;   // a spire keeps a cap of snow
          const snow = at < Y.treeline + 0.1 && (r < snowAbs(x) + (isArete ? 11 : 0) || depth < cap * (1 - smooth(Y.treeline - 0.7, Y.treeline + 0.1, at)));
          const top = depth < 1 && !(l.core && r <= sc.bodyTop + 1), gentle = Math.abs(slope[x]) <= 0.8;
          let ch = ' ', color = P.rock, a = 1;
          if (top && gentle && !snow && wood < 0.6) { ch = edge(peak[x] - Math.floor(peak[x]), slope[x]); color = lit ? P.rockLight : P.rock; a = 1 - wood; }
          else if (x === c && snow && fine < 0.3) { ch = '@'; color = P.snow; }
          else if (x === e && !lit && fine < 0.22) { ch = '%'; color = snow ? P.snow : P.rock; a = 0.8 * (1 - wood); }
          else if (isArete) { ch = onRidge.get(r * W + x); color = snow ? P.snow : P.rockLight; a = 1 - wood; }
          else {
            // a ledge now and then, holding a line of snow
            const ledge = !snow && at < Y.treeline && Math.floor(r + (n.noise(x * 0.05 + l.seed, 7) - 0.5) * 9) % 9 === 0 && n.noise(x * 0.13 + l.seed, r * 0.2) > 0.42;
            if (snow) { ch = lit ? (patch > 0.6 ? '%' : '#') : fine > 0.42 ? ':' : fine > 0.2 ? '.' : ' '; color = P.snow; a = lit ? 1 : 0.55; }
            else if (ledge) { ch = '_'; color = P.snow; a = lit ? 0.9 : 0.5; }
            else if (lit) { ch = patch < 0.4 ? (fine < 0.22 ? '.' : ' ') : patch > 0.62 ? '#' : '%'; color = P.rockLight; a = (patch > 0.62 ? 1 : 0.88) * (1 - wood); }   // a lit face is weathered: bare in patches
            else { ch = fine > 0.5 ? ':' : fine > 0.3 ? '.' : ' '; color = P.rock; a = 0.85 * (1 - wood); }
          }
          if (ch !== ' ' && a > 0.03) cells[i][x] = [ch, color, a];
        }
        c = e + 1;
      }
    }

    // --- trees: a close line of them on the crest, so the outline is trees,
    // then ranks every few rows that thin out into the dark below it. Each
    // is its own drawing. They are all much of a height, whichever drawing
    // it is, so that when one is larger than another it is because it is
    // nearer: the scene sizes each by where it stands (grown). ---
    const trees = l.trees = [], T = D.glyphs;
    const plant = (c, r, shape, leafy, dark, snowy, k) => {
      const h = shape.length, w = shape[0].length, olive = rnd() < 0.5;
      // the route stays clear
      for (let rr = Math.floor(r - h * k * 1.2); rr <= r; rr++) for (let x = Math.floor(c - w * k * 0.6); x <= Math.ceil(c + w * k * 0.6); x++) if (kept.has(rr * W + x)) return;
      for (const o of trees) if (Math.abs(o.row - r) <= 5 && Math.abs(o.c - c) < 0.4 * (w * k + o.w * o.k)) return;   // and trees keep their distance, by their size
      const rows = shape.map((line, i) => {
        let f = 0, e = w - 1;
        while (f < w && line[f] === ' ') f++; while (e >= 0 && line[e] === ' ') e--;
        const marks = [];
        for (let j = f; j <= e; j++) {
          const ch = line[j]; if (ch === ' ') continue;
          const foot = i === h - 1 && (ch === '|' || leafy), right = j > (w - 1) / 2 + 0.6;
          marks.push(leafy ? [j, ch, foot ? P.ground : olive ? P.leafOlive : P.leaf, !foot && (dark || right) ? 0.6 : 1]
            : [j, ch, !foot && (i < snowy || (i === snowy && snowy > 1 && j === f)) ? P.snow : foot || dark || right ? P.pineDark : P.pine, 1]);
        }
        return { f, e, marks };
      });
      trees.push({ c, row: r, h, w, k, rows, leafy, id: index * 10000 + trees.length });
    };
    const full = T.pines.filter((p) => !p.join('').includes('|||'));   // on rock, only pines with a full body: a stick pine on a cliff reads as see-through
    const pick = (at) => { const leafy = rnd() < smooth(Y.forest + 0.3, Y.forest + 2.0, at) * 0.22, set = at < Y.forest ? full : T.pines; return [leafy ? T.leafy[Math.floor(rnd() * T.leafy.length)] : set[Math.floor(rnd() * set.length)], leafy]; };
    // how much snow a tree carries: laden near the treeline, dusted lower, bare in the forest proper
    const snowOn = (at) => at < Y.forest - 0.15 ? 2 : at < Y.forest + 0.3 ? (rnd() < 0.75 ? 2 : 1) : at < Y.forest + 0.95 ? (rnd() < 0.6 ? 1 : 0) : 0;
    const density = (at) => smooth(Y.treeline - 0.1, Y.forest + 0.2, at);
    // a tree's own size: a little smaller at the treeline, a little chance, and its drawing's rows made up to the common height
    const sizeOf = (d, shape, leafy) => (0.82 + 0.18 * d) * (0.94 + rnd() * 0.12) * (leafy ? 3.8 : 4.6) / shape.length;
    for (let c = 2 + Math.floor(rnd() * 3); c < W - 3; c += 3 + Math.floor(rnd() * 3)) {
      if (!Number.isFinite(peak[c])) continue;
      const r = Math.round(peak[c]), at = r / S, d = density(at);
      if (r >= G - 1 || rnd() > d * 1.1 || (l.core && r <= sc.bodyTop + 2)) continue;
      const [shape, leafy] = pick(at);
      plant(c, r, shape, leafy, slope[c] > 0.05, leafy ? 0 : snowOn(at), sizeOf(d, shape, leafy));
    }
    for (let r = Math.round(Y.treeline * S); r < G; r += 3) {
      const at = r / S, d = density(at);
      for (let c = 2 + (r * 7) % 5; c < W - 3; c += 5 + Math.floor(rnd() * 5)) {
        if (!Number.isFinite(peak[c])) continue;
        const depth = r - peak[c];
        if (depth < 4 || depth > deep || rnd() > d * 0.92 * (1 - (l.folds ? 0.5 : 0.72) * smooth(10, 44, depth))) continue;
        const [shape, leafy] = pick(at);
        plant(c, r, shape, leafy, slope[c] > 0.05, leafy ? 0 : snowOn(at), sizeOf(d, shape, leafy));
      }
    }
    trees.sort((p, q) => p.row - q.row);   // further up the face first, so the nearer ones are drawn over them

    // --- the route's own marks: a fixed rope on the ice, a path of stones on
    // the rock, a trodden path in the forest. They are faint here; the scene
    // lights the stretch you are on. ---
    path.forEach(([c, r], k) => {
      const i = r - base, at = r / S; if (i < 0 || i >= rowsN || c < 0 || c >= W) return;
      mask[i][c] = 1;
      cells[i][c] = at < Y.ice ? (k % 4 === 0 ? ['+', P.muted, 0.8] : [':', P.muted, 0.5])
        : at < Y.forest ? [k % 3 ? '.' : ',', P.muted, 0.6]
        : k % 7 === 3 ? ['=', P.muted, 0.45] : [k % 2 ? ':' : '.', P.muted, 0.5];
    });

    // a dark margin round everything on it, one cell either side and one
    // above, so its edge reads against whatever is behind it
    const wide = l.mask = mask.map((m) => Uint8Array.from(m));
    for (let i = 0; i < rowsN; i++) for (let c = 0; c < W; c++) if (mask[i][c]) { if (c > 0) wide[i][c - 1] = 1; if (c + 1 < W) wide[i][c + 1] = 1; if (i > 0) wide[i - 1][c] = 1; }

    // what each row covers, as runs, for hiding whatever is behind
    l.wash = document.createElement('canvas'); l.wash.width = W; l.wash.height = rowsN;
    l.wash.getContext('2d').putImageData(img, 0, 0);
    l.runs = wide.map((m) => { const out = []; let a = -1; for (let c = 0; c <= W; c++) { const on = c < W && m[c]; if (on && a < 0) a = c; else if (!on && a >= 0) { out.push([a, c]); a = -1; } } return out; });
  }

  // ---------- each frame ----------
  frame(centreRow, yaw) {
    this.centreRow = centreRow;
    for (const l of this.lobes) Object.assign(l, this.pose(l, yaw, centreRow));
  }
  // a place on a cut-out (column, row; fractions allowed), in viewport pixels
  at(l, c, r) { const g = this.sc.grid; return [(l.X + (c - l.cx - 0.5) * l.s) * g.cellW, g.h / 2 + (r - this.centreRow) * g.cellH * l.s]; }

  // A frame does not set the mountain glyph by glyph. Each cut-out is
  // painted once into tiles, at sizes half an octave apart, and only ever
  // drawn smaller than it was painted, so it stays sharp. A tile is two
  // layers: the dark that hides what is behind the cut-out and its trees,
  // and the ink (its ground, its glyphs, its trees). The trees of a cut-out
  // are painted into its tiles while their sizes stand still, which is
  // whenever you are not on that cut-out. On the one you are on, a tree
  // grows or shrinks as you pass it, so each of its trees is its own small
  // picture, placed at its size of the moment.
  render() {
    const sc = this.sc, g = sc.grid, cw = g.cellW, ch = g.cellH, H = g.h, d = g.dpr, t = TILE / d, ctx = g.ctx;
    this.frameNo = (this.frameNo || 0) + 1;
    for (const l of this.lobes) {
      if (l.vis < 0.02) continue;
      const top = H / 2 + (l.apex - 8 - this.centreRow) * ch * l.s;
      if (top > H) continue;                         // wholly below the screen
      if (!l.cells) this.paint(l);
      const s = l.s, cws = cw * s, chs = ch * s, x0 = l.X * cw - (l.cx + 0.5) * cws, y0 = H / 2 - this.centreRow * chs;   // the pixel of its column 0, row 0
      const r0 = Math.max(l.base, Math.floor(-y0 / chs) - 1), r1 = Math.min(l.base + l.rowsN - 1, Math.ceil((H - y0) / chs));
      const c0 = Math.max(0, Math.floor(-x0 / cws) - 1), c1 = Math.min(l.W - 1, Math.ceil((g.w - x0) / cws));
      if (r1 < r0 || c1 < c0) continue;
      // Its trees are painted in at the sizes they stand at for where you are. On the cut-out you are on they grow
      // as you go down it, so there they are painted again each time you have come down a little way (in steps of
      // a few percent of their size, too small to see).
      const step = sc.screenRows / 4, ref = Math.round(l.ref / step) * step;
      const lv = Math.ceil(Math.log2(s) * 2 - 1e-6), sL = 2 ** (lv / 2), f = s / sL, tw = t * f, Y0 = y0 + l.base * chs;
      const L = this.level(l, `${lv}|${ref}|${sc.sky}`, sL, ref);
      const nx = Math.ceil(l.W * cw * sL * d / TILE), ny = Math.ceil(l.rowsN * ch * sL * d / TILE);
      const ty0 = Math.max(0, Math.floor((y0 + r0 * chs - Y0) / tw)), ty1 = Math.min(ny - 1, Math.floor((y0 + (r1 + 1) * chs - Y0) / tw));
      const tx0 = Math.max(0, Math.floor(-x0 / tw)), tx1 = Math.min(nx - 1, Math.floor((g.w - x0) / tw));
      const shown = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const x = x0 + tx * tw, y = Y0 + ty * tw;
        if (this.behind(x, y, tw, tw, l.index)) continue;   // wholly behind a nearer cut-out: not painted, not drawn
        shown.push([this.tile(l, L, tx, ty), x, y]);
      }
      // its dark and its ink in one; then, for one turned from you, the dark again over it, so its ink is that much fainter
      ctx.globalAlpha = g.alpha = l.vis; ctx.fillStyle = sc.sky;
      for (const [e, x, y] of shown) if (e.both) ctx.drawImage(e.both, x, y, e.w / d * f, e.h / d * f); else if (e.plain) ctx.fillRect(x, y, e.w / d * f, e.h / d * f);
      if (l.tone < 0.99) {
        ctx.globalAlpha = g.alpha = (1 - l.tone) * l.vis;
        for (const [e, x, y] of shown) if (e.both) { if (e.plain) ctx.fillRect(x, y, e.w / d * f, e.h / d * f); else if (e.dark) ctx.drawImage(e.dark, x, y, e.w / d * f, e.h / d * f); }
      }
    }
    this.tidy();
  }

  // a cut-out's tiles at one size, with its trees in them or not, in one sky
  level(l, key, sL, ref) {
    if (!l.levels) l.levels = new Map();
    let L = l.levels.get(key); if (!L) l.levels.set(key, L = { sL, ref, tiles: new Map() });
    return L;
  }
  // one tile of a cut-out, painted if it has not been: { dark, ink }
  tile(l, L, tx, ty) {
    const key = ty * 4096 + tx; let e = L.tiles.get(key);
    if (e === undefined) {
      const sc = this.sc, g = sc.grid, d = g.dpr, t = TILE / d, sL = L.sL, cws = g.cellW * sL, chs = g.cellH * sL, sky = sc.sky;
      const w = Math.max(1, Math.min(TILE, Math.ceil(l.W * cws * d) - tx * TILE)), h = Math.max(1, Math.min(TILE, Math.ceil(l.rowsN * chs * d) - ty * TILE));
      const make = () => this.canvas(w, h);
      const [dark, dx] = make(), [ink, ix] = make();
      let inked = false, boxed = false, full = true, any = false;
      const ox = -tx * t, oy = -ty * t, size = g.size * sL, seam = l.core ? sc.seamRow + sc.blend : -1, shift = sc.ax - l.cx - 0.5;
      const c0 = Math.max(0, Math.floor(tx * t / cws) - 2), c1 = Math.min(l.W - 1, Math.ceil((tx + 1) * t / cws) + 1);
      const i0 = Math.max(0, Math.floor(ty * t / chs) - 2), i1 = Math.min(l.rowsN - 1, Math.ceil((ty + 1) * t / chs) + 1);
      dx.fillStyle = sky;
      for (let i = i0; i <= i1; i++) {
        let covers = false;
        for (const [a, b] of l.runs[i]) if (b >= c0 && a <= c1) { dx.fillRect(ox + a * cws - 0.5, oy + i * chs - 0.5, (b - a) * cws + 1, chs + 1); any = true; if (a <= c0 && b > c1) covers = true; }
        if (!covers) full = false;
      }
      // is there any of its ground's wash here: it is only just under the crest
      for (let cc = c0; cc <= c1 && !inked; cc++) { const pk = l.peak[cc]; if (pk > l.base + i0 - 27 && pk <= l.base + i1 + 1) inked = true; }
      g.into(ix, () => {
        ix.drawImage(l.wash, c0, i0, c1 - c0 + 1, i1 - i0 + 1, ox + c0 * cws, oy + i0 * chs, (c1 - c0 + 1) * cws, (i1 - i0 + 1) * chs);
        for (let i = i0; i <= i1; i++) {
          const cells = l.cells[i], row = l.base + i;
          for (let cc = c0; cc <= c1; cc++) {
            const cell = cells[cc];
            if (cell && !(row <= seam && !l.kept.has(row * l.W + cc) && sc.painted(row, Math.round(shift + cc)))) { g.set(cell[0], cell[1], ox + cc * cws, oy + i * chs, size, cell[2]); inked = true; }
          }
        }
        // its trees, at the sizes they stand at while you are not on it, further up the face first
        const cw = g.cellW, ch = g.cellH, x0 = ox, y0 = oy - l.base * chs, still = sc.reduced.matches;   // the pixel of its column 0, row 0, in this tile
        const rTop = l.base + i0 - 16, rBottom = l.base + i1 + 2;
        for (const tr of l.trees) {
          if (tr.row < rTop) continue;
          if (tr.row > rBottom + 16) break;
          const k = Math.min(2 * sL / l.s, sL * tr.k * (still ? 1 : this.gain((l.ridge ? clamp(tr.row, l.apex, l.apex + l.span) : tr.row) - L.ref))), cwk = cw * k, chk = ch * k, left = x0 + (tr.c + 0.5) * cws - tr.w / 2 * cwk, foot = y0 + (tr.row + 1) * chs;
          if (foot < -2 * chk || foot - (tr.h + 1) * chk > t + 2 || left > t + 2 || left + (tr.w + 2) * cwk < -2) continue;
          tr.rows.forEach((row, i) => {
            if (row.e < row.f) return;
            const y = foot - (tr.h - i) * chk, bx = left + (row.f - 0.6) * cwk, bw = (row.e - row.f + 2.2) * cwk;
            dx.fillRect(bx, y - 0.5, bw, chk + 1); boxed = any = inked = true;
            ix.globalCompositeOperation = 'destination-out'; ix.globalAlpha = 1; ix.fillRect(bx, y - 0.5, bw, chk + 1); ix.globalCompositeOperation = 'source-over'; g.alpha = NaN;
            for (const [j, glyph, color, a] of row.marks) g.set(glyph, color, left + j * cwk, y, g.size * k, a);
          });
        }
      });
      // a tile that is all dark is filled, not kept; one with nothing on it is nothing
      const plain = full && !boxed;
      // the two in one: the dark, the ink over it
      let both = null;
      if (inked) {
        [both] = this.canvas(w, h); const bx = both.getContext('2d'); bx.setTransform(1, 0, 0, 1, 0, 0);
        if (plain) { bx.fillStyle = sky; bx.fillRect(0, 0, w, h); } else if (any) bx.drawImage(dark, 0, 0);
        bx.drawImage(ink, 0, 0);
      } else if (any && !plain) both = dark;
      this.spare(ink); if (!(any && !plain) || !inked && false) { if (!(any && !plain)) this.spare(dark); }
      e = { dark: any && !plain ? dark : null, both, plain, w, h, used: 0 };
      this.held = (this.held || 0) + (e.dark ? w * h : 0) + (both && both !== e.dark ? w * h : 0);
      L.tiles.set(key, e);
    }
    e.used = this.frameNo;
    return e;
  }
  // a clear canvas w by h, in css pixels' scale: one let go of before, if there is one that size
  canvas(w, h) {
    const d = this.sc.grid.dpr, pool = this.pool || (this.pool = []);
    let i = pool.findIndex((c) => c.width === w && c.height === h), c;
    if (i >= 0) { c = pool[i]; pool[i] = pool[pool.length - 1]; pool.pop(); const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h); x.setTransform(d, 0, 0, d, 0, 0); return [c, x]; }
    c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return [c, x];
  }
  spare(c) { if (c && (this.pool || (this.pool = [])).length < 96) this.pool.push(c); }
  // let go of the pictures longest unseen, when too many are held
  tidy() {
    const g = this.sc.grid, room = 10 * g.canvas.width * g.canvas.height;
    if ((this.held || 0) <= room) return;
    const old = [];
    for (const l of this.lobes) if (l.levels) for (const [lk, L] of l.levels) {
      for (const [k, e] of L.tiles) if (e.used < this.frameNo) old.push([e.used, () => { L.tiles.delete(k); this.held -= (e.dark ? e.w * e.h : 0) + (e.both && e.both !== e.dark ? e.w * e.h : 0); this.spare(e.dark); if (e.both !== e.dark) this.spare(e.both); }]);
      if (!L.tiles.size) l.levels.delete(lk);
    }
    old.sort((a, b) => a[0] - b[0]);
    for (const [, drop] of old) { if (this.held <= room * 0.6) break; drop(); }
  }

  // The route crosses from one cut-out to the next on a rope bridge: a
  // sagging deck of planks, a hand rope over it, a post at either end. The
  // scene draws them after it has put the mountain out, so a bridge shows
  // plainly wherever it is; the light only warms the one you are on.
  drawBridges() {
    const sc = this.sc, g = sc.grid, P = sc.P, wood = mixHex(P.ground, P.rockLight, 0.45);
    for (let i = 0; i + 1 < this.route.length; i++) {
      const B = this.bridge(i); if (!B) continue;
      const { pts, u, vis } = B;
      for (const [x, y] of pts) g.box(x - u * 0.45, y - u * 1.35, u * 0.9, u * 1.9, sc.sky, vis);   // it hides what is behind it
      pts.forEach(([x, y], k) => {
        g.ink('=', wood, x, y, u * 0.95, vis);
        g.ink('·', P.muted, x, y - u * 0.95, u, 0.85 * vis);
        if (k % 3 === 1) g.ink(':', P.muted, x, y - u * 0.48, u * 0.7, 0.6 * vis);
      });
      if (B.posts) for (const [x, y] of [pts[0], pts[pts.length - 1]]) g.ink('|', wood, x, y - u * 0.5, u * 1.35, vis);
    }
  }

  // the bridge from the route's i-th cut-out to the next: its planks, in pixels, or null if it is not to be seen
  bridge(i) {
    const g = this.sc.grid, a = this.route[i], b = this.route[i + 1];
    if (!b || !a.depart || Math.min(a.vis, b.vis) < 0.1) return null;
    // it starts where the path on this side last shows: if the far end of the path has slipped behind the next ridge, the bridge reaches back to it
    let k = a.path.length - 1, x0, y0;
    for (; k >= 0; k--) { [x0, y0] = this.at(a, a.path[k][0] + 0.5, a.path[k][1] + 0.5); if (k === 0 || !this.hidden(x0, y0, a.index)) break; }
    const [x1, y1] = this.at(b, b.arrive[0] + 0.5, b.arrive[1] + 0.5);
    if (Math.max(y0, y1) < -40 || Math.min(y0, y1) > g.h + 40) return null;
    const u = g.size * (a.s + b.s) / 2, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    // while the next ridge is still far round the mountain there is no bridge to it yet
    const vis = Math.min(a.vis, b.vis) * (1 - smooth(11 * u, 15 * u, len));
    if (vis < 0.05) return null;
    const n = Math.max(1, Math.round(len / (u * 0.6))), sag = Math.min(len * 0.16, u * 1.3), pts = [];
    for (let k = 0; k <= n; k++) { const t = k / n; pts.push([x0 + dx * t, y0 + dy * t + sag * 4 * t * (1 - t)]); }
    return { pts, u, vis, posts: len > u * 1.3 };
  }

  // is a rectangle of the screen wholly behind a cut-out standing in front of the one at `index`: its corners and
  // the middle of its top edge are all inside it (a cut-out is solid from its crest down)
  behind(x, y, w, h, index) {
    const g = this.sc.grid;
    for (let m = index + 1; m < this.lobes.length; m++) {
      const f = this.lobes[m]; if (f.vis < 0.995 || !f.mask) continue;
      let all = true;
      for (const [px, py] of [[x, y], [x + w / 2, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        const c = Math.floor(f.cx + 0.5 + (px / g.cellW - f.X) / f.s), i = Math.floor(this.centreRow + (py - g.h / 2) / (g.cellH * f.s)) - f.base;
        if (!(i >= 0 && i < f.rowsN && c >= 0 && c < f.W && f.mask[i][c] === 1)) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  }
  // is a pixel hidden by a cut-out standing in front of the one at `index`
  hidden(x, y, index) {
    const g = this.sc.grid;
    for (let m = index + 1; m < this.lobes.length; m++) {
      const f = this.lobes[m]; if (f.vis < 0.5 || !f.mask) continue;
      const c = Math.floor(f.cx + 0.5 + (x / g.cellW - f.X) / f.s), i = Math.floor(this.centreRow + (y - g.h / 2) / (g.cellH * f.s)) - f.base;
      if (i >= 0 && i < f.rowsN && c >= 0 && c < f.W && f.mask[i][c] === 1) return true;
    }
    return false;
  }

  // Where you are on the route: its place across the screen at height y
  // (pixels), and its marks within `reach` of there, each as [left, top,
  // glyph, size, strength, whether it is placed by its middle], for the scene to light.
  light(y, reach) {
    const g = this.sc.grid, near = [], sig = g.cellH * 2;
    let sum = 0, weight = 0;
    for (const l of this.route) {
      if (l.vis < 0.2 || !l.cells) continue;
      for (const [c, r] of l.path) {
        const [px, py] = this.at(l, c, r), cy = py + g.cellH * l.s / 2;
        if (Math.abs(cy - y) > reach) continue;
        const ch = l.cells[r - l.base]?.[c]?.[0]; if (!ch) continue;
        const cx = px + g.cellW * l.s / 2;
        if (this.hidden(cx, cy, l.index)) continue;
        const w = Math.exp(-(((cy - y) / sig) ** 2)) * l.vis; sum += cx * w; weight += w;
        near.push([px, py, ch, g.size * l.s, l.vis, false]);
      }
    }
    for (let i = 0; i + 1 < this.route.length; i++) {
      const B = this.bridge(i); if (!B) continue;
      for (const [x, cy] of B.pts) {
        if (Math.abs(cy - y) > reach) continue;
        const w = Math.exp(-(((cy - y) / sig) ** 2)) * B.vis; sum += x * w; weight += w;
        near.push([x, cy, '=', B.u * 0.95, B.vis, true], [x, cy - B.u * 0.95, '·', B.u, B.vis * 0.8, true]);   // a plank and the rope over it: placed by their middles
      }
    }
    return { sum, weight, near };
  }

  // trees something could sit on: on cut-outs facing you, on screen, with nothing nearer over them
  perches() {
    const g = this.sc.grid, out = [];
    this.lobes.forEach((l, n) => {
      if (l.vis < 0.9 || !l.trees || !l.trees.length) return;
      for (const t of l.trees) {
        const [x, y] = this.at(l, t.c + 0.5, t.row + 1), k = this.grown(l, t);
        if (y < 0 || y > g.h + 30 || x < 10 || x > g.w - 10) continue;
        const covered = this.hidden(x, y - g.cellH * l.s * 0.5, n);
        if (!covered) out.push({ id: t.id, x, y, top: y - t.h * g.cellH * k, s: k, ls: l.s, leafy: t.leafy, lobe: n });   // s: the size it is drawn at; ls: its ridge's
      }
    });
    return out;
  }

  // paint one cut-out that will be needed soon, in spare time; true if there was one
  warm() {
    const ahead = this.centreRow + this.sc.screenRows * 2;
    const l = this.lobes.find((x) => !x.cells && x.apex < ahead);
    if (l) this.paint(l);
    return !!l;
  }

  // lamps on the route's upper stretch, one for every merged commit
  setLamps(n) {
    const S = this.sc.screenRows, cells = [];
    for (const l of this.route) for (const [c, r] of l.path) if (r > 4.6 * S && r < 6.25 * S) cells.push([l, c, r]);
    this.lamps = [];
    for (let i = 0; i < n && cells.length; i++) { const [l, c, r] = cells[Math.floor((i + 0.5) / n * cells.length)]; this.lamps.push({ l, c, r, phase: i * 2.4 }); }
  }
}
