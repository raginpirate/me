// What is round the mountain: far ranges on the horizon, and cloud. Each is
// a pane at its own depth in the camera's world, like everything else, and
// is painted from its own shape at whatever size it is seen, so it is drawn
// in more cells when near and fewer when far.
//
// The cloud deck wraps the mountain's waist. You come down through it, and
// as the camera backs away it stays there round the mountain, with banks of
// cloud further off in the sky beyond: there is cloud in sight all the way
// down.

import { mulberry32, edge, hash, mix } from './util.js';
import { D } from './direction.js';

export class Air {
  constructor(sc) {
    this.sc = sc;
    const { cols, P } = sc, cam = sc.cam, g = sc.grid, S = sc.screenRows, rnd = mulberry32(2026), L = D.layout, n = sc.noise;
    const last = sc.end + S / 2, [, yEnd] = cam.path(last);
    // how far either side a thing at depth Z is ever seen
    const across = (Z) => { const xs = [cam.wx(0, cam.from, Z), cam.wx(g.w, cam.from, Z), cam.wx(0, last, Z), cam.wx(g.w, last, Z)]; return [Math.min(...xs) - 20, Math.max(...xs) + 20]; };

    // ---------- far ranges ----------
    // Z: its depth. tall: its highest crest above its foot, in screens; relief: how far its crest dips; wave: columns from peak to peak.
    const foot = yEnd + 0.3 * S;
    this.ranges = [
      { Z: 5.5, tall: 2.3, relief: 0.9, wave: 150, a: 0.7, seed: 3.1, hatch: 7 },
      { Z: 12, tall: 4.6, relief: 1.6, wave: 260, a: 0.95, seed: 8.4, hatch: 11 },
    ].map((r) => {
      const [xa, xb] = across(r.Z), top = (X) => S * (r.tall - r.relief * (1 - (0.62 * n.ridged(X / r.wave + r.seed, r.seed, 3) ** 1.5 + 0.38 * n.noise(X / r.wave * 0.4 + 5, r.seed))));
      const y0 = Math.floor(foot - r.tall * S - 4), h = Math.ceil(foot - y0 + 0.6 * S);
      const p = cam.pane({
        Z: r.Z, x: Math.floor(xa), y: y0, w: Math.ceil(xb - xa), h, uMin: 1, uMax: 64, kind: 'range',
        // under the hatching it is all sky
        plain: (u, X0, Y0, X1) => { for (let X = X0; X <= X1 + 1e-6; X += u) if (!(foot - top(Math.min(X, X1)) + (r.hatch + 2) * u < Y0)) return null; return P.sky; },
        paint: (Lv, c0, i0, c1, i1, ox, oy) => {
          const u = Lv.u, { cw, ch, font } = Lv;
          for (let c = c0; c <= c1; c++) {
            const X = p.x + (c + 0.5) * u, t = top(X), slope = (top(X - u) - top(X + u)) / (2 * u), crest = (foot - t - y0) / u, row = Math.floor(crest);
            if (row > i1) continue;
            // it hides what is behind it
            const from = Math.max(i0, row);
            if (from <= i1) g.box(ox + c * cw - 0.5, oy + from * ch, cw + 1, (i1 - from + 1) * ch + 1, P.sky);
            const snowy = t > S * (r.tall - r.relief * 0.22);
            if (row >= i0) g.set(edge(crest - row, slope), snowy ? P.snow : P.dim, ox + c * cw, oy + row * ch, font, snowy ? r.a * 0.6 : r.a);
            // under the crest: the side away from the moon is hatched, and it all fades into haze
            for (let k = 1; k <= r.hatch; k++) {
              const i = row + k; if (i < i0 || i > i1) continue;
              const fade = 1 - k / (r.hatch + 1);
              if (slope > 0.06) { if ((c + i) % 2 === 0) g.set(k < 3 ? ':' : '.', P.dim, ox + c * cw, oy + i * ch, font, r.a * 0.75 * fade); }
              else if (hash(c, i, 3 + u) < 0.07) g.set('.', P.dim, ox + c * cw, oy + i * ch, font, r.a * 0.6 * fade);
            }
          }
        },
      });
      return p;
    });

    // ---------- cloud ----------
    // The deck: three depths of long, flat-bottomed cloud round the mountain.
    // veil: how much a cloud hides what is behind it. Then banks further off.
    this.deckRow = Math.round((L.deck[0] + L.deck[1]) / 2 * S);
    const wide = cols > 100 ? 1.5 : 1, per = Math.max(5, Math.round(cols / 9 / (cols > 100 ? 1.35 : 1)));
    const layers = [
      { Z: 1.35, drift: 0.3, line: P.rockDark, body: P.far, la: 1, ba: 0.85, veil: 1, spread: 0.22, count: per, w: [9, 22], h: [2.4, 5] },
      { Z: 1.35, drift: 0.3, line: P.rockDark, body: P.far, la: 1, ba: 0.85, veil: 1, spread: 0.08, count: Math.ceil(per / 2), w: [4, 9], h: [1.2, 2.2], off: -0.5 },
      { Z: 1, drift: -0.55, line: P.dim, body: P.rockDark, la: 0.95, ba: 0.9, veil: 0.7, spread: 0.17, count: per, w: [9, 22], h: [2.8, 6] },
      { Z: 1, drift: -0.55, line: P.dim, body: P.rockDark, la: 0.95, ba: 0.9, veil: 0.7, spread: 0.07, count: Math.ceil(per / 2), w: [5, 10], h: [1.3, 2.4], off: 0.42 },
      { Z: 0.735, drift: 1.0, line: P.rule, body: P.dim, la: 0.8, ba: 0.55, veil: 0.5, spread: 0.16, count: Math.ceil(per * 0.7), w: [9, 20], h: [3, 6] },
      // banks out in the sky, further off: bigger, and seen small
      { Z: 2.6, drift: 0.2, line: P.dim, body: P.far, la: 0.8, ba: 0.6, sparse: 0.55, veil: 0.85, spread: 0.3, count: Math.ceil(per * 0.8), w: [20, 44], h: [4, 9], off: 0.15 },
      { Z: 5, drift: 0.12, line: P.dim, body: P.far, la: 0.6, ba: 0.5, sparse: 0.62, veil: 0.8, spread: 0.45, count: Math.ceil(per * 0.8), w: [40, 90], h: [7, 16], off: -0.2 },
    ];
    // each depth of cloud is one wide bank, painted once, and drawn twice side by side as it drifts, so it goes round
    this.clouds = [];
    for (const Ly of layers) {
      const [xa, xb] = across(Ly.Z), span = Math.ceil(xb - xa), mid = sc.ax - xa, items = [];
      const count = Math.round(Ly.count * Math.max(1, span / (cols * 1.2)) * 0.5);
      for (let i = 0; i < count; i++) {
        const X = rnd() < 0.45 ? ((mid + (rnd() - 0.5) * cols * 1.6) % span + span) % span : rnd() * span;
        items.push({ X, Y: Math.round((Ly.off ?? 0) * S + (rnd() + rnd() + rnd() - 1.5) / 1.5 * Ly.spread * S), w: mix(Ly.w, rnd()) * wide, h: mix(Ly.h, rnd()), s: rnd() * 100, flat: 0.5 });
      }
      this.bank(Ly, items, xa, span);
    }
    // one cloud that never leaves: it sits on the seam between the painted peak and the massif under it
    const seam = { Y: Math.round(sc.seamRow + 2 - this.deckRow), w: sc.seamHalf * 1.7 + 10, h: 6.2, s: 7, flat: 0.86 };
    seam.X = Math.ceil(seam.w) + 1;
    this.pinned = this.bankPane(layers[2], [seam], sc.ax - seam.X, 2 * seam.X + 1, false);
    this.pinned.X0 = this.pinned.x;
  }

