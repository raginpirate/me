// The mountain below the peak: sheets in the camera's world.
//
// The body is the mountain the peak stands on. It is on the page's own
// plane, painted by the hand that painted the peak, and under the clouds it
// spreads. In front of it, lower down, stand wooded ridges, one after
// another, each nearer than the last: each is set in type one pixel larger
// than the one before, and that is its depth. Nothing changes size as you
// scroll. A nearer sheet is larger and passes faster, and that is all.
// Each is a pane of the camera's: painted once, then only moved.
//
// The route is the camera's own track. The light you carry stays at one
// height on the screen, and the trail is whatever passes under it: on each
// sheet in turn, from where it lands on it to where a bridge leaves for
// the next. So a bridge is as long as it is, from wherever you see it.

import { clamp, smooth, mulberry32, edge, mixHex } from './util.js';
import { D } from './direction.js';
import { face } from './world.js';
import { Ground } from './ground.js';

// straight runs between points [[x, y], ...]
const line = (pts) => (x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
// the long ridges are no two alike: [the side you come from, the side you go down, level top, how fast it widens, how wide]
const FORMS = [[1.0, 2.0, 2, 0.62, 3.1], [1.4, 2.3, 8, 0.6, 4.0], [0.9, 2.6, 3, 0.66, 3.5], [1.2, 2.0, 5, 0.6, 3.8]];

export class Massif {
  constructor(sc) {
    this.sc = sc;
    const g = sc.grid, cam = sc.cam, S = sc.screenRows, L = D.layout, M = D.massif, P = sc.P, still = sc.reduced.matches;
    const kx = this.kx = Math.min(sc.cols, 170) / 60, rnd = mulberry32(3);
    const rest = D.rest[sc.stack ? 'stack' : 'side'] * S;          // the light is this many rows above the middle of the screen
    this.lampY = g.h / 2 - rest * g.cellH;
    const depth = (n) => still ? 1 : (g.size + n) / g.size;        // sheet n is set in type n pixels larger than the page's
    const last = sc.end + S / 2, gap = M.gap;                      // the camera's last row; rows of travel a bridge spans

    // The ridges: the camera's row when you step onto each. One at the
    // treeline; one for each stop, a little before its waypoint; one behind
    // the hut; and between those enough that none is longer than a stride.
    const marked = sc.stops.filter((s) => s.mark && s.mark !== 'hut'), at = (s) => s.snap + S / 2;
    const behind = (n) => last - Math.max(0.27 * S - rest, 0.2 * S) / depth(n);
    const anchors = [{ y: (L.treeline - 0.05) * S + rest }, ...marked.filter((s) => s.at > L.ice).map((s) => ({ y: at(s) - 0.12 * S, stop: s })), { y: behind(7) }];
    const sparse = (anchors.find((a) => a.stop && a.stop.id === M.sparse)?.y ?? Infinity) - 1;
    const tops = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i], b = anchors[i + 1], n = Math.max(1, Math.round((b.y - a.y) / (M.stride[a.y < sparse ? 0 : 1] * S)));
      for (let k = 0; k < n; k++) tops.push(k ? { y: a.y + (b.y - a.y) * k / n } : a);
    }
    tops.push(anchors[anchors.length - 1]);
    tops[tops.length - 1].y = behind(tops.length);

    // the ground is the nearest thing there is
    const ground = sc.ground = new Ground(sc, depth(tops.length + 1));
    cam.look(last);
    const door = ground.at(...ground.door);

    // The trail: where across the screen the light is, for every place the
    // camera can be. It is the rope's line on the peak, it is at each
    // stop's waypoint when that stop's card is open, and at the hut's door
    // at the end. Between those it eases over, with a swing or two on a
    // long stretch. Where it steps from one sheet to the next it goes
    // quickly sideways, the way it was already going: that is the bridge.
    // A knot is [the camera's row, pixels across, straight from the last one?, swings on the way].
    const knots = this.knots = [[sc.summitRow + 2 + rest, (sc.world.topCol + 1.5) * g.cellW], [sc.bodyTop + rest, (Math.floor(sc.ax + 0.5) + 0.5) * g.cellW, true], ...marked.map((s) => [at(s), (s.hx + 0.5) * g.cellW]), [last, door[0]]];
    tops.forEach((t, i) => {
      const mid = this.trail(t.y - gap / 2), dir = this.trail(t.y + 0.25 * S) >= this.trail(t.y - 0.25 * S) ? 1 : -1;
      t.cross = [mid - dir * (t.reach = clamp((5 + rnd() * 3) * kx, 5, 11) * g.cellW * depth(i + 1) / 2), mid + dir * t.reach];
    });
    for (const t of tops) knots.push([t.y - gap, t.cross[0]], [t.y, t.cross[1], true]);
    knots.sort((p, q) => p[0] - q[0]);
    knots.forEach((k, i) => { if (i && !k[2] && k[0] - knots[i - 1][0] > 0.5 * S) k[3] = 2 * Math.round((k[0] - knots[i - 1][0]) / (0.45 * S)); });
    this.swing = 2.2 * kx * g.cellW;

    // ---------- the sheets ----------
    const sheets = this.sheets = [];
    const add = (sh) => {
      sh.index = sheets.length; sh.font = Math.round(g.size * sh.z); sh.cw = g.cellW * sh.z; sh.ch = g.cellH * sh.z; sh.path = []; sh.kept = new Set(); sh.clear = new Set(); sheets.push(sh);
      // it is a pane, and it hides whatever is behind it from its crest down
      sh.pane = cam.pane({ x: sh.x0, y: sh.base, z: sh.z, cols: sh.W, rows: sh.rowsN, paint: (...a) => this.draw(sh, ...a), solid: (c, i) => i < sh.rowsN && sh.peak[c] <= sh.base + i });
      return sh;
    };
    const fillAt = (y) => mixHex(P.sky, P.skyBase, smooth(8.3, 9.7, y / S));

    // The body. Under the clouds each flank goes out and down in steep
    // faces and gentler shoulders, and the two are not alike.
    // [screens below the seam, half-width in the peak's own half-widths]
    const flank = (pts) => { const f = line(pts); return (n) => sc.seamHalf * f(n / S); };
    const coreL = flank([[0, 1], [0.16, 1.2], [0.3, 1.85], [0.66, 2.15], [0.9, 2.95], [1.45, 3.45], [1.95, 4.6], [3, 6.2], [4.6, 9.5], [6, 13]]);
    const coreR = flank([[0, 1], [0.1, 1.45], [0.42, 1.8], [0.58, 2.55], [1.05, 2.95], [1.35, 3.9], [2.2, 4.6], [3, 6], [4.6, 9.5], [6, 13]]);
    const covered = (L.forest + 1.3) * S;                          // the camera's row by which the ridges have covered it
    const bx0 = -6, bW = Math.ceil(cam.wx(g.w, covered)) + 6 - bx0, bRows = Math.ceil(cam.wy(g.h, covered)) - sc.bodyTop + 4;
    add({
      kind: 'body', z: depth(0), x0: bx0, W: bW, cx: sc.ax - bx0, base: sc.bodyTop - 10, rowsN: bRows + 10, deep: bRows, seed: 1, fill: P.sky,
      peak: this.outline({ W: bW, cx: sc.ax - bx0, tall: bRows, hL: coreL, hR: coreR, rag: 4, seed: 1 }).map((v) => v + sc.bodyTop),
      from: sc.bodyTop + rest, to: tops[0].y - gap, stop: marked.find((s) => s.at <= L.ice),
    });

    // The ridges. Each is a hill whose top is a little way on from where
    // the trail lands on it, with a long side going down the way you go.
    let long = 0;
    tops.forEach((t, i) => {
      const z = depth(i + 1), e = t.y, next = tops[i + 1]?.y ?? last, [Ax, Ay] = this.where(e, z);
      const far = e >= sparse, [wl, wr, flat, pow, wide] = far ? FORMS[long++ % FORMS.length] : [1, 1.7 + rnd() * 0.4, 0, 0.62, 3.1];
      const u = Math.round((3 + rnd() * 3) * kx) + Math.round(flat * kx / 2), apex = Math.floor(Ax) + u;   // its top, as a column of the page
      // it must reach as far either side, and as far down, as it is ever seen
      const out = Math.min(last, next + S);
      const left = Math.ceil(apex - cam.wx(0, e - S, z)) + 4, right = Math.ceil(cam.wx(g.w, out, z) - apex) + 4, tall = Math.ceil(cam.wy(g.h, out, z) - Ay) + 6;
      const peak = this.outline({ W: left + right + 1, cx: left, tall, hL: (n) => wl * kx * wide * n ** pow, hR: (n) => wr * kx * wide * n ** pow, flat: flat * kx, rag: 5, seed: 100 + i * 13 });
      // its height is set so that its crest is one row above where the trail lands
      const lift = Math.floor(Ay) - 1 - Math.ceil(peak[left - u]), top = Math.floor(lift + Math.min(...peak));
      add({
        kind: 'ridge', z, x0: apex - left, W: left + right + 1, cx: left, base: top - 12, rowsN: Math.floor(Ay) + tall - top + 12, deep: Math.round(next - e + S * 0.9), seed: 100 + i * 13, fill: fillAt(e),
        peak: peak.map((v) => v + lift), from: e, to: tops[i + 1] ? next - gap : last, stop: t.stop, folds: far,
      });
    });
    this.route = sheets.slice();

    // the route over each sheet, and what it must keep clear
    const ends = [];
    for (const sh of sheets) {
      for (let y = sh.from; y <= sh.to + 1e-6; y++) {
        const [wx, wy] = this.where(y, sh.z), r = Math.floor(wy), c = this.inside(sh, Math.floor(wx) - sh.x0, r), p = sh.path[sh.path.length - 1];
        if (p) for (let x = p[0] + Math.sign(c - p[0]); x !== c; x += Math.sign(c - p[0])) sh.path.push([x, r, y]);
        sh.path.push([c, r, y]);
      }
      if (sh.stop) { const s = sh.stop; sh.mark = this.where(at(s), sh.z, (s.hx + 0.5) * g.cellW, (s.hy - s.snap + 0.5) * g.cellH); s.sheet = sh; }
      ends.push(sh.path[sh.path.length - 1]);
    }
    // from where the trail ends on the last ridge, down to the hut's door
    {
      const sh = sheets[sheets.length - 1], [c0, r0] = sh.path[sh.path.length - 1];
      const cd = Math.floor(cam.wx(door[0], last, sh.z)) - sh.x0, rd = Math.floor(cam.wy(door[1], last, sh.z));
      for (let r = r0 + 1; r <= rd; r++) sh.path.push([this.inside(sh, Math.round(c0 + (cd - c0) * (r - r0) / Math.max(1, rd - r0)), r), r, last]);
    }
    // bridges: from where the trail leaves one sheet to where it lands on the next
    this.bridges = [];
    for (let i = 0; i + 1 < sheets.length; i++) {
      const a = sheets[i], b = sheets[i + 1], [c0, r0] = ends[i], [c1, r1] = b.path[0];
      cam.look(b.from);
      const dir = this.at(b, c1, r1)[0] >= this.at(a, c0, r0)[0] ? 1 : -1;     // which way it runs, as you cross it
      this.bridges.push({ a, b, from: [c0 + 0.5, r0 + 0.5], to: [c1 + 0.5, r1 + 0.5] });
      // a clearing where it lands: no trees on the crest there, so the bridge and the path going on from it are not behind them
      for (let dr = -8; dr <= 1; dr++) for (let dc = -13; dc <= 3; dc++) b.clear.add((r1 + dr) * b.W + c1 + dc * dir);
    }
    for (const sh of sheets) for (const [c, r] of sh.path) for (let dr = -1; dr <= 1; dr++) for (let dc = -2; dc <= 2; dc++) sh.kept.add((r + dr) * sh.W + c + dc);
    cam.look(sc.centreRow || 0);
    this.lamps = [];
  }

  // where across the screen the light is when the camera is at row y
  trail(y) {
    const k = this.knots;
    if (y <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (y <= k[i][0]) {
      const [y0, x0] = k[i - 1], [y1, x1, straight, swings] = k[i], t = (y - y0) / (y1 - y0);
      return straight ? x0 + (x1 - x0) * t : x0 + (x1 - x0) * smooth(0, 1, t) + (swings ? Math.sin(t * Math.PI) * Math.sin(t * Math.PI * swings) * this.swing : 0);
    }
    return k[k.length - 1][1];
  }
  // the place on a sheet of depth z that is under the light (or under another pixel) when the camera is at row y
  where(y, z, px = this.trail(y), py = this.lampY) { const cam = this.sc.cam; return [cam.wx(px, y, z), cam.wy(py, y, z)]; }

  // An outline: for every column, how many rows below its top the crest is.
  // hL, hR: how far out each side has got by n rows down; flat: a level top.
  outline({ W, cx, tall, hL, hR, flat = 0, rag, seed }) {
    const n = this.sc.noise, peak = new Float32Array(W).fill(Infinity);
    for (let c = 0; c < W; c++) {
      const h = c < cx ? hL : hR, a = Math.max(0, Math.abs(c - cx) - flat); if (h(tall) < a) continue;
      let lo = 0, hi = tall;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (h(m) >= a) hi = m; else lo = m; }
      peak[c] = hi + (n.fbm(c * 0.21 + seed, 3.3, 2) - 0.5) * rag * Math.min(1, hi / 5);
    }
    return peak;
  }
  // the nearest column to c that is inside a sheet at row r
  inside(sh, c, r) { c = clamp(c, 1, sh.W - 2); for (let i = 0; i < sh.W && !(sh.peak[c] <= r - 1); i++) c += c < sh.cx ? 1 : -1; return c; }

  // ---------- painting a sheet: done once, the first time it is needed ----------
  paint(sh) {
    const sc = this.sc, g = sc.grid, S = sc.screenRows, P = sc.P, n = sc.noise, rnd = mulberry32(sh.seed), Y = D.layout, kx = this.kx;
    const { W, cx, peak, path, kept, clear, base, rowsN, index } = sh, bottom = base + rowsN, body = sh.kind === 'body', M = D.massif;
    const cells = sh.cells = Array.from({ length: rowsN }, () => new Array(W).fill(null)), mask = Array.from({ length: rowsN }, () => new Uint8Array(W));
    const slope = new Float32Array(W);
    for (let c = 1; c < W - 1; c++) slope[c] = Number.isFinite(peak[c - 1]) && Number.isFinite(peak[c + 1]) ? (peak[c + 1] - peak[c - 1]) / 2 : c < cx ? -2 : 2;
    let top = Infinity; for (const v of peak) if (v < top) top = v;
    top = Math.floor(top);
    const wooded = (r) => smooth(Y.treeline + 0.05, Y.forest, r / S);   // under the trees the ground is dark

    // --- bare rock and snow, in the peak's hand: lit from the left, down to where the trees close over it ---
    const rockEnd = Math.min(bottom, Math.round(Y.forest * S) + 1);
    if (top < rockEnd) {
      // Ribs come down a face from its top and spread as it spreads. The
      // one down its middle parts the face that looks left, which is lit,
      // from the one that looks right, which is not: that is the peak. Each
      // other rib, from where it starts, throws a shadow to its right on
      // the lit side, or catches the light on its left on the dark side.
      const ribs = body ? M.ribs : [[0, 0]], crest = [], own = new Map(), from = body ? sc.bodyTop : top, [shadow, glint] = M.cast;
      for (let r = top; r < rockEnd; r++) {
        const down = Math.max(0, r - from) / S, half = body ? sc.seamHalf * (1 + M.spread * down) : 30 * kx, last = crest[crest.length - 1];
        const row = ribs.map(([t, start], k) => ({ t, on: t ? smooth(start, start + 0.3, down) : 1, x: cx + (t + (n.fbm(r * 0.035, k * 3.7 + sh.seed, 2) - 0.5) * 0.2 * smooth(0, 0.3, down)) * half }));
        row.half = half; row.mid = row.find((p) => !p.t).x; crest.push(row);
        if (last) row.forEach((p, k) => { const c = Math.round(p.x), dc = c - Math.round(last[k].x); if (p.on > 0.3) own.set(r * W + c, dc < 0 ? '/' : dc > 0 ? '\\' : '|'); });
      }
      const lit = (c, r) => {
        const row = crest[r - top], left = c < row.mid; let sun = left ? 1 : 0;
        for (const p of row) {
          const u = left ? (c - p.x) / (shadow * row.half) : (p.x - c) / (glint * row.half);
          if (p.t && u >= 0 && u < 1) sun = left ? Math.min(sun, 1 - p.on * Math.min(1, (1 - u) * 2.5)) : Math.max(sun, p.on * (1 - 0.5 * u));
        }
        return sun;
      };
      const rock = face({
        W, x0: sh.x0, r0: top, r1: rockEnd, peak, S, P, seed: sh.seed + 7, lift: 0.16, ice: Y.ice * S, lit, arete: (r, c) => own.get(r * W + c),
        axis: sh.x0 + cx, half: body ? sc.cols * 0.5 : Math.max(20, 30 * kx),
      });
      for (let r = Math.max(top, base); r < rockEnd; r++) {
        const wood = wooded(r); if (wood > 0.97) break;
        const row = rock[r - top], out = cells[r - base];
        for (let c = 0; c < W; c++) { const cell = row[c]; if (cell && !kept.has(r * W + c)) out[c] = wood > 0.01 ? [cell[0], cell[1], (cell[2] ?? 1) * (1 - wood)] : cell; }
      }
    }

    // --- under the trees: the crest as a line, ground cover thinning out below it, and the ground itself as a
    // soft wash, one pixel to a cell, brightest just under the crest and gone a few rows below: it is what makes
    // a ridge a shape and not only the trees on it ---
    const img = new ImageData(W, rowsN), px = img.data, tone = [1, 3, 5].map((k) => parseInt(P.pineDark.slice(k, k + 2), 16));
    const moss = mixHex(P.pine, P.leafOlive, 0.45), GRASS = [',', '.', "'", '"', ',', '`'];
    const deep = sh.deep;
    // A long face is not one slope: shoulders run across it, each a line
    // with the ground lit under it, falling one way and then the other.
    const folds = [];
    if (sh.folds) for (let down = 17 + rnd() * 6, k = 0; down < deep - 6; down += 15 + rnd() * 9, k++) {
      const len = Math.round((30 + rnd() * 28) * kx), mid = cx + Math.round((rnd() - 0.2) * 44 * kx), tilt = ((k + sh.seed) % 2 ? 1 : -1) * (0.1 + rnd() * 0.2) / kx;
      const c0 = Math.max(1, mid - (len >> 1)), c1 = Math.min(W - 2, mid + (len >> 1)), rows = new Float32Array(W).fill(NaN), on = new Float32Array(W), taper = 8 * kx;
      for (let c = c0; c <= c1; c++) {
        const r = top + down + tilt * (c - mid) + (n.fbm(c * 0.13 + sh.seed + k * 9, 5.5, 2) - 0.5) * 6;
        on[c] = smooth(c0, c0 + taper, c) * (1 - smooth(c1 - taper, c1, c)) * smooth(6, 18, r - peak[c]);   // it dies away at either end, and where it comes up to the crest
        if (on[c] > 0.02) rows[c] = r;
      }
      folds.push({ rows, tilt, on });
    }
    for (let r = Math.max(top, base); r < bottom; r++) {
      const i = r - base, wood = wooded(r);
      for (let x = 0; x < W; x++) {
        if (!(peak[x] <= r)) continue;
        mask[i][x] = 1;
        if (wood < 0.5) continue;
        const depth = r - peak[x], p4 = (i * W + x) * 4;
        if (depth < 26) { px[p4] = tone[0]; px[p4 + 1] = tone[1]; px[p4 + 2] = tone[2]; px[p4 + 3] = 255 * 0.32 * Math.exp(-depth / 6.5) * Math.min(1, depth + 0.3) * smooth(0.5, 0.8, wood); }
        let ledge = null;
        for (const f of folds) {
          const under = r - f.rows[x]; if (!(under >= 0 && under < 22)) continue;
          const on = f.on[x], a = 255 * 0.3 * Math.exp(-under / 6) * Math.min(1, under + 0.3) * on;
          if (a > px[p4 + 3]) { px[p4] = tone[0]; px[p4 + 1] = tone[1]; px[p4 + 2] = tone[2]; px[p4 + 3] = a; }
          if (under < 9 && !ledge) ledge = [f, under, on];
        }
        if (depth > deep || wood < 0.6 || kept.has(r * W + x)) continue;
        if (ledge && depth >= 1) {
          const [f, under, on] = ledge;
          if (under < 1) { if (rnd() < on * 1.3) cells[i][x] = [edge(f.rows[x] - Math.floor(f.rows[x]), f.tilt * 3), f.tilt < 0 ? moss : P.pine, 0.9 * on]; }
          else if (rnd() < 0.28 * (1 - under / 9) * on) cells[i][x] = [GRASS[Math.floor(rnd() * GRASS.length)], P.pine, 0.8 - under * 0.05];
        }
        else if (depth < 1) cells[i][x] = [edge(peak[x] - Math.floor(peak[x]), slope[x]), slope[x] < 0.05 ? moss : P.pine, 0.95];
        else if (depth < 11 && rnd() < 0.3 * (1 - depth / 11)) cells[i][x] = [GRASS[Math.floor(rnd() * GRASS.length)], slope[x] < 0.05 ? P.pine : P.pineDark, 0.85 - depth * 0.05];
      }
    }

    // --- trees: a close line of them on the crest, so the outline is trees,
    // then ranks every few rows that thin out into the dark below it. Each
    // is its own drawing, set in whole pixels of type. They are all much of
    // a height, whichever drawing it is, and a little larger the further
    // down the face, which is nearer. ---
    const trees = sh.trees = [], T = D.glyphs, TALL = { pine: 4.6, leafy: 3.8, birch: 5.5 };
    const plant = (c, r, shape, kind, dark, snowy, k) => {
      const h = shape.length, w2 = shape[0].length, olive = rnd() < 0.5, font = Math.max(6, Math.round(sh.font * k)); k = font / sh.font;
      // the route stays clear, and trees keep their distance, by their size
      for (let rr = Math.floor(r - h * k * 1.2); rr <= r; rr++) for (let x = Math.floor(c - w2 * k * 0.6); x <= Math.ceil(c + w2 * k * 0.6); x++) if (kept.has(rr * W + x) || clear.has(rr * W + x)) return;
      for (const o of trees) if (Math.abs(o.row - r) <= 5 && Math.abs(o.c - c) < 0.4 * (w2 * k + o.w * o.k)) return;
      const rows = shape.map((ln, i) => {
        let f = 0, e = w2 - 1;
        while (f < w2 && ln[f] === ' ') f++; while (e >= 0 && ln[e] === ' ') e--;
        const marks = [];
        for (let j = f; j <= e; j++) {
          const ch = ln[j]; if (ch === ' ') continue;
          const shade = dark || j > (w2 - 1) / 2 + 0.6;
          if (kind === 'pine') { const foot = i === h - 1 && ch === '|'; marks.push([j, ch, !foot && (i < snowy || (i === snowy && snowy > 1 && j === f)) ? P.snow : foot || shade ? P.pineDark : P.pine, 1]); }
          else if (kind === 'birch') { const bark = ch === '|' || ch === '!'; marks.push([j, ch, bark ? P.birch : P.birchLeaf, bark ? 0.92 : shade ? 0.6 : 0.95]); }   // a white trunk, right up through its leaves
          else { const foot = i === h - 1; marks.push([j, ch, foot ? P.ground : olive ? P.leafOlive : P.leaf, !foot && shade ? 0.6 : 1]); }
        }
        return { f, e, marks };
      });
      trees.push({ c, row: r, h, w: w2, k, font, rows, kind });
    };
    // What grows where. Pines at the treeline give way slowly to broadleaves
    // and birches all the way down, and at the foot of the mountain there is
    // hardly a pine.
    const pines = (at) => 1 - 0.96 * smooth(Y.forest - 0.5, Y.ground - 0.8, at);
    const pick = (at) => {
      const kind = rnd() < pines(at) ? 'pine' : rnd() < 0.42 ? 'birch' : 'leafy', set = kind === 'pine' ? T.pines : kind === 'birch' ? T.birch : T.leafy;
      return [set[Math.floor(rnd() * set.length)], kind];
    };
    // how much snow a tree carries: laden near the treeline, dusted lower, bare in the forest proper
    const snowOn = (at) => at < Y.forest - 0.15 ? 2 : at < Y.forest + 0.3 ? (rnd() < 0.75 ? 2 : 1) : at < Y.forest + 0.95 ? (rnd() < 0.6 ? 1 : 0) : 0;
    const density = (at) => smooth(Y.treeline - 0.1, Y.forest + 0.2, at);
    const sizeOf = (d, shape, kind, depth) => (0.82 + 0.18 * d) * (0.94 + rnd() * 0.12) * (1 + 0.3 * smooth(0, S * 0.9, depth)) * TALL[kind] / shape.length;
    for (let c = 2 + Math.floor(rnd() * 3); c < W - 3; c += 3 + Math.floor(rnd() * 3)) {
      if (!Number.isFinite(peak[c])) continue;
      const r = Math.round(peak[c]), at = r / S, d = density(at);
      if (r >= bottom - 1 || rnd() > d * 1.1) continue;
      const [shape, kind] = pick(at);
      plant(c, r, shape, kind, slope[c] > 0.05, kind === 'pine' ? snowOn(at) : 0, sizeOf(d, shape, kind, 0));
    }
    for (let r = Math.max(top, Math.round(Y.treeline * S)); r < bottom; r += 3) {
      const at = r / S, d = density(at);
      for (let c = 2 + (r * 7) % 5; c < W - 3; c += 5 + Math.floor(rnd() * 5)) {
        if (!Number.isFinite(peak[c])) continue;
        const depth = r - peak[c];
        if (depth < 4 || depth > deep || rnd() > d * 0.92 * (1 - (sh.folds ? 0.5 : 0.72) * smooth(10, 44, depth))) continue;
        const [shape, kind] = pick(at);
        plant(c, r, shape, kind, slope[c] > 0.05, kind === 'pine' ? snowOn(at) : 0, sizeOf(d, shape, kind, depth));
      }
    }
    trees.sort((p, q) => p.row - q.row);   // further up the face first, so the nearer ones are drawn over them
    trees.forEach((t, i) => { t.id = index * 10000 + i; });
    // A tree hides what is behind it: nothing of the sheet's own is drawn
    // under it, and a tree further up the face loses the marks a nearer one
    // stands over.
    const over = new Int32Array(rowsN * W).fill(-1), leftOf = (t) => t.c + 0.5 - t.w / 2 * t.k;
    trees.forEach((t, id) => t.rows.forEach((row, j) => {
      const y = t.row + 1 - (t.h - j) * t.k - base, x = leftOf(t);
      if (row.e >= row.f) for (let i = Math.max(0, Math.floor(y)); i < Math.min(rowsN, y + t.k); i++) for (let c = Math.max(0, Math.floor(x + (row.f - 0.6) * t.k)); c < Math.min(W, x + (row.e + 1.6) * t.k); c++) { over[i * W + c] = id; cells[i][c] = null; }
    }));
    trees.forEach((t, id) => t.rows.forEach((row, j) => {
      const i = Math.floor(t.row + 1 - (t.h - j - 0.5) * t.k - base);
      row.marks = row.marks.filter(([col]) => !(over[i * W + Math.floor(leftOf(t) + (col + 0.5) * t.k)] > id));
    }));

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
    // every glyph the sheet is set in is made now, not while you scroll
    for (const t of trees) for (const row of t.rows) for (const [, ch, color] of row.marks) g.sprite(ch, color, t.font);
    for (const row of cells) for (const cell of row) if (cell) g.sprite(cell[0], cell[1], sh.font);

    // a dark margin round everything on it, one cell either side and one
    // above, so its edge reads against whatever is behind it
    const wide = mask.map((m) => Uint8Array.from(m));
    for (let i = 0; i < rowsN; i++) for (let c = 0; c < W; c++) if (mask[i][c]) { if (c > 0) wide[i][c - 1] = 1; if (c + 1 < W) wide[i][c + 1] = 1; if (i > 0) wide[i - 1][c] = 1; }
    // what each row covers, as runs, for hiding whatever is behind
    sh.wash = document.createElement('canvas'); sh.wash.width = W; sh.wash.height = rowsN;
    sh.wash.getContext('2d').putImageData(img, 0, 0);
    sh.runs = wide.map((m) => { const out = []; let a = -1; for (let c = 0; c <= W; c++) { const on = c < W && m[c]; if (on && a < 0) a = c; else if (!on && a >= 0) { out.push([a, c]); a = -1; } } return out; });
  }

  // ---------- each frame ----------
  // a place on a sheet (its own column, the page's row; fractions allowed) → viewport pixels
  at(sh, c, r) { const cam = this.sc.cam; return [cam.px(sh.x0 + c, sh.z), cam.py(r, sh.z)]; }
  // is any of a sheet on the screen
  shows(sh) { const g = this.sc.grid, [x0, y0] = this.at(sh, 0, sh.base), [x1, y1] = this.at(sh, sh.W, sh.base + sh.rowsN); return x1 > 0 && x0 < g.w && y1 > 0 && y0 < g.h; }

  // A sheet's cells c0..c1 of rows i0..i1, for a tile of its pane: what it
  // covers, the ground's wash, its marks, its trees.
  draw(sh, c0, i0, c1, i1, ox, oy) {
    if (!sh.cells) this.paint(sh);
    const sc = this.sc, g = sc.grid, { cw, ch, W, base, font } = sh, seam = sc.seamRow + sc.blend, body = sh.kind === 'body';
    for (let i = i0; i <= i1; i++) for (const [a, b] of sh.runs[i]) if (b >= c0 && a <= c1) g.box(ox + a * cw - 0.5, oy + i * ch - 0.5, (b - a) * cw + 1, ch + 1, sh.fill);
    // each row of each tree that is here, and where it goes
    const drawTrees = (draw) => {
      for (const t of sh.trees) {
        const i = t.row - base;
        if (i < i0 - 1) continue;
        if (i - 14 > i1) break;                        // sorted by the row they stand on; none is taller than this
        const k = t.font / g.size, cwk = g.cellW * k, chk = g.cellH * k, left = ox + (t.c + 0.5) * cw - t.w / 2 * cwk, foot = oy + (i + 1) * ch;
        if (left < g.vw && left + t.w * cwk > 0) t.rows.forEach((row, j) => { if (row.e >= row.f) draw(t, row, left, foot - (t.h - j) * chk, cwk, chk); });
      }
    };
    drawTrees((t, row, x, y, cwk, chk) => g.box(x + row.f * cwk, y, (row.e - row.f + 1) * cwk, chk, sh.fill));   // a tree hides what is behind it, and no more than that
    // the wash, stretched to size: smoothing makes it a soft edge, not blocks
    g.ctx.globalAlpha = g.alpha = 1;
    g.ctx.drawImage(sh.wash, ox, oy, W * cw, sh.rowsN * ch);
    for (let i = i0; i <= i1; i++) {
      const cells = sh.cells[i], row = base + i;
      for (let c = c0; c <= c1; c++) {
        const cell = cells[c];
        // through the seam the peak's own painting still stands
        if (cell && !(body && row <= seam && !sh.kept.has(row * W + c) && sc.painted(row, sh.x0 + c))) g.set(cell[0], cell[1], ox + c * cw, oy + i * ch, font, cell[2] ?? 1);
      }
    }
    drawTrees((t, row, x, y, cwk, chk) => { for (const [col, glyph, color, a] of row.marks) g.set(glyph, color, x + col * cwk, y, t.font, a); });
  }

  // is a pixel hidden by a sheet nearer than the one at `index`
  hidden(x, y, index) {
    const cam = this.sc.cam;
    return this.sheets.some((f, m) => m > index && f.pane.solid(Math.floor((x - cam.px(f.x0, f.z)) / f.cw), Math.floor((y - cam.py(f.base, f.z)) / f.ch)));
  }

  // a bridge as it shows now: its planks in pixels, and the size it is drawn at
  span(b) {
    const g = this.sc.grid, [x0, y0] = this.at(b.a, ...b.from), [x1, y1] = this.at(b.b, ...b.to);
    if (Math.max(y0, y1) < -40 || Math.min(y0, y1) > g.h + 40 || Math.max(x0, x1) < -40 || Math.min(x0, x1) > g.w + 40) return null;
    const u = g.size * (b.a.z + b.b.z) / 2, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / (u * 0.6))), sag = Math.min(len * 0.16, u * 1.5), pts = [];
    for (let k = 0; k <= n; k++) { const t = k / n; pts.push([x0 + dx * t, y0 + dy * t + sag * 4 * t * (1 - t)]); }
    return { pts, u };
  }
  // The route crosses from one sheet to the next on a rope bridge: a
  // sagging deck of planks, a hand rope over it, a post at either end. The
  // scene draws them after it has put the mountain out, so a bridge shows
  // plainly wherever it is; the light only warms the one you are on.
  drawBridges() {
    const sc = this.sc, g = sc.grid, P = sc.P, wood = mixHex(P.ground, P.rockLight, 0.45);
    for (const b of this.bridges) {
      const B = this.span(b); if (!B) continue;
      const { pts, u } = B;
      for (const [x, y] of pts) g.box(x - u * 0.45, y - u * 1.35, u * 0.9, u * 1.9, sc.sky);   // it hides what is behind it
      pts.forEach(([x, y], k) => {
        g.ink('=', wood, x, y, u * 0.95);
        g.ink('·', P.muted, x, y - u * 0.95, u, 0.85);
        if (k % 3 === 1) g.ink(':', P.muted, x, y - u * 0.48, u * 0.7, 0.6);
      });
      for (const [x, y] of [pts[0], pts[pts.length - 1]]) g.ink('|', wood, x, y - u * 0.5, u * 1.35);
    }
  }

  // The route's marks within `reach` pixels of the light at (x, y), each as
  // [left, top, glyph, size, whether it is placed by its middle], for the
  // scene to light.
  light(x, y, reach) {
    const sc = this.sc, cam = sc.cam, near = [], rows = reach / sc.grid.cellH + 2;
    for (const sh of this.route) {
      if (!sh.cells || sh.from - rows > cam.y || sh.path[sh.path.length - 1][2] + rows < cam.y) continue;
      for (const [c, r, at] of sh.path) {
        if (Math.abs(at - cam.y) > rows) continue;
        const [px, py] = this.at(sh, c, r);
        if (Math.hypot(px + sh.cw / 2 - x, py + sh.ch / 2 - y) > reach || this.hidden(px + sh.cw / 2, py + sh.ch / 2, sh.index)) continue;
        near.push([px, py, sh.cells[r - sh.base][c][0], sh.font, false]);
      }
    }
    for (const b of this.bridges) {
      const B = this.span(b); if (!B) continue;
      for (const [px, py] of B.pts) if (Math.hypot(px - x, py - y) <= reach) near.push([px, py, '=', B.u * 0.95, true], [px, py - B.u * 0.95, '·', B.u, true]);
    }
    return near;
  }

  // One tree as it stands now: its foot and its top on the screen; near:
  // the size of things where it stands, which is what a creature at it
  // takes; and whether it can be seen, with nothing nearer over it.
  stand(sh, t) {
    const g = this.sc.grid, [x, y] = this.at(sh, t.c + 0.5, t.row + 1);
    return { id: t.id, x, y, top: y - t.h * g.cellH * t.font / g.size, near: sh.z, kind: t.kind, sheet: sh.index, row: t.row, seen: !this.hidden(x, y - sh.ch * 0.5, sh.index) };
  }
  tree(id) { const sh = this.sheets[Math.floor(id / 10000)], t = sh?.trees?.[id % 10000]; return t ? this.stand(sh, t) : null; }
  // trees something could sit on: those on the screen or about to be, that can be seen
  perches() {
    const g = this.sc.grid, out = [];
    for (const sh of this.sheets) {
      if (!sh.trees || !this.shows(sh)) continue;
      for (const t of sh.trees) {
        const [x, y] = this.at(sh, t.c + 0.5, t.row + 1);
        if (y < -g.h * 0.4 || y > g.h * 1.5 || x < -g.w * 0.3 || x > g.w * 1.3) continue;
        const q = this.stand(sh, t);
        if (q.seen) out.push(q);
      }
    }
    return out;
  }
  // A tree at or just below a row, on the ridge the route is on at that height: the one that will be nearest the
  // middle of the screen when you come level with it, a little off the trail. Its id, or null if that ridge is not painted yet.
  roost(row) {
    const sc = this.sc, g = sc.grid, S = sc.screenRows, sh = this.route.find((s) => s.kind === 'ridge' && s.path[0][1] <= row && row <= s.path[s.path.length - 1][1]);
    if (!sh?.trees) return null;
    let best = null, least = Infinity;
    for (const t of sh.trees) {
      if (t.row < row || t.row > row + S * 0.5) continue;
      const p = sh.path.find(([, r]) => r >= t.row); if (!p || Math.abs(t.c - p[0]) < 4) continue;
      const off = Math.abs(this.trail(p[2]) + (t.c - p[0]) * sh.cw - g.w / 2);   // how far from the middle it will be
      if (off < least) { least = off; best = t; }
    }
    return best ? best.id : null;
  }

  // paint one sheet that is not yet painted, the next one down first; true if there was one
  warm() {
    const sh = this.sheets.find((x) => !x.cells);
    if (sh) this.paint(sh);
    return !!sh;
  }

  // lamps on the route's upper stretch, one for every merged commit
  setLamps(n) {
    const S = this.sc.screenRows, cells = [];
    for (const sh of this.route) for (const [c, r] of sh.path) if (r > 4.6 * S && r < 6.25 * S) cells.push([sh, c, r]);
    this.lamps = [];
    for (let i = 0; i < n && cells.length; i++) { const [sh, c, r] = cells[Math.floor((i + 0.5) / n * cells.length)]; this.lamps.push({ sh, c, r, phase: i * 2.4 }); }
  }
}
