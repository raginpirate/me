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

import { clamp, smooth, mulberry32, wrapPi, edge } from './util.js';
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
    defs.sort((a, b) => a.apex - b.apex);
    this.lobes = defs.map((d) => this.shape(d));

    // the route: over each of its cut-outs from where it arrives to where it steps onto the next
    const route = this.route = this.lobes.filter((l) => l.route);
    route.forEach((l, i) => { l.arrive = l.core ? [l.cx + 1, sc.bodyTop] : this.onCrest(l, l.cx - Math.round((3 + rnd() * 3) * kx)); });
    route.forEach((l, i) => {
      const next = route[i + 1];
      if (!next) { l.depart = null; return; }
      // where the next one's arrival shows on this one, half way between each facing you
      const yaw = (l.core ? next.th - 0.2 : (l.th + next.th) / 2), mid = ((l.core ? next.apex : (l.apex + next.apex) / 2)) + lead * S;
      const a = this.pose(l, yaw), b = this.pose(next, yaw);
      const x = b.X + (next.arrive[0] - next.cx) * b.s, y = (next.arrive[1] - mid) * b.s;
      const r = Math.max(l.arrive[1] + 3, Math.round(mid + y / a.s) - 1);
      l.depart = [this.inside(l, Math.round(l.cx + (x - a.X) / a.s), r), r];
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
    return { vis: l.core ? 1 : 1 - smooth(h0, h1, Math.abs(phi)), s: this.sc.reduced.matches ? 1 : 1 + D.massif.depth * l.d * Math.cos(phi) / this.reach, X: this.sc.ax + l.d * Math.sin(phi) };
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
          if (depth > deep || r >= G || wood > 0.6 || kept.has(r * W + x)) continue;
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
            : [ch, snowy && i === 0 ? P.snow : foot || dark || right ? P.pineDark : P.pine, 1];
        }
      }
      trees.push({ c, row: r, h, leafy, id: index * 10000 + trees.length });
    };
    const pick = (at, d) => {
      const low = smooth(Y.forest + 0.3, Y.forest + 2.0, at), leafy = rnd() < low * 0.16, small = !leafy && rnd() > d * 0.85 + 0.08;
      return [leafy ? T.leafy[Math.floor(rnd() * T.leafy.length)] : small ? T.sapling : T.pines[Math.floor(rnd() * T.pines.length)], leafy];
    };
    const density = (at) => smooth(Y.treeline - 0.1, Y.forest + 0.2, at);
    for (let c = 2 + Math.floor(rnd() * 3); c < W - 3; c += 3 + Math.floor(rnd() * 3)) {
      if (!Number.isFinite(peak[c])) continue;
      const r = Math.round(peak[c]), at = r / S, d = density(at);
      if (r >= G - 1 || rnd() > d * 1.1 || (l.core && r <= sc.bodyTop + 2)) continue;
      const [shape, leafy] = pick(at, d);
      stamp(c, r, shape, leafy, slope[c] > 0.05, !leafy && at < Y.forest + 0.3 && rnd() < 0.6);
    }
    for (let r = Math.round(Y.treeline * S); r < G; r += 3) {
      const at = r / S, d = density(at);
      for (let c = 2 + (r * 7) % 5; c < W - 3; c += 5 + Math.floor(rnd() * 5)) {
        if (!Number.isFinite(peak[c])) continue;
        const depth = r - peak[c];
        if (depth < 4 || depth > deep || rnd() > d * 0.92 * (1 - 0.72 * smooth(10, 44, depth))) continue;
        const [shape, leafy] = pick(at, d);
        stamp(c, r, shape, leafy, slope[c] > 0.05, !leafy && at < Y.forest + 0.2 && rnd() < 0.5);
      }
    }

    // --- the route's own marks: a fixed rope on the ice, a path of stones on the rock, a trodden path in the forest ---
    path.forEach(([c, r], k) => {
      const i = r - base, at = r / S; if (i < 0 || i >= rowsN || c < 0 || c >= W) return;
      mask[i][c] = 1;
      cells[i][c] = at < Y.ice ? (k % 4 === 0 ? ['+', P.ember, 0.95] : [':', P.ember, 0.6])
        : at < Y.forest ? [k % 3 ? '.' : ',', P.ember, 0.75]
        : k % 7 === 3 ? ['=', P.ember, 0.5] : [k % 2 ? ':' : '.', P.ember, 0.62];
    });

    // what each row covers, as runs, for hiding whatever is behind
    l.runs = mask.map((m) => { const out = []; let a = -1; for (let c = 0; c <= W; c++) { const on = c < W && m[c]; if (on && a < 0) a = c; else if (!on && a >= 0) { out.push([a, c]); a = -1; } } return out; });
  }

  // ---------- each frame ----------
  frame(centreRow, yaw) {
    this.centreRow = centreRow;
    for (const l of this.lobes) Object.assign(l, this.pose(l, yaw));
  }
  // a place on a cut-out (column, row; fractions allowed), in viewport pixels
  at(l, c, r) { const g = this.sc.grid; return [(l.X + (c - l.cx - 0.5) * l.s) * g.cellW, g.h / 2 + (r - this.centreRow) * g.cellH * l.s]; }

  render() {
    const sc = this.sc, g = sc.grid, cw = g.cellW, ch = g.cellH, H = g.h, sky = sc.sky;
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
        const cells = l.cells[i];
        for (let c = c0; c <= c1; c++) {
          const cell = cells[c];
          if (cell && !(row <= seam && sc.painted(row, Math.round(shift + c)))) g.set(cell[0], cell[1], x0 + c * cws, y, size, cell[2] * l.vis);
        }
      }
    }
    // the route steps from one cut-out to the next
    for (let i = 0; i + 1 < this.route.length; i++) {
      const a = this.route[i], b = this.route[i + 1], vis = Math.min(a.vis, b.vis);
      if (vis < 0.1 || !a.depart) continue;
      const [x0, y0] = this.at(a, a.depart[0] + 0.5, a.depart[1] + 0.5), [x1, y1] = this.at(b, b.arrive[0] + 0.5, b.arrive[1] + 0.5);
      if (Math.max(y0, y1) < -20 || Math.min(y0, y1) > H + 20) continue;
      const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / (cw * 1.15));
      for (let k = 1; k < n; k++) g.ink('.', sc.P.ember, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, g.size * (a.s + b.s) / 2, 0.7 * vis);
    }
  }

  // trees something could sit on: on cut-outs facing you, on screen, with nothing nearer over them
  perches() {
    const g = this.sc.grid, out = [];
    this.lobes.forEach((l, n) => {
      if (l.vis < 0.9 || !l.trees || !l.trees.length) return;
      for (const t of l.trees) {
        const [x, y] = this.at(l, t.c + 0.5, t.row + 1);
        if (y < 0 || y > g.h + 30 || x < 10 || x > g.w - 10) continue;
        let covered = false;
        for (let m = n + 1; m < this.lobes.length && !covered; m++) {
          const f = this.lobes[m]; if (f.vis < 0.5 || !f.mask) continue;
          const c = Math.floor(f.cx + 0.5 + (x / g.cellW - f.X) / f.s), i = Math.floor(this.centreRow + (y - g.cellH * f.s * 0.5 - g.h / 2) / (g.cellH * f.s)) - f.base;
          covered = i >= 0 && i < f.rowsN && c >= 0 && c < f.W && f.mask[i][c] === 1;
        }
        if (!covered) out.push({ id: t.id, x, y, top: y - t.h * g.cellH * l.s, s: l.s, leafy: t.leafy });
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
