// The bottom of the page: the ground line, the hut the route ends at, and
// the roots under the mountain. It is the nearest thing there is, so it is
// set at the size of the nearest cut-out. Painted once.

import { mulberry32, hash, mixHex } from './util.js';
import { D } from './direction.js';

export class Ground {
  constructor(sc, hutCol) {
    this.sc = sc;
    const { P } = sc, g = sc.grid, rnd = mulberry32(404);
    const k = this.k = sc.reduced.matches ? 1 : 1 + D.massif.depth;
    const cols = this.cols = Math.ceil(sc.cols / k) + 2, deep = this.deep = Math.ceil(sc.screenRows / 2 / k) + 2;
    this.earth = mixHex(P.skyBase, P.groundDark, 0.3);
    const wood = mixHex(P.ground, P.leaf, 0.45), timber = mixHex(P.leaf, P.snow, 0.25);
    // rows count from the ground line: row -1 is the line itself, 0 and on are under it
    const cells = this.cells = new Map();
    const set = (r, c, ch, color, a = 1) => { if (c >= 0 && c < cols && r < deep) cells.set(r * 1000 + c, [ch, color, a, c, r]); };

    // the ground line and the litter on it, soil under it, fine roots hanging from the turf
    const litter = [',', "'", '~', ',', '"'];
    for (let c = 0; c < cols; c++) {
      const u = hash(c, 1, 21);
      set(-1, c, u < 0.46 ? '_' : u < 0.6 ? '.' : u < 0.74 ? ',' : u < 0.86 ? '-' : '~', u < 0.6 ? P.ground : hash(c, 2, 21) < 0.5 ? P.leaf : P.leafOlive);
      if (hash(c, 3, 21) < 0.3) set(-2, c, litter[Math.floor(hash(c, 4, 21) * litter.length)], hash(c, 5, 21) < 0.5 ? P.leaf : P.leafOlive, 0.9);
      for (let r = 0; r < deep; r++) {
        const d = r / deep, v = hash(c, r, 22);
        if (v < 0.005) set(r, c, 'o', P.dim, 0.55);
        else if (v < 0.11 - 0.05 * d) set(r, c, v < 0.04 ? '.' : v < 0.07 ? ',' : v < 0.09 ? ':' : "'", P.ground, 0.55 - 0.2 * d);
      }
      if (hash(c, 6, 21) < 0.34) { const n = 1 + Math.floor(hash(c, 7, 21) * 3); for (let i = 0; i < n; i++) set(i, c, i === n - 1 ? (hash(c, 8, 21) < 0.5 ? "'" : ',') : '|', P.ground, 0.8 - i * 0.12); }
    }
    // roots: each walks down and out from the turf, forking as it goes
    const root = (c, r, dir, len, thick) => {
      let x = c, y = r;
      for (let i = 0; i < len && y < deep - 2; i++) {
        const u = rnd();
        let dx = 0, dy = 1;
        if (dir) { if (u < 0.46) dx = dir; else if (u < 0.74) { dx = dir; dy = 0; } }
        else dx = u < 0.22 ? -1 : u < 0.44 ? 1 : 0;
        x += dx; y += dy;
        set(y, x, dy === 0 ? '_' : dx < 0 ? '/' : dx > 0 ? '\\' : '|', thick && i < len * 0.7 ? wood : P.ground, 1 - 0.4 * i / len);
        if (len - i > 5 && rnd() < 0.2) root(x, y, dir ? (rnd() < 0.3 ? -dir : dir) : (rnd() < 0.5 ? -1 : 1), (len - i) * (0.45 + rnd() * 0.3), false);
      }
      set(y + 1, x, rnd() < 0.5 ? "'" : ',', P.ground, 0.8);
    };
    for (let c = 2 + Math.floor(rnd() * 4); c < cols - 2; c += 6 + Math.floor(rnd() * 6)) {
      const big = rnd() < 0.55, len = deep * (big ? 0.55 + rnd() * 0.4 : 0.25 + rnd() * 0.25);
      root(c, -1, 0, len, big);
      if (big) for (const dir of [-1, 1]) root(c + dir, -1, dir, len * (0.5 + rnd() * 0.4), true);
    }

    // the hut, standing on the line
    const hut = D.glyphs.hut, w = hut[0].length;
    const left = this.hutLeft = Math.round((hutCol + 0.5) * g.cellW / (g.cellW * k) - w / 2);
    this.hutRows = [];
    hut.forEach((row, i) => { for (let j = 0; j < w; j++) { const ch = row[j]; if (ch !== ' ') this.hutRows.push([ch, ch === '[' || ch === ']' ? P.ember : timber, left + j, i - hut.length - 1]); } });
    for (let j = 1; j < w; j++) cells.delete(-2 * 1000 + left + j);
    // where the path comes to it (just left of its wall, on the ground), its window and its chimney, in ground cells
    this.door = [left - 0.5, -2];
    this.window = [left + hut[4].indexOf('[') + 1, 4 - hut.length - 1 + 0.5];
    this.chimney = [left + hut[0].indexOf(',') + 0.5, -hut.length - 1];
  }

  // a place on the ground (column, row from the line), in viewport pixels
  at(c, r) { const g = this.sc.grid; return [c * g.cellW * this.k, g.h / 2 + (this.sc.groundRow + 1 + r - this.sc.centreRow) * g.cellH * this.k]; }
  get showing() { return this.at(0, -8)[1] < this.sc.grid.h; }

  // the part that never changes, into the mountain's layer
  render() {
    if (!this.showing) return;
    const sc = this.sc, g = sc.grid, cw = g.cellW * this.k, size = g.size * this.k, [, y0] = this.at(0, 0);
    g.box(0, y0, g.w, g.h - y0 + 1, this.earth);
    for (const [ch, color, a, c, r] of this.cells.values()) { const [x, y] = this.at(c, r); if (y < g.h && y > -size * 2) { if (r === -1) g.box(x - 0.5, y, cw + 1, g.cellH * this.k, sc.sky); g.set(ch, color, x, y, size, a); } }
    // the hut hides what is behind it
    const [hx, hy] = this.at(this.hutLeft + 1, -6), [hx2, hy2] = this.at(this.hutLeft + D.glyphs.hut[0].length, -1);
    g.box(hx, hy, hx2 - hx, hy2 - hy, sc.sky);
    for (const [ch, color, c, r] of this.hutRows) { const [x, y] = this.at(c, r); g.set(ch, color, x, y, size, 1); }
  }

  // the part that moves: smoke from the chimney
  draw() {
    if (!this.showing || this.sc.reduced.matches) return;
    const sc = this.sc, g = sc.grid, u = g.size * this.k, [x, y] = this.at(...this.chimney);
    for (let i = 0; i < 4; i++) {
      const t = (sc.time * 0.22 + i / 4) % 1;
      g.ink(t < 0.3 ? '.' : t < 0.65 ? 'o' : 'O', sc.P.dim, x + (Math.sin(t * 5 + i) * 0.5 + t * 1.6) * u, y - t * 3.4 * u, u * (0.6 + t * 0.9), 0.75 * (1 - t) ** 1.2);
    }
  }
}
