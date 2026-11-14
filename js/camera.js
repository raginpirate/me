// The engine: one camera, and everything it looks at.
//
// A thing is a place in the world (X: columns of the page, Y: rows of the
// page) at a depth Z. The page itself stands at Z = 1, and the camera starts
// at Z = 0, so the page is seen at its own size. A thing at distance d from
// the camera is drawn 1/d times its size, and passes 1/d times as fast.
// That one rule is all the perspective there is.
//
// The horizon is fixed on the screen. Down through the stars and past the
// peak the camera only goes down, with the page. From the cloud line it
// goes on down, but slower, and it also backs away from the mountain, and
// slides a little sideways: the slant comes in by the first bridge and is
// held. So what is below you rises toward the horizon and what is above you
// sinks toward it: the ground you came down falls behind and the mountain
// stands further and further off in the sky.
//
// What is painted once is a pane, kept as tiles. A pane is painted in
// cells of type; how big a cell is in the world depends on how near the
// pane is. Near, it is painted in more, smaller cells, so no glyph is ever
// larger than type gets; far, in fewer. Between two ways of painting it the
// one fades into the other. In between it is not painted again: its tiles
// are only drawn smaller, from copies of themselves at half the size, and a
// half of that, made as they are wanted. What a nearer thing hides is not
// drawn at all.

import { clamp } from './util.js';
import { D } from './direction.js';

const T = 256;   // a tile's side, in device pixels
export const MOST = 1.25;   // the largest type is ever drawn, as a share of the page's

export class Camera {
  constructor(sc) {
    const g = this.g = sc.grid, C = D.camera, S = this.S = sc.screenRows;
    this.sc = sc;
    this.mid = g.w / g.cellW / 2;                       // columns to the middle of the screen
    const rest = D.rest[sc.stack ? 'stack' : 'side'];
    this.lampFrac = 0.5 - rest;                          // the light you carry: its height on the screen
    this.h0 = clamp(this.lampFrac - C.above, 0.12, 0.45);   // the horizon
    this.yOff = (0.5 - this.h0) * S;
    this.from = C.from * S;
    this.U = Math.max(0.5, (sc.end + S / 2 - this.from) / S);   // screens of scroll below the cloud line
    this.back = C.back;
    const E = C.ease * (1 - Math.exp(-this.U / C.ease));
    this.Fz = this.U - E;
    // how far it goes down: so that at the end the summit stands just under the top of the screen
    const y0 = this.from - this.yOff, kEnd = 1 / (1 + this.back);
    const yEnd = sc.summitRow + (this.h0 - C.top) * S / kEnd;
    this.fall = Math.max((yEnd - y0) / S, E * 0.4);
    this.a = clamp((this.fall - E) / (this.U - E), 0.03, 1);
    // the sideways slant, in columns a row of scroll, once it is in
    this.slant = clamp(C.slant * g.w / g.h, ...C.within) * g.cellH / g.cellW;
    this.occluders = []; this.kept = 0; this.frame = 0;
    const screen = g.canvas.width * g.canvas.height;
    this.room = Math.min(8 * screen, 3.5 * screen + 14e6);
    this.look(0);
  }

  // ---------- the path ----------
  // where the camera is when the middle of the screen is at row s: [x, y, z]
  path(s) {
    const S = this.S, C = D.camera, x = this.slide(s);
    if (s <= this.from) return [x, s - this.yOff, 0];
    const u = (s - this.from) / S, e = C.ease * (1 - Math.exp(-u / C.ease));
    return [x, this.from - this.yOff + S * (this.a * u + (1 - this.a) * e), -this.back * (u - e) / this.Fz];
  }
  slide(s) {
    const { ramp, rise } = D.camera, S = this.S, r = ramp * S, d = Math.max(0, s - this.from), t = Math.min(d / r, 1), on = Math.max(0, d - r), rest = this.U * S - r;
    return this.slant * (r * (t ** 3 - t ** 4 / 2) + on + rise * on * on / (2 * rest));
  }
  look(s) { this.s = s; [this.x, this.y, this.z] = this.path(s); }