  // a bank of cloud: two panes, side by side, that share their painting
  bank(Ly, items, xa, span) {
    const a = this.bankPane(Ly, items, xa, span, true), b = this.sc.cam.pane({ ...a });
    b.levels = a.levels;
    for (const p of [a, b]) Object.assign(p, { Ly, xa, span });
    this.clouds.push([a, b]);
  }
  // A pane of cloud. Each cloud's shape is worked out from its own numbers
  // at whatever size it is painted. wrap: the bank goes round, so a cloud
  // over one end is painted over the other end too.
  bankPane(Ly, items, xa, span, wrap) {
    const sc = this.sc, g = sc.grid, P = sc.P, n = sc.noise;
    const top = Math.min(...items.map((it) => it.Y - it.h)) - 2, bottom = Math.max(...items.map((it) => it.Y + it.h * 0.3)) + 3;
    const shapes = items.map((it) => ({
      it, top: (U) => { const e2 = 1 - (U / it.w) ** 2; return e2 <= 0 ? 0 : -it.h * Math.sqrt(e2) * (it.flat + (1 - it.flat) * (0.6 * Math.abs(Math.sin(U * 0.33 + it.s)) + 0.4 * n.noise(it.s + U * 0.21, 1.7))); },
      base: (U) => { const e2 = 1 - (U / it.w) ** 2; return e2 <= 0 ? 0 : it.h * 0.3 * Math.sqrt(e2) * (0.5 + 0.5 * n.noise(it.s + U * 0.13, 9.2)) + 0.4; },
    }));
    return sc.cam.pane({
      Z: Ly.Z, x: xa, y: this.deckRow + top, w: span, h: bottom - top, uMin: 0.5, uMax: 64, kind: 'cloud',
      paint: (L, c0, i0, c1, i1, ox, oy) => {
        const u = L.u, { cw, ch, font } = L, x0 = c0 * u, x1 = (c1 + 1) * u;
        for (const { it, top: topAt, base: baseAt } of shapes) for (const shift of wrap ? [0, -span, span] : [0]) {
          const cxw = it.X + shift; if (cxw + it.w < x0 || cxw - it.w > x1) continue;
          const mid = (it.Y - top) / u;   // the cloud's middle row, in cells from the top of the pane
          for (let c = Math.max(c0, Math.floor((cxw - it.w) / u)); c <= Math.min(c1, Math.ceil((cxw + it.w) / u)); c++) {
            const U = (c + 0.5) * u - cxw; if (Math.abs(U) >= it.w) continue;
            const t = topAt(U) / u + mid, b = baseAt(U) / u + mid, rt = Math.floor(t), rb = Math.floor(b), x = ox + c * cw;
            if (rb < i0 - 1 || rt > i1 + 1) continue;
            g.box(x - 0.4, oy + rt * ch - 0.5, cw + 0.8, ch + 0.5, P.sky, Ly.veil * 0.5);   // a cloud veils what is behind it, thinly at its top
            g.box(x - 0.4, oy + (rt + 1) * ch - 0.5, cw + 0.8, (rb - rt) * ch + 1, P.sky, Ly.veil);
            g.set(edge(t - rt, (topAt(U + u) - topAt(U - u)) / (2 * u)), Ly.line, x, oy + rt * ch, font, Ly.la * (0.8 + 0.2 * (-U / it.w)));
            // the body: thick in the middle, wispy at the ends, a flat dark base
            const e2 = 1 - (U / it.w) ** 2;
            for (let r = rt + 1; r <= rb; r++) {
              const v = n.noise(it.s + U * 0.3, r * u * 1.3 + it.s) + 0.35 * Math.sqrt(e2) - 0.2;
              if (r === rb) g.set(b - rb < 0.5 ? '-' : '_', Ly.body, x, oy + r * ch, font, Ly.ba);
              else if (v > (Ly.sparse ?? 0.3)) g.set(v > 0.62 ? '=' : v > 0.45 ? '~' : '-', Ly.body, x, oy + r * ch, font, Ly.ba * (v > 0.62 ? 1 : 0.8));
            }
          }
        }
      },
    });
  }

  // is any of it on screen: the cloud drifts, so it must be redrawn
  get showing() { return this.sc.centre > D.layout.deck[0] - 1.1; }

  // what to draw: the ranges, and every bank of cloud where it has drifted to
  items() {
    const sc = this.sc, t = sc.reduced.matches ? 0 : sc.time, out = [...this.ranges];
    this.pinned.x = this.pinned.X0 + Math.sin(t * 0.07) * 3;
    out.push(this.pinned);
    for (const [a, b] of this.clouds) {
      const off = ((a.Ly.drift * t) % a.span + a.span) % a.span;
      a.x = a.xa + off; b.x = a.x - a.span;
      out.push(a, b);
    }
    return out;
  }
}

