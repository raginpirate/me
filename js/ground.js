// The bottom of the page: the ground line, the hut the route ends at, and
// the roots under the mountain. It is one more pane in the camera's world,
// and the nearest there is.

import { mulberry32, hash, mixHex } from './util.js';
import { D } from './direction.js';

export class Ground {
  // k: its depth
  constructor(sc, k) {
    this.sc = sc; this.k = k;
    const { P } = sc, g = sc.grid, cam = sc.cam, S = sc.screenRows, rnd = mulberry32(404), last = sc.end + S / 2;
    // it reaches as far either side as it is ever seen: from when its line first shows, to the end of the page
    const x0 = this.x0 = Math.floor(cam.wx(0, last - S / 2 / k - 14, k)) - 2;
    const cols = Math.ceil(cam.wx(g.w, last, k)) + 2 - x0, deep = Math.ceil(S / 2 / k) + 2;
    const wood = mixHex(P.ground, P.leaf, 0.45), timber = mixHex(P.leaf, P.snow, 0.25);
    // rows count from the ground line: row -1 is the line itself, 0 and on are under it, and the hut stands `up` rows over it
    const hut = D.glyphs.hut, up = hut.length + 2;
    const cells = Array.from({ length: deep + up }, () => new Array(cols).fill(null));
    // what is under the ground goes into the dark the deeper it is
    const set = (r, c, ch, color, a = 1) => { if (c >= 0 && c < cols && r < deep) cells[r + up][c] = [ch, color, a * (1 - 0.65 * Math.max(0, r) / deep)]; };

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
    // where its stop puts it when the page is at its end
    const w = hut[0].length, stop = sc.stops.find((s) => s.mark === 'hut');
    const left = Math.round(cam.wx((stop.hx + 0.5) * g.cellW, last, k) - x0 - w / 2);
    for (let j = 1; j < w; j++) cells[up - 2][left + j] = null;
    hut.forEach((row, i) => { for (let j = 0; j < w; j++) if (row[j] !== ' ') set(i - hut.length - 1, left + j, row[j], row[j] === '[' || row[j] === ']' ? P.ember : timber); });
    // where the path comes to it (just left of its wall, on the ground), its window and its chimney, in ground cells
    this.door = [left - 0.5, -2];
    this.window = [left + hut[4].indexOf('[') + 1, 4 - hut.length - 1 + 0.5];
    this.chimney = [left + hut[0].indexOf(',') + 0.5, -hut.length - 1];

    // The pane. From the line down it is earth, and hides everything; the hut hides what is behind it.
    const earth = mixHex(P.skyBase, P.groundDark, 0.3), font = Math.round(g.size * k);
    sc.groundPane = cam.pane({
      x: x0, y: sc.groundRow + 1 - up, z: k, cols, rows: deep + up, solid: (c, i) => i >= up - 1 && i < deep + up && c >= 0 && c < cols,
      paint(c0, i0, c1, i1, ox, oy) {
        const { cw, ch } = this, line = up - 1, box = (a, i, b, j, color) => { if (b >= c0 && a <= c1 && j >= i0 && i <= i1) g.box(ox + a * cw - 0.5, oy + i * ch, (b - a + 1) * cw + 1, (j - i + 1) * ch, color); };
        box(0, line, cols - 1, line, P.skyBase); box(0, up, cols - 1, deep + up - 1, earth); hut.forEach((ln, i) => { const a = ln.search(/\S/), b = ln.trimEnd().length - 1; if (a >= 0) box(left + a, up - 1 - hut.length + i, left + b, up - 1 - hut.length + i, P.skyBase); });
        for (let i = i0; i <= i1; i++) for (let c = c0; c <= c1; c++) { const cell = cells[i][c]; if (cell) g.set(cell[0], cell[1], ox + c * cw, oy + i * ch, font, cell[2]); }
      },
    });
  }

  // a place on the ground (its own column, row from the line), in viewport pixels
  at(c, r) { const cam = this.sc.cam; return [cam.px(this.x0 + c, this.k), cam.py(this.sc.groundRow + 1 + r, this.k)]; }
  get showing() { return this.at(0, -8)[1] < this.sc.grid.h; }

  // the one thing here that moves: smoke from the chimney
  draw() {
    if (!this.showing || this.sc.reduced.matches) return;
    const sc = this.sc, g = sc.grid, u = g.size * this.k, [x, y] = this.at(...this.chimney);
    for (let i = 0; i < 4; i++) {
      const t = (sc.time * 0.22 + i / 4) % 1;
      g.ink(t < 0.3 ? '.' : t < 0.65 ? 'o' : 'O', sc.P.dim, x + (Math.sin(t * 5 + i) * 0.5 + t * 1.6) * u, y - t * 3.4 * u, u * (0.6 + t * 0.9), 0.75 * (1 - t) ** 1.2);
    }
  }
}
