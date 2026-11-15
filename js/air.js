// What is behind and around the mountain: the far ranges, the cloud deck.
// Each is a pane at a depth in the camera's world, like everything else.

import { mulberry32, edge, hash, mix } from './util.js';
import { D } from './direction.js';

export class Air {
  constructor(sc) {
    this.sc = sc;
    const { cols, P } = sc, g = sc.grid, cam = sc.cam, S = sc.screenRows, rnd = mulberry32(2026), L = D.layout, n = sc.noise, last = sc.end + S / 2;
    // a thing at depth z is set in whole pixels of type: the type's size, and how many times the page's that is
    const type = (z) => { const font = Math.max(5, Math.round(g.size * cam.size(z))); return [font, font / g.size]; };

    // Far ranges. Each stands on the horizon you reach at the bottom. It is
    // far, so it passes slower than the page: low and small from the
    // summit, standing over you in the valley.
    // z: its depth. tall: its highest crest above the horizon, in screens. relief: how far its crest dips, in
    // screens. wave: columns from peak to peak.
    this.far = [
      { z: 0.2, tall: 0.8, relief: 0.3, wave: 27, a: 0.55, seed: 3.1, hatch: 7 },
      { z: 0.42, tall: 1.52, relief: 0.4, wave: 38, a: 0.85, seed: 8.4, hatch: 11 },
    ].map((d) => {
      const [font, s] = type(d.z), rows = S / s, up = Math.ceil(rows * d.tall) + 2;   // a screen, and its highest crest, in rows of its own type
      // it goes on as far as the camera ever sees of it
      const x = Math.floor(cam.wx(0, 0, d.z)) - 1, width = Math.ceil((cam.wx(g.w, last, d.z) - x) * d.z / s) + 3;
      const top = Float32Array.from({ length: width + 3 }, (_, c) => { const u = c / d.wave + d.seed; return rows * (d.tall - d.relief * (1 - (0.62 * n.ridged(u, d.seed, 3) ** 1.5 + 0.38 * n.noise(u * 0.4 + 5, d.seed)))); });
      return cam.pane({
        x, y: sc.groundRow - up * s / d.z, z: d.z, s, cols: width, rows: Math.ceil(rows * d.relief) + d.hatch + 6,
        paint(c0, i0, c1, i1, ox, oy) {
          const { cw, ch } = this, put = (glyph, color, c, r, a) => g.set(glyph, color, ox + c * cw, oy + (up + r) * ch, font, a);
          for (let c = c0; c <= c1; c++) {
            const h = -top[c + 1], slope = (top[c] - top[c + 2]) / 2, row = Math.floor(h), snowy = top[c + 1] > rows * (d.tall - d.relief * 0.22);
            put(edge(h - row, slope), snowy ? P.snow : P.dim, c, row, snowy ? d.a * 0.6 : d.a);
            // a steep run takes more than one cell
            const next = Math.floor(-top[c + 2]);
            for (let r = Math.min(row, next) + 1; r < Math.max(row, next); r++) put(slope < 0 ? '/' : '\\', P.dim, c + (slope < 0 ? 1 : 0), r, d.a);
            // under the crest: the side away from the moon is hatched, and it all fades into haze
            for (let k = 1; k <= d.hatch; k++) {
              const fade = 1 - k / (d.hatch + 1), r = row + k;
              if (slope > 0.1) { if ((c + r) % 2 === 0) put(k < 3 ? ':' : '.', P.dim, c, r, d.a * 0.75 * fade); }
              else if (hash(c, r, 3) < 0.07) put('.', P.dim, c, r, d.a * 0.6 * fade);
            }
          }
        },
      });
    });

    // The cloud deck: three depths of long, flat-bottomed cloud. veil: how
    // much a cloud hides what is behind it. Those in front of the mountain
    // are thin, so the mountain goes on through the deck and is not cut off
    // by it.
    this.deckRow = Math.round((L.deck[0] + L.deck[1]) / 2 * S);
    this.span = cols + 80;
    const wide = cols > 100 ? 1.5 : 1;
    const mk = (count, spread, w, h, off = 0) => Array.from({ length: count }, () => ({ x: rnd() * this.span, y: Math.round(off * S + (rnd() + rnd() + rnd() - 1.5) / 1.5 * spread * S), w: mix(w, rnd()) * wide, h: mix(h, rnd()), s: rnd() * 100 }));
    const per = Math.max(5, Math.round(cols / 9 / (cols > 100 ? 1.35 : 1)));
    this.layers = [
      { z: 0.74, drift: 0.3, line: P.rockDark, body: P.far, la: 1, ba: 0.85, veil: 1, front: false, items: [...mk(per, 0.22, [9, 22], [2.4, 5]), ...mk(Math.ceil(per / 2), 0.08, [4, 9], [1.2, 2.2], -0.5)] },
      { z: 1, drift: -0.55, line: P.dim, body: P.rockDark, la: 0.95, ba: 0.9, veil: 0.7, front: true, items: [...mk(per, 0.17, [9, 22], [2.8, 6]), ...mk(Math.ceil(per / 2), 0.07, [5, 10], [1.3, 2.4], 0.42)] },
      { z: 1.36, drift: 1.0, line: P.rule, body: P.dim, la: 0.8, ba: 0.55, veil: 0.5, front: true, items: mk(Math.ceil(per * 0.7), 0.16, [9, 20], [3, 6]) },
    ];
    // one cloud that never leaves: it sits on the seam between the painted peak and the body under it
    // (long and low, its top nearly level: flat is how much of its height is the same all along)
    this.layers[1].items.push({ x: 0, y: Math.round(sc.seamRow + 2 - this.deckRow), w: sc.seamHalf * 1.7 + 10, h: 6.2, s: 7, pinned: sc.ax, flat: 0.86 });
    // every cloud is a pane of its own, drawn once: the deck only drifts
    for (const Ly of this.layers) {
      const [font, s] = type(Ly.z);
      for (const it of Ly.items) {
        const W = it.W = Math.ceil(it.w), up = it.up = Math.ceil(it.h) + 1, flat = it.flat ?? 0.5;
        const topAt = (u) => { const e2 = 1 - (u / it.w) ** 2; return e2 <= 0 ? 0 : -it.h * Math.sqrt(e2) * (flat + (1 - flat) * (0.6 * Math.abs(Math.sin(u * 0.33 + it.s)) + 0.4 * n.noise(it.s + u * 0.21, 1.7))); };
        it.pane = cam.pane({
          z: Ly.z, s, cols: 2 * W + 1, rows: up + Math.ceil(it.h * 0.3) + 3,
          paint(c0, i0, c1, i1, ox, oy) {
            const { cw, ch } = this, y0 = oy + up * ch;
            for (let u = c0 - W; u <= c1 - W; u++) {
              const e2 = 1 - (u / it.w) ** 2; if (e2 <= 0) continue;
              const x = ox + (u + W) * cw, t = topAt(u), b = it.h * 0.3 * Math.sqrt(e2) * (0.5 + 0.5 * n.noise(it.s + u * 0.13, 9.2)) + 0.4, rt = Math.floor(t), rb = Math.floor(b);
              g.box(x - 0.4, y0 + rt * ch - 0.5, cw + 0.8, ch + 0.5, P.sky, Ly.veil * 0.5);   // a cloud veils what is behind it, thinly at its top
              g.box(x - 0.4, y0 + (rt + 1) * ch - 0.5, cw + 0.8, (rb - rt) * ch + 1, P.sky, Ly.veil);
              g.set(edge(t - rt, (topAt(u + 1) - topAt(u - 1)) / 2), Ly.line, x, y0 + rt * ch, font, Ly.la * (0.8 + 0.2 * (-u / it.w)));
              // the body: thick in the middle, wispy at the ends, a flat dark base
              for (let r = rt + 1; r <= rb; r++) {
                const v = n.noise(it.s + u * 0.3, r * 1.3 + it.s) + 0.35 * Math.sqrt(e2) - 0.2;
                if (r === rb) g.set(b - rb < 0.5 ? '-' : '_', Ly.body, x, y0 + r * ch, font, Ly.ba);
                else if (v > 0.3) g.set(v > 0.62 ? '=' : v > 0.45 ? '~' : '-', Ly.body, x, y0 + r * ch, font, Ly.ba * (v > 0.62 ? 1 : 0.8));
              }
            }
          },
        });
      }
    }
  }

