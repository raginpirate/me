// The massif: which lobes there are, how the table turns, each lobe's outline, and the route over them.

import { clamp, smooth, makeNoise, mulberry32 } from '../math.js';
import { LAYOUT, MASSIF, CARD } from '../art.js';
import { GROUND_K } from './ground.js';

const wrapPi = (a) => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a; };

// How the table turns and where a lobe stands. pose() writes X, s, vis, tone, ref into `out`.
export function makeTurn(d) {
  const { S } = d, ref = Math.min(d.cols, 170), kx = ref / 60, reach = 34 * kx, leadScreens = CARD.rest[d.stack ? 'stack' : 'side'] + MASSIF.lead, leadRows = leadScreens * S;
  const [t0, t1] = MASSIF.turn, k = MASSIF.ease;
  const yawAt = (centre) => { const tt = clamp((centre - t0) / (t1 - t0), 0, 1), e = tt < k ? tt * tt / (2 * k) : tt <= 1 - k ? tt - k / 2 : 1 - k - (1 - tt) ** 2 / (2 * k); return MASSIF.turns * 2 * Math.PI * e / (1 - k); };
  const gain = (rows) => Math.exp(MASSIF.depth * clamp(rows / S, -1.6, 1.6));
  const pose = (l, yaw, centreRow, out = {}) => {
    const you = centreRow - leadRows;
    if (l.kind === 'core') { out.X = d.ax; out.s = out.vis = out.tone = 1; out.ref = you; return out; }
    const phi = wrapPi(l.th - yaw), cos = Math.cos(phi), ridge = l.span != null;
    out.ref = ridge ? clamp(you, l.apex, l.apex + l.span) : you;
    out.s = ridge ? (1 + MASSIF.depth / 2 * l.d / reach) * gain(out.ref - you) * (0.82 + 0.18 * cos) : 1 + MASSIF.depth * l.d * cos / reach;
    out.vis = 1 - smooth(MASSIF.haze[0], MASSIF.haze[1], Math.abs(phi)); out.tone = 0.55 + 0.45 * smooth(0.3, 1, cos); out.X = d.ax + l.d * Math.sin(phi);
    return out;
  };
  return { ref, kx, reach, leadScreens, leadRows, yawAt, face: (row) => yawAt(row / S + leadScreens), gain, pose };
}

