// <ascii-scene> — a night mountain drawn in type.
//
// A tall scene the browser scrolls through 1:1. At the top a sky: stars,
// the name, shooting stars, each a particle on a spring or on a path.
// Then the painted peak, and below it the mountain: sheets one behind
// another with the route going down over them, clouds and far ranges
// behind, and things that live there. All of that is placed by one camera
// (camera.js), and what never changes is painted once, into its panes.
// The page starts it with start(); until then it is an empty element.

import { Grid } from './grid.js';
import { buildWorld } from './world.js';
import { D } from './direction.js';
import { layoutName } from './asterism.js';
import { clamp, smooth, mulberry32, twinkle, mix, makeNoise, hash, mixHex } from './util.js';
import { Camera } from './camera.js';
import { Massif } from './massif.js';
import { Air } from './air.js';
import { Life } from './life.js';

// The palette is the page's own: one definition, in styles.css.
// P.rockLight reads --rock-light.
function palette(el) {
  const css = getComputedStyle(el);
  return new Proxy({}, {
    get(seen, key) {
      if (typeof key !== 'string') return undefined;
      return seen[key] ?? (seen[key] = css.getPropertyValue('--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())).trim());
    },
  });
}

export class AsciiScene extends HTMLElement {
  // Build and run. Returns false if the scene cannot be drawn here, and the
  // page stays the text document it already is.
  start() {
    if (this.started) return true;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.rnd = mulberry32(99);
    this.t0 = performance.now();
    this.t = 0; this.scrollRows = 0; this.scrollVel = 0;
    this.pointer = null;
    this.quiet = [];
    this.lampCount = this.lampCount || 0;
    try {
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-hidden', 'true');
      this.appendChild(this.canvas);
      this.viewW = innerWidth; this.viewH = this.largeViewportHeight();
      this.grid = new Grid(this.canvas, { font: getComputedStyle(this).fontFamily });
      this.build();
    } catch (e) { console.warn('ascii scene failed', e); this.canvas?.remove(); return false; }

    this.onScroll = () => { this.scrollTarget = scrollY / this.grid.cellH; };
    // screen cells; converted to world cells each frame
    this.onPointer = (e) => { this.pointer = [e.clientX / this.grid.cellW, e.clientY / this.grid.cellH]; this.pointerAt = performance.now(); };
    this.onResize = () => {
      // a mobile URL bar showing or hiding only changes the height a little:
      // ignore that. Rebuild for a width change or an orientation change.
      const h = this.largeViewportHeight();
      if (innerWidth === this.viewW && Math.abs(h - this.viewH) < this.viewH * 0.2) return;
      this.viewW = innerWidth; this.viewH = h;
      this.build();
    };
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('pointermove', this.onPointer, { passive: true });
    addEventListener('resize', this.onResize);
    this.onScroll();
    this.scrollRows = this.scrollTarget;
    this.loop = this.loop.bind(this);
    this.started = true;
    requestAnimationFrame(this.loop);
    return true;
  }

  disconnectedCallback() {
    if (!this.started) return;
    removeEventListener('scroll', this.onScroll); removeEventListener('pointermove', this.onPointer); removeEventListener('resize', this.onResize);
    this.stopped = true;
  }
  pause() { this.paused = true; }
  resume() { if (!this.paused) return; this.paused = false; this.last = 0; this.dirty = true; this.told = undefined; requestAnimationFrame(this.loop); }

  // the viewport height with the browser's bars hidden (100lvh), so the
  // painting is laid out once and the bars just cover its bottom rows
  largeViewportHeight() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;height:100lvh;width:0;pointer-events:none;visibility:hidden';
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h > 0 ? Math.max(h, innerHeight) : innerHeight;
  }

  // ---------- build the world and everything that lives in it ----------
  build() {
    const g = this.grid, L = D.layout;
    const P = this.P = palette(document.documentElement);
    if (!P.sky) throw new Error('the stylesheet did not load');
    // the page's one test for "cards stack under the scene", and the width of
    // its centred stage, both set in the stylesheet
    const page = getComputedStyle(document.documentElement);
    this.stack = page.getPropertyValue('--stack').trim() === '1';
    const stagePx = parseFloat(page.getPropertyValue('--stage')) || Infinity;
    g.size = this.stack ? D.type.stack : this.viewW < D.type.wideFrom ? D.type.mid : D.type.wide;
    g.resize(this.viewW, this.viewH);
    this.u = g.size / D.type.stack; // lights are measured in pixels at the stack type size

    const S = this.screenRows = this.viewH / g.cellH;
    this.cols = g.cols;
    this.rows = Math.ceil(L.screens * S) + 2;
    this.maxScroll = (L.screens - 1) * S;
    this.aspect = g.cellW / g.cellH; // a column is this many rows wide
    this.noise = makeNoise(77);
    const rnd = mulberry32(2026);

    // page height follows the world, in pixels, so the scroll range does not
    // move when a browser bar comes and goes
    document.documentElement.style.setProperty('--world-height', `${Math.round(this.rows * g.cellH)}px`);

    // The peak is painted, as it always was, down to a seam inside the
    // clouds. Through the seam the painting thins out cell by cell and the
    // massif's core fills in.
    // the furthest the scene scrolls, and the ground line: the row in the middle of the screen when it is there,
    // so the last screen is half above ground and half below
    this.end = this.rows - S;
    this.summitRow = L.summit * S; this.seamRow = Math.round(L.seam * S); this.groundRow = Math.round(this.end + S / 2);
    this.blend = 3; this.bodyTop = this.seamRow - this.blend;
    const w = this.world = buildWorld(this.cols, this.rows, S, D, P, this.seamRow + this.blend + 1);
    this.painted = (row, c) => row < this.bodyTop || hash(row, c, 5) > (row - this.bodyTop) / (2 * this.blend);
    const inside = (c, r) => c >= 0 && c < this.cols && w.peak[c] <= r;
    this.peakSpan = [];   // what the peak covers on each row: [from, to)
    for (let row = 0; row <= this.seamRow + this.blend; row++) {
      let a = w.topCol, b = w.topCol;
      const on = inside(a, row);
      if (on) { while (inside(a - 1, row)) a--; while (inside(b + 1, row)) b++; this.peakSpan[row] = [a, b + 1]; }
      const cells = w.cells[row];
      for (let c = 0; c < this.cols; c++) if (cells[c] && (!on || c < a || c > b || !this.painted(row, c))) cells[c] = null;
    }
    const seam = this.peakSpan[this.seamRow];
    this.seamHalf = (seam[1] - seam[0]) / 2; this.ax = (seam[0] + seam[1]) / 2;   // the massif's axis and its width where it takes over
    // the route starts at the flag: a fixed rope down the peak to the seam
    this.rope = [];
    for (let row = Math.ceil(this.summitRow) + 2, n = 0; row < this.bodyTop; row++, n++) {
      const t = n / (this.bodyTop - this.summitRow), span = this.peakSpan[row];
      const c = clamp(Math.round(w.topCol + 1 + (Math.floor(this.ax + 0.5) - w.topCol - 1) * t), span[0] + 1, span[1] - 2);
      w.cells[row][c] = n % 4 === 0 ? ['+', P.muted, 0.8] : [':', P.muted, 0.5];
      this.rope.push([c, row, w.cells[row][c][0]]);
    }

    // field stars: everywhere above the mountain, three tiers
    this.field = [];
    const star = (x, y, dimShare, midShare) => {
      const u = rnd();
      const tier = u < dimShare ? 0 : u < midShare ? 1 : 2;
      const ch = tier === 0 ? (rnd() < 0.2 ? '·' : '.') : tier === 1 ? (rnd() < 0.15 ? '+' : '*') : '✦';
      this.field.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, tier, ch, phase: rnd() * 6.28, fade: 1 });
    };
    const skyRows = Math.floor(L.deck[1] * S);
    const count = Math.floor((this.cols * skyRows) / 58);
    for (let i = 0; i < count; i++) {
      const x = rnd() * this.cols, y = rnd() * skyRows, span = this.peakSpan[Math.floor(y)];
      if (span && x >= span[0] && x < span[1]) continue;
      // most stars are gone by the top of the cloud deck; one in four shows through it
      const through = rnd() < 0.25, ys = y / S;
      const fade = Math.max(1 - smooth(L.deck[0] - 0.12, L.deck[0] + 0.3, ys), through ? 0.7 * (1 - smooth(L.deck[1] - 0.3, L.deck[1], ys)) : 0);
      if (fade < 0.03) continue;
      star(x, y, 0.7, 0.94);
      this.field[this.field.length - 1].fade = fade;
    }
    // the sky above the name is what you see first: a little denser there,
    // with a few bright ones, so the name is not alone up top
    const nameTop = Math.max(6, L.name * this.screenRows - 7 * (this.stack ? 1 : 1.4));
    const extra = Math.floor(this.cols * nameTop / 30);
    for (let i = 0; i < extra; i++) { const x = rnd() * this.cols, y = rnd() * nameTop; star(x, y, 0.5, 0.85); }

    // the name
    const name = layoutName(this.getAttribute('name') || '', { seed: 7, tight: this.stack });
    const wordWidth = this.stack ? 5.9 : 7.3;
    const unitPx = Math.min((this.stack ? 3.4 : 4.4) * g.cellH / 0.58, (this.stack ? 0.94 : 0.7) * this.viewW / wordWidth);
    const ux = unitPx / g.cellW, uy = unitPx / g.cellH;
    const cx = this.cols * 0.5, cy = L.name * this.screenRows;
    this.nameStars = name.stars.map(([x, y, anchor]) => {
      const X = cx + x * ux, Y = cy - y * uy;
      return { x: X, y: Y, hx: X, hy: Y, vx: 0, vy: 0, anchor };
    });
    this.nameLines = name.lines;
    // keep the sky clear around the name, so no stray star sits against it or reads as part of a letter
    const [byStar, byLine] = D.clear.name.map((v) => v * this.u);
    const at = (p) => [(p.x + 0.5) * g.cellW, (p.y + 0.5) * g.cellH];
    const marks = this.nameStars.map(at), runs = this.nameLines.map(([i, j]) => [...marks[i], ...marks[j]]);
    this.field = this.field.filter((p) => {
      const [x, y] = at(p);
      for (const [mx, my] of marks) if (Math.hypot(x - mx, y - my) < byStar) return false;
      for (const [x0, y0, x1, y1] of runs) {
        const dx = x1 - x0, dy = y1 - y0, t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        if (Math.hypot(x - x0 - dx * t, y - y0 - dy * t) < byLine) return false;
      }
      return true;
    });
    // half of the name's stars were always there; the rest twinkle in
    const seeded = mulberry32(31);
    this.nameSeeds = this.nameStars.map(() => seeded());

    // the stops: when each card is open, where a glide rests, where its light is
    const span = L.screens - 1, last = this.rows - this.screenRows;   // span: the scroll's length in screens
    const toT = (centre) => clamp((centre - 0.5) / span, 0, 1);                       // viewport centre in screens → scroll fraction
    const restRow = (centre) => clamp((centre - 0.5) * this.screenRows, 0, last);  // → the scroll position, in rows
    const mode = this.stack ? 'stack' : 'side', stage = Math.min(this.cols, stagePx / g.cellW);
    this.fade = D.fade / span;
    this.stops = D.stops.map((d, n) => {
      const s = { id: d.id, n, band: null, snap: 0, glow: 0, card: null, dots: [] };
      if (d.at) {
        const [screen, across] = d.at;
        // across the stage, which is the whole screen until the screen is wider than it
        s.x = s.hx = Math.round(this.cols / 2 + (across - 0.5) * stage); s.y = s.hy = Math.round(screen * this.screenRows); s.vx = s.vy = 0;
        s.side = across > 0.5 ? 'left' : 'right'; // the card goes on the other side from its light
        s.band = [toT(screen + D.band[mode][0]), toT(screen + D.band[mode][1])];
        s.at = screen; s.mark = d.mark;   // a mark: a waypoint on the route rather than a light in the sky
        s.snap = restRow(screen + D.rest[mode]);
      } else if (d.until) s.band = [0, toT(d.until)];
      else s.snap = restRow(d.rest);
      if (n === D.stops.length - 1) { s.band[1] = 1; s.snap = last; }
      return s;
    });
    this.lights = this.stops.filter((s) => s.side);

    // The one camera, and everything it looks at: the mountain below the
    // peak (which lays the ground under itself), what is round it, what
    // lives on it.
    const hut = this.stops.find((s) => s.mark === 'hut');
    const cam = this.cam = new Camera(this);
    this.massif = new Massif(this);
    this.massif.setLamps(this.lampCount);
    // where the route runs through the seam, the painting gives way to it
    const [body, ...ridges] = this.massif.sheets;
    for (const key of body.kept) { const row = Math.floor(key / body.W), c = body.x0 + key % body.W; if (row >= this.bodyTop && row <= this.seamRow + this.blend && w.cells[row]?.[c]) w.cells[row][c] = null; }
    // the painted peak is a pane on the page's own plane; it hides what is behind it
    const peak = cam.pane({
      x: 0, y: 0, cols: this.cols, rows: this.seamRow + this.blend + 1,
      paint: (c0, i0, c1, i1, ox, oy) => {
        for (let r = i0; r <= i1; r++) {
          const span = this.peakSpan[r];
          if (span && r < this.bodyTop && span[1] > c0 && span[0] <= c1) g.box(ox + span[0] * g.cellW, oy + r * g.cellH, (span[1] - span[0]) * g.cellW, g.cellH + 0.5, P.sky);
          for (let c = c0; c <= c1; c++) { const cell = w.cells[r][c]; if (cell) g.set(cell[0], cell[1], ox + c * g.cellW, oy + r * g.cellH, g.size, cell[2] ?? 1); }
        }
      },
    });
    cam.panes = [body.pane, peak, ...ridges.map((sh) => sh.pane), this.groundPane];
    this.air = new Air(this);
    // the last stop's waypoint is the hut's window, wherever the hut stands at the end of the page
    this.cam.look(this.end + S / 2);
    const [wx, wy] = this.ground.at(...this.ground.window);
    hut.x = hut.hx = wx / g.cellW - 0.5; hut.y = hut.hy = wy / g.cellH - 0.5 + this.end;
    this.life = new Life(this);

    this.movers = [];
    this.nextShoot = 1.5 + rnd() * 2;
    this.dirty = true; this.told = undefined;
    this.dispatchEvent(new CustomEvent('built'));
  }

  setTrailLights(n) { this.lampCount = clamp(n, 0, 40); this.massif?.setLamps(this.lampCount); this.dirty = true; }

  // ---------- particles ----------
  // Shooting stars are points in front of a camera. The camera sits at the
  // origin looking down +Z; the screen plane is at Z = F (pixels), centred
  // on the viewport. A point (X, Y, Z) lands at (X, Y) * F / Z from the
  // centre, and its glyph is drawn F / Z times the base size.
  //
  // Each one is a straight flight through that space, chosen by where it
  // shows on screen: it comes in from outside an outer edge, crosses, and
  // leaves past another, never appearing or vanishing in the open. It
  // starts and ends at different depths, so it grows or shrinks on the way
  // and moves faster while it is near.
  get focal() { return this.viewW; }
  spawnShooting(rnd) {
    const L = D.layout, S = D.shoot, g = this.grid, F = this.focal, W = this.viewW, H = this.viewH;
    const topPx = this.scrollRows * g.cellH;
    const roof = Math.max(0, L.shooting[0] * this.screenRows * g.cellH - topPx); // on screen, nothing flies above this (the name is up there)
    const out = g.size * 2;                                                        // how far outside the edge a flight begins and ends
    // In over the top edge when the sky above is open, otherwise over a side;
    // then a heading across the screen, always falling. (ex, ey) → (qx, qy).
    let ex, ey, qx, qy, len, tries = 0;
    do {
      let heading;
      if (roof === 0 && rnd() < S.top) { ex = rnd() * W; ey = -out; heading = (30 + rnd() * 35) * Math.PI / 180; if (rnd() < 0.5) heading = Math.PI - heading; }
      else {
        const left = rnd() < 0.5;
        ex = left ? -out : W + out; ey = roof + rnd() * (H - roof) * 0.7;
        heading = (8 + rnd() * 37) * Math.PI / 180; if (!left) heading = Math.PI - heading;
      }
      const dx = Math.cos(heading), dy = Math.sin(heading);
      // where that line leaves the screen again
      len = Math.min(dx > 0 ? (W + out - ex) / dx : dx < 0 ? (-out - ex) / dx : Infinity, (H + out - ey) / dy);
      qx = ex + dx * len; qy = ey + dy * len;
    } while ((len < 0.35 * Math.min(W, H) + 2 * out || len > S.cross * W) && ++tries < 12); // not a clipped corner, not the long way down a tall screen
    // depth: from far to near (it grows) or near to far (it shrinks)
    const ratio = mix(S.depth, rnd()), near = mix(S.near, rnd()) * F, toward = rnd() < S.toward;
    const z0 = toward ? near * ratio : near, z1 = toward ? near : near * ratio;
    // Speed is set as it looks: screen widths a second, averaged over the
    // crossing. At its nearest it moves `ratio` times that, so a deep
    // flight is slowed until even that moment is no faster than S.peak.
    const speed = Math.min(mix(S.speed, (rnd() + rnd()) / 2), S.peak / ratio) * W;
    const T = len / speed;
    const X0 = (ex - W / 2) * z0 / F, Y0 = (ey - H / 2) * z0 / F, X1 = (qx - W / 2) * z1 / F, Y1 = (qy - H / 2) * z1 / F;
    const p = { kind: 'shoot', X: X0, Y: Y0, Z: z0, vX: (X1 - X0) / T, vY: (Y1 - Y0) / T, vZ: (z1 - z0) / T, cxPx: W / 2, cyPx: topPx + H / 2, x: 0, y: 0, life: T * 1.5 + 0.5, age: 0, hist: [] };
    this.project3(p);
    return p;
  }
  // world pixels → the page's cell coordinates, plus the on-screen scale
  project3(p) {
    const F = this.focal, g = this.grid;
    const k = F / p.Z;
    p.px = p.cxPx + p.X * k; p.py = p.cyPx + p.Y * k;   // world pixels
    p.x = p.px / g.cellW; p.y = p.py / g.cellH;         // world cells, for everything else
    p.scale = k;
  }
  // ---------- the frame ----------
  loop(now) {
    if (this.stopped || this.paused) return;
    requestAnimationFrame(this.loop);
    const g = this.grid, P = this.P, G = D.glyphs, L = D.layout, w = this.world;
    const reduced = this.reduced.matches;
    const time = this.time = (now - this.t0) / 1000;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000) || 0.016; this.last = now;
    const rnd = this.rnd;

    // scroll: the painting moves exactly with the page; velocity drives the shove
    const prev = this.scrollRows;
    this.scrollRows = Math.min(this.scrollTarget, this.end);   // a phone's bars can let the page go a little further: the scene stays put
    const rawVel = (this.scrollRows - prev) / dt;
    this.scrollVel += (rawVel - this.scrollVel) * Math.min(1, dt * 12);
    this.t = this.maxScroll > 0 ? clamp(this.scrollRows / this.maxScroll, 0, 1) : 0;
    const top = this.scrollRows, rows = this.screenRows, bottom = top + rows;
    this.centreRow = top + rows / 2; this.centre = this.centreRow / rows;   // the middle of the screen: in rows, and in screens
    const cam = this.cam; cam.look(this.centreRow);
    // The scroll's shove on everything: with the scroll's speed, but levelling
    // off, so a fast scroll leans the world further without ever pinning it
    // against a limit.
    const [lean, most] = D.shove;
    const shove = reduced ? 0 : -most * Math.tanh(lean * this.scrollVel / most);

    // `active`: something on screen is moving, so this frame must be drawn.
    // Set by anything below that moves.
    let active = this.dirty || this.scrollRows !== prev || Math.abs(this.scrollVel) > 0.05;
    this.dirty = false;

    // pointer in world cells; fades out when it stops moving
    const ptr = this.pointer && now - this.pointerAt < 2500 ? [this.pointer[0], this.pointer[1] + this.scrollRows] : null;
    const push = (p, radius, max) => {
      if (!ptr) return [0, 0];
      const dx = (p.x + 0.5 - ptr[0]) * this.aspect, dy = p.y + 0.5 - ptr[1]; // from the pointer to the glyph's centre
      const d = Math.hypot(dx, dy);
      if (d >= radius || d < 1e-4) return [0, 0];
      // strongest a little way off, nothing right under the pointer: a thing
      // you point at rests there instead of snapping from side to side
      const f = (1 - d / radius) * max * smooth(0, D.push.core, d);
      return [(dx / d) * f / this.aspect, (dy / d) * f];
    };
    // `held` scales the shove for a thing tied to something else: 0 is held fast, 1 is free
    const spring = (p, [stiff, zeta, maxDisp, pushR, pushMax, shoveK], held = 1) => {
      const [px, py] = push(p, pushR, pushMax);
      const tx = p.hx + px, ty = p.hy + py;
      // the push is quick, the return is slow
      const omega = px || py ? stiff * 2.2 : stiff;
      p.vx += (-omega * omega * (p.x - tx) - 2 * zeta * omega * p.vx) * dt;
      p.vy += (-omega * omega * (p.y - ty) - 2 * zeta * omega * p.vy + shove * shoveK * held) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dx = p.x - p.hx, dy = p.y - p.hy, d = Math.hypot(dx * this.aspect, dy);
      if (d > maxDisp) { const k = maxDisp / d; p.x = p.hx + dx * k; p.y = p.hy + dy * k; p.vx *= 0.5; p.vy *= 0.5; }
      if (Math.abs(p.vx) + Math.abs(p.vy) > 0.03) active = true;
    };

    // --- update the sky and the lights ---
    const inView = (p, m = 3) => p.y > top - m && p.y < bottom + m;
    for (const s of this.field) if (inView(s, 6)) spring(s, D.spring.star);
    for (const s of this.nameStars) if (inView(s, 6)) spring(s, D.spring.star);
    let litInView = false;
    for (const s of this.lights) {
      if (s.mark) {
        // a waypoint stands where its sheet (or the hut) stands now
        const [x, y] = s.sheet ? [cam.px(s.sheet.mark[0], s.sheet.z), cam.py(s.sheet.mark[1], s.sheet.z)] : this.ground.at(...this.ground.window);
        s.x = x / g.cellW - 0.5; s.y = y / g.cellH - 0.5 + top; s.show = 1;
      } else if (inView(s, 6)) spring(s, D.spring.light);
      const on = this.presence(s);
      if (Math.abs(on - s.glow) > 0.003) active = true;
      s.glow += (on - s.glow) * Math.min(1, dt * 5);
      if (s.glow > 0.02 && inView(s, 4)) litInView = true;
      // a light's tether: strung fresh each time the card opens, gone when it closes.
      // A waypoint has none: on the mountain the route is what leads to it.
      if (!s.mark && on >= 0.02 && s.card) { if (!s.dots.length) this.string(s); this.tether(s, top, spring, dt); }
      else if (s.dots.length) s.dots = [];
    }

    // --- shooting stars ---
    if (!reduced && this.centre > L.shooting[0] && this.centre < L.shooting[1]) {
      this.nextShoot -= dt;
      if (this.nextShoot <= 0) { this.movers.push(this.spawnShooting(rnd)); this.nextShoot = D.spawn.shoot[0] + rnd() * D.spawn.shoot[1]; }
    }
    const keep = [];
    for (const p of this.movers) {
      p.age += dt;
      // bend away from the pointer: the lateral velocity turns, in 3D
      if (ptr) {
        const dx = (p.x - ptr[0]) * this.aspect, dy = p.y - ptr[1], d = Math.hypot(dx, dy);
        const reach = 6 * Math.max(0.6, p.scale);
        if (d < reach && d > 0.01) {
          const want = Math.atan2(dy, dx), have = Math.atan2(p.vY, p.vX);
          let diff = want - have; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
          const turn = clamp(diff, -0.7, 0.7) * (1 - d / reach) * dt * 6;
          const sp = Math.hypot(p.vX, p.vY), a = have + turn;
          p.vX = sp * Math.cos(a); p.vY = sp * Math.sin(a);
        }
      }
      p.vY -= shove * g.cellH * (p.Z / this.focal) * dt;
      p.X += p.vX * dt; p.Y += p.vY * dt; p.Z += p.vZ * dt;
      this.project3(p);
      p.hist.push([p.X, p.Y, p.Z]); if (p.hist.length > 48) p.hist.shift();
      const F = this.focal;
      // gone past the edge, or down to the summit, where they burn out
      if (!(p.age < p.life && p.x > -20 && p.x < this.cols + 20 && p.y < Math.min(bottom + 8, L.summit * rows) && p.Z > 0.28 * F && p.Z < 4.2 * F)) continue;
      if (inView(p, 2)) active = true;
      keep.push(p);
    }
    this.movers = keep;

    // --- what lives on the mountain ---
    const alive = this.life.showing || this.air.showing || this.ground.showing;
    if (!reduced && this.life.showing) this.life.update(dt);

    // the name twinkles in all at once over three seconds
    const reveal = this.reveal = reduced ? 1 : clamp((time - 0.4) / 3, 0, 1);
    if (reveal < 1) active = true;

    // tell the page where we are, when that changes
    if (this.t !== this.told) { this.told = this.t; this.dispatchEvent(new CustomEvent('moved')); }

    // --- is there anything new to draw? ---
    // If only slow twinkles are alive, every other frame will do. If nothing
    // is, the last frame stands, and the spare time paints the next screen
    // of mountain ahead of the scroll.
    const skyVisible = top < L.deck[1] * rows;
    const ambient = !reduced && (skyVisible || litInView || alive);
    this.tick = (this.tick || 0) + 1;
    if (!active && !(ambient && this.tick % 2 === 0)) { this.warm(); return; }

    // --- draw, from the back to the front ---
    this.sky = mixHex(P.sky, P.skyBase, smooth(8.3, 9.7, this.centre));
    g.clear(this.sky);
    cam.tidy();
    const began = performance.now();

    // field stars
    if (skyVisible) {
      const [floor, rate] = D.twinkle.field;
      // The lines under the name stay readable: while they are showing, a
      // star fades out as it comes up to them and back in once it is past.
      // The page says where they are (quiet: boxes in viewport pixels).
      const hush = this.quiet.length ? this.presence(this.stops[0]) : 0, [gone, back] = D.clear.text.map((v) => v * this.u);
      for (const s of this.field) {
        if (!inView(s)) continue;
        let ch = s.ch, a = s.fade;
        if (hush > 0.01) {
          const x = (s.x + 0.5) * g.cellW, y = (s.y - top + 0.5) * g.cellH;
          let d = Infinity;
          for (const [l, t, r, b] of this.quiet) d = Math.min(d, Math.hypot(Math.max(l - x, 0, x - r), Math.max(t - y, 0, y - b)));
          a = 1 - hush * (1 - smooth(gone, back, d));
          if (a < 0.01) continue;
        }
        // a third of the sky twinkles, each on its own rate, and the bright
        // ones also blink between glyphs
        if (!reduced && s.phase < 2.1) {
          a *= twinkle(time, s.phase * 7, floor, rate + s.phase);
          if (s.tier === 2 && Math.sin(time * 1.7 + s.phase * 5) < -0.2) ch = '*';
        } else if (!reduced && s.tier === 2 && Math.sin(time * 1.7 + s.phase) < -0.3) ch = '*';
        g.put(ch, s.tier === 0 ? P.dim : s.tier === 1 ? P.star : P.starBright, s.x - cam.x, s.y - top, a);
      }
    }

    // the name. Its threads are redrawn every frame from where the stars are
    // now, so a pushed star drags its lines with it and they spring back.
    const hold = 1 - smooth(0.05, 0.1, this.t);
    if (hold > 0.001 && skyVisible) {
      this.nameLines.forEach(([i, j], n) => {
        const a = this.nameStars[i], b = this.nameStars[j];
        this.thread(a.x, a.y, b.x, b.y, top, hold, n * 1.7);
      });
      const [floor, rate] = D.twinkle.name;
      this.nameStars.forEach((s, i) => {
        const seed = this.nameSeeds[i], y = s.y - top;
        if (seed < 0.5) {
          // always there, indistinguishable from the field; it brightens to white over the reveal
          const ch = s.anchor && reveal > 0.6 ? '✦' : '*';
          g.put(ch, P.star, s.x, y);
          g.put(ch, P.white, s.x, y, reveal);
        } else {
          // twinkles in from nothing and keeps twinkling. The fast flicker of
          // the reveal crossfades into the slow twinkle, so there is no seam.
          const slow = reduced ? 1 : twinkle(time, seed * 50, floor, rate + seed * 1.5);
          const fast = twinkle(time, seed * 40, 0, 8);
          g.put(s.anchor ? '✦' : '*', P.white, s.x, y, clamp(reveal * ((1 - reveal) * fast + reveal * slow), 0, 1));
        }
      });
    } else if (skyVisible) {
      for (const s of this.nameStars) g.put('*', P.star, s.x, s.y - top);
    }

    // the lights in the sky, one for every stop up there. Each is one object
    // placed in pixels, not cells (a cell is twice as tall as it is wide): a
    // soft bloom of the glyph itself, a ring of dots at one even pitch, and
    // the star centred on its own ink. At rest: bloom and four dots. Lit:
    // the four brighten, the corners and four outer points fill in, the star
    // grows and warms.
    const A = D.light, u = this.u, pitch = A.pitch * u;
    for (const s of this.lights) {
      if (s.mark || !inView(s, 4)) continue;
      const lit = s.glow, live = lit * (reduced ? 1 : twinkle(time, s.n, ...D.twinkle.light));
      const x = (s.x + 0.5) * g.cellW, y = (s.y - top + 0.5) * g.cellH;
      g.ink('✦', P.ember, x, y, mix(A.bloom, lit) * u, mix(A.bloomAlpha, live));
      const ring = A.ring + (1 - A.ring) * live;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.ink('·', P.ember, x + dx * pitch, y + dy * pitch, g.size, ring);
      if (lit > 0.05) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) g.ink('·', P.ember, x + dx * pitch, y + dy * pitch, g.size, A.ring * live);
      const size = mix(A.star, lit) * u;
      g.ink('✦', P.ember, x, y, size);
      g.ink('✦', P.emberHot, x, y, size, lit);
    }
    for (const p of this.movers) if (inView(p, 2)) this.drawShooting(p, top);

    // below the sky: far ranges, far snow and the flock, the clouds behind
    // the mountain; then the mountain; then what is in front of it
    const below = bottom > (L.deck[0] - 1.2) * rows;
    if (below) {
      cam.show(this.air.far, cam.panes);   // the far ranges, where the mountain is not over them
      if (!reduced) this.life.behind();
      this.air.drawClouds(false);
    }
    this.massif.haze();
    cam.show();   // the peak, the mountain under it, the ground
    if (below) {
      this.ground.draw();
      if (!reduced) this.life.front();
    }
    this.lamp(top);
    if (below && !reduced) this.life.leaves(...this.lampAt);
    this.drawRoute(top, time, reduced);
    if (below) { this.air.drawMist(); this.air.drawClouds(true); }

    // the tethers. Their stars come in one by one as the card opens, each
    // at its own moment, and leave the same way. While they are there they
    // twinkle exactly as the name's thread does.
    for (const s of this.lights) {
      if (!s.dots.length) continue;
      const on = this.presence(s);
      const edge = this.stack ? (s.card.top - 2) / g.cellH - 0.5 + top : Infinity; // nothing is drawn over a stacked card
      for (const p of s.dots) if (p.a && p.y < edge) g.put('·', P.thread, p.x, p.y - top, p.a * 0.95 * smooth(p.late * 0.55, p.late * 0.55 + 0.45, on) * this.flicker(p.tw));
    }
    // with time to spare in the frame, paint tiles ahead of the scroll
    for (const way = this.scrollVel < 0 ? -1 : 1; performance.now() - began < 5 && cam.warm(way););
  }

  // The light you carry down the route. It is on the trail, at the height
  // on the screen where a stop's waypoint rests. Round it everything is as
  // bright as it is painted; further off the mountain is put out, and only
  // the stretch of route inside the light is lit.
  lamp(top) {
    const g = this.grid, P = this.P, cam = this.cam, K = D.massif.lamp, L = D.layout, H = g.h, m = Math.min(g.w, H), r0 = K.core * m, r1 = K.reach * m;
    const x = this.massif.trail(cam.y), y = this.massif.lampY, reach = r0 * 2.1;
    this.lampAt = [x, y, r0, r1];
    // the dark comes on below the summit: up there the sky is the light
    const dark = K.dark * smooth(L.summit + 0.1, L.seam + 0.45, this.centre);
    if (dark > 0.01) {
      const grad = g.ctx.createRadialGradient(x, y, r0, x, y, r1), hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
      grad.addColorStop(0, this.sky + '00'); grad.addColorStop(0.5, this.sky + hex(dark * 0.62)); grad.addColorStop(1, this.sky + hex(dark));
      g.box(0, 0, g.w, H, grad);
    }
    this.massif.drawBridges();   // after the dark, so a bridge out of the light still shows: plain, not lit
    const near = this.massif.light(x, y, reach);
    // the rope on the peak is route too
    for (const [c, row, ch] of this.rope) { const px = cam.px(c), py = cam.py(row); if (Math.abs(py - y) < reach) near.push([px, py, ch, g.size, false]); }
    for (const [px, py, ch, size, mid] of near) {
      const d = mid ? Math.hypot(px - x, py - y) : Math.hypot(px + size * 0.3 - x, py + size * 0.6 - y), f = 1 - smooth(r0 * 0.55, reach, d);
      if (f < 0.02) continue;
      if (mid) { g.ink(ch, P.ember, px, py, size, f); g.ink(ch, P.emberHot, px, py, size, f * f * 0.7); }
      else { g.set(ch, P.ember, px, py, size, f); g.set(ch, P.emberHot, px, py, size, f * f * 0.7); }
    }
  }

  // The route's own things: the flag on the summit, the lamps of those
  // climbing it, and a waypoint for every stop on the mountain: a small
  // lantern on whatever stands there. Each is a drawing of a few glyphs at
  // different sizes, sized with the sheet it stands on.
  drawRoute(top, time, reduced) {
    const g = this.grid, P = this.P, w = this.world, H = g.h;
    // the flag
    const fx = this.cam.px(w.topCol + 0.5), fy = this.cam.py(Math.ceil(this.summitRow)), fu = g.size * 1.7;
    if (fy > -80 && fy < H + 40) {
      for (const dy of [0.45, 1.4, 2.3]) g.ink('|', P.rockLight, fx, fy - dy * fu, fu * 1.3);
      const wave = reduced ? 0 : Math.sin(time * 3.2);
      g.ink('o', P.ember, fx + 0.6 * fu, fy - 2.5 * fu, fu * 2.6, 0.12);
      g.ink(wave > 0.3 ? '}' : '>', P.ember, fx + (0.58 + 0.05 * wave) * fu, fy - 2.5 * fu, fu * 1.45);
    }
    // lamps
    for (const m of this.massif.lamps) {
      const [x, y] = this.massif.at(m.sh, m.c + 0.5, m.r + 0.5);
      if (y < -10 || y > H + 10 || this.massif.hidden(x, y, m.sh.index)) continue;
      const u = m.sh.font, pulse = reduced ? 1 : twinkle(time, m.phase, ...D.twinkle.lamp);
      g.ink('o', P.ember, x, y, u, pulse);
    }
    // waypoints
    const FIX = {
      axe: [['T', -0.6, 0.15, 1.5, P.rockLight]],
      cairn: [['O', -0.78, 0.3, 1.1, P.rockLight], ['o', -0.82, -0.38, 0.9, P.rockLight], ['o', -0.76, -0.95, 0.6, P.rockLight]],
      post: [['T', -0.6, 0, 1.7, mixHex(P.ground, P.leaf, 0.45)]],
      hut: [],
    };
    for (const s of this.lights) {
      if (!s.mark || s.show < 0.05) continue;
      const [x, y] = this.where(s);
      if (y < -40 || y > H + 40) continue;
      const u = s.sheet ? s.sheet.font : g.size * this.ground.k, lit = s.glow, live = lit * (reduced ? 1 : twinkle(time, s.n, ...D.twinkle.light)), a = s.show;
      if (s.sheet) {
        // a small hollow, so it reads against rock and trees
        const x2 = g.ctx, r = u * 2.6, grad = x2.createRadialGradient(x, y, r * 0.45, x, y, r);
        grad.addColorStop(0, this.sky); grad.addColorStop(1, this.sky + '00');
        g.box(x - r, y - r, 2 * r, 2 * r, grad, a);
      }
      for (const [ch, dx, dy, k, color] of FIX[s.mark]) g.ink(ch, color, x + dx * u, y + dy * u, k * u, a);
      // the lantern: a glow, the flame, and when its card is open a ring round it
      g.ink('o', P.ember, x, y, u * 2.7, (0.1 + 0.2 * live) * a);
      if (s.mark === 'hut') { for (const [ch, dx] of [['[', -0.5], [']', 0.5]]) g.ink(ch, P.emberHot, x + dx * g.cellW * this.ground.k, y, u, live * a); }
      else { g.ink('o', P.ember, x, y, u * 0.85, a); g.ink('o', P.emberHot, x, y, u * 0.85, lit * a); }
      if (lit > 0.05) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.ink('·', P.ember, x + dx * u * 1.25, y + dy * u * 1.25, u, 0.8 * live * a);
    }
  }

  // The name's thread: a straight run of dots, one every half cell,
  // alternating bright and dim, each flickering on its own.
  thread(ax, ay, bx, by, top, level, phase) {
    const g = this.grid, T = D.thread, color = this.P.thread;
    const dx = bx - ax, dy = by - ay;
    const steps = Math.max(1, Math.round(T.perCell * Math.max(Math.abs(dx) * this.aspect * 2, Math.abs(dy))));
    for (let k = 1; k < steps; k++) {
      const f = k / steps;
      const a = (k % 2 ? T.bright : T.dim) * level * this.flicker(phase + k * 2.3);
      if (a >= 0.02) g.put('·', color, ax + dx * f, ay + dy * f - top, a);
    }
  }

  // The page tells the scene where a stop's card sits on screen (its box,
  // in viewport pixels), so the stop's tether knows where to end.
  attach(s, box) {
    s.card = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    this.dirty = true;
  }
  // where a tether meets its card, in viewport pixels: the top of a stacked
  // card, the near side of a card beside the light
  anchor(s) {
    const c = s.card;
    return this.stack ? [(c.left + c.right) / 2, c.top - 4] : [s.side === 'left' ? c.right + 4 : c.left - 4, c.top + Math.min((c.bottom - c.top) * 0.3, 40)];
  }

  // A stop's tether is a string of stars tied between its light and its
  // card. string() makes a new one every time the card opens, and no two
  // are alike: how many stars, where each sits along the string, how bright,
  // which are missing, how the string wanders, and the order they appear in
  // are all drawn fresh. Each star only knows how far along the string it is
  // (f, 0 at the light to 1 at the card), so the string has no length of its
  // own: it is as long as the gap it spans.
  string(s) {
    const g = this.grid, T = D.tether, u = this.u, R = Math.random;
    // enough stars to fill it at the stop's resting place
    const [ax, ay] = this.anchor(s);
    const gap = Math.hypot(ax - (s.hx + 0.5) * g.cellW, ay - (s.hy - s.snap + 0.5) * g.cellH);
    s.rest = Math.max(20 * u, gap - (D.light.clear + 5) * u);
    const n = Math.max(6, Math.round(s.rest / (mix(T.step, R()) * u)));
    // its wander: two waves across the string, each [how far, how many, where it starts]
    s.sway = T.wander.map(([far, fewest, most]) => [far * (0.7 + 0.6 * R()), mix([fewest, most], R()) * 2 * Math.PI, R() * 2 * Math.PI]);
    s.dots = [];
    for (let k = 0; k < n; k++) s.dots.push({ f: (k + 0.5 + (R() - 0.5) * T.jitter) / n, a: R() > T.miss ? mix(T.alpha, R()) : 0, late: R(), tw: R() * 2 * Math.PI, fresh: true, x: 0, y: 0, hx: 0, hy: 0, vx: 0, vy: 0 });
  }

  // Every frame the string is laid from the light to the card as they now
  // stand, so it stretches as they part and gathers as they close: slack
  // and wavier when short, taut and straighter when long. That gives each
  // star a home, and the star goes there on the sky's own spring, shoved by
  // a swipe and pushed by a pointer like any other star.
  //
  // The ends are held: a star by the light stays by the light, a star at
  // the card stays at the card. Toward the middle the stars hang free: they
  // are carried with the page and swing back to the string, and they take
  // the scroll's shove. Both are kept in one smooth bow however fast the
  // page moves: the whole string is left behind by the same share, and that
  // share shrinks as the speed climbs, so no part of it is ever thrown
  // against a limit while the rest is not.
  tether(s, top, spring, dt) {
    const g = this.grid, T = D.tether, u = this.u;
    const [ax, ay] = this.anchor(s);
    const lx = (s.x + 0.5) * g.cellW, ly = (s.y - top + 0.5) * g.cellH; // the light, in viewport pixels
    const full = Math.hypot(ax - lx, ay - ly) || 1, ux = (ax - lx) / full, uy = (ay - ly) / full;
    const clear = (D.light.clear + 2) * u, len = Math.max(0, full - clear - 3 * u);
    const slack = clamp((s.rest / Math.max(len, 1)) ** 0.8, T.slack[0], T.slack[1]) * u;
    const [[far1, many1, from1], [far2, many2, from2]] = s.sway;
    // where each star belongs now, and the fastest any of them is being left behind
    let fastest = 0;
    for (const p of s.dots) {
      p.free = Math.sin(Math.PI * p.f); // 0 at either end, 1 in the middle
      const along = clear + p.f * len, off = (Math.sin(p.f * many1 + from1) * far1 + Math.sin(p.f * many2 + from2) * far2) * p.free * slack;
      p.nx = (lx + ux * along - uy * off) / g.cellW - 0.5; p.ny = (ly + uy * along + ux * off) / g.cellH - 0.5 + top;
      if (p.fresh) { p.x = p.hx = p.nx; p.y = p.hy = p.ny; p.fresh = false; }
      fastest = Math.max(fastest, p.free * Math.hypot((p.nx - p.hx) * this.aspect, p.ny - p.hy) / dt);
    }
    const share = fastest > 0.01 ? T.lag * Math.tanh(fastest / T.lag) / fastest : 1; // 1 when slow, less as it speeds up
    for (const p of s.dots) {
      // a held star moves with its home; a free one is left where the page carries it, by that share
      const follow = 1 - p.free * share;
      p.x += (p.nx - p.hx) * follow; p.y += (p.ny - p.hy) * follow;
      p.hx = p.nx; p.hy = p.ny;
      if (p.a) spring(p, D.spring.tether, p.free);
    }
  }

  // a thread dot's brightness, for the name's thread and the tethers alike: it flickers up over the name's reveal, then keeps a faint twinkle for good
  flicker(phase) {
    if (this.reduced.matches) return 1;
    const steady = twinkle(this.time, phase, ...D.twinkle.thread), r = this.reveal;
    if (r >= 1) return steady;
    return clamp(r * twinkle(this.time, phase, 0.1, 9) + r * r * 0.6, 0, 1) * (1 - r) + steady * r;
  }

  // How open a stop is at this scroll position, 0 to 1. Its card's opacity,
  // its light's glow and its thread all follow this one number.
  presence(s) {
    if (!s.band) return 0;
    const [a, b] = s.band, w = Math.min(this.fade, (b - a) / 3), t = this.t;
    return (a <= 0 ? 1 : smooth(a, a + w, t)) * (b >= 1 ? 1 : 1 - smooth(b - w, b, t));
  }

  // a shooting star and its tail, every glyph sized by its own distance
  drawShooting(p, top) {
    const g = this.grid, P = this.P, F = this.focal, tail = D.glyphs.shootTail;
    const base = g.size, topPx = top * g.cellH;
    const headK = F / p.Z;
    // one a pointer has held on screen past its time fades instead of blinking out; so does one that comes down to the summit
    const fade = clamp((p.life - p.age) / 0.3, 0, 1) * (1 - smooth(D.layout.summit - 0.5, D.layout.summit - 0.05, p.y / this.screenRows));
    g.ink(D.glyphs.shootHead, P.starBright, p.px, p.py - topPx, base * clamp(headK, 0.35, 3.6), clamp(headK * 1.15, 0.1, 1) * fade);
    // the tail follows the real path through space; spacing is one glyph at each point's own scale
    let acc = 0, k = 0;
    for (let i = p.hist.length - 2; i >= 0 && k < tail.length; i--) {
      const [X1, Y1, Z1] = p.hist[i + 1], [X0, Y0, Z0] = p.hist[i];
      const k1 = F / Z1, k0 = F / Z0;
      const x1 = p.cxPx + X1 * k1, y1 = p.cyPx + Y1 * k1, x0 = p.cxPx + X0 * k0, y0 = p.cyPx + Y0 * k0;
      acc += Math.hypot(x1 - x0, y1 - y0);
      while (acc >= (k + 1) * base * 0.9 * Math.max(0.5, k0) && k < tail.length) {
        g.ink(tail[k], P.star, x0, y0 - topPx, base * clamp(k0, 0.35, 3.2), (k < 2 ? 0.9 : k < 4 ? 0.55 : 0.35) * clamp(k0 * 1.15, 0.1, 1) * fade);
        k++;
      }
    }
  }

  // in spare time, paint what will be wanted soon, so scrolling into it does not hitch: the sheets of the mountain,
  // then the tiles just off the screen, ahead of the scroll first
  warm() { const way = this.scrollVel < 0 ? -1 : 1; return this.massif.warm() || this.cam.warm(way) || this.cam.warm(-way); }

  // ---------- for the page ----------
  // where a stop's light is on screen, in viewport pixels
  where(s) { return [(s.x + 0.5) * this.grid.cellW, (s.y - this.scrollRows + 0.5) * this.grid.cellH]; }
}

customElements.define('ascii-scene', AsciiScene);