  // ---------- seeing ----------
  k(Z) { const d = Z - this.z; return d > 1e-3 ? 1 / d : 0; }
  dist(Z) { return Z - this.z; }
  px(X, Z = 1) { return this.g.w / 2 + (X - this.x - this.mid) * this.g.cellW * this.k(Z); }
  py(Y, Z = 1) { return this.h0 * this.g.h + (Y - this.y) * this.g.cellH * this.k(Z); }
  // the place at depth Z that shows at a pixel, when the middle of the screen is at row s
  wx(px, s, Z = 1) { const [x, , z] = this.path(s); return x + this.mid + (px - this.g.w / 2) * (Z - z) / this.g.cellW; }
  wy(py, s, Z = 1) { const [, y, z] = this.path(s); return y + (py - this.h0 * this.g.h) * (Z - z) / this.g.cellH; }
  // the size a small thing at depth Z is drawn, as a share of the page's type: never larger than type gets
  size(Z) { return Math.min(this.k(Z), MOST); }

  // ---------- panes ----------
  // A pane: x, y, w, h: the world place of its top left, and its size, in
  // columns and rows. Z: its depth. uMin, uMax: the finest and coarsest
  // cells it may be painted in, in world columns. paint(L, c0, i0, c1, i1,
  // ox, oy): draw cells c0..c1 of rows i0..i1 of level L with the grid, cell
  // (c, i) at ox + c * L.cw, oy + i * L.ch, its type L.font. solidAt(X, Y):
  // does it hide what is behind it there? alpha(d): how much of it shows at
  // distance d (mist).
  pane(p) {
    p.uMin = p.uMin ?? 1; p.uMax = p.uMax ?? 1; p.levels = new Map();
    if (p.solidAt) this.occluders.push(p);
    return p;
  }
  level(p, u, gam) {
    const key = u * 1000 + gam; let L = p.levels.get(key);
    if (!L) { const g = this.g; L = { u, gam, cw: g.cellW * gam, ch: g.cellH * gam, font: Math.round(g.size * gam * 2) / 2, cols: Math.ceil(p.w / u), rows: Math.ceil(p.h / u), tiles: new Map() }; p.levels.set(key, L); }
    return L;
  }
  // which levels to draw a pane at, at scale k: [[u, gam, alpha], ...], the first drawn whole. A level is painted with its
  // type at the page's own size if that is as large as it is wanted, else at the largest; it is only ever drawn smaller.
  choose(p, k) {
    const lam = Math.log2(MOST / k), n = Math.floor(lam), frac = lam - n, w = 0.08;
    const pick = (u) => [u, u * k > 1.0001 ? MOST : 1];   // smaller than that it is drawn from halved copies
    const u = clamp(2 ** n, p.uMin, p.uMax), out = [];
    let other = null, t = 1;
    if (u === 2 ** n) {
      if (frac < w && u / 2 >= p.uMin) { other = u / 2; t = 0.5 + frac / (2 * w); }
      else if (frac > 1 - w && u * 2 <= p.uMax) { other = u * 2; t = 0.5 + (1 - frac) / (2 * w); }
    }
    if (other) out.push([...pick(other), 1]);
    out.push([...pick(u), other ? t : 1]);
    return out;
  }
  // one tile of a level, painted if it has not been: { c: its canvas } or { fill: its one colour }; null if there is nothing on it
  tile(p, L, tx, ty) {
    const key = ty * 4096 + tx; let e = L.tiles.get(key);
    if (e === undefined) {
      const g = this.g, d = g.dpr, t = T / d, u = L.u;
      const W = Math.max(1, Math.min(T, Math.ceil(L.cols * L.cw * d) - tx * T)), H = Math.max(1, Math.min(T, Math.ceil(L.rows * L.ch * d) - ty * T));
      const c0 = Math.max(0, Math.floor(tx * t / L.cw) - 2), c1 = Math.min(L.cols - 1, Math.ceil((tx + 1) * t / L.cw) + 1);
      const i0 = Math.max(0, Math.floor(ty * t / L.ch) - 2), i1 = Math.min(L.rows - 1, Math.ceil((ty + 1) * t / L.ch) + 1);
      // a tile of nothing but one colour is not painted, but filled where it is drawn
      const fill = p.plain && p.plain(u, p.x + c0 * u, p.y + i0 * u, p.x + (c1 + 1) * u, p.y + (i1 + 1) * u);
      if (fill) { L.tiles.set(key, e = { fill, W, H }); e.used = this.frame; return e; }
      const c = this.spare || document.createElement('canvas'), x = c.getContext('2d');
      c.width = W; c.height = H; x.setTransform(d, 0, 0, d, 0, 0); this.spare = null;
      if (g.into(x, c.width / d, c.height / d, () => p.paint(L, c0, i0, c1, i1, -tx * t, -ty * t))) {
        // only the part of it with something on it is drawn
        const [a, b, r, s] = g.reach, bb = [Math.max(0, Math.floor(a * d) - 1), Math.max(0, Math.floor(b * d) - 1), Math.min(W, Math.ceil(r * d) + 1), Math.min(H, Math.ceil(s * d) + 1)];
        e = bb[2] > bb[0] && bb[3] > bb[1] ? { c, W, H, bb } : null;
      }
      if (e) { this.kept += c.width * c.height; } else { e = null; this.spare = c; }
      L.tiles.set(key, e);
    }
    if (e) e.used = this.frame;
    return e;
  }
  // a tile drawn at a scale under a half: a copy of it at a half (and a half of that), made from the one above
  mip(L, tx, ty, c, m) {
    if (m <= 0) return c;
    const key = (ty * 4096 + tx) * 8 + m; let e = (L.mips || (L.mips = new Map())).get(key);
    if (!e) {
      const up = this.mip(L, tx, ty, c, m - 1), d = document.createElement('canvas');
      d.width = Math.max(1, Math.ceil(up.width / 2)); d.height = Math.max(1, Math.ceil(up.height / 2));
      const x = d.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(up, 0, 0, d.width, d.height);
      L.mips.set(key, e = d); this.kept += d.width * d.height;
    }
    return e;
  }
  // where a pane's top left is on the screen, and its scale
  place(p) { const k = this.k(p.Z); return [this.px(p.x, p.Z), this.py(p.y, p.Z), k]; }
  // the tiles of a level on the screen (or within `pad` tiles of it): [tx, ty, x, y, w, h, scale]
  seen(p, L, X0, Y0, k, pad = 0) {
    const g = this.g, d = g.dpr, t = T / d, sc = L.u * k / L.gam, tw = t * sc, out = [];
    if (!(tw > 0.5)) return out;
    const nx = Math.ceil(L.cols * L.cw / t), ny = Math.ceil(L.rows * L.ch / t);
    for (let ty = Math.max(0, Math.floor(-Y0 / tw) - pad); ty <= Math.min(ny - 1, Math.floor((g.h - Y0) / tw) + pad); ty++) {
      for (let tx = Math.max(0, Math.floor(-X0 / tw) - pad); tx <= Math.min(nx - 1, Math.floor((g.w - X0) / tw) + pad); tx++) {
        const x = Math.round((X0 + tx * tw) * d) / d, y = Math.round((Y0 + ty * tw) * d) / d;
        out.push([tx, ty, x, y, Math.round((X0 + (tx + 1) * tw) * d) / d - x, Math.round((Y0 + (ty + 1) * tw) * d) / d - y, sc]);
      }
    }
    return out;
  }
  // draw a pane where the camera puts it now; nearer: the solid things in front of it, whose cover need not be drawn under
  show(p, nearer = [], alpha = 1) {
    const [X0, Y0, k] = this.place(p); if (!(k > 0)) return;
    const a0 = alpha * (p.alpha ? p.alpha(1 / k) : 1); if (a0 < 0.01) return;
    const ctx = this.g.ctx, d = this.g.dpr, W = this.g.w, H = this.g.h;
    for (const [u, gam, a] of this.choose(p, k)) {
      const L = this.level(p, u, gam);
      for (const [tx, ty, x, y, w, h, sc] of this.seen(p, L, X0, Y0, k)) {
        if (nearer.length && this.hiddenRect(nearer, Math.max(0, x), Math.max(0, y), Math.min(W, x + w), Math.min(H, y + h))) continue;
        const e = this.tile(p, L, tx, ty); if (!e) continue;
        const ww = e.W < T ? e.W / d * sc : w, hh = e.H < T ? e.H / d * sc : h;   // a cut tile at the far edge is smaller
        ctx.globalAlpha = this.g.alpha = a0 * a;
        if (e.fill) { ctx.fillStyle = e.fill; ctx.fillRect(x, y, ww, hh); continue; }
        const m = sc < 0.6 ? Math.min(5, Math.max(1, Math.round(-Math.log2(sc)))) : 0;
        const src = this.mip(L, tx, ty, e.c, m), f = src.width / e.W, [l, t, r, b] = e.bb, kx = ww / e.W, ky = hh / e.H;
        ctx.drawImage(src, l * f, t * f, (r - l) * f, (b - t) * f, x + l * kx, y + t * ky, (r - l) * kx, (b - t) * ky);
      }
    }
  }
  // is a rectangle of the screen wholly behind the solid part of one of these (each solid from its top down in every column)
  hiddenRect(nearer, x0, y0, x1, y1) {
    if (x1 <= x0 || y1 <= y0) return true;
    const W = this.g.w, cw = this.g.cellW, ch = this.g.cellH, hy = this.h0 * this.g.h;
    for (const q of nearer) {
      const dq = this.dist(q.Z), Y = this.y + (y0 - hy) * dq / ch, Yb = this.y + (y1 - hy) * dq / ch;
      if (Yb >= q.y + q.h) continue;
      let all = true;
      for (let i = 0; i <= 6 && all; i++) { const X = this.x + this.mid + (x0 + (x1 - x0) * i / 6 - W / 2) * dq / cw; if (!(X >= q.x && X < q.x + q.w && q.solidAt(X, Y))) all = false; }
      if (all) return true;
    }
    return false;
  }
  // Everything below the sky, from the furthest to the nearest. An item is
  // a pane, or { d, draw() } for something that moves.
  render(items) {
    const list = items.map((it) => it.levels ? { d: this.dist(it.Z), pane: it } : it).filter((it) => it.d > 0.02);
    list.sort((a, b) => b.d - a.d);
    this.g.ctx.imageSmoothingQuality = 'low'; this.g.ctx.imageSmoothingEnabled = true;
    // the solid, unmisted panes, nearest first: what hides what is behind it
    const solid = list.filter((it) => it.pane && it.pane.solidAt && it.pane.cover && (!it.pane.alpha || it.pane.alpha(it.d) > 0.995));
    for (const it of list) { if (it.pane) this.show(it.pane, solid.filter((q) => q.d < it.d - 1e-4).map((q) => q.pane)); else it.draw(); }
  }
  // is a pixel hidden by something solid nearer than distance d
  covered(x, y, d) {
    for (const q of this.occluders) {
      const dq = this.dist(q.Z); if (!(dq > 0.02 && dq < d - 1e-4) || (q.alpha && q.alpha(dq) < 0.5)) continue;
      const X = this.x + this.mid + (x - this.g.w / 2) * dq / this.g.cellW, Y = this.y + (y - this.h0 * this.g.h) * dq / this.g.cellH;
      if (X >= q.x && X < q.x + q.w && Y >= q.y && Y < q.y + q.h && q.solidAt(X, Y)) return true;
    }
    return false;
  }

