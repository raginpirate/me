// The ground at the bottom of the page: turf, soil and roots, and the hut the route ends at.
// Ground cells are (col, row) with rows counted from the ground line: row -1 is the line, 0 and on are under it.

import { hash, mulberry32 } from '../math.js';

export const GROUND_K = 1.42;   // it is the nearest thing there is, so it is set at the nearest lobe's size
export const HUT = ['      ,     ', '   ___|]__  ', '  /       \\ ', ' /_________\\', ' |  []  _  |', ' |_____|_|_|'];

export function makeGround(d, hutCol) {
  const cols = Math.ceil(d.cols / GROUND_K) + 2, deep = Math.ceil(d.S / 2 / GROUND_K) + 2, at = new Map();
  const place = (c, r, ch, colour, alpha = 1) => { if (c >= 0 && c < cols && r < deep) at.set((r + 16) * 4096 + c, [r, c, ch, colour, alpha]); };
  for (let c = 0; c < cols; c++) {
    const u = hash(c, 1, 21), fallen = () => hash(c, 2, 21) < 0.5 ? 'leaf' : 'leafOlive';
    place(c, -1, u < 0.46 ? '_' : u < 0.6 ? '.' : u < 0.74 ? ',' : u < 0.86 ? '-' : '~', u < 0.6 ? 'ground' : fallen());
    if (hash(c, 3, 21) < 0.3) place(c, -2, [',', "'", '~', ',', '"'][Math.floor(hash(c, 4, 21) * 5)], hash(c, 5, 21) < 0.5 ? 'leaf' : 'leafOlive', 0.9);
    for (let r = 0; r < deep; r++) {
      const dd = r / deep, v = hash(c, r, 22);
      if (v < 0.005) place(c, r, 'o', 'dim', 0.55);
      else if (v < 0.11 - 0.05 * dd) place(c, r, v < 0.04 ? '.' : v < 0.07 ? ',' : v < 0.09 ? ':' : "'", 'ground', 0.55 - 0.2 * dd);
    }
    if (hash(c, 6, 21) < 0.34) for (let n = 1 + Math.floor(hash(c, 7, 21) * 3), i = 0; i < n; i++) place(c, i, i < n - 1 ? '|' : hash(c, 8, 21) < 0.5 ? "'" : ',', 'ground', 0.8 - 0.12 * i);
  }
  const R = mulberry32(404);
  const root = (c, r, dir, len, thick) => {
    let x = c, y = r;
    for (let i = 0; i < len && y < deep - 2; i++) {
      const u = R(), [dx, dy] = dir ? (u < 0.46 ? [dir, 1] : u < 0.74 ? [dir, 0] : [0, 1]) : (u < 0.22 ? [-1, 1] : u < 0.44 ? [1, 1] : [0, 1]);
      x += dx; y += dy;
      place(x, y, dy === 0 ? '_' : dx < 0 ? '/' : dx > 0 ? '\\' : '|', thick && i < 0.7 * len ? 'wood' : 'ground', 1 - 0.4 * i / len);
      if (len - i > 5 && R() < 0.2) { const ndir = dir ? (R() < 0.3 ? -dir : dir) : (R() < 0.5 ? -1 : 1); root(x, y, ndir, (len - i) * (0.45 + R() * 0.3), false); }
    }
    place(x, y + 1, R() < 0.5 ? "'" : ',', 'ground', 0.8);
  };
  for (let c = 2 + Math.floor(R() * 4); c < cols - 2; c += 6 + Math.floor(R() * 6)) {
    const big = R() < 0.55, len = deep * (big ? 0.55 + R() * 0.4 : 0.25 + R() * 0.25);
    root(c, -1, 0, len, big);
    if (big) for (const dir of [-1, 1]) root(c + dir, -1, dir, len * (0.5 + R() * 0.4), true);
  }
  const hutLeft = Math.round((hutCol + 0.5) / GROUND_K - 6);
  for (let c = hutLeft + 1; c <= hutLeft + 11; c++) at.delete((-2 + 16) * 4096 + c);   // no litter under the hut
  return { k: GROUND_K, cols, deep, hutLeft, door: [hutLeft - 0.5, -2], window: [hutLeft + 5, -2.5], chimney: [hutLeft + 6.5, -7], cells: [...at.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) };
}