  // is any of it on screen: the deck drifts, so it must be redrawn
  get showing() { const c = this.sc.centre, [a, b] = D.layout.deck; return c > a - 1.1 && c < b + 1.1; }

  // Mist through the deck, over the mountain: it goes into the clouds and
  // comes out of them, it is not cut off by them. Thickest through the
  // middle of the deck, nothing at its top and bottom.
  drawMist() {
    const sc = this.sc, g = sc.grid, cam = sc.cam, [a, b] = D.layout.deck, S = sc.screenRows;
    const y0 = cam.py((a - 0.12) * S), y1 = cam.py((b + 0.2) * S);
    if (y1 < 0 || y0 > g.h) return;
    const grad = g.ctx.createLinearGradient(0, y0, 0, y1), hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    for (const [t, v] of [[0, 0], [0.3, 0.42], [0.5, 0.5], [0.72, 0.36], [1, 0]]) grad.addColorStop(t, sc.sky + hex(v));
    g.box(0, Math.max(0, y0), g.w, Math.min(g.h, y1) - Math.max(0, y0), grad);
  }

  // The clouds behind the mountain, or those in front of it. Each drifts
  // along its bank and comes round again; the camera carries the bank.
  drawClouds(front) {
    const sc = this.sc, cam = sc.cam, drift = sc.reduced.matches ? 0 : sc.time;
    for (const Ly of this.layers) {
      if (Ly.front !== front) continue;
      const mid = cam.py(this.deckRow, Ly.z);   // the pixel the deck's middle is at
      for (const it of Ly.items) {
        const { cw, ch } = it.pane, slid = cam.drift(Ly.z) / cw;   // how far the camera has carried the bank, in its own cells
        let x0 = (it.x + Ly.drift * drift - slid) % this.span; if (x0 < 0) x0 += this.span; x0 -= 40;
        if (it.pinned !== undefined) x0 = it.pinned + Math.sin(drift * 0.07) * 3 - slid;
        it.pane.at = [(x0 - it.W) * cw, mid + (it.y - it.up) * ch];
      }
      cam.show(Ly.items.map((it) => it.pane));
    }
  }
}
