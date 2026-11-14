// The engine. Everything below the sky is placed by this and by nothing
// else.
//
// A thing is a place in the world (x: columns, y: rows of the page) at a
// depth z. The page itself is z = 1. A nearer thing has a larger z, and
// that one number is both how much larger it is drawn and how much faster
// it passes; a further thing has a smaller z and is smaller and slower.
//
// The camera goes down the page with the scroll. Through the stars and past
// the peak it goes straight down. From the cloud line it also slides
// sideways: slowly at first, then more, and most on the last row of the
// page. The slant never lessens, so nothing ever goes back to moving
// straight.
//
// What is painted once and from then on only moves is a pane: the peak,
// each sheet of the mountain, the ground. A pane is kept as tiles of
// canvas, each painted the first time it is wanted, and a frame only puts
// the tiles where the camera says they are.

import { clamp } from './util.js';
import { D } from './direction.js';

const T = 256;   // a tile's side, in device pixels

export class Camera {
  constructor(sc) {
    const g = this.g = sc.grid, C = D.camera, S = sc.screenRows;
    this.mid = g.w / g.cellW / 2;                       // columns to the middle of the screen
    this.from = C.from * S; this.run = sc.end + S / 2 - this.from;   // from the cloud line to the last row it ever looks at
    // the slant on the last row, in columns a row. It is asked for in screen widths a screen, so a wide screen slides further.
    this.slant = sc.reduced.matches ? 0 : clamp(C.slant * g.w / g.h, ...C.within) * g.cellH / g.cellW;
    this.panes = []; this.all = []; this.kept = 0; this.frame = 0;   // the mountain's panes, furthest first; every pane; pixels of tile held; frames drawn
    const screen = g.canvas.width * g.canvas.height;
    this.room = Math.min(5 * screen, 2.6 * screen + 6e6);   // pixels of tile to hold: a few screens of them, fewer of a very large one
    this.look(0);
  }
  // How far it has slid when it is at row y. The slant is `early` of its
  // full self once `ease` of the way down, and grows on evenly from there:
  // this is the sum of it.
  slide(y) {
    const { ease, early } = D.camera, s = clamp((y - this.from) / this.run, 0, 1), u = Math.min(s / ease, 1);
    return this.slant * this.run * (early * (ease * (u ** 3 - u ** 4 / 2) + Math.max(0, s - ease)) + (1 - early) * s * s / 2);
  }
  look(y) { this.y = y; this.x = this.slide(y); }

  // a place at a depth → a pixel
  px(x, z = 1) { return this.g.w / 2 + (x - this.x - this.mid) * this.g.cellW * z; }
  py(y, z = 1) { return this.g.h / 2 + (y - this.y) * this.g.cellH * z; }
  // the place that shows at a pixel, at depth z, when the camera is at row y
  wx(px, y, z = 1) { return this.slide(y) + this.mid + (px - this.g.w / 2) / (this.g.cellW * z); }
  wy(py, y, z = 1) { return y + (py - this.g.h / 2) / (this.g.cellH * z); }
  // how far across, in pixels, it has carried something at depth z that has no place of its own: a range, a cloud bank, falling snow
  drift(z = 1) { return this.x * this.g.cellW * z; }
  // the size a thing at a depth is drawn: its depth, but far things shrink less than they slow, so they can still be read
  size(z) { return z < 1 ? 0.6 + 0.4 * z : z; }

