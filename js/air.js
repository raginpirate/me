// What is behind and around the mountain: the far ranges, the cloud deck.

import { mulberry32, edge, hash, mix } from './util.js';
import { D } from './direction.js';

export class Air {
  constructor(sc) {
    this.sc = sc;
    const { cols, P } = sc, S = sc.screenRows, rnd = mulberry32(2026), n = sc.noise, L = D.layout;

    // Far ranges. Each stands on the horizon you reach at the bottom and
    // moves up the screen slower than the page, so it is low and small from
    // the summit and stands over you in the valley.
    // p: its share of the scroll. tall: its highest crest above the horizon, in screens.
    // relief: how far its crest dips, in screens. wave: columns from peak to peak. k: the size it is set in.
    this.ranges = [
      { p: 0.2, tall: 0.8, relief: 0.3, wave: 27, k: 0.78, color: P.dim, a: 0.55, seed: 3.1, hatch: 7 },
      { p: 0.42, tall: 1.52, relief: 0.4, wave: 38, k: 0.9, color: P.dim, a: 0.85, seed: 8.4, hatch: 11 },
    ];
    for (const d of this.ranges) {
      const count = Math.ceil(cols / d.k) + 3;
      d.h = new Float32Array(count);
      for (let c = 0; c < count; c++) {
        const x = c / d.wave + d.seed, m = n.ridged(x, d.seed, 3), big = n.noise(x * 0.4 + 5, d.seed);
        d.h[c] = S / d.k * (d.tall - d.relief * (1 - (0.62 * m ** 1.5 + 0.38 * big)));
      }
    }

    // The cloud deck: three depths of long, flat-bottomed cloud. A nearer
    // layer is set larger and passes faster than the page, a further one
    // smaller and slower: k is both.
    this.deckRow = Math.round((L.deck[0] + L.deck[1]) / 2 * S);
    this.span = cols + 80;
    const wide = cols > 100 ? 1.5 : 1;
    const mk = (count, spread, w, h, off = 0) => Array.from({ length: count }, () => ({ x: rnd() * this.span, y: Math.round(off * S + (rnd() + rnd() + rnd() - 1.5) / 1.5 * spread * S), w: mix(w, rnd()) * wide, h: mix(h, rnd()), s: rnd() * 100 }));
    const per = Math.max(5, Math.round(cols / 9));
    this.layers = [
      { k: 0.74, drift: 0.3, line: P.rockDark, body: P.far, la: 1, ba: 0.85, front: false, items: [...mk(per, 0.22, [9, 22], [2.4, 5]), ...mk(Math.ceil(per / 2), 0.08, [4, 9], [1.2, 2.2], -0.5)] },
      { k: 1, drift: -0.55, line: P.dim, body: P.rockDark, la: 0.95, ba: 0.9, front: true, items: [...mk(per, 0.17, [9, 22], [2.8, 6]), ...mk(Math.ceil(per / 2), 0.07, [5, 10], [1.3, 2.4], 0.42)] },
      { k: 1.36, drift: 1.0, line: P.rule, body: P.dim, la: 0.8, ba: 0.55, front: true, items: mk(Math.ceil(per * 0.7), 0.16, [9, 20], [3, 6]) },
    ];
    // one cloud that never leaves: it sits on the seam between the painted peak and the cut-outs
    // (long and low, its top nearly level: flat is how much of its height is the same all along)
    this.layers[1].items.push({ x: 0, y: Math.round(sc.seamRow + 2 - this.deckRow), w: sc.seamHalf * 1.7 + 10, h: 6.2, s: 7, pinned: sc.ax, flat: 0.86 });
  }

  // is any of it on screen: the deck drifts, so it must be redrawn
  get showing() { const c = this.sc.centre, [a, b] = D.layout.deck; return c > a - 1.1 && c < b + 1.1; }

