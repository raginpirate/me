// The mountain and the way down it, in the camera's world.
//
// The mountain stands on the page's own plane: the painted peak, and the
// massif it stands on, painted by the same hand. You come down its face,
// and from its flank a rope bridge takes you across open air to the first
// ridge of the forest. From there the way down is along skylines: each
// ridge is a terrace whose crest is the path, and the path goes along it,
// then down onto the next terrace, nearer, the other way, as switchbacks
// do. Where one spur ends and the next begins there is a gap, and a bridge
// over it, from the edge of one cliff to the edge of the next. The last
// terrace is the valley floor, with the hut on it.
//
// Every one of those is a pane at its own depth. The camera backs away as
// you go down, so each terrace you leave rises and shrinks and goes into
// the mist, and the mountain stands further off in the sky.
//
// The path is where the light you carry is: at every moment it is the
// place on the terrace you are on that is under the light. So the crest of
// each terrace is laid along exactly that.

import { clamp, smooth, mulberry32, edge, mixHex, hash } from './util.js';
import { D } from './direction.js';
import { face } from './world.js';
import { tree } from './trees.js';
import { MOST } from './camera.js';

const line = (pts) => (x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
// how much a glyph stands out, for keeping the right one when a painting is drawn in fewer cells
const WEIGHT = { '@': 6, '#': 5, '%': 4, '/': 4.5, '\\': 4.5, '|': 4.5, '^': 3.5, '&': 3.5, ':': 2.5, '+': 3, '.': 1.5, ',': 1.2, "'": 1.2, '-': 2, '_': 2, '"': 1 };
const GRASS = [',', '.', "'", '"', ',', '`'];

export class Massif {
  constructor(sc) {
    this.sc = sc;
    const g = sc.grid, cam = sc.cam, S = sc.screenRows, L = D.layout, M = D.massif;
    this.kx = Math.min(sc.cols, 170) / 60;
    const rest = D.rest[sc.stack ? 'stack' : 'side'] * S;           // a row is under the light this many rows of scroll after it is in the middle
    this.lampY = cam.lampFrac * g.h;
    const W = g.w, cx = W / 2, last = sc.end + S / 2, at = (s) => s.snap + S / 2, pxOf = (s) => (s.hx + 0.5) * g.cellW;
    const marked = sc.stops.filter((s) => s.mark && s.mark !== 'hut'), hutStop = sc.stops.find((s) => s.mark === 'hut');
    const narrow = sc.stack ? 1 : 0, sweep = M.sweep[narrow] * W, jump = M.jump[narrow] * W, bl = M.cross * S, step = M.slice * S;

    // ---------- the trail: where across the screen the light is, at every scroll ----------
    // Bridges: one onto the forest at the treeline, one a little before each
    // stop below that, and more where two of those are far apart.
    const anchors = [];
    for (const b of [(L.treeline - 0.05) * S + rest, ...marked.filter((s) => s.at > L.ice).map((s) => at(s) - 0.12 * S)].sort((a, b) => a - b)) if (!anchors.length || b - anchors[anchors.length - 1] > M.apart * 0.5 * S) anchors.push(b);
    const lands = [];
    anchors.forEach((b, i) => { lands.push(b); const nx = anchors[i + 1] ?? last - 0.55 * S, n = Math.floor((nx - b) / (M.apart * S)); for (let k = 1; k <= n; k++) lands.push(b + (nx - b) * k / (n + 1)); });
    // a knot: [scroll, pixels across, what leads to it: 'walk' or 'bridge']
    const knots = this.knots = [[sc.summitRow + 2 + rest, (sc.world.topCol + 1.5) * g.cellW, 'walk'], [sc.bodyTop + rest, (Math.floor(sc.ax + 0.5) + 0.5) * g.cellW, 'walk']];
    const stopsIn = (a, b) => marked.filter((s) => at(s) > a + 2 && at(s) < b - 2).map((s) => [at(s), pxOf(s)]);
    // walk on to t1: switchbacks from one side to the other, through any stop on the way; x1 null: head for the middle, to cross
    const walk = (t1, x1) => {
      let [pt, px] = knots[knots.length - 1];
      for (const [tt, xx] of [...stopsIn(pt, t1), [t1, x1]]) {
        const n = Math.max(1, Math.round((tt - pt) / step));
        for (let k = 1; k < n; k++) { px = px > cx ? cx - sweep : cx + sweep; knots.push([pt + (tt - pt) * k / n, px, 'walk']); }
        const x = xx ?? cx - (px > cx ? -1 : 1) * jump / 2;
        knots.push([tt, x, 'walk']); pt = tt; px = x;
      }
    };
    for (const b of lands) {
      walk(b - bl, null);
      const [, xa] = knots[knots.length - 1], xp = knots[knots.length - 2][1], dir = Math.sign(xa - xp) || 1;
      knots.push([b, clamp(xa + dir * jump, W * 0.12, W * 0.88), 'bridge']);
    }
    walk(last, pxOf(hutStop));

    // ---------- the mountain: the peak's painting and the massif under it, at Z = 1 ----------
    const firstLand = lands[0], depart = firstLand - bl;
    const bodyRoute = this.locus(knots[1][0], depart, 1);
    const [XD, YD] = bodyRoute[bodyRoute.length - 1], dir1 = Math.sign(this.trail(firstLand) - this.trail(depart)) || 1;
    this.mountain = this.makeMountain(bodyRoute, XD, YD, dir1);
    this.mountain.t1 = depart;

    // ---------- the terraces: one for every stretch of walking below the first bridge ----------
    const slices = this.slices = [];
    for (let i = 1; i < knots.length; i++) {
      const [t0] = knots[i - 1], [t1, , kind] = knots[i];
      if (t0 < firstLand - 0.5 || kind === 'bridge') continue;
      slices.push(this.makeSlice({ t0, t1, landing: knots[i - 1][2] === 'bridge', departing: knots[i + 1]?.[2] === 'bridge', valley: i === knots.length - 1, index: slices.length }));
    }
    this.sheets = [this.mountain, ...slices];
    this.sheets.forEach((sh, i) => { sh.index = i; });
    // a stop's waypoint: on the terrace it is on, under the light when its card is open
    for (const s of marked) {
      const sh = slices.find((x) => x.t0 <= at(s) && at(s) <= x.t1) ?? this.mountain;
      s.sheet = sh; sh.mark = this.where(at(s), sh.Z, pxOf(s), (s.hy - s.snap + 0.5) * g.cellH);
    }
    // ---------- the bridges: from where the path leaves one to where it takes up on the next ----------
    this.bridges = [];
    for (let i = 1; i < knots.length; i++) {
      if (knots[i][2] !== 'bridge') continue;
      const a = knots[i - 1][0], b = knots[i][0];
      const from = [...this.sheets].reverse().find((x) => x.t1 <= a + 0.6) ?? this.mountain, to = slices.find((x) => x.t0 >= b - 0.6);
      if (!to) continue;
      // a straight span in the world, from the edge of one to the edge of the next, sagging in the middle
      const [XA, YA] = this.where(a, from.Z), [XB, YB] = this.where(b, to.Z), sag = 0.025 * Math.abs(XB - XA) + 0.4, pts = [];
      for (let k = 0; k <= 24; k++) { const f = k / 24; pts.push([XA + (XB - XA) * f, YA + (YB - YA) * f + sag * Math.sin(Math.PI * f), from.Z + (to.Z - from.Z) * f]); }
      this.bridges.push({ a, b, from, to, pts });
    }
    // the valley floor is the last terrace: the hut stands on it, its door where the path ends
    sc.ground = this.ground = slices[slices.length - 1].hut;
    this.lamps = [];
  }

  // ---------- the trail ----------
  // where across the screen the light is when the middle of the screen is at row s
  trail(s) {
    const k = this.knots;
    if (s <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (s <= k[i][0]) { const [s0, x0] = k[i - 1], [s1, x1] = k[i]; return x0 + (x1 - x0) * (s - s0) / (s1 - s0); }
    return k[k.length - 1][1];
  }
  // on a bridge it is on the deck, wherever the camera puts the deck
  lamp(s) {
    const b = this.bridges?.find((b) => s > b.a && s < b.b);
    if (!b) return [this.trail(s), this.lampY];
    const cam = this.sc.cam, f = (s - b.a) / (b.b - b.a) * 24, i = Math.min(23, Math.floor(f)), t = f - i, p = b.pts[i], q = b.pts[i + 1], Z = p[2] + (q[2] - p[2]) * t;
    return [cam.px(p[0] + (q[0] - p[0]) * t, Z), cam.py(p[1] + (q[1] - p[1]) * t, Z) - this.sc.grid.cellH * 0.2];
  }
  // the place at depth Z under the light (or another pixel) when the middle of the screen is at row s: [X, Y]
  where(s, Z, px = this.trail(s), py = this.lampY) { const cam = this.sc.cam; return [cam.wx(px, s, Z), cam.wy(py, s, Z)]; }
  // the path over a stretch of scroll, on the plane at depth Z: [X, Y, s] every half row
  locus(t0, t1, Z) { const out = []; for (let t = t0; t <= t1 + 1e-6; t += 0.5) out.push([...this.where(t, Z), t]); if (out[out.length - 1][2] < t1) out.push([...this.where(t1, Z), t1]); return out; }

  // ---------- the mountain ----------
  makeMountain(route, XD, YD, dir) {
    const sc = this.sc, cam = sc.cam, g = sc.grid, S = sc.screenRows, P = sc.P, M = D.massif, n = sc.noise, kx = this.kx, w = sc.world;
    // its flanks, in the peak's own half-widths: [screens below the seam, half-width]; the side the first bridge leaves from ends in a cliff there
    const flank = (pts) => { const f = line(pts); return (r) => sc.seamHalf * f(r / S); };
    let hL = flank([[0, 1], [0.16, 1.2], [0.3, 1.85], [0.66, 2.15], [0.9, 2.95], [1.45, 3.45], [1.95, 4.6], [3, 6.2], [4.6, 9.5], [6, 13]]);
    let hR = flank([[0, 1], [0.1, 1.45], [0.42, 1.8], [0.58, 2.55], [1.05, 2.95], [1.35, 3.9], [2.2, 4.6], [3, 6], [4.6, 9.5], [6, 13]]);
    const cx = sc.ax, rowD = YD - sc.bodyTop, need = Math.abs(XD - cx) + 0.5, orig = dir > 0 ? hR : hL;
    // the path must stay on the face until it gets there
    const off = new Map(); for (const [X, Y] of route) { const r = Math.round(Y - sc.bodyTop); off.set(r, Math.max(off.get(r) ?? 0, Math.abs(X - cx) + 2)); }
    const cliff = 0.22 * kx, wall = 0.32 * S;
    const side = (r) => r <= rowD ? Math.max(Math.min(orig(r) * (1 + (need / Math.max(1, orig(rowD)) - 1) * smooth(0, rowD, r)), need), off.get(Math.round(r)) ?? 0)
      : r < rowD + wall ? need + cliff * (r - rowD) : Math.max(need + cliff * wall + (r - rowD - wall) * 0.9 * kx, orig(r) * 0.85);
    if (dir > 0) hR = side; else hL = side;
    // as deep as it is ever seen: below the ground line when you are at the hut
    const bottom = Math.ceil(cam.wy(cam.lampFrac * g.h, sc.end + S / 2, 1)) + Math.round(0.4 * S), top = sc.bodyTop, tall = bottom - top;
    const half = Math.ceil(Math.max(hL(tall), hR(tall))) + 4, x0 = Math.floor(cx - half), Wd = 2 * half;
    const crest = new Float32Array(Wd).fill(Infinity), cxi = cx - x0;
    for (let c = 0; c < Wd; c++) {
      const h = c < cxi ? hL : hR, a = Math.abs(c + 0.5 - cxi);
      if (h(tall) < a) continue;
      let lo = 0, hi = tall; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (h(m) >= a) hi = m; else lo = m; }
      crest[c] = top + hi + (n.fbm(c * 0.21 + 1, 3.3, 2) - 0.5) * 4 * Math.min(1, hi / 5);
    }
    // the whole of it, peak and massif, in one grid of cells, painted once
    const X0 = Math.min(0, x0), X1 = Math.max(sc.cols, x0 + Wd), mw = X1 - X0, mh = bottom;
    const cells = new Array(mh), inside = new Array(mh);
    for (let r = 0; r < mh; r++) { cells[r] = new Array(mw).fill(null); inside[r] = new Uint8Array(mw); }
    for (let r = 0; r <= sc.seamRow + sc.blend && r < mh; r++) {
      const span = sc.peakSpan[r]; if (span && r < sc.bodyTop) for (let X = span[0]; X < span[1]; X++) inside[r][X - X0] = 1;
      for (let X = 0; X < sc.cols; X++) { const cell = w.cells[r]?.[X]; if (cell) cells[r][X - X0] = cell; }
    }
    // rock and snow below the seam, lit as the peak is: ribs fan down from it, lit on their left, shaded on their right
    const wooded = (r) => smooth(D.layout.treeline + 0.05, D.layout.forest, r / S);
    const rockEnd = Math.min(bottom, top + Math.round(1.3 * S));
    const ribRows = [], own = new Map(), [shadow, glint] = M.cast;
    for (let r = top; r < rockEnd; r++) {
      const down = (r - top) / S, hw = sc.seamHalf * (1 + M.spread * down), lastR = ribRows[ribRows.length - 1];
      const row = M.ribs.map(([t, start], k) => ({ t, on: t ? smooth(start, start + 0.3, down) : 1, x: cxi + (t + (n.fbm(r * 0.05, k * 3.7 + 1, 3) - 0.5) * 0.34 * smooth(0, 0.3, down)) * hw }));
      row.half = hw; row.mid = row.find((p) => !p.t).x; ribRows.push(row);
      if (lastR) row.forEach((p, k) => { const c = Math.round(p.x), dc = c - Math.round(lastR[k].x); if (p.on > 0.3) own.set(r * Wd + c, dc < 0 ? '/' : dc > 0 ? '\\' : '|'); });
    }
    const lit = (c, r) => {
      const row = ribRows[r - top], left = c < row.mid; let sun = left ? 1 : 0;
      for (const p of row) { const u = left ? (c - p.x) / (shadow * row.half) : (p.x - c) / (glint * row.half); if (p.t && u >= 0 && u < 1) sun = left ? Math.min(sun, 1 - p.on * Math.min(1, (1 - u) * 2.5)) : Math.max(sun, p.on * (1 - 0.5 * u)); }
      return sun;
    };
    const rock = face({ W: Wd, x0, r0: top, r1: rockEnd, peak: crest, S, P, seed: 8, lift: 0.16, ice: D.layout.ice * S, lit, arete: (r, c) => own.get(r * Wd + c), axis: cx, half: Math.max(20, sc.cols * 0.5) });
    const moss = mixHex(P.pine, P.leafOlive, 0.45), kept = new Set();
    for (const [X, Y] of route) for (let dr = -1; dr <= 1; dr++) for (let dc = -2; dc <= 2; dc++) kept.add((Math.floor(Y) + dr) * mw + Math.floor(X) + dc - X0);
    for (let r = top; r < bottom; r++) {
      const wood = wooded(r), inRock = r < rockEnd;
      for (let c = 0; c < Wd; c++) {
        if (!(crest[c] <= r)) continue;
        const X = x0 + c, i = X - X0; inside[r][i] = 1;
        if (r <= sc.seamRow + sc.blend && cells[r][i] && sc.painted(r, X)) continue;   // through the seam the peak's own painting stands
        if (kept.has(r * mw + i)) { cells[r][i] = null; continue; }
        const depth = r - crest[c];
        let cell = inRock ? rock[r - top][c] : null;
        if (cell && wood > 0.01) cell = [cell[0], cell[1], (cell[2] ?? 1) * (1 - wood)];
        if (wood > 0.5) {
          // the forest, as it is seen from far off: a crown here and there, the crest a line
          const v = hash(X, r, 77);
          if (depth < 1) cell = [edge(crest[c] - Math.floor(crest[c]), (crest[c + 1] - crest[c - 1]) / 2 || 0), moss, 0.9];
          else if (v < 0.07 * wood) cell = ['^', v < 0.035 ? P.pine : P.pineDark, 0.85];
          else if (v < 0.1 * wood) cell = ['&', v < 0.085 ? P.leafOlive : P.leaf, 0.6];
          else if (v < 0.16 * wood) cell = [GRASS[Math.floor(v * 97) % GRASS.length], P.pineDark, 0.5];
        }
        cells[r][i] = cell;
      }
    }
    // the path on the face: faint here; the scene lights the stretch you are on
    route.forEach(([X, Y], k) => { const r = Math.floor(Y), i = Math.floor(X) - X0; if (r >= 0 && r < mh && i >= 0 && i < mw) { cells[r][i] = Y / S < D.layout.ice ? (k % 4 === 0 ? ['+', P.muted, 0.8] : [':', P.muted, 0.5]) : [k % 3 ? '.' : ',', P.muted, 0.6]; inside[r][i] = 1; } });
    const mt = {
      kind: 'mountain', Z: 1, x: X0, y: 0, w: mw, h: mh, uMin: 1, uMax: 32, t0: -Infinity, t1: 0, cells, inside, route: route.map(([X, Y, t]) => [X, Y + 0.6, t]),
      fill: P.sky, alpha: (d) => 1 - 0.32 * smooth(1.5, 9, d), coarse: new Map(),
      solidAt: (X, Y) => { const r = Math.floor(Y), i = Math.floor(X) - X0; return r >= 0 && r < mh && i >= 0 && i < mw && inside[r][i] === 1; },
      paint: (L, c0, i0, c1, i1, ox, oy) => this.paintGrid(mt, L, c0, i0, c1, i1, ox, oy),
    };
    return cam.pane(mt);
  }

  // A grid of cells, at any level: at its own cells as it is, and coarser by keeping, of every block of cells, the one that stands out most.
  paintGrid(p, L, c0, i0, c1, i1, ox, oy) {
    const g = this.sc.grid, u = L.u, { cw, ch, font } = L, snow = this.sc.P.snow;
    let G = p.coarse.get(u);
    if (!G) {
      if (u === 1) G = { cells: p.cells, inside: p.inside };
      else {
        const rows = Math.ceil(p.h / u), cols = Math.ceil(p.w / u), cells = new Array(rows), inside = new Array(rows);
        for (let i = 0; i < rows; i++) {
          cells[i] = new Array(cols).fill(null); inside[i] = new Uint8Array(cols);
          for (let c = 0; c < cols; c++) {
            let best = null, wb = 0, n = 0;
            for (let r = i * u; r < Math.min(p.h, (i + 1) * u); r++) for (let x = c * u; x < Math.min(p.w, (c + 1) * u); x++) {
              if (p.inside[r][x]) n++;
              const cell = p.cells[r][x]; if (!cell) continue;
              const wv = (WEIGHT[cell[0]] ?? 2) * (cell[2] ?? 1) * (cell[1] === snow ? 1.3 : 1);
              if (wv > wb) { wb = wv; best = cell; }
            }
            cells[i][c] = best; inside[i][c] = n * 2 >= u * u ? 1 : 0;
          }
        }
        G = { cells, inside };
      }
      p.coarse.set(u, G);
    }
    for (let i = i0; i <= i1; i++) {
      const ins = G.inside[i], row = G.cells[i]; if (!ins) continue;
      let a = -1;
      for (let c = c0; c <= c1 + 1; c++) { const on = c <= c1 && ins[c]; if (on && a < 0) a = c; else if (!on && a >= 0) { g.box(ox + a * cw - 0.5, oy + i * ch - 0.5, (c - a) * cw + 1, ch + 1, p.fill); a = -1; } }
      for (let c = c0; c <= c1; c++) { const cell = row[c]; if (cell) g.set(cell[0], cell[1], ox + c * cw, oy + i * ch, font, cell[2] ?? 1); }
    }
  }

  // ---------- a terrace ----------
  makeSlice({ t0, t1, landing, departing, valley, index }) {
    const sc = this.sc, cam = sc.cam, g = sc.grid, S = sc.screenRows, P = sc.P, M = D.massif, n = sc.noise, kx = this.kx, Y = D.layout;
    const rnd = mulberry32(500 + index * 31), seed = 100 + index * 13;
    const Z = cam.path(t0)[2] + M.near;
    const route = this.locus(t0, t1, Z);
    const [XS, YS] = route[0], [XE, YE] = route[route.length - 1], wdir = Math.sign(XE - XS) || 1;
    const slope = valley ? 0 : clamp((YE - YS) / Math.max(1, Math.abs(XE - XS)), 0.05, 1.6);
    // deep enough to reach the bottom of the screen while it is the nearest thing there
    const bottom = Math.ceil(cam.wy(g.h, t0 + 0.15 * S, Z)) + 6;
    // its crest: along the path, and beyond it at either end
    const xMin = Math.min(XS, XE), xMax = Math.max(XS, XE);
    const cliff = M.cliff, E1 = (5 + rnd() * 6) * kx, E2 = (8 + rnd() * 10) * kx;
    const beyond = (X) => {
      if (valley) return Math.min(YS, YE) - 0.6 + (n.fbm(X * 0.07 + seed, 2.1, 2) - 0.5) * 1.6;
      const back = (X - XS) * -wdir, fwd = (X - XE) * wdir;
      if (back > 0) return landing ? YS - 0.6 + cliff * back : YS - 0.6 - slope * back + (slope + 0.4) * back * back / (2 * E1) + (n.fbm(X * 0.15 + seed, 1.3, 2) - 0.5) * 1.5 * Math.min(1, back / 4);
      if (fwd > 0) return departing ? YE - 0.6 + cliff * fwd : YE - 0.6 + slope * fwd + 0.6 * fwd * fwd / (2 * E2) + (n.fbm(X * 0.15 + seed, 4.7, 2) - 0.5) * 1.5 * Math.min(1, fwd / 4);
      return Infinity;
    };
    // it reaches out to either side until its crest has gone down past its foot
    let a = Math.floor(xMin), b = Math.ceil(xMax);
    while (beyond(a - 1) < bottom && xMin - a < 900) a--;
    while (beyond(b + 1) < bottom && b - xMax < 900) b++;
    if (valley) { a = Math.min(a, Math.floor(cam.wx(0, t1, Z)) - 40); b = Math.max(b, Math.ceil(cam.wx(g.w, t1, Z)) + 40); }
    const x0 = a - 2, w = b - a + 5, crest = new Float32Array(w + 2).fill(Infinity);
    // along the path the crest is the path itself: of the path's points over each column, the highest
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1], [bx, by] = route[i];
      for (let X = Math.ceil(Math.min(ax, bx)); X <= Math.floor(Math.max(ax, bx)); X++) {
        const t = bx === ax ? 0 : (X - ax) / (bx - ax), c = X - x0;
        if (c >= 0 && c <= w + 1) crest[c] = Math.min(crest[c], ay + (by - ay) * t - 0.6);
      }
    }
    for (let c = 0; c <= w + 1; c++) if (!Number.isFinite(crest[c])) { const X = x0 + c; crest[c] = X >= xMin && X <= xMax ? (crest[c - 1] ?? YS) : beyond(X); }
    const cAt = (X) => { const f = X - x0, i = Math.floor(f); if (i < 0 || i > w) return Infinity; return crest[i] + (crest[i + 1] - crest[i]) * (f - i); };
    let top = Infinity; for (const v of crest) if (v < top) top = v;
    const y0 = Math.floor(top - M.tall.birch * 1.6 * 1.35 - 2), h = bottom - y0;
    const fill = mixHex(P.sky, valley ? P.groundDark : P.pineDark, valley ? 0.12 : 0.07);

    // ---------- its trees, in the world: where each stands, how tall, what it is ----------
    const trees = [], at = t0 / S;
    const pines = 1 - 0.96 * smooth(Y.forest - 0.5, Y.ground - 0.8, at), dens = smooth(Y.treeline - 0.1, Y.forest + 0.2, at);
    const snow = at < Y.forest - 0.15 ? 2 : at < Y.forest + 0.3 ? 1.5 : at < Y.forest + 0.95 ? 0.6 : 0;
    const onPath = (X) => X >= xMin - 2 && X <= xMax + 2;
    const clear = (X, Yt) => {   // nothing may stand over the path, nor in the air a bridge crosses
      if (onPath(X) && Yt < cAt(X) + 0.6) return false;
      if (landing && (X - XS) * -wdir > -3 && (X - XS) * -wdir < 14 * kx && Yt < cAt(X) + 3) return false;
      if (departing && (X - XE) * wdir > -3 && (X - XE) * wdir < 14 * kx && Yt < cAt(X) + 3) return false;
      return true;
    };
    const kindAt = () => rnd() < pines ? 'pine' : rnd() < 0.42 ? 'birch' : 'leafy';
    // further down a face is nearer you: a tree there stands taller, the more so on the valley floor, which comes right up to you
    const plant = (X, Yf, kind) => {
      const tall = M.tall[kind] * (0.75 + 0.45 * rnd()) * (rnd() < 0.06 ? 1.45 : 1) * (1 + (valley ? 1.3 : 0.35) * smooth(2, valley ? 50 : 40, Yf - cAt(X))), wd = tree(kind, tall, mulberry32(7)).rows[0].length;
      for (const dx of [-wd / 2, 0, wd / 2]) if (!clear(X + dx, Yf - tall)) return;
      for (const o of trees) if (Math.abs(o.Y - Yf) < 0.45 * Math.max(tall, o.h) && Math.abs(o.X - X) < 0.42 * (wd + o.wd)) return;
      trees.push({ X, Y: Yf, h: tall, wd, kind, seed: Math.floor(rnd() * 1e9), dark: rnd() < 0.5, olive: rnd() < 0.5, snow: kind === 'pine' ? snow * (0.6 + 0.4 * rnd()) : 0 });
    };
    if (!valley) {
      // a line along the crest beyond the path, so the outline is trees
      for (let X = a + rnd() * 3; X < b; X += (3 + rnd() * 3)) { if (onPath(X) || rnd() > dens * 1.1) continue; plant(X, cAt(X) + 0.6, kindAt()); }
      // ranks down the face, thinning into the dark
      for (let dy = 3; dy < 48; dy += 2.6) for (let X = a + rnd() * 4; X < b; X += (4 + rnd() * 4)) {
        const c = cAt(X); if (!Number.isFinite(c) || c + dy > bottom - 1 || rnd() > dens * (1 - 0.6 * smooth(8, 40, dy))) continue;
        plant(X, c + dy, kindAt());
      }
    } else {
      // the valley: trees about the hut, none in front of it, and the forest going on in front of you
      const any = () => rnd() < 0.12 ? 'pine' : rnd() < 0.45 ? 'birch' : 'leafy';
      for (let X = a + rnd() * 5; X < b; X += (5 + rnd() * 7)) { if (X > XE - 14 && X < XE + 26) continue; if (rnd() < 0.55) plant(X, cAt(X) + 0.6 + rnd() * 1.2, any()); }
      for (let dy = 6; dy < bottom - cAt(XE); dy += 3.2) for (let X = a + rnd() * 6; X < b; X += (6 + rnd() * 7)) { if (Math.abs(X - XE - 6) < 16 && dy < 14) continue; if (rnd() < 0.5 * smooth(4, 14, dy)) plant(X, cAt(X) + dy, any()); }
    }
    trees.sort((p, q) => p.Y - q.Y);   // further up the face first, so the nearer ones are drawn over them
    trees.forEach((t, i) => { t.id = (index + 1) * 10000 + i; });

    const sh = {
      kind: valley ? 'valley' : 'slice', cover: true, Z, x: x0, y: y0, w, h, uMin: 0.5, uMax: 1, t0, t1, route, crest, cAt, trees, fill, landing, departing, wdir, seed,
      alpha: valley ? (d) => smooth(M.close[0], M.close[1], d) : (d) => smooth(M.close[0], M.close[1], d) * (1 - smooth(M.fade[0], M.fade[1], d)),
      solidAt: (X, Yw) => Yw >= cAt(X) && Yw < y0 + h,
      // is a stretch of it nothing but its fill: deeper under the crest than anything drawn on it
      plain: (u, X0, Y0, X1, Y1) => {
        const deep = valley ? 62 : 28;
        for (let X = X0; X <= X1 + 1e-6; X += Math.min(1, u)) if (!(cAt(Math.min(X, X1)) + deep < Y0)) return null;
        for (const t of trees) if (t.X + t.wd > X0 && t.X - t.wd < X1 && t.Y + 1 > Y0 && t.Y - t.h < Y1) return null;
        if (sh.hutAt && sh.hutAt[0] < X1 + 2 && sh.hutAt[0] + 30 > X0 && sh.hutAt[1] + 2 > Y0) return null;
        return fill;
      },
      paint: (L, c0, i0, c1, i1, ox, oy) => this.paintSlice(sh, L, c0, i0, c1, i1, ox, oy),
      shapes: new Map(), pathX: [xMin, xMax],
    };
    if (valley) sh.hut = this.makeHut(sh, XE, cAt(XE));
    return cam.pane(sh);
  }

  // the hut: where it stands, its window, its chimney
  makeHut(sh, XE, Yg) {
    const sc = this.sc, hut = D.glyphs.hut, left = XE + 1.5;
    sh.hutAt = [left, Yg + 0.6];
    const window = [left + hut[4].indexOf('[') + 1, Yg + 0.6 - (hut.length - 4) + 0.5], chimney = [left + hut[0].indexOf(',') + 0.5, Yg + 0.6 - hut.length];
    return {
      Z: sh.Z, sheet: sh, door: [XE, Yg], window, chimney,
      at(X, Yw) { const cam = sc.cam; return [cam.px(X, sh.Z), cam.py(Yw, sh.Z)]; },
      get k() { return sc.cam.size(sh.Z); },
      get showing() { return sc.cam.dist(sh.Z) > 0.05 && sc.cam.py(Yg - 8, sh.Z) < sc.grid.h; },
      // smoke from the chimney
      draw() {
        if (!this.showing || sc.reduced.matches) return;
        const g = sc.grid, u = g.size * this.k, [x, y] = this.at(...chimney);
        for (let i = 0; i < 4; i++) {
          const t = (sc.time * 0.22 + i / 4) % 1;
          g.ink(t < 0.3 ? '.' : t < 0.65 ? 'o' : 'O', sc.P.dim, x + (Math.sin(t * 5 + i) * 0.5 + t * 1.6) * u, y - t * 3.4 * u, u * (0.6 + t * 0.9), 0.75 * (1 - t) ** 1.2);
        }
      },
    };
  }

  // A terrace at one level: what it covers, the ground's wash, its crest,
  // its ground cover, its trees, its path. Cell (c, i) is u world columns
  // and rows from its top left.
  paintSlice(sh, L, c0, i0, c1, i1, ox, oy) {
    const sc = this.sc, g = sc.grid, P = sc.P, { u, cw, ch, font } = L, { x, y, cAt, fill } = sh, valley = sh.kind === 'valley';
    const crestC = new Float32Array(c1 - c0 + 3);
    for (let c = c0 - 1; c <= c1 + 1; c++) crestC[c - c0 + 1] = cAt(x + (c + 0.5) * u);
    const cr = (c) => crestC[c - c0 + 1];
    // what it covers
    let any = false;
    for (let i = i0; i <= i1; i++) {
      const Yc = y + (i + 0.5) * u; let a = -1;
      for (let c = c0; c <= c1 + 1; c++) { const on = c <= c1 && cr(c) <= Yc; if (on && a < 0) a = c; else if (!on && a >= 0) { g.box(ox + a * cw - 0.5, oy + i * ch - 0.5, (c - a) * cw + 1, ch + 1, fill); a = -1; any = true; } }
    }
    // the wash: the ground just under the crest, soft, one pixel a cell, stretched
    const nw = c1 - c0 + 1, nh = i1 - i0 + 1;
    if (any && !valley) {
      const img = new ImageData(nw, nh), px = img.data, tone = [1, 3, 5].map((k) => parseInt(P.pineDark.slice(k, k + 2), 16));
      for (let i = i0; i <= i1; i++) for (let c = c0; c <= c1; c++) {
        const depth = y + (i + 0.5) * u - cr(c); if (!(depth >= 0 && depth < 26)) continue;
        const p4 = ((i - i0) * nw + c - c0) * 4; px[p4] = tone[0]; px[p4 + 1] = tone[1]; px[p4 + 2] = tone[2]; px[p4 + 3] = 255 * 0.3 * Math.exp(-depth / 6.5) * Math.min(1, depth / u + 0.3);
      }
      const can = this.scratch || (this.scratch = document.createElement('canvas'));
      if (can.width < nw || can.height < nh) { can.width = Math.max(can.width, nw); can.height = Math.max(can.height, nh); }
      can.getContext('2d').putImageData(img, 0, 0);
      g.ctx.globalAlpha = g.alpha = 1; g.ctx.imageSmoothingEnabled = true;
      g.ctx.drawImage(can, 0, 0, nw, nh, ox + c0 * cw, oy + i0 * ch, nw * cw, nh * ch); g.mark(ox + c0 * cw, oy + i0 * ch, nw * cw, nh * ch);
    }
    // the hut's walls hide what is behind them
    const hut = D.glyphs.hut;
    if (valley && sh.hutAt) {
      const [hl, hg] = sh.hutAt, bx = ox + (hl - x) / u * cw, by = oy + (hg - y) / u * ch - hut.length * ch / u;
      hut.forEach((ln, i) => {
        const a = ln.indexOf('/') >= 0 ? ln.indexOf('/') : ln.indexOf('|'), b = Math.max(ln.lastIndexOf('\\'), ln.lastIndexOf('|'));
        if (a >= 0 && b > a) { g.box(bx + a * cw / u, by + i * ch / u, (b - a + 1) * cw / u, ch / u + 0.5, fill); any = true; }
      });
    }
    if (!any) return;
    const moss = mixHex(P.pine, P.leafOlive, 0.45), [pa, pb] = sh.pathX, onPath = (X) => X >= pa - 1 && X <= pb + 1;
    // the crest as a line, and ground cover under it
    for (let c = c0; c <= c1; c++) {
      const X = x + (c + 0.5) * u, k = cr(c); if (!Number.isFinite(k)) continue;
      const i = Math.floor((k - y) / u);
      if (i >= i0 && i <= i1 && !(onPath(X) && !valley)) {
        const slope = (cr(c + 1) - cr(c - 1)) / (2 * u);
        if (valley) { const v = hash(Math.floor(X / u), 1, 21); g.set(v < 0.46 ? '_' : v < 0.6 ? '.' : v < 0.74 ? ',' : v < 0.86 ? '-' : '~', v < 0.6 ? P.ground : v < 0.8 ? P.leaf : P.leafOlive, ox + c * cw, oy + i * ch, font, 1); }
        else g.set(edge((k - y) / u - i, Number.isFinite(slope) ? slope : 0), slope < 0.05 ? moss : P.pine, ox + c * cw, oy + i * ch, font, 0.95);
      }
      const deep = Math.ceil((valley ? 60 : 11) / u);
      for (let ii = Math.max(i0, i + 1); ii <= Math.min(i1, i + deep); ii++) {
        const depth = y + (ii + 0.5) * u - k, v = hash(c, ii, 31 + u * 8);
        if (valley) {
          // under the ground: soil, and roots hanging from the turf, going into the dark
          const f = 1 - 0.85 * smooth(0, 12, depth), Xi = Math.floor(X), root = hash(Xi, 6, 21) < 0.3 && depth < 1.5 + hash(Xi, 7, 21) * 6;
          if (root) g.set(depth < 1.5 ? '|' : hash(Xi, Math.floor(depth), 9) < 0.5 ? '\\' : '/', P.ground, ox + c * cw, oy + ii * ch, font, 0.7 * f);
          else if (v < 0.08 * f) g.set(v < 0.03 ? '.' : v < 0.05 ? ',' : ':', P.ground, ox + c * cw, oy + ii * ch, font, 0.45 * f);
          else if (v > 0.86 && depth > 6) g.set(GRASS[Math.floor(v * 97) % GRASS.length], v > 0.95 ? P.leaf : P.pineDark, ox + c * cw, oy + ii * ch, font, 0.6);
        } else if (v < 0.3 * u * u * (1 - depth / 11)) g.set(GRASS[Math.floor(v * 97) % GRASS.length], depth < 3 ? P.pine : P.pineDark, ox + c * cw, oy + ii * ch, font, 0.85 - depth * 0.05);
      }
    }
    // trees: each its own drawing, as many characters tall as it is at this level; its body shaded so you do not see through it
    for (const t of sh.trees) {
      const fi = (t.Y - y) / u, fc = (t.X - x) / u, hc = t.h / u;
      if (fi < i0 - 1 || fi - hc > i1 + 1 || fc + t.wd / u < c0 - 1 || fc - t.wd / u > c1 + 1) continue;
      const key = t.id * 64 + u * 8; let shape = sh.shapes.get(key); if (!shape) { shape = this.treeShape(t, u); sh.shapes.set(key, shape); }
      const left = ox + (fc - shape.w / 2) * cw, foot = oy + (Math.floor(fi) + 1) * ch;
      shape.rows.forEach((row, j) => {
        if (row.e < row.f) return;
        const ty = foot - (shape.h - j) * ch;
        g.box(left + (row.f + 0.1) * cw, ty - 0.3, (row.e - row.f + 0.8) * cw, ch + 0.6, shape.body);
        for (const [col, glyph, color, a] of row.marks) g.set(glyph, color, left + col * cw, ty, font, a);
      });
    }
    // the path
    const every = Math.max(1, Math.round(1 / u));
    sh.route.forEach(([X, Yw], k) => {
      if (k % every) return;
      const c = Math.floor((X - x) / u), i = Math.floor((Yw - 0.6 - y) / u + 0.5); if (c < c0 || c > c1 || i < i0 || i > i1) return;
      const n = Math.floor(k / every);
      g.set(n % 7 === 3 ? '=' : n % 2 ? ':' : '.', P.muted, ox + c * cw, oy + i * ch, font, n % 7 === 3 ? 0.6 : 0.68);
    });
    // the hut on the valley floor
    if (valley && sh.hutAt) {
      const [hl, hg] = sh.hutAt, timber = mixHex(P.leaf, P.snow, 0.25), hf = font / u, hcw = cw / u, hch = ch / u;
      const bx = ox + (hl - x) / u * cw, by = oy + (hg - y) / u * ch - hut.length * hch;
      hut.forEach((ln, i) => { for (let j = 0; j < ln.length; j++) if (ln[j] !== ' ') g.set(ln[j], ln[j] === '[' || ln[j] === ']' ? P.ember : timber, bx + j * hcw, by + i * hch, hf, 1); });
    }
  }

  // a tree's drawing at a level: rows of marks, and where in each row its body is
  treeShape(t, u) {
    const P = this.sc.P, { rows: shape, stem } = tree(t.kind, t.h / u, mulberry32(t.seed)), h = shape.length, w = shape[0].length;
    const snowy = Math.ceil(h * 0.22 * t.snow);
    const rows = shape.map((ln, i) => {
      let f = 0, e = w - 1; while (f < w && ln[f] === ' ') f++; while (e >= 0 && ln[e] === ' ') e--;
      const marks = [], foot = i >= h - stem;
      for (let j = f; j <= e; j++) {
        const ch = ln[j];
        // inside its outline a tree is needles and leaves, not air
        if (ch === ' ') { const v = hash(j, i, t.seed % 997); if (v < (t.kind === 'pine' ? 0.5 : 0.3) && !foot) marks.push([j, v < 0.18 ? ':' : v < 0.34 ? "'" : '.', t.kind === 'pine' ? P.pineDark : t.kind === 'birch' ? P.birchLeaf : t.olive ? P.leafOlive : P.leaf, 0.45]); continue; }
        const shade = t.dark || j > (w - 1) / 2 + 0.6;
        if (t.kind === 'pine') marks.push([j, ch, !foot && (i < snowy || (i === snowy && snowy > 1 && j === f)) ? P.snow : foot || shade ? P.pineDark : P.pine, 1]);
        else if (t.kind === 'birch') { const bark = ch === '|' || ch === '!'; marks.push([j, ch, bark ? P.birch : P.birchLeaf, bark ? 0.92 : shade ? 0.62 : 0.95]); }
        else marks.push([j, ch, foot ? P.ground : t.olive ? P.leafOlive : P.leaf, !foot && shade ? 0.62 : 1]);
      }
      return { f, e, marks };
    });
    // its body: darker than the sky behind it, so you never see through it
    const body = mixHex(P.sky, t.kind === 'pine' ? P.pineDark : t.kind === 'birch' ? P.pineDark : P.ground, t.kind === 'pine' ? 0.45 : 0.3);
    return { rows, h, w, body };
  }

  // ---------- each frame ----------
  // what to draw, for the camera to put in order: the mountain, the terraces still in sight, the bridges, the lamps
  items() {
    const cam = this.sc.cam, out = [];
    for (const sh of this.sheets) { const d = cam.dist(sh.Z); if (d > 0.05 && (!sh.alpha || sh.alpha(d) > 0.01)) out.push(sh); }
    for (const b of this.bridges) {
      const da = cam.dist(b.from.Z), db = cam.dist(b.to.Z);
      if (db > 0.05) out.push({ d: db + Math.min(1e-3, (da - db) / 2), draw: () => this.drawBridge(b) });
    }
    for (const m of this.lamps) out.push({ d: cam.dist(m.sh.Z) - 2e-3, draw: () => this.drawLamp(m) });
    return out;
  }
  // a bridge as it shows now: its planks in pixels and the size of each
  span(b) {
    const cam = this.sc.cam, g = this.sc.grid;
    if (b.pts.some(([, , Z]) => cam.dist(Z) < 0.05)) return null;
    const pts = b.pts.map(([X, Y, Z]) => [cam.px(X, Z), cam.py(Y, Z), g.size * Math.min(cam.k(Z), MOST)]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (Math.max(...ys) < -60 || Math.min(...ys) > g.h + 60 || Math.max(...xs) < -60 || Math.min(...xs) > g.w + 60) return null;
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const u = pts.reduce((s, p) => s + p[2], 0) / pts.length, n = Math.max(3, Math.round(len / (u * 0.62))), out = [];
    for (let k = 0; k <= n; k++) {
      const f = k / n * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i, p = pts[i], q = pts[i + 1];
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
    return out;
  }
  // A rope bridge: a sagging deck of planks, a hand rope over it, a post at
  // either end. Nothing is behind its planks: you see between them.
  drawBridge(b) {
    const sc = this.sc, cam = sc.cam, g = sc.grid, P = sc.P, wood = mixHex(P.ground, P.rockLight, 0.45), pts = this.span(b); if (!pts) return;
    const a = smooth(0.5, 0.72, cam.dist(b.to.Z)); if (a < 0.02) return;   // a bridge still under you, in the foreground, is not drawn: it would only be a streak
    pts.forEach(([x, y, u], k) => {
      g.ink('=', wood, x, y, u * 0.95, a);
      g.ink('·', P.muted, x, y - u * 0.95, u, 0.85 * a);
      if (k % 3 === 1) g.ink(':', P.muted, x, y - u * 0.48, u * 0.7, 0.6 * a);
    });
    for (const [x, y, u] of [pts[0], pts[pts.length - 1]]) g.ink('|', wood, x, y - u * 0.5, u * 1.35, a);
  }
  drawLamp(m) {
    const sc = this.sc, cam = sc.cam, x = cam.px(m.X, m.sh.Z), y = cam.py(m.Y, m.sh.Z);
    if (y < -10 || y > sc.grid.h + 10) return;
    const pulse = sc.reduced.matches ? 1 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(sc.time * 3.1 + m.phase));
    sc.grid.ink('o', sc.P.ember, x, y, sc.grid.size * cam.size(m.sh.Z), pulse);
  }

  // is a pixel hidden by something nearer than the sheet at `index`
  hidden(x, y, index) { const sh = this.sheets[index] ?? this.mountain, cam = this.sc.cam; return cam.covered(x, y, cam.dist(sh.Z)); }

  // The route's marks within `reach` pixels of the light at (x, y), each as
  // [left, top, glyph, size, whether it is placed by its middle], for the
  // scene to light.
  light(x, y, reach) {
    const sc = this.sc, cam = sc.cam, g = sc.grid, near = [], s = cam.s, win = 0.45 * sc.screenRows;
    for (const sh of this.sheets) {
      if (sh.t1 < s - win || sh.t0 > s + win) continue;
      const k = cam.k(sh.Z); if (!(k > 0)) continue;
      const size = g.size * Math.min(k, MOST), d = cam.dist(sh.Z), every = Math.max(1, Math.round(1 / Math.max(k, 0.3) / 1.2));
      sh.route.forEach(([X, Yw, t], i) => {
        if (Math.abs(t - s) > win || i % every) return;
        const px = cam.px(X, sh.Z), py = cam.py(Yw - 0.6, sh.Z) - size * 0.55;
        if (Math.hypot(px - x, py - y) > reach || cam.covered(px + size * 0.3, py + size * 0.5, d)) return;
        const n = Math.floor(i / every);
        near.push([px - size * 0.3, py, sh.kind === 'mountain' ? (n % 4 === 0 ? '+' : ':') : n % 7 === 3 ? '=' : n % 2 ? ':' : '.', size, false]);
      });
    }
    for (const b of this.bridges) {
      const pts = this.span(b); if (!pts) continue;
      for (const [px, py, u] of pts) if (Math.hypot(px - x, py - y) <= reach) near.push([px, py, '=', u * 0.95, true], [px, py - u * 0.95, '·', u, true]);
    }
    return near;
  }

  // One tree as it stands now: its foot and its top on the screen; size:
  // the size of type where it stands, which is what a creature at it takes;
  // and whether its crown can be seen, with nothing nearer over it.
  stand(sh, t) {
    const cam = this.sc.cam, k = cam.k(sh.Z), x = cam.px(t.X, sh.Z), y = cam.py(t.Y + 0.5, sh.Z), top = cam.py(t.Y - t.h + 0.5, sh.Z);
    return { id: t.id, x, y, top, bole: y - (y - top) * 0.3, near: k, size: Math.min(k, MOST), kind: t.kind, sheet: sh.index, row: sh.t0, seen: !cam.covered(x, top + (y - top) * 0.15, cam.dist(sh.Z)) && (!sh.alpha || sh.alpha(1 / k) > 0.6) };
  }
  // where a tree's foot and top will be on the screen when the middle of the screen is at row s
  later(id, s) {
    const sh = this.slices[Math.floor(id / 10000) - 1], t = sh?.trees[id % 10000]; if (!t) return [NaN, NaN];
    const cam = this.sc.cam, g = this.sc.grid, [cx, cy, cz] = cam.path(s), k = 1 / Math.max(0.02, sh.Z - cz);
    return [g.w / 2 + (t.X - cx - cam.mid) * g.cellW * k, cam.h0 * g.h + (t.Y - t.h + 0.5 - cy) * g.cellH * k];
  }
  tree(id) { const sh = this.slices[Math.floor(id / 10000) - 1], t = sh?.trees[id % 10000]; return t ? this.stand(sh, t) : null; }
  // trees something could sit on: those on the screen or about to be, that can be seen
  perches() {
    const cam = this.sc.cam, g = this.sc.grid, out = [];
    for (const sh of this.slices) {
      const d = cam.dist(sh.Z); if (!(d > 0.25 && d < 2.2)) continue;
      for (const t of sh.trees) {
        const x = cam.px(t.X, sh.Z), y = cam.py(t.Y, sh.Z);
        if (y < -g.h * 0.4 || y > g.h * 1.5 || x < -g.w * 0.3 || x > g.w * 1.3) continue;
        const q = this.stand(sh, t); if (q.seen) out.push(q);
      }
    }
    return out;
  }
  // a tree on the terrace you are on at scroll row s, a little off the path: the one nearest the middle of the screen then
  roost(s) {
    const cam = this.sc.cam, g = this.sc.grid, sh = this.slices.find((x) => x.t0 <= s && s <= x.t1); if (!sh) return null;
    const [cx, , cz] = cam.path(s), k = 1 / (sh.Z - cz);
    let best = null, least = Infinity;
    for (const t of sh.trees) { const off = Math.abs((t.X - cx - cam.mid) * g.cellW * k); if (off < least && off > 30) { least = off; best = t; } }
    return best ? best.id : null;
  }

  // lamps on the route's upper stretch, one for every merged commit
  setLamps(n) {
    const S = this.sc.screenRows, pts = [];
    for (const sh of this.sheets) for (const [X, Y, t] of sh.route) if (t > 4.7 * S && t < 6.4 * S) pts.push([sh, X, Y]);
    this.lamps = [];
    for (let i = 0; i < n && pts.length; i++) { const [sh, X, Y] = pts[Math.floor((i + 0.5) / n * pts.length)]; this.lamps.push({ sh, X, Y: Y - 1.1, phase: i * 2.4 }); }
  }
}
