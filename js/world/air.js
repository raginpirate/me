// What is in the air: two far ranges, three depths of cloud, the standing fields of snow and leaves.

import { mix, mulberry32, edge, hash } from '../math.js';

export const RANGES = [   // p: its share of the scroll; tall in screens; k: its type size
  { p: 0.2, tall: 0.8, relief: 0.3, wave: 27, k: 0.78, a: 0.55, seed: 3.1, hatch: 7 },
  { p: 0.42, tall: 1.52, relief: 0.4, wave: 38, k: 0.9, a: 0.85, seed: 8.4, hatch: 11 },
];
export const CLOUDS = [   // k is both size and parallax; drift in own columns a second
  { k: 0.74, drift: 0.3, line: ['rockDark', 1], body: ['far', 0.85] },
  { k: 1, drift: -0.55, line: ['dim', 0.95], body: ['rockDark', 0.9] },
  { k: 1.36, drift: 1, line: ['rule', 0.8], body: ['dim', 0.55] },
];
export const SNOW = { z: [4.62, 6.55], tiers: [[0.72, '.', 0.9, 0.9, 1.2, 'dim'], [1, '*', 1, 0.8, 2.3, 'snow'], [1.4, '*', 1.5, 0.95, 3.6, 'snow']] };   // k, glyph, size, alpha, fall, colour
export const LEAVES = { from: 6.05, depths: [[0.8, 0.85, 0.75, 1.3], [1.1, 1.1, 0.95, 1.9], [1.5, 1.6, 1, 2.6]] };                                       // k, size, alpha, fall

export function makeAir(d, N) {
  const { cols, S, seamRow, seamHalf, ax, groundRow } = d;
  const ranges = RANGES.map(({ tall, relief, wave, k, seed }) => Float32Array.from({ length: Math.ceil(cols / k) + 3 }, (_, c) => {
    const x = c / wave + seed, m = N.ridged(x, seed, 3), big = N.noise(0.4 * x + 5, seed);
    return (S / k) * (tall - relief * (1 - (0.62 * m ** 1.5 + 0.38 * big)));
  }));

  const R = mulberry32(2026), span = cols + 80, wide = cols > 100 ? 1.5 : 1, per = Math.max(5, Math.round(cols / 9)), deckRow = Math.round(4.51 * S);
  const mk = (count, spread, w, h, off = 0) => Array.from({ length: count }, () => [R() * span, Math.round(off * S + (R() + R() + R() - 1.5) / 1.5 * spread * S), mix(w[0], w[1], R()) * wide, mix(h[0], h[1], R()), R() * 100, null, null]);
  const clouds = [
    [...mk(per, 0.22, [9, 22], [2.4, 5]), ...mk(Math.ceil(per / 2), 0.08, [4, 9], [1.2, 2.2], -0.5)],
    [...mk(per, 0.17, [9, 22], [2.8, 6]), ...mk(Math.ceil(per / 2), 0.07, [5, 10], [1.3, 2.4], 0.1)],
    mk(Math.ceil(0.7 * per), 0.16, [9, 20], [3, 6]),
  ];

  const A = mulberry32(31), z0 = SNOW.z[0] * S, z1 = SNOW.z[1] * S, l0 = LEAVES.from * S, l1 = groundRow;
  const snow = Array.from({ length: Math.round(cols * (z1 - z0) / 44) }, () => { const u = A(), tier = u < 0.42 ? 0 : u < 0.93 ? 1 : 2, x = A(), y = z0 + A() * (z1 - z0), ch = tier === 1 ? (A() < 0.7 ? '*' : '+') : SNOW.tiers[tier][1]; return [x, y, tier, ch, A() * 6.28]; });
  const leaves = Array.from({ length: Math.round(cols * (l1 - l0) / 85) }, () => { const u = A(), v = A(), x = A(), y = l0 + A() * (l1 - l0), rank = A(), phase = A() * 6.28; return [x, y, u < 0.4 ? 0 : u < 0.86 ? 1 : 2, rank, phase, Math.floor(A() * 3), v < 0.5 ? 'leaf' : 'leafOlive']; });
  return { ranges, clouds, snow, leaves, deckRow, span, random: A };
}

// A range as cells in its own grid, rows counted down from its foot: [col, row, ch, colour, alpha]
export function rangeCells(range, h, S) {
  const { tall, relief, k, a, hatch } = range, out = [], snowAt = (S / k) * (tall - 0.22 * relief);
  for (let c = 0; c + 2 < h.length; c++) {
    const up = -h[c + 1], slope = (h[c] - h[c + 2]) / 2, row = Math.floor(up), snowy = h[c + 1] > snowAt;
    out.push([c, row, edge(up - row, slope), snowy ? 'snow' : 'dim', snowy ? 0.6 * a : a]);
    const next = Math.floor(-h[c + 2]);
    for (let r = Math.min(row, next) + 1; r < Math.max(row, next); r++) out.push(slope < 0 ? [c + 1, r, '/', 'dim', a] : [c, r, '\\', 'dim', a]);
    for (let j = 1; j <= hatch; j++) {
      const fade = 1 - j / (hatch + 1), r = row + j;
      if (slope > 0.1) { if ((c + r) % 2 === 0) out.push([c, r, j < 3 ? ':' : '.', 'dim', 0.75 * a * fade]); }
      else if (hash(c, r, 3) < 0.07) out.push([c, r, '.', 'dim', 0.6 * a * fade]);
    }
  }
  return out;
}

// A cloud, column by column from its own middle: [u, top row, bottom row, [[row, ch, body?, alpha share]]]
export function cloudColumns([, , w, h, s, flat], N) {
  const f = flat ?? 0.5, e2 = (u) => 1 - (u / w) ** 2, out = [];
  const topAt = (u) => { const e = e2(u); return e > 0 ? -h * Math.sqrt(e) * (f + (1 - f) * (0.6 * Math.abs(Math.sin(0.33 * u + s)) + 0.4 * N.noise(s + 0.21 * u, 1.7))) : 0; };
  for (let u = -Math.ceil(w); u <= Math.ceil(w); u++) {
    const e = e2(u); if (!(e > 0)) continue;
    const root = Math.sqrt(e), t = topAt(u), b = 0.3 * h * root * (0.5 + 0.5 * N.noise(s + 0.13 * u, 9.2)) + 0.4, rt = Math.floor(t), rb = Math.floor(b);
    const cells = [[rt, edge(t - rt, (topAt(u + 1) - topAt(u - 1)) / 2), 0, 0.8 + 0.2 * (-u / w)]];
    for (let r = rt + 1; r <= rb; r++) {
      if (r === rb) { cells.push([r, b - rb < 0.5 ? '-' : '_', 1, 1]); continue; }
      const v = N.noise(s + 0.3 * u, 1.3 * r + s) + 0.35 * root - 0.2;
      if (v > 0.3) cells.push([r, v > 0.62 ? '=' : v > 0.45 ? '~' : '-', 1, v > 0.62 ? 1 : 0.8]);
    }
    out.push([u, rt, rb, cells]);
  }
  return out;
}