// The lobes, back to front, each with its outline, and the route laid over the ones it crosses.
export function makeMassif(d, stops, door) {
  const T = makeTurn(d), { S, cols, groundRow: G, bodyTop, summitRow } = d, { kx, reach, ref, leadRows, yawAt, face, pose } = T, R = mulberry32(3), N = makeNoise(77);
  const out = (at) => kx * (15 + 4.3 * (at - 5.4)), ridgeHalf = (n) => kx * 3.1 * n ** 0.62, mode = d.stack ? 'stack' : 'side';
  const marked = stops.filter((s) => s.mark && s.mark !== 'hut'), screens = (s) => s.at[0], lobes = [];

  // the core: the peak's spire carried on down
  const pts = [[LAYOUT.seam - LAYOUT.summit, d.seamHalf], ...MASSIF.core.map(([x, w]) => [x, w * ref])];
  for (let i = 1; i < pts.length; i++) pts[i][1] = Math.max(pts[i][1], 1.08 * pts[i - 1][1]);
  const through = (x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[pts.length - 1][1]; };
  lobes.push({ kind: 'core', th: 0, off: 0, d: 0, apex: bodyTop, span: null, rag: 2, seed: 1, stop: marked.find((s) => screens(s) < LAYOUT.ice) ?? null, rank: -1,
    half: (n) => through((bodyTop + n - summitRow) / S) * (1 - 0.25 * smooth(0, 0.9 * S, n)) });
  // spires: steep, snow-topped, close in
  MASSIF.spires.forEach(([s, far, off], i) => { const apex = Math.round(summitRow + s * S); lobes.push({ kind: 'spire', apex, span: null, th: face(apex) + off, off, d: far * kx, rag: 3, seed: 10 + 7 * i, stop: null, rank: apex - 1e6,
    half: (n) => kx * (0.3 * Math.min(n, 14) + 0.105 * Math.max(0, n - 14)) }); });
  // route ridges: one for each stop on the way down, and plain ones between
  const stopTops = marked.filter((s) => screens(s) >= LAYOUT.ice).map((s) => {
    const rest = screens(s) + CARD.rest[mode], far = out(screens(s) - MASSIF.lead), size = 1 + MASSIF.depth * 0.5 * far / reach;
    return { at: Math.round(rest * S + (s.y - rest * S) / size - MASSIF.lead * S) / S, stop: s, d: far, rest };
  });
  const sparse = stopTops.find((t) => t.stop.id === MASSIF.sparse).at - 0.001, anchors = [{ at: LAYOUT.treeline - 0.1 }, ...stopTops, { at: LAYOUT.ground - MASSIF.depth }], tops = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i], b = anchors[i + 1], n = Math.max(1, Math.round((b.at - a.at) / MASSIF.stride[a.at < sparse ? 0 : 1]));
    tops.push(a); for (let k = 1; k < n; k++) tops.push({ at: a.at + (b.at - a.at) * k / n });
  }
  tops.push(anchors[anchors.length - 1]);
  let long = 0;
  tops.forEach((t, i) => {
    const apex = Math.round(t.at * S), span = (i + 1 < tops.length ? Math.round(tops[i + 1].at * S) : G) - apex, turn = face(apex + 0.3 * Math.max(0, span - 0.3 * S));
    const th = turn + (t.stop ? 0 : (R() - 0.5) * 0.2), far = t.stop ? t.d : out(t.at) * (0.92 + R() * 0.16);
    const l = { kind: 'route', th, off: th - turn, d: far, apex, span, half: ridgeHalf, rag: 5, seed: 100 + 13 * i, stop: t.stop ?? null, rank: apex };
    if (t.at >= sparse) { const [wl, wr, flat, pow, c, lean] = MASSIF.forms[long++ % 4]; Object.assign(l, { wl, wr, flat: flat * kx, lean: Math.round(lean * kx), folds: true, half: (n) => kx * c * n ** pow }); }
    if (t.stop) { const mid = t.rest * S, p = pose(l, yawAt(t.rest), mid); l.way = [(t.stop.x + 0.5 - p.X) / p.s, mid + (t.stop.y - mid) / p.s]; }
    lobes.push(l);
  });
  // side ridges: off the route, to one side and the other
  const routeApexes = lobes.filter((l) => l.kind === 'route').map((l) => l.apex);
  for (let i = 0, at = LAYOUT.forest - 0.35; at < sparse + 0.2; i++) {
    const apex = Math.round(at * S), off = (i % 2 ? -1 : 1) * (0.8 + R() * 0.4), far = out(at) * (1.05 + R() * 0.2);
    const under = Math.max(apex - 0.45 * S, ...routeApexes.filter((a) => a <= apex));
    lobes.push({ kind: 'side', th: face(apex) + off, off, d: far, apex, span: Math.round(0.45 * S), half: ridgeHalf, rag: 5, seed: 400 + 17 * i, stop: null, rank: Math.min(under, apex - 0.3 * S) - 0.5 });
    at += 0.5 + R() * 0.2;
  }
  lobes.sort((a, b) => a.rank - b.rank);

  // outlines
  for (const l of lobes) {
    const { wl = 1, wr = 1, flat = 0, lean = 0 } = l, tall = G - l.apex, widest = l.half(tall);
    const wmax = Math.min(Math.ceil(widest * Math.max(wl, wr) + flat + Math.abs(lean)), Math.ceil(cols / 2 + reach) + 6) + 3, W = 2 * wmax + 1, cx = wmax, crest = new Float64Array(W).fill(Infinity);
    for (let c = 0; c < W; c++) {
      const a = Math.max(0, Math.abs(c - cx - lean) - flat) / (c < cx + lean ? wl : wr);
      if (widest < a) continue;
      let lo = 0, hi = tall; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (l.half(m) >= a) hi = m; else lo = m; }
      crest[c] = l.apex + hi + (N.fbm(0.21 * c + l.seed, 3.3, 2) - 0.5) * l.rag * Math.min(1, hi / 5);
    }
    const slope = Array.from(crest, (_, c) => c > 0 && c < W - 1 && crest[c - 1] < Infinity && crest[c + 1] < Infinity ? (crest[c + 1] - crest[c - 1]) / 2 : c < cx ? -2 : 2);
    Object.assign(l, { W, cx, crest, slope, wl, wr, flat, lean, folds: !!l.folds });
    l.onCrest = (c) => { c = clamp(c, 2, W - 3); while (crest[c] === Infinity) c += c < cx ? 1 : -1; return [c, Math.ceil(crest[c])]; };
    l.inside = (c, r) => { c = clamp(c, 1, W - 2); while (!(crest[c] <= r - 1) && c !== cx) c += c < cx ? 1 : -1; return c; };
  }

  // the route: where it arrives on each lobe, where it steps off to the next, and the path between
  const route = lobes.filter((l) => l.kind === 'core' || l.kind === 'route');
  for (const l of route) l.arrive = l.kind === 'core' ? [l.cx + 1, bodyTop] : l.onCrest(l.cx - Math.round((3 + R() * 3) * kx));
  route.forEach((l, i) => {
    const nx = route[i + 1], core = l.kind === 'core';
    if (!nx) { const e = pose(l, yawAt(99), d.end + S / 2); l.depart = [l.inside(Math.round(l.cx + (door[0] * GROUND_K - e.X) / e.s), G - 1), G - 1]; }
    else {
      const mid = (core ? nx.apex : nx.apex - 0.15 * S) + leadRows, yaw = core ? nx.th - 0.2 : yawAt(mid / S), a = { ...pose(l, yaw, mid) }, b = pose(nx, yaw, mid);
      const x = b.X + (nx.arrive[0] - nx.cx) * b.s, y = (nx.arrive[1] - mid) * b.s, r = Math.max(l.arrive[1] + 3, Math.round(mid + y / a.s) - 3), gap = Math.min(9, Math.round((4 + R() * 2) * kx));
      l.depart = [l.inside(Math.round(l.cx + (x - a.X) / a.s) - gap, r), r];
    }
    if (l.stop) { const way = core ? [l.stop.x + 0.5 - d.ax, l.stop.y] : l.way; l.mark = [l.cx + 0.5 + way[0], way[1] + 0.5]; l.via = [Math.round(l.cx + way[0]), Math.round(way[1])]; }
    const path = l.path = [], legs = l.via ? [[l.arrive, l.via], [l.via, l.depart]] : [[l.arrive, l.depart]];
    for (const [[x0, r0], [x1, r1]] of legs) {
      const rows = Math.max(1, r1 - r0), bends = Math.max(1, Math.round(rows / 9)); let x = x0;
      for (let k = 0; k <= rows; k++) {
        const tt = k / rows, r = r0 + k, want = l.inside(Math.round(x0 + (x1 - x0) * tt + Math.sin(tt * Math.PI * bends) * Math.min(3.2 * kx, rows / 4) * Math.sin(tt * Math.PI) ** 0.5), r);
        while (x !== want) { x += Math.sign(want - x); path.push([x, r]); }
        path.push([want, r]);
      }
    }
    // what the route needs kept clear
    const kept = l.kept = new Set(), keep = (c, r) => kept.add(r * l.W + c);
    for (const [c, r] of path) for (let dr = -1; dr <= 1; dr++) for (let dc = -2; dc <= 2; dc++) keep(c + dc, r + dr);
    if (!core) for (let r = l.arrive[1] - 7; r <= l.arrive[1] + 1; r++) for (let c = l.arrive[0] - 13; c <= l.arrive[0] + 3; c++) keep(c, r);
  });
  for (const l of lobes) { l.kept ??= new Set(); l.path ??= []; }
  for (const s of stops) { const i = lobes.findIndex((l) => l.stop === s); if (i >= 0) s.lobe = i; }
  return { lobes, turn: T, N };
}