  // once a frame: let go of the tiles longest unseen, if too many are held
  tidy(all) {
    if (this.kept > this.room) {
      const old = [];
      for (const p of all) for (const L of p.levels.values()) for (const [k, e] of L.tiles) if (e && e.c && e.used < this.frame) old.push([e.used, L, k, e.c]);
      old.sort((a, b) => a[0] - b[0]);
      for (const [, L, k, c] of old) {
        if (this.kept <= this.room * 0.8) break;
        L.tiles.delete(k); this.kept -= c.width * c.height;
        if (L.mips) for (let m = 1; m <= 5; m++) { const e = L.mips.get(k * 8 + m); if (e) { L.mips.delete(k * 8 + m); this.kept -= e.width * e.height; } }
      }
    }
    this.frame++;
  }
  // paint one tile that is about to be wanted: just off the screen, or at the next size down; true if there was one
  warm(panes) {
    if (this.kept >= this.room) return false;
    for (const p of panes) {
      const [X0, Y0, k] = this.place(p); if (!(k > 0) || (p.alpha && p.alpha(1 / k) < 0.01)) continue;
      for (const kk of [k, k * 0.8]) for (const [u, gam] of this.choose(p, kk)) {
        const L = this.level(p, u, gam);
        for (const [tx, ty] of this.seen(p, L, X0, Y0, kk, 1)) if (!L.tiles.has(ty * 4096 + tx)) { this.tile(p, L, tx, ty); return true; }
      }
    }
    return false;
  }
}
