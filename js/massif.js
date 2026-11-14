// The mountain below the peak: cut-outs on a turntable.
//
// The peak's spire is carried on down as the core. Round it stand more
// spires, and below them wooded ridges, further out the lower they start.
// Each is painted once, flat, the way the peak is painted. The turntable
// turns as the page scrolls, and it turns so that the ridge at your own
// height is always the one facing you: the route down the mountain winds
// round it, and you follow the route.
//
// A cut-out that faces you is nearer, so it is drawn larger and moves
// faster than the page; as it goes round the side it shrinks back and
// fades into haze. Lower cut-outs always stand in front of higher ones, so
// nothing ever swaps places.

import { clamp, smooth, mulberry32, wrapPi, edge, mixHex } from './util.js';
import { D } from './direction.js';

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

    const lead = D.rest[sc.stack ? 'stack' : 'side'] + M.lead;
    const face = (apex) => sc.yawAt(apex / S + lead);          // the turn at which a cut-out with this top faces you
    this.reach = kx * 34;
    const out = (at) => kx * (15 + 4.3 * (at - 5.4));           // how far out a ridge stands, by the height of its top
    const sizeAt = (d) => 1 + M.depth * d / this.reach;         // how large it is drawn when it faces you

    const marked = sc.stops.filter((s) => s.mark && s.mark !== 'hut');
    const defs = [{ core: true, route: true, th: 0, off: 0, d: 0, apex: sc.bodyTop, half: coreHalf, rag: 2, seed: 1, stop: marked.find((s) => s.at <= L.ice) }];
    // spires: steep, snow-topped, close in. Each stands off to one side when you are level with it.
    [[0.98, 9, 1.25], [1.22, 15, -1.2], [1.5, 12, 1.4], [1.78, 20, -1.35], [2.05, 17, 1.2], [2.3, 23, -1.1]].forEach(([s, d, off], i) => {
      const apex = Math.round(sc.summitRow + s * S);
      defs.push({ th: face(apex) + off, off, d: d * kx, apex, half: spire, rag: 3, seed: 10 + i * 7 });
    });
    // The ridges the route runs over. A stop's ridge faces you exactly when
    // its card is open, with the stop's waypoint where the stop says.
    const mode = sc.stack ? 'stack' : 'side';
    const stopTops = marked.filter((s) => s.at > L.ice).map((s) => {
      const rest = s.at + D.rest[mode], d = out(s.at - 0.14), size = sizeAt(d);
      const row = rest * S + (s.hy - rest * S) / size;         // the waypoint's row on the cut-out
      return { at: row / S - 0.14, stop: s, th: sc.yawAt(rest), d, way: [(s.hx + 0.5 - sc.ax) / size, row] };
    });
    const anchors = [{ at: L.treeline - 0.1 }, ...stopTops, { at: L.ground - 0.42 }];
    const tops = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i], b = anchors[i + 1], n = Math.max(1, Math.round((b.at - a.at) / 0.3));
      for (let k = 0; k < n; k++) tops.push(k ? { at: a.at + (b.at - a.at) * k / n } : a);
    }
    tops.push(anchors[anchors.length - 1]);
    tops.forEach((t, i) => {
      const apex = Math.round(t.at * S), th = t.th ?? face(apex) + (rnd() - 0.5) * 0.2;
      defs.push({ ridge: true, route: true, th, off: th - face(apex), d: t.d ?? out(t.at) * (0.92 + rnd() * 0.16), apex, half: ridge, rag: 5, seed: 100 + i * 13, stop: t.stop, way: t.way });
    });
    // more ridges off the route, standing to one side and the other
    for (let i = 0, at = L.forest - 0.35; at < L.ground - 0.8; i++, at += 0.5 + rnd() * 0.2) {
      const apex = Math.round(at * S), off = (i % 2 ? -1 : 1) * (0.8 + rnd() * 0.4);
      defs.push({ ridge: true, th: face(apex) + off, off, d: out(at) * (1.05 + rnd() * 0.2), apex, half: ridge, rag: 5, seed: 400 + i * 17 });
    }
    // lower ones stand in front of higher ones, always
    // Which stands in front of which never changes. Spires stand behind the
    // core, so the rope down it is never hidden. A ridge off the route stands
    // behind the route's ridges near its own height, so the path is never
    // hidden either. Otherwise lower stands in front of higher.
    const rank = (d) => d.core ? -1 : !d.ridge ? d.apex - 1e6 : d.route ? d.apex : d.apex - 0.45 * S;
    defs.sort((a, b) => rank(a) - rank(b));
    this.lobes = defs.map((d) => this.shape(d));

    // the route: over each of its cut-outs from where it arrives to where it steps onto the next
    const route = this.route = this.lobes.filter((l) => l.route);
    route.forEach((l, i) => { l.arrive = l.core ? [l.cx + 1, sc.bodyTop] : this.onCrest(l, l.cx - Math.round((3 + rnd() * 3) * kx)); });
    route.forEach((l, i) => {
      const next = route[i + 1];
      if (!next) {
        // the last ridge: the path runs down it to the hut, where the hut stands at the end of the page
        const end = this.pose(l, sc.yawAt(99)), G = sc.groundRow;
        l.depart = [this.inside(l, Math.round(l.cx + (sc.ground.door[0] * sc.ground.k - end.X) / end.s), G - 1), G - 1];
        return;
      }
      // where the next one's arrival shows on this one, half way between each facing you
      const yaw = (l.core ? next.th - 0.2 : (l.th + next.th) / 2), mid = ((l.core ? next.apex : (l.apex + next.apex) / 2)) + lead * S;
      const a = this.pose(l, yaw), b = this.pose(next, yaw);
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
    const tall = G - def.apex, wmax = Math.min(Math.ceil(def.half(tall)), Math.ceil(sc.cols / 2 + this.reach) + 6) + 3, W = 2 * wmax + 1, cx = wmax;
    const peak = new Float32Array(W).fill(Infinity);
    for (let c = 0; c < W; c++) {
      const a = Math.abs(c - cx); if (def.half(tall) < a) continue;
      let lo = 0, hi = tall;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (def.half(m) >= a) hi = m; else lo = m; }
      peak[c] = def.apex + hi + (n.fbm(c * 0.21 + def.seed, 3.3, 2) - 0.5) * def.rag * Math.min(1, hi / 5);
    }
    return { ...def, W, cx, peak, vis: 0, s: 1, X: 0 };
  }
  onCrest(l, c) { c = clamp(c, 2, l.W - 3); while (!Number.isFinite(l.peak[c])) c += c < l.cx ? 1 : -1; return [c, Math.ceil(l.peak[c])]; }
  inside(l, c, r) { c = clamp(c, 1, l.W - 2); for (let i = 0; i < l.W && !(l.peak[c] <= r - 1); i++) c += c < l.cx ? 1 : -1; return c; }

  // where a cut-out stands and how large it is drawn, for a turn of the table
  pose(l, yaw) {
    const phi = l.core ? 0 : this.sc.reduced.matches ? l.off : wrapPi(l.th - yaw), [h0, h1] = D.massif.haze;
    // tone: the cut-out that faces you is the brightest; one turning away dims, so what is in front reads against what is behind
    return { vis: l.core ? 1 : 1 - smooth(h0, h1, Math.abs(phi)), tone: l.core ? 1 : D.massif.far + (1 - D.massif.far) * smooth(0.3, 1, Math.cos(phi)), s: this.sc.reduced.matches ? 1 : 1 + D.massif.depth * l.d * Math.cos(phi) / this.reach, X: this.sc.ax + l.d * Math.sin(phi) };
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
    const deep = Math.round(S * 1.25);
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
          if (depth > deep || kept.has(r * W + x)) continue;
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
    // then ranks every few rows that thin out into the dark below it ---
    const trees = l.trees = [], T = D.glyphs;
    const stamp = (c, r, shape, leafy, dark, snowy) => {
      const h = shape.length, w = shape[0].length, x0 = c - Math.floor(w / 2), olive = rnd() < 0.5;
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (shape[i][j] !== ' ' && kept.has((r - (h - 1 - i)) * W + x0 + j)) return;   // the route stays clear
      for (let i = 0; i < h; i++) {
        const row = shape[i]; let f = 0, e = w - 1;
        while (f < w && row[f] === ' ') f++; while (e >= 0 && row[e] === ' ') e--;
        for (let j = f; j <= e; j++) {
          const k = r - (h - 1 - i) - base; if (k < 0 || k >= rowsN || x0 + j < 0 || x0 + j >= W) continue;
          mask[k][x0 + j] = 1; cells[k][x0 + j] = null;
          const ch = row[j]; if (ch === ' ') continue;
          const foot = i === h - 1 && (ch === '|' || leafy), right = j > (w - 1) / 2 + 0.6;
          cells[k][x0 + j] = leafy ? [ch, foot ? P.ground : olive ? P.leafOlive : P.leaf, !foot && (dark || right) ? 0.6 : 1]
            : [ch, !foot && (i < snowy || (i === snowy && snowy > 1 && j === f)) ? P.snow : foot || dark || right ? P.pineDark : P.pine, 1];
        }
      }
      trees.push({ c, row: r, h, leafy, id: index * 10000 + trees.length });
    };
    const pick = (at, d) => {
      const low = smooth(Y.forest + 0.3, Y.forest + 2.0, at), leafy = rnd() < low * 0.22, small = !leafy && rnd() > d * 0.85 + 0.08;
      return [leafy ? T.leafy[Math.floor(rnd() * T.leafy.length)] : small ? T.sapling : T.pines[Math.floor(rnd() * T.pines.length)], leafy];
    };
    // how much snow a tree carries: laden near the treeline, dusted lower, bare in the forest proper
    const snowOn = (at) => at < Y.forest - 0.15 ? 2 : at < Y.forest + 0.3 ? (rnd() < 0.75 ? 2 : 1) : at < Y.forest + 0.95 ? (rnd() < 0.6 ? 1 : 0) : 0;
    const density = (at) => smooth(Y.treeline - 0.1, Y.forest + 0.2, at);
    for (let c = 2 + Math.floor(rnd() * 3); c < W - 3; c += 3 + Math.floor(rnd() * 3)) {
      if (!Number.isFinite(peak[c])) continue;
      const r = Math.round(peak[c]), at = r / S, d = density(at);
      if (r >= G - 1 || rnd() > d * 1.1 || (l.core && r <= sc.bodyTop + 2)) continue;
      const [shape, leafy] = pick(at, d);
      stamp(c, r, shape, leafy, slope[c] > 0.05, leafy ? 0 : Math.min(snowOn(at), shape.length - 1));
    }
    for (let r = Math.round(Y.treeline * S); r < G; r += 3) {
      const at = r / S, d = density(at);
      for (let c = 2 + (r * 7) % 5; c < W - 3; c += 5 + Math.floor(rnd() * 5)) {
        if (!Number.isFinite(peak[c])) continue;
        const depth = r - peak[c];
        if (depth < 4 || depth > deep || rnd() > d * 0.92 * (1 - 0.72 * smooth(10, 44, depth))) continue;
        const [shape, leafy] = pick(at, d);
        stamp(c, r, shape, leafy, slope[c] > 0.05, leafy ? 0 : Math.min(snowOn(at), shape.length - 1));
      }
    }

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
    for (const l of this.lobes) Object.assign(l, this.pose(l, yaw));
  }
  // a place on a cut-out (column, row; fractions allowed), in viewport pixels
  at(l, c, r) { const g = this.sc.grid; return [(l.X + (c - l.cx - 0.5) * l.s) * g.cellW, g.h / 2 + (r - this.centreRow) * g.cellH * l.s]; }

  render() {
    const sc = this.sc, g = sc.grid, P = sc.P, cw = g.cellW, ch = g.cellH, H = g.h, sky = sc.sky;
    for (const l of this.lobes) {
      if (l.vis < 0.02) continue;
      const top = H / 2 + (l.apex - 8 - this.centreRow) * ch * l.s;
      if (top > H) continue;                         // wholly below the screen
      if (!l.cells) this.paint(l);
      const s = l.s, cws = cw * s, chs = ch * s, x0 = l.X * cw - (l.cx + 0.5) * cws, y0 = H / 2 - this.centreRow * chs;   // the pixel of its column 0, row 0
      const r0 = Math.max(l.base, Math.floor(-y0 / chs) - 1), r1 = Math.min(l.base + l.rowsN - 1, Math.ceil((H - y0) / chs));
      const c0 = Math.max(0, Math.floor(-x0 / cws) - 1), c1 = Math.min(l.W - 1, Math.ceil((g.w - x0) / cws));
      if (r1 < r0 || c1 < c0) continue;
      const size = g.size * s, seam = l.core ? sc.seamRow + sc.blend : -1, shift = sc.ax - l.cx - 0.5;
      for (let row = r0; row <= r1; row++) {
        const i = row - l.base, y = y0 + row * chs;
        for (const [a, b] of l.runs[i]) if (b >= c0 && a <= c1) g.box(x0 + a * cws - 0.5, y - 0.5, (b - a) * cws + 1, chs + 1, sky, l.vis);
      }
      // the ground's wash, stretched to size: smoothing makes it a soft edge, not blocks
      g.ctx.globalAlpha = g.alpha = l.vis * l.tone;
      g.ctx.drawImage(l.wash, 0, r0 - l.base, l.W, r1 - r0 + 1, x0, y0 + r0 * chs, l.W * cws, (r1 - r0 + 1) * chs);
      for (let row = r0; row <= r1; row++) {
        const i = row - l.base, y = y0 + row * chs, cells = l.cells[i];
        for (let c = c0; c <= c1; c++) {
          const cell = cells[c];
          if (cell && !(row <= seam && !l.kept.has(row * l.W + c) && sc.painted(row, Math.round(shift + c)))) g.set(cell[0], cell[1], x0 + c * cws, y, size, cell[2] * l.vis * l.tone);
        }
      }
    }
    // the route crosses from one cut-out to the next on a rope bridge: a
    // sagging deck of planks, a hand rope over it, a post at either end
    const wood = mixHex(P.ground, P.leaf, 0.5);
    for (let i = 0; i + 1 < this.route.length; i++) {
      const B = this.bridge(i); if (!B) continue;
      const { pts, u, vis } = B;
      for (const [x, y] of pts) g.box(x - u * 0.45, y - u * 1.35, u * 0.9, u * 1.9, sky, vis);   // it hides what is behind it
      pts.forEach(([x, y], k) => {
        g.ink('=', wood, x, y, u * 0.95, vis);
        g.ink('·', P.muted, x, y - u * 0.95, u, 0.9 * vis);
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
    const vis = Math.min(a.vis, b.vis) * (1 - smooth(8 * u, 11 * u, len));
    if (vis < 0.05) return null;
    const n = Math.max(1, Math.round(len / (u * 0.6))), sag = Math.min(len * 0.16, u * 1.3), pts = [];
    for (let k = 0; k <= n; k++) { const t = k / n; pts.push([x0 + dx * t, y0 + dy * t + sag * 4 * t * (1 - t)]); }
    return { pts, u, vis, posts: len > u * 1.3 };
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
        near.push([x, cy, '=', B.u * 0.95, B.vis, true]);   // a plank: placed by its middle
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
        const [x, y] = this.at(l, t.c + 0.5, t.row + 1);
        if (y < 0 || y > g.h + 30 || x < 10 || x > g.w - 10) continue;
        const covered = this.hidden(x, y - g.cellH * l.s * 0.5, n);
        if (!covered) out.push({ id: t.id, x, y, top: y - t.h * g.cellH * l.s, s: l.s, leafy: t.leafy, lobe: n });
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