  // ---------- panes ----------
  // A pane: x, y: the world place of its top left cell. z: its depth.
  // s: the size of its type, in the page's (its depth, unless it says).
  // cols, rows: its size in cells of that type. paint(c0, i0, c1, i1, ox,
  // oy): draw its cells c0..c1 of rows i0..i1 with the grid, cell (c, i) at
  // ox + c * cw, oy + i * ch. solid(c, i): does it hide everything behind
  // that cell, and behind all of its column under that? at: the pixel it
  // is at, for a thing that drifts and has no place of its own.
  pane(p) { const z = p.z ?? 1, s = p.s ?? z; this.all.push(p); return Object.assign(p, { z, cw: this.g.cellW * s, ch: this.g.cellH * s, tiles: new Map() }); }
  // one tile of a pane, painted if it has not been; null if there is nothing on it
  tile(p, tx, ty) {
    const key = ty * 4096 + tx; let e = p.tiles.get(key);
    if (e === undefined) {
      const g = this.g, d = g.dpr, t = T / d, c = this.spare || document.createElement('canvas'), x = c.getContext('2d');
      c.width = Math.min(T, Math.ceil(p.cols * p.cw * d) - tx * T); c.height = Math.min(T, Math.ceil(p.rows * p.ch * d) - ty * T);   // the last ones are cut to fit
      x.setTransform(d, 0, 0, d, 0, 0); this.spare = null;
      const c0 = Math.max(0, Math.floor(tx * t / p.cw) - 1), c1 = Math.min(p.cols - 1, Math.ceil((tx + 1) * t / p.cw));
      const i0 = Math.max(0, Math.floor(ty * t / p.ch) - 1), i1 = Math.min(p.rows - 1, Math.ceil((ty + 1) * t / p.ch));
      if (g.into(x, c.width / d, c.height / d, () => p.paint(c0, i0, c1, i1, -tx * t, -ty * t))) { e = { c }; this.kept += c.width * c.height; } else { e = null; this.spare = c; }
      p.tiles.set(key, e);
    }
    if (e) e.used = this.frame;
    return e && e.c;
  }
  // A list of panes, furthest first, each with the solid panes nearer than
  // it: those after it in the list, and those of `front`.
  order(list, front = []) {
    let nearer = front.filter((q) => q.solid); const out = [];
    for (let n = list.length - 1; n >= 0; n--) { out.push([list[n], nearer]); if (list[n].solid) nearer = [list[n], ...nearer]; }
    return out.reverse();
  }
  // The tiles of a pane that are on the screen (or within `pad` tiles of
  // it), as [tx, ty, x, y]. Not those wholly behind one of `nearer`.
  seen(p, nearer, pad = 0) {
    const g = this.g, d = g.dpr, t = T / d, out = [];
    const X = Math.round((p.at ? p.at[0] : this.px(p.x, p.z)) * d) / d, Y = Math.round((p.at ? p.at[1] : this.py(p.y, p.z)) * d) / d;
    // a pane is solid from some row down in each column: it covers a tile if it is solid all along the tile's top edge, and goes on past its bottom
    const covers = (q, x, y) => {
      const qx = this.px(q.x, q.z), qy = this.py(q.y, q.z), i = Math.floor((y - qy) / q.ch);
      if ((y + t - qy) / q.ch > q.rows) return false;
      for (let c = Math.floor((x - qx) / q.cw); c <= Math.floor((x + t - qx) / q.cw); c++) if (!q.solid(c, i)) return false;
      return true;
    };
    for (let ty = Math.max(0, Math.floor(-Y / t) - pad); ty <= Math.min(Math.ceil(p.rows * p.ch / t) - 1, Math.floor((g.h - Y) / t) + pad); ty++) {
      for (let tx = Math.max(0, Math.floor(-X / t) - pad); tx <= Math.min(Math.ceil(p.cols * p.cw / t) - 1, Math.floor((g.w - X) / t) + pad); tx++) {
        const x = X + tx * t, y = Y + ty * t;
        if (!nearer.some((q) => covers(q, x, y))) out.push([tx, ty, x, y]);
      }
    }
    return out;
  }
  // draw a list of panes, furthest first: the mountain, unless another is given
  show(list = this.panes, front) {
    for (const [p, nearer] of this.order(list, front)) for (const [tx, ty, x, y] of this.seen(p, nearer)) { const c = this.tile(p, tx, ty); if (c) this.g.blit(c, x, y); }
  }
  // once a frame: let go of the tiles longest unseen, if too many are held
  tidy() {
    if (this.kept > this.room) {
      const old = this.all.flatMap((p) => [...p.tiles].filter(([, e]) => e && e.used < this.frame).map(([k, e]) => [e.used, p, k, e.c])).sort((a, b) => a[0] - b[0]);
      for (const [, p, k, c] of old) { if (this.kept <= this.room * 0.8) break; p.tiles.delete(k); this.kept -= c.width * c.height; }
    }
    this.frame++;
  }
  // Paint one tile of the mountain that is about to be wanted: one just
  // off the screen, below it if the page is going down (way > 0), above it
  // if up; the nearest pane's first. True if there was one.
  warm(way) {
    if (this.kept >= this.room) return false;
    for (const [p, nearer] of this.order(this.panes).reverse()) {
      for (const [tx, ty, , y] of this.seen(p, nearer, 1)) if ((way > 0 ? y >= this.g.h : y + T / this.g.dpr <= 0) && !p.tiles.has(ty * 4096 + tx)) { this.tile(p, tx, ty); return true; }
    }
    return false;
  }
}
