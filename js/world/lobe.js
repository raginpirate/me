// Painting one lobe, flat, in its own columns and the page's rows: arêtes, folds, the ground's tone, rock and snow,
// grass, the route's marks, and its trees.

import { clamp, smooth, mulberry32, edge } from '../math.js';
import { LAYOUT, TREES } from '../art.js';

const GRASS = [',', '.', "'", '"', ',', '`'], TONE = { pineDark: 0, rockDark: 1, dim: 2 };
const frac = (v) => v - Math.floor(v);

// the route's mark on its k-th cell: a fixed rope on the ice, stones, then a trodden path
export const pathMark = (k, at) => at < LAYOUT.ice ? (k % 4 === 0 ? ['+', 'muted', 0.8] : [':', 'muted', 0.5]) : at < LAYOUT.forest ? [k % 3 ? '.' : ',', 'muted', 0.6] : k % 7 === 3 ? ['=', 'muted', 0.45] : [k % 2 ? ':' : '.', 'muted', 0.5];

// peakShows(row, col): the painted peak is drawn at this page cell (the core only shows where it is not)
export function paintLobe(l, d, N, kx, peakShows) {
  const R = mulberry32(l.seed), { S, groundRow: G, bodyTop, seamRow } = d, { W, cx, crest, slope, seed, apex, kept } = l, core = l.kind === 'core', spire = l.kind === 'spire', ridge = l.span != null;
  const has = (c) => crest[c] < Infinity, deep = Math.round(Math.max(1.25 * S, (l.span ?? 0) + 0.6 * S));

  // arêtes
  const arete = new Map(), crossings = new Map();
  const walk = (c, r, lean, len) => {
    for (let i = 0; i < len && r < G - 2; i++) {
      const v = N.noise(0.11 * c + 0.05 * i + seed, 0.05 * r + 7 * lean), dc = (v < 0.42 - 0.12 * lean ? -1 : v > 0.58 - 0.12 * lean ? 1 : 0) * (R() < 0.7 ? 1 : 0);
      r += 1; c = clamp(c + dc, 1, W - 2); if (r < crest[c] + 1) break;
      arete.set(r * W + c, dc < 0 ? '/' : dc > 0 ? '\\' : '|'); (crossings.get(r) ?? crossings.set(r, []).get(r)).push(c);
    }
  };
  const top = Math.round(crest[cx]);
  walk(cx, top, 0, Infinity);
  if (core) { walk(cx - 2, bodyTop + Math.round(0.35 * S), -1.3, 1.1 * S); walk(cx + 2, bodyTop + Math.round(0.6 * S), 1.3, S); }
  else { walk(cx - 1, top + 5, -1.6, ridge ? 26 : 80); walk(cx + 1, top + 8, 1.6, ridge ? 22 : 70); }
  for (const list of crossings.values()) list.sort((a, b) => a - b);

  // folds: shoulders across the face of a long ridge
  const folds = [];
  if (l.folds) for (let down = 17 + R() * 6, k = 0; down < deep - 6; k++) {
    const len = Math.round((30 + R() * 28) * kx), mid = cx + Math.round((R() - 0.5) * 34 * kx), tilt = ((k + seed) % 2 ? 1 : -1) * (0.1 + R() * 0.2) / kx;
    const c0 = Math.max(1, mid - Math.floor(len / 2)), c1 = Math.min(W - 2, mid + Math.floor(len / 2)), taper = 8 * kx, on = new Float32Array(W), row = new Float32Array(W).fill(NaN);
    for (let c = c0; c <= c1; c++) {
      const r = apex + down + tilt * (c - mid) + (N.fbm(0.13 * c + seed + 9 * k, 5.5, 2) - 0.5) * 6;
      on[c] = smooth(c0, c0 + taper, c) * (1 - smooth(c1 - taper, c1, c)) * smooth(6, 18, r - crest[c]);
      if (on[c] > 0.02) row[c] = r;
    }
    folds.push({ tilt, on, row }); down += 15 + R() * 9;
  }

  // the ground's tone, one sample a cell; where two meet, the stronger wins
  const y0 = apex - 7, H = G - y0, tone = new Uint8Array(W * H), strength = new Uint8Array(W * H);
  const wash = (c, r, name, alpha) => { const i = (r - y0) * W + c; if (r < y0 || r >= G || !(alpha * 255 > strength[i])) return; strength[i] = Math.round(alpha * 255); tone[i] = TONE[name]; };
  const wood = (r) => smooth(5.55, LAYOUT.forest, r / S), seamed = (r) => core && r <= seamRow + 5;
  for (let c = 0; c < W; c++) {
    if (!has(c)) continue;
    for (let r = Math.ceil(crest[c]); r - crest[c] < 26 && r < G; r++) { if (seamed(r)) continue; const depth = r - crest[c], w = wood(r) > 0.5; wash(c, r, w ? 'pineDark' : 'rockDark', (w ? 0.32 : 0.2) * Math.exp(-depth / 6.5) * Math.min(1, depth + 0.3)); }
    for (const f of folds) if (!Number.isNaN(f.row[c])) for (let r = Math.ceil(f.row[c]); r - f.row[c] < 22; r++) { const under = r - f.row[c]; wash(c, r, 'pineDark', 0.3 * Math.exp(-under / 6) * Math.min(1, under + 0.3) * f.on[c]); }
    if (smooth(5.55, LAYOUT.forest, crest[c] / S) >= 0.5) for (let up = 1; up <= 5; up++) { const r = Math.floor(crest[c]) - up; if (!seamed(r)) wash(c, r, 'dim', 0.11 * (1 - (up - 0.5) / 5) ** 2); }
  }

  // the body, row by row, run by run
  const cells = [], pathAt = new Map(l.path.map(([c, r], k) => [r * W + c, k])), first = Math.ceil(Math.min(...crest)), shift = d.ax - cx - 0.5;
  const snowAbs = (x) => 4.76 * S + (N.fbm(0.09 * x + seed, 2.2, 3) - 0.5) * 16;
  for (let r = first; r < G; r++) {
    const at = r / S, wd = wood(r), cross = crossings.get(r) ?? [];
    for (let c = 0; c < W; c++) {
      if (!(crest[c] <= r)) continue;
      let e = c; while (e + 1 < W && crest[e + 1] <= r) e++;
      for (let x = c; x <= e; x++) {
        const depth = r - crest[x]; if (depth > deep || kept.has(r * W + x)) continue;
        let cell = null;
        const fold = wd > 0.6 && depth >= 1 ? folds.find((f) => r - f.row[x] >= 0 && r - f.row[x] < 9) : null;
        if (fold) {
          const under = r - fold.row[x], on = fold.on[x];
          if (under < 1) { if (R() < 1.3 * on) cell = [edge(frac(fold.row[x]), 3 * fold.tilt), fold.tilt < 0 ? 'moss' : 'pine', 0.9 * on]; }
          else if (R() < 0.28 * (1 - under / 9) * on) cell = [GRASS[Math.floor(R() * 6)], 'pine', 0.8 - 0.05 * under];
        } else if (wd > 0.6) {
          if (depth < 1) cell = [edge(frac(crest[x]), slope[x]), slope[x] < 0.05 ? 'moss' : 'pine', 0.95];
          else if (depth < 11 && R() < 0.3 * (1 - depth / 11)) cell = [GRASS[Math.floor(R() * 6)], slope[x] < 0.05 ? 'pine' : 'pineDark', 0.85 - 0.05 * depth];
        } else {
          // rock and snow, lit from the left: the face left of an arête is lit, the face right of it in shadow
          let k = 0; while (k < cross.length && cross[k] < x) k++;
          const n = cross.length, isArete = cross[k] === x, left = k > 0 ? cross[k - 1] : c, right = k < n ? cross[k] : e;
          const lit = n ? (k === 0 ? 1 : x < (left + right) / 2 ? 0 : k < n ? 1 : 0) : slope[x] < 0 ? 1 : 0;
          const patch = N.fbm(0.17 * x + 4.2 + seed, 0.11 * r + 1.1, 3), fine = N.noise(0.9 * x, 0.9 * r + seed), cap = spire ? 16 + (N.noise(0.3 * x + seed, 1) - 0.3) * 12 : 0;
          const snow = at < 5.6 && (r < snowAbs(x) + (isArete ? 11 : 0) || depth < cap * (1 - smooth(4.8, 5.6, at))), topRow = depth < 1 && !(core && r <= bodyTop + 1), bare = 1 - wd;
          if (topRow && Math.abs(slope[x]) <= 0.8 && !snow && wd < 0.6) cell = [edge(frac(crest[x]), slope[x]), lit ? 'rockLight' : 'rock', bare];
          else if (x === c && snow && fine < 0.3) cell = ['@', 'snow', 1];
          else if (x === e && !lit && fine < 0.22) cell = ['%', snow ? 'snow' : 'rock', 0.8 * bare];
          else if (isArete) cell = [arete.get(r * W + x), snow ? 'snow' : 'rockLight', bare];
          else if (snow) cell = [lit ? (patch > 0.6 ? '%' : '#') : fine > 0.42 ? ':' : fine > 0.2 ? '.' : null, 'snow', lit ? 1 : 0.55];
          else if (at < 5.5 && ((Math.floor(r + (N.noise(0.05 * x + seed, 7) - 0.5) * 9) % 9) + 9) % 9 === 0 && N.noise(0.13 * x + seed, 0.2 * r) > 0.42) cell = ['_', 'snow', lit ? 0.9 : 0.5];
          else if (lit) cell = [patch < 0.4 ? (fine < 0.22 ? '.' : null) : patch > 0.62 ? '#' : '%', 'rockLight', (patch > 0.62 ? 1 : 0.88) * bare];
          else cell = [fine > 0.5 ? ':' : fine > 0.3 ? '.' : null, 'rock', 0.85 * bare];
        }
        if (cell && cell[0] && (wd > 0.6 || cell[2] > 0.03) && !(core && r <= seamRow + 3 && peakShows(r, Math.round(shift + x)))) cells.push([r, x, ...cell]);
      }
      c = e;
    }
  }
  // the route's marks replace whatever was there: a fixed rope on the ice, stones, then a trodden path
  const marks = new Map(); l.path.forEach(([c, r], k) => marks.set(r * W + c, [r, c, ...pathMark(k, r / S)]));
  const all = new Map(cells.map((c) => [c[0] * W + c[1], c])); for (const [key, m] of marks) all.set(key, m);
  l.cells = [...all.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);

  // what it hides: everything from its crest down and the path, with a margin of one cell left, right and above
  const topOf = (c) => c >= 0 && c < W && has(c) ? Math.ceil(crest[c]) : Infinity, cover = new Float64Array(W).fill(Infinity);
  for (let c = 0; c < W; c++) cover[c] = Math.min(topOf(c) - 1, topOf(c - 1), topOf(c + 1));
  for (const [c, r] of l.path) { cover[c] = Math.min(cover[c], r - 1); for (const n of [c - 1, c + 1]) if (n >= 0 && n < W) cover[n] = Math.min(cover[n], r); }
  l.cover = cover;
  const idx = [], tn = [], al = []; for (let i = 0; i < strength.length; i++) if (strength[i]) { idx.push(i); tn.push(tone[i]); al.push(strength[i]); }
  l.wash = { idx, tone: tn, a: al, y0, h: H };

  // trees: along the crest (the outline is trees), then in ranks down the face, thinning into the dark
  const trees = [], density = (at) => smooth(5.4, 6.5, at);
  const plant = (c, r, shape, leafy, dark, snowy, k) => {
    const rows = TREES[shape], h = rows.length, w = rows[0].length, olive = R() < 0.5;
    for (let rr = Math.floor(r - 1.2 * h * k); rr <= r; rr++) for (let x = Math.floor(c - 0.6 * w * k); x <= Math.ceil(c + 0.6 * w * k); x++) if (kept.has(rr * W + x)) return;
    for (const o of trees) if (Math.abs(o[1] - r) <= 5 && Math.abs(o[0] - c) < 0.4 * (w * k + TREES[o[3]][0].length * o[2])) return;
    trees.push([c, r, k, shape, leafy ? +olive : null, +dark, snowy]);
  };
  const grow = (c, r) => {
    const at = r / S, leafy = R() < 0.22 * smooth(6.6, 8.3, at), set = leafy ? 'DEF' : at < LAYOUT.forest ? 'AC' : 'ABC', shape = set[Math.floor(R() * set.length)];
    const snowy = leafy ? 0 : at < 6.15 ? 2 : at < 6.6 ? (R() < 0.75 ? 2 : 1) : at < 7.25 ? (R() < 0.6 ? 1 : 0) : 0, far = density(at);
    plant(c, r, shape, leafy, slope[c] > 0.05, snowy, (0.82 + 0.18 * far) * (0.94 + R() * 0.12) * (leafy ? 4.4 : 4.6) / TREES[shape].length);
  };
  for (let c = 2 + Math.floor(R() * 3); c < W - 3; c += 3 + Math.floor(R() * 3)) {
    if (!has(c)) continue;
    const r = Math.round(crest[c]);
    if (r >= G - 1 || R() > 1.1 * density(r / S) || (core && r <= bodyTop + 2)) continue;
    grow(c, r);
  }
  for (let r = Math.round(LAYOUT.treeline * S); r < G; r += 3) for (let c = 2 + (7 * r) % 5; c < W - 3; c += 5 + Math.floor(R() * 5)) {
    if (!has(c)) continue;
    const depth = r - crest[c];
    if (depth < 4 || depth > deep || R() > 0.92 * density(r / S) * (1 - (l.folds ? 0.5 : 0.72) * smooth(10, 44, depth))) continue;
    grow(c, r);
  }
  l.trees = trees.map((t, i) => [t, i]).sort((a, b) => a[0][1] - b[0][1] || a[1] - b[1]).map((e) => e[0]);
  return l;
}