  drawRanges() {
    const sc = this.sc, g = sc.grid, S = sc.screenRows, P = sc.P, H = g.h;
    for (const d of this.ranges) {
      const cw = g.cellW * d.k, ch = g.cellH * d.k, size = g.size * d.k;
      const foot = H / 2 + d.p * (sc.maxScroll - sc.scrollRows) * g.cellH;   // screen pixel of the range's foot
      if (foot - d.tall * S * g.cellH > H + 4) continue;
      for (let c = 0; c + 2 < d.h.length; c++) {
        const h = -d.h[c + 1], slope = (d.h[c] - d.h[c + 2]) / 2, row = Math.floor(h), y = foot + row * ch, x = c * cw;
        if (y > H + 4 || y < -(d.hatch + 2) * ch || x > g.w) continue;
        const snowy = d.h[c + 1] > S / d.k * (d.tall - d.relief * 0.22);
        g.set(edge(h - row, slope), snowy ? P.snow : d.color, x, y, size, snowy ? d.a * 0.6 : d.a);
        // a steep run takes more than one cell
        const next = Math.floor(-d.h[c + 2]);
        for (let r = Math.min(row, next) + 1; r < Math.max(row, next); r++) g.set(slope < 0 ? '/' : '\\', d.color, x + (slope < 0 ? cw : 0), foot + r * ch, size, d.a);
        // under the crest: the side away from the moon is hatched, and it all fades into haze
        for (let k = 1; k <= d.hatch; k++) {
          const fade = 1 - k / (d.hatch + 1), r = row + k;
          if (slope > 0.1) { if ((c + r) % 2 === 0) g.set(k < 3 ? ':' : '.', d.color, x, foot + r * ch, size, d.a * 0.75 * fade); }
          else if (hash(c, r, 3) < 0.07) g.set('.', d.color, x, foot + r * ch, size, d.a * 0.6 * fade);
        }
      }
    }
  }

  drawClouds(front) {
    const sc = this.sc, g = sc.grid, n = sc.noise, H = g.h, drift = sc.reduced.matches ? 0 : sc.time;
    for (const L of this.layers) {
      if (L.front !== front) continue;
      const cw = g.cellW * L.k, ch = g.cellH * L.k, size = g.size * L.k;
      const mid = H / 2 + (this.deckRow - sc.centreRow) * ch;   // screen pixel of the deck's middle
      if (mid < -H || mid > 2 * H) continue;
      for (const it of L.items) {
        const y0 = mid + it.y * ch;
        if (y0 < -(it.h + 2) * ch || y0 > H + (it.h + 2) * ch) continue;
        let x0 = (it.x + L.drift * drift) % this.span; if (x0 < 0) x0 += this.span; x0 -= 40;
        if (it.pinned !== undefined) x0 = it.pinned + Math.sin(drift * 0.07) * 3;
        if ((x0 + it.w) * cw < -4 || (x0 - it.w) * cw > g.w + 4) continue;
        const W = Math.ceil(it.w);
        const topAt = (u) => { const e2 = 1 - (u / it.w) ** 2; const flat = it.flat ?? 0.5; return e2 <= 0 ? 0 : -it.h * Math.sqrt(e2) * (flat + (1 - flat) * (0.6 * Math.abs(Math.sin(u * 0.33 + it.s)) + 0.4 * n.noise(it.s + u * 0.21, 1.7))); };
        for (let u = -W; u <= W; u++) {
          const e2 = 1 - (u / it.w) ** 2; if (e2 <= 0) continue;
          const t = topAt(u), b = it.h * 0.3 * Math.sqrt(e2) * (0.5 + 0.5 * n.noise(it.s + u * 0.13, 9.2)) + 0.4;
          const rt = Math.floor(t), rb = Math.floor(b), x = (x0 + u) * cw;
          g.box(x - 0.4, y0 + rt * ch - 0.5, cw + 0.8, (rb - rt + 1) * ch + 1, sc.sky);   // a cloud hides what is behind it
          g.set(edge(t - rt, (topAt(u + 1) - topAt(u - 1)) / 2), L.line, x, y0 + rt * ch, size, L.la * (0.8 + 0.2 * (-u / it.w)));
          // the body: thick in the middle, wispy at the ends, a flat dark base
          for (let r = rt + 1; r <= rb; r++) {
            const v = n.noise(it.s + u * 0.3, r * 1.3 + it.s) + 0.35 * Math.sqrt(e2) - 0.2;
            if (r === rb) g.set(b - rb < 0.5 ? '-' : '_', L.body, x, y0 + r * ch, size, L.ba);
            else if (v > 0.3) g.set(v > 0.62 ? '=' : v > 0.45 ? '~' : '-', L.body, x, y0 + r * ch, size, L.ba * (v > 0.62 ? 1 : 0.8));
          }
        }
      }
    }
  }
}
