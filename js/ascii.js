// <ascii-scene> — a night mountain drawn in type.
//
// A tall ASCII painting the browser scrolls through 1:1. Everything that
// lives (stars, the name, shooting stars, birds, flakes, leaves) is a
// particle on a spring or on a path; everything else is drawn once.

import { Grid } from './grid.js';
import { buildWorld, mulberry32, makeNoise } from './world.js';
import { D } from './direction.js';
import { layoutName } from './asterism.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

// dx in columns, dy in rows (y up); cells are about twice as tall as wide
function lineGlyph(dx, dy, aspect) {
  const ax = Math.abs(dx) * aspect, ay = Math.abs(dy);
  if (ax >= 2.2 * ay) return '-';
  if (ay >= 2.2 * ax) return '|';
  return dx * dy > 0 ? '/' : '\\';
}

// cells along a line between two cells (Bresenham), excluding endpoints
function cellsBetween(x0, y0, x1, y1) {
  const out = [];
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  let x = x0, y = y0;
  for (let guard = 0; guard < 4000; guard++) {
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    out.push([x, y]);
  }
  return out;
}

export class AsciiScene extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.appendChild(this.canvas);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.rnd = mulberry32(99);
    this.noise = makeNoise(5);
    this.start = performance.now();
    this.t = 0; this.scrollRows = 0; this.scrollVel = 0;
    this.pointer = null; this.pointerVel = 0;
    this.movers = []; this.resting = [];
    this.lampCount = 0;
    this.named = [];

    try {
      this.viewW = innerWidth; this.viewH = this.largeViewportHeight();
      this.grid = new Grid(this.canvas, { size: this.fontSize() });
      this.grid.resize(this.viewW, this.viewH);
      this.build();
    } catch (e) { console.warn('ascii scene failed', e); this.classList.add('is-fallback'); this.dispatchEvent(new CustomEvent('fallback')); return; }

    this.onScroll = () => { this.scrollTarget = scrollY / this.grid.cellH; };
    this.onPointer = (e) => {
      // screen cells; converted to world cells each frame
      this.pointer = [e.clientX / this.grid.cellW, e.clientY / this.grid.cellH]; this.pointerAt = performance.now();
    };
    this.onLeave = () => { this.pointer = null; };
    this.onResize = () => {
      // a mobile URL bar showing or hiding only changes the height a little:
      // ignore that. Rebuild for a width change or an orientation change.
      const h = this.largeViewportHeight();
      if (innerWidth === this.viewW && Math.abs(h - this.viewH) < this.viewH * 0.2) return;
      this.viewW = innerWidth; this.viewH = h;
      this.grid.size = this.fontSize(); this.grid.resize(this.viewW, this.viewH); this.build();
    };
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('pointermove', this.onPointer, { passive: true });
    addEventListener('pointerleave', this.onLeave);
    addEventListener('resize', this.onResize);
    this.onScroll();
    this.scrollRows = this.scrollTarget;
    this.classList.add('is-ready');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  disconnectedCallback() {
    removeEventListener('scroll', this.onScroll); removeEventListener('pointermove', this.onPointer);
    removeEventListener('pointerleave', this.onLeave); removeEventListener('resize', this.onResize);
    this.stopped = true;
  }
  pause() { this.paused = true; }
  resume() { if (!this.paused) return; this.paused = false; this.last = 0; requestAnimationFrame(this.loop); }

  fontSize() { return innerWidth < 600 ? 11 : innerWidth < 1100 ? 13 : 14; }

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
    const g = this.grid, L = D.layout, P = D.palette, G = D.glyphs;
    this.screenRows = this.viewH / g.cellH;
    this.cols = g.cols;
    this.rows = Math.ceil(L.screens * this.screenRows) + 2;
    this.world = buildWorld(this.cols, this.rows, this.screenRows, D);
    this.tileRows = Math.ceil(this.screenRows);
    this.tiles = new Map();
    this.maxScroll = (L.screens - 1) * this.screenRows;
    this.aspect = g.cellW / g.cellH; // a column is this many rows wide
    const rnd = mulberry32(2026);

    // page height follows the world, in pixels, so the scroll range does not
    // move when a browser bar comes and goes
    document.documentElement.style.setProperty('--world-height', `${Math.round(this.rows * g.cellH)}px`);

    // field stars: everywhere above the mountain, three tiers
    this.field = [];
    const skyRows = Math.floor(L.summit * this.screenRows);
    const count = Math.floor((this.cols * skyRows) / 58);
    for (let i = 0; i < count; i++) {
      const x = rnd() * this.cols, y = rnd() * (skyRows + 20);
      if (y > this.world.peak[Math.floor(x)]) continue;
      const u = rnd();
      const tier = u < 0.7 ? 0 : u < 0.94 ? 1 : 2;
      const ch = tier === 0 ? (rnd() < 0.2 ? '·' : '.') : tier === 1 ? (rnd() < 0.15 ? '+' : '*') : '✦';
      this.field.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, tier, ch, phase: rnd() * 6.28 });
    }

    // the sky above the name is what you see first: a little denser there,
    // with a few bright ones, so the name is not alone up top
    const nameTop = L.name * this.screenRows - 7 * (this.viewW < 600 ? 1 : 1.4);
    const extra = Math.floor(this.cols * Math.max(nameTop, 6) / 30);
    for (let i = 0; i < extra; i++) {
      const x = rnd() * this.cols, y = rnd() * Math.max(nameTop, 6);
      const u = rnd();
      const tier = u < 0.5 ? 0 : u < 0.85 ? 1 : 2;
      const ch = tier === 0 ? (rnd() < 0.2 ? '·' : '.') : tier === 1 ? (rnd() < 0.15 ? '+' : '*') : '✦';
      this.field.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, tier, ch, phase: rnd() * 6.28 });
    }

    // the name
    const phone = this.viewW < 600;
    const name = layoutName(this.getAttribute('name') || 'daniel wyckoff', { stacked: true, seed: 7, tight: phone });
    const wordWidth = phone ? 5.9 : 7.3;
    const unitPx = Math.min((phone ? 3.4 : 4.4) * g.cellH / 0.58, (phone ? 0.94 : 0.7) * this.viewW / wordWidth);
    this.nameDense = true;
    const ux = unitPx / g.cellW, uy = unitPx / g.cellH;
    const cx = this.cols * 0.5, cy = L.name * this.screenRows;
    this.nameStars = name.stars.map(([x, y, anchor, letter]) => {
      const X = cx + x * ux, Y = cy - y * uy;
      return { x: X, y: Y, hx: X, hy: Y, vx: 0, vy: 0, anchor, letter, cell: [Math.round(X), Math.round(Y)] };
    });
    this.nameLetters = name.letters;
    // lines as cell paths, in drawing order
    const perLetter = {};
    this.nameLines = name.lines.filter(([, , letter]) => (perLetter[letter] = (perLetter[letter] || 0) + 1) <= 8).map(([i, j, letter]) => {
      const a = this.nameStars[i], b = this.nameStars[j];
      const cells = cellsBetween(a.cell[0], a.cell[1], b.cell[0], b.cell[1]);
      const glyph = lineGlyph(b.cell[0] - a.cell[0], -(b.cell[1] - a.cell[1]), this.aspect);
      return { i, j, letter, cells, glyph };
    });
    this.nameTotal = this.nameLines.reduce((s, l) => s + l.cells.length + 1, 0);

    // the four bright stars
    this.named = L.stars.map(([screen, xf]) => {
      const x = Math.round(xf * this.cols), y = Math.round(screen * this.screenRows);
      return { x, y, hx: x, hy: y, vx: 0, vy: 0, glow: 0 };
    });

    // headlamps: a walk down the face between the route rows
    this.lamps = [];
    this.placeLamps(this.lampCount);

    // bands the page uses to show cards: viewport centre in [from, to] screens
    const S = L.screens - 1;
    const band = ([a, b]) => [clamp((a - 0.5) / S, 0, 1), clamp((b - 0.5) / S, 0, 1)];
    this.bands = {
      name: [0, band([0, 0.72])[1]],
      // portrait: the card sits at the bottom, so it opens only once its star
      // has climbed above it (star just past mid-screen) and closes as the
      // star leaves the top edge. Landscape: the card sits beside the star.
      stars: this.viewH > this.viewW
        ? L.stars.map(([screen]) => band([screen - 0.04, screen + 0.44]))
        : [[1.1, 1.65], [1.75, 2.3], [2.4, 2.95], [3.05, 3.6]].map(band),
      climb: band([4.65, 5.25]),
      slopes: [[5.8, 6.4], [6.5, 7.1], [7.2, 7.8]].map(band),
      roots: [band([9.15, 10.5])[0], 1],
    };

    // talking points, in world rows: where a glide should come to rest
    const centreRow = (screen) => (screen - 0.5) * this.screenRows;
    const portrait = this.viewH > this.viewW;
    const desk = [[1.1, 1.65], [1.75, 2.3], [2.4, 2.95], [3.05, 3.6]];
    this.snaps = [
      0,
      ...L.stars.map(([screen], i) => portrait ? centreRow(screen + 0.16) : centreRow((desk[i][0] + desk[i][1]) / 2)),
      centreRow(L.summit + 0.12),
      centreRow(4.95),
      centreRow(6.1), centreRow(6.8), centreRow(7.5),
      this.rows - this.screenRows,
    ].map((r) => clamp(r, 0, this.rows - this.screenRows));
    this.dispatchEvent(new CustomEvent('built'));

    // static props for reduced motion
    this.movers = []; this.resting = [];
    if (this.reduced.matches) {
      for (let i = 0; i < 40; i++) this.movers.push(this.spawnFlake(rnd() * this.cols, (L.flakesFrom + rnd() * (L.leavesFrom - L.flakesFrom)) * this.screenRows, rnd));
      for (let i = 0; i < 40; i++) { const f = this.spawnFlake(rnd() * this.cols, (L.leavesFrom + rnd() * (L.groundFrom - L.leavesFrom)) * this.screenRows, rnd); this.toLeaf(f, rnd); this.movers.push(f); }
      for (let i = 0; i < 5; i++) this.movers.push(this.spawnBird(rnd() * this.cols, (L.birds[0] + rnd() * (L.birds[1] - L.birds[0])) * this.screenRows, rnd() < 0.5 ? 1 : -1, rnd));
    }
    this.nextShoot = 1.5 + rnd() * 2; this.nextBird = 1; this.flakeAcc = 0; this.leafAcc = 0;
  }

  placeLamps(n) {
    const L = D.layout, w = this.world;
    this.lampCount = n;
    this.lamps = [];
    if (!n || !w) return;
    const r0 = L.route[0] * this.screenRows, r1 = L.route[1] * this.screenRows;
    const rnd = mulberry32(77);
    let x = w.topCol + 2;
    for (let i = 0; i < n; i++) {
      const r = Math.round(r0 + ((r1 - r0) * (i + 0.5)) / n);
      x += Math.round((rnd() - 0.42) * 7);
      x = clamp(x, 2, this.cols - 3);
      // keep it on the mountain
      while (x < this.cols - 3 && r < w.peak[x]) x++;
      this.lamps.push({ x, y: r, phase: rnd() * 6.28 });
    }
  }
  setTrailLights(n) { this.placeLamps(clamp(n, 0, 40)); }

  // ---------- particles ----------
  spawnShooting(rnd) {
    const L = D.layout, top = this.scrollRows, rows = this.screenRows;
    const dir = rnd() < 0.5 ? 1 : -1;
    const ang = (20 + rnd() * 15) * Math.PI / 180;
    const speed = 28;
    const bandTop = L.shooting[0] * rows;
    // always enter from off screen: over the top edge when the band allows
    // it, otherwise in from the side, heading down and across
    let x, y;
    if (top - 3 >= bandTop && rnd() < 0.6) { x = rnd() * this.cols; y = top - 3; }
    else { x = dir > 0 ? -5 : this.cols + 5; y = Math.max(bandTop, top + 2 + rnd() * rows * 0.45); }
    return { kind: 'shoot', x, y, vx: dir * speed * Math.cos(ang), vy: speed * Math.sin(ang) * this.aspect, life: 3.6, age: 0, hist: [], tailLen: 6 };
  }
  spawnBird(x, y, dir, rnd) {
    return { kind: 'bird', x, y, vx: dir * 7, vy: 0, baseY: y, phase: rnd() * 6.28, age: 0, life: 14, frame: 0, hist: [], tailLen: 0 };
  }
  toBird(p, rnd) {
    p.kind = 'bird'; p.vx = Math.sign(p.vx || 1) * 7; p.vy = 0; p.baseY = p.y; p.phase = rnd() * 6.28; p.age = 0; p.life = 14; p.frame = 0; p.morph = 0.4;
  }
  spawnFlake(x, y, rnd) {
    const u = rnd();
    const ch = u < 0.5 ? '*' : u < 0.85 ? '.' : '+';
    return { kind: 'flake', x, y, vx: 0, vy: 2.5, ch, far: ch === '.', phase: rnd() * 6.28, age: 0, life: 40, wasSky: y < this.world.peak[clamp(Math.floor(x), 0, this.cols - 1)] };
  }
  toLeaf(p, rnd) {
    p.kind = 'leaf'; p.vy = 1.8; p.color = rnd() < 0.5 ? D.palette.leaf : D.palette.leafOlive; p.frame = Math.floor(rnd() * 3); p.phase = rnd() * 6.28; p.age = 0; p.life = 60;
    p.restRow = this.world.groundRow + 1 + Math.floor(rnd() * (this.rows - this.world.groundRow - 8));
  }

  // ---------- the frame ----------
  loop(now) {
    if (this.stopped || this.paused) return;
    const g = this.grid, P = D.palette, G = D.glyphs, L = D.layout, w = this.world;
    const reduced = this.reduced.matches;
    const time = (now - this.start) / 1000;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000) || 0.016; this.last = now;
    const rnd = this.rnd;

    // scroll: the painting moves exactly with the page; velocity drives the shove
    const prev = this.scrollRows;
    this.scrollRows = this.scrollTarget;
    const rawVel = (this.scrollRows - prev) / dt;
    this.scrollVel += (rawVel - this.scrollVel) * Math.min(1, dt * 12);
    this.t = this.maxScroll > 0 ? clamp(this.scrollRows / this.maxScroll, 0, 1) : 0;
    const top = this.scrollRows, rows = this.screenRows, bottom = top + rows;
    const centre = top + rows / 2;
    const shove = reduced ? 0 : -0.9 * this.scrollVel;

    // pointer in world cells; fades out when it stops moving
    const ptr = this.pointer && now - this.pointerAt < 2500 ? [this.pointer[0], this.pointer[1] + this.scrollRows] : null;
    const push = (p, radius, max) => {
      if (!ptr) return [0, 0];
      const dx = (p.x - ptr[0]) * this.aspect, dy = p.y - ptr[1];
      const d = Math.hypot(dx, dy);
      if (d >= radius || d < 1e-4) return [0, 0];
      const f = (1 - d / radius) * max;
      return [(dx / d) * f / this.aspect, (dy / d) * f];
    };
    const spring = (p, omega, zeta, maxDisp, pushR, pushMax, shoveK) => {
      const [px, py] = push(p, pushR, pushMax);
      const tx = p.hx + px, ty = p.hy + py;
      // the push is quick, the return is slow
      if (px || py) omega *= 2.2;
      p.vx += (-omega * omega * (p.x - tx) - 2 * zeta * omega * p.vx) * dt;
      p.vy += (-omega * omega * (p.y - ty) - 2 * zeta * omega * p.vy + shove * shoveK) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dx = p.x - p.hx, dy = p.y - p.hy, d = Math.hypot(dx * this.aspect, dy);
      if (d > maxDisp) { const k = maxDisp / d; p.x = p.hx + dx * k; p.y = p.hy + dy * k; p.vx *= 0.5; p.vy *= 0.5; }
    };

    // --- update the sky ---
    const inView = (p, m = 3) => p.y > top - m && p.y < bottom + m;
    for (const s of this.field) if (inView(s, 6)) spring(s, 7, 0.5, 3, 5, 2.5, 1);
    for (const s of this.nameStars) if (inView(s, 6)) spring(s, 7, 0.5, 3, 5, 2.5, 1);
    for (const s of this.named) if (inView(s, 6)) spring(s, 12, 0.6, 1.2, 5, 1.2, 0.6);

    // --- spawn and update the living things ---
    if (!reduced) this.spawn(dt, rnd, top, bottom, centre);
    const keep = [];
    for (const p of this.movers) {
      p.age += dt;
      if (p.kind === 'shoot') {
        // bend away from the pointer
        if (ptr) {
          const dx = (p.x - ptr[0]) * this.aspect, dy = p.y - ptr[1], d = Math.hypot(dx, dy);
          if (d < 6 && d > 0.01) {
            const want = Math.atan2(dy, dx), have = Math.atan2(p.vy, p.vx * this.aspect);
            let diff = want - have; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
            const turn = clamp(diff, -0.7, 0.7) * (1 - d / 6) * dt * 6;
            const sp = Math.hypot(p.vx * this.aspect, p.vy), a = have + turn;
            p.vx = sp * Math.cos(a) / this.aspect; p.vy = sp * Math.sin(a);
          }
        }
        p.vy -= shove * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.hist.push([p.x, p.y]); if (p.hist.length > 40) p.hist.shift();
        if (p.y >= L.birds[0] * rows) { this.toBird(p, rnd); keep.push(p); continue; }
        if (p.age < p.life && p.x > -8 && p.x < this.cols + 8) keep.push(p);
      } else if (p.kind === 'bird') {
        p.morph = Math.max(0, (p.morph || 0) - dt);
        const [px, py] = push(p, 4, 3);
        p.baseY += 1.0 * dt + shove * 0.5 * dt;
        p.y = p.baseY + Math.sin(time * 2 + p.phase) * 1.0 + py;
        p.x += p.vx * dt + px * dt * 3;
        if (p.hist.length) p.hist.shift();
        if (p.y >= L.flakesFrom * rows) {
          for (let i = 0; i < 3; i++) { const f = this.spawnFlake(p.x + (i - 1), p.y, rnd); f.vx = (rnd() - 0.5) * 2; this.movers.push(f); keep.push(f); }
          continue;
        }
        if (p.age < p.life && p.x > -6 && p.x < this.cols + 6 && inView(p, rows)) keep.push(p);
      } else if (p.kind === 'flake' || p.kind === 'leaf') {
        if (p.rest) { keep.push(p); continue; }
        const [px, py] = push(p, 5, 2.5);
        const leaf = p.kind === 'leaf';
        const sway = leaf ? 1.5 : 0.8;
        p.x += (Math.sin(time * 2.1 + p.phase) * sway + (p.vx || 0) + px * 2) * dt;
        p.y += ((leaf ? 1.8 : 2.5) + shove * 0.5 + py * 2) * dt;
        p.vx = (p.vx || 0) * (1 - dt * 0.8);
        const col = clamp(Math.floor(p.x), 0, this.cols - 1);
        if (!leaf && p.y >= L.leavesFrom * rows) { this.toLeaf(p, rnd); keep.push(p); continue; }
        if (!leaf && p.wasSky && p.y >= w.peak[col]) { p.landed = (p.landed || 0) + dt; if (p.landed > 0.5) continue; }
        if (leaf && p.y >= p.restRow) { p.rest = true; p.y = p.restRow; this.resting.push(p); if (this.resting.length > 200) { const old = this.resting.shift(); old.gone = true; } }
        if (p.gone) continue;
        if (p.age < p.life && p.y < this.rows) keep.push(p);
      }
    }
    this.movers = keep;

    // --- draw ---
    g.clear(this.t > 0.86 ? P.skyBase : P.sky);
    this.blitWorld(top);

    // field stars
    const skyVisible = top < L.summit * rows + 10;
    if (skyVisible) {
      const tw = reduced ? 0 : 1;
      const rgb = { 0: '90,106,134', 1: '201,216,238', 2: '242,246,255' };
      for (const s of this.field) {
        if (!inView(s)) continue;
        let ch = s.ch, color = s.tier === 0 ? P.starDim : s.tier === 1 ? P.star : P.starBright;
        // a third of the sky twinkles: brightness breathes between 55% and 100%
        // on its own rate, and the bright ones also blink between glyphs
        if (tw && s.phase < 2.1) {
          const b = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * (1.4 + s.phase) + s.phase * 7));
          color = `rgba(${rgb[s.tier]},${b.toFixed(2)})`;
          if (s.tier === 2 && Math.sin(time * 1.7 + s.phase * 5) < -0.2) ch = '*';
        } else if (s.tier === 2 && tw && Math.sin(time * 1.7 + s.phase) < -0.3) ch = '*';
        g.put(ch, color, s.x, s.y - top);
      }
    }

    // the name: traced on load, let go on scroll. The lines are recomputed
    // every frame from where the stars are now, so a pushed star drags its
    // lines with it and they spring back together.
    // the name twinkles in all at once over three seconds: every star and
    // every thread dot flickers up from nothing on its own rhythm
    const reveal = reduced ? 1 : clamp((time - 0.4) / 3, 0, 1);
    const hold = 1 - smooth(0.05, 0.1, this.t);
    if (hold > 0.001 && skyVisible) {
      const N = this.nameLines.length;
      // the thread flickers up over the reveal, then keeps a faint twinkle for good
      const flicker = (phase) => {
        const steady = 0.86 + 0.14 * Math.sin(time * 2.6 + phase);
        if (reveal >= 1) return reduced ? 1 : steady;
        return clamp(reveal * (0.55 + 0.45 * Math.sin(time * 9 + phase)) + (reveal * reveal) * 0.6, 0, 1) * (1 - reveal) + steady * reveal;
      };
      for (let idx = 0; idx < N; idx++) {
        const line = this.nameLines[idx];
        const a = this.nameStars[line.i], b = this.nameStars[line.j];
        const ax = a.x, ay = a.y, bx = b.x, by = b.y;
        // the same dotted thread as the star tethers, at twice the density
        const steps = Math.max(1, Math.round(2 * Math.max(Math.abs(bx - ax) * this.aspect * 2, Math.abs(by - ay))));
        for (let k = 1; k < steps; k++) {
          const f = k / steps;
          const base = k % 2 ? 0.95 : 0.6;
          const alpha = base * hold * flicker(idx * 1.7 + k * 2.3);
          if (alpha < 0.02) continue;
          g.put('·', `rgba(190,206,232,${alpha.toFixed(2)})`, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f - top);
        }
      }
      // about a third of the name's stars were always there, indistinguishable
      // from the field; they brighten to white over the reveal. The rest
      // twinkle in from nothing.
      const seeds = this.nameSeeds || (this.nameSeeds = (() => { const r = mulberry32(31); return this.nameStars.map(() => r()); })());
      this.nameStars.forEach((s, i) => {
        const always = seeds[i] < 0.34;
        if (always) {
          const w = reveal; // field colour → white
          const col = `rgb(${Math.round(201 + (255 - 201) * w)},${Math.round(216 + (255 - 216) * w)},${Math.round(238 + (255 - 238) * w)})`;
          g.put(s.anchor && reveal > 0.6 ? '✦' : '*', col, s.x, s.y - top);
        } else {
          const alpha = reveal >= 1 ? 1 : clamp(reveal * (0.5 + 0.5 * Math.sin(time * 8 + seeds[i] * 40)) + reveal * reveal * 0.7, 0, 1);
          if (alpha < 0.02) return;
          g.put(s.anchor ? '✦' : '*', `rgba(255,255,255,${alpha.toFixed(2)})`, s.x, s.y - top);
        }
      });
    } else if (skyVisible) {
      for (const s of this.nameStars) g.put('*', P.star, s.x, s.y - top);
    }

    // the four bright stars with halos
    this.named.forEach((s, i) => {
      if (!inView(s, 4)) return;
      const [a, b] = this.bands.stars[i];
      const on = smooth(a - 0.01, a + 0.01, this.t) * (1 - smooth(b - 0.01, b + 0.01, this.t));
      s.glow += (on - s.glow) * Math.min(1, dt * 5);
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(time * 2.4 + i);
      // the original: four faint neighbours, eight when lit. Same shape,
      // a touch more contrast so it reads on a phone.
      const rest = 0.45; // the resting ring level
      const halo = `rgba(243,200,107,${(rest + (1 - rest) * s.glow * pulse).toFixed(2)})`;
      const cx = Math.round(s.hx), cy = Math.round(s.hy) - top;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.put('·', halo, cx + dx, cy + dy);
      if (s.glow > 0.05) {
        // the corners and the four points come in at the ring's resting level
        const a = `rgba(243,200,107,${(rest * s.glow * pulse).toFixed(2)})`;
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) g.put('·', a, cx + dx, cy + dy);
      }
      g.put('✦', P.ember, s.x, s.y - top);
    });

    // headlamps on the route
    if (this.lamps.length) {
      const sweep = smooth(L.route[0] - 0.3, L.route[1], centre / rows);
      this.lamps.forEach((l, i) => {
        if (l.y < top - 2 || l.y > bottom + 2) return;
        const order = (i + 0.5) / this.lamps.length;
        const lit = smooth(order - 0.1, order + 0.02, sweep * 1.08);
        const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin(time * 3.1 + l.phase);
        const a = (0.35 + 0.65 * lit) * pulse;
        g.put('o', `rgba(243,200,107,${a.toFixed(2)})`, l.x, l.y - top);
        if (lit > 0.5) { g.put('·', `rgba(243,200,107,${(0.5 * lit * pulse).toFixed(2)})`, l.x - 1, l.y - top); g.put('·', `rgba(243,200,107,${(0.5 * lit * pulse).toFixed(2)})`, l.x + 1, l.y - top); }
      });
    }

    // the living things
    for (const p of this.movers) {
      if (!inView(p, 2)) continue;
      if (p.kind === 'shoot') {
        g.put(G.shootHead, P.starBright, p.x, p.y - top);
        this.drawTail(p, top, 6);
      } else if (p.kind === 'bird') {
        if (p.morph > 0) this.drawTail(p, top, Math.ceil(p.morph * 15));
        const frames = G.bird;
        const f = frames[Math.floor(time * 6 + p.phase) % frames.length];
        if (p.morph > 0.25) g.put('v', P.bird, p.x, p.y - top);
        else g.text(f, P.bird, p.x - 1, p.y - top);
      } else if (p.kind === 'flake') {
        g.put(p.ch, p.far ? P.starDim : P.snow, p.x, p.y - top);
      } else {
        const ch = p.rest ? ',' : G.leaves[(p.frame + Math.floor(time * 3)) % 3];
        g.put(ch, p.color, p.x, p.y - top);
      }
    }

    // tether from the lit star to its card, drawn by the page via drawTether()
    if (this.tether) {
      // the original: a dot on every other cell. White-blue, brighter than before.
      const [x0, y0, x1, y1, alpha] = this.tether;
      // every cell carries a dot now, alternating a mid dot and a small one,
      // so the line is continuous but still a line of dots
      cellsBetween(x0, y0, x1, y1).forEach(([cx, cy], k) => g.put(k % 2 ? '.' : '·', `rgba(190,206,232,${alpha.toFixed(2)})`, cx, cy - top));
      this.tether = null;
    }

    this.dispatchEvent(new CustomEvent('frame', { detail: { t: this.t } }));
    requestAnimationFrame(this.loop);
  }

  drawTail(p, top, len) {
    const G = D.glyphs, P = D.palette;
    const tail = G.shootTail;
    let acc = 0, k = 0;
    for (let i = p.hist.length - 2; i >= 0 && k < len; i--) {
      const [x1, y1] = p.hist[i + 1], [x0, y0] = p.hist[i];
      acc += Math.hypot((x1 - x0), (y1 - y0) / this.aspect);
      while (acc >= k + 1 && k < len) {
        const ch = tail[Math.min(tail.length - 1, k)];
        const color = k < 2 ? P.star : k < 4 ? `rgba(201,216,238,0.6)` : P.starDim;
        this.grid.put(ch, color, x0, y0 - top);
        k++;
      }
    }
  }

  spawn(dt, rnd, top, bottom, centre) {
    const L = D.layout, rows = this.screenRows;
    const cs = centre / rows; // viewport centre in screens
    // shooting stars
    if (cs > L.shooting[0] && cs < L.shooting[1]) {
      this.nextShoot -= dt;
      if (this.nextShoot <= 0) { this.movers.push(this.spawnShooting(rnd)); this.nextShoot = 3.5 + rnd() * 2.5; }
    }
    // birds from the edges
    if (bottom > L.birds[0] * rows && top < L.birds[1] * rows) {
      this.nextBird -= dt;
      const birds = this.movers.filter((p) => p.kind === 'bird').length;
      if (this.nextBird <= 0 && birds < 6) {
        const dir = rnd() < 0.5 ? 1 : -1;
        const y = clamp(top + rnd() * rows * 0.6, L.birds[0] * rows, L.birds[1] * rows - 2);
        this.movers.push(this.spawnBird(dir > 0 ? -3 : this.cols + 3, y, dir, rnd));
        this.nextBird = 4;
      }
    }
    // flakes across the width
    if (bottom > L.flakesFrom * rows && top < L.leavesFrom * rows) {
      const live = this.movers.filter((p) => p.kind === 'flake').length;
      this.flakeAcc += dt * 9;
      while (this.flakeAcc >= 1 && live < 90) {
        this.flakeAcc -= 1;
        const y = Math.max(L.flakesFrom * rows, top - 1);
        this.movers.push(this.spawnFlake(rnd() * this.cols, y, rnd));
      }
      if (this.flakeAcc > 1) this.flakeAcc = 0;
    }
    // leaves through the trees
    if (bottom > L.leavesFrom * rows && top < L.groundFrom * rows) {
      const live = this.movers.filter((p) => p.kind === 'leaf' && !p.rest).length;
      this.leafAcc += dt * 5;
      while (this.leafAcc >= 1 && live < 80) {
        this.leafAcc -= 1;
        const f = this.spawnFlake(rnd() * this.cols, Math.max(L.leavesFrom * rows, top - 1), rnd);
        this.toLeaf(f, rnd); this.movers.push(f);
      }
      if (this.leafAcc > 1) this.leafAcc = 0;
    }
  }

  // ---------- the static painting, cached in tiles of one screen ----------
  tile(index) {
    this.tiles = this.tiles || new Map();
    let t = this.tiles.get(index);
    if (t) { t.used = performance.now(); return t.canvas; }
    const g = this.grid, rowsPer = this.tileRows;
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = Math.ceil(rowsPer * g.cellH * g.dpr);
    const x = c.getContext('2d');
    x.scale(g.dpr, g.dpr);
    const r0 = index * rowsPer, r1 = Math.min(this.rows, r0 + rowsPer);
    for (let r = r0; r < r1; r++) {
      const row = this.world.cells[r];
      for (let col = 0; col < this.cols; col++) {
        const cell = row[col];
        if (cell) x.drawImage(g.sprite(cell[0], cell[1]), col * g.cellW, (r - r0) * g.cellH, g.cellW + 2 / g.dpr, g.cellH + 2 / g.dpr);
      }
    }
    t = { canvas: c, used: performance.now() };
    this.tiles.set(index, t);
    if (this.tiles.size > 4) {
      let oldest = null;
      for (const [k, v] of this.tiles) if (!oldest || v.used < this.tiles.get(oldest).used) oldest = k;
      this.tiles.delete(oldest);
    }
    return c;
  }
  blitWorld(top) {
    const g = this.grid, rowsPer = this.tileRows;
    const first = Math.max(0, Math.floor(top / rowsPer)), last = Math.min(Math.ceil(this.rows / rowsPer) - 1, Math.floor((top + this.screenRows + 1) / rowsPer));
    for (let i = first; i <= last; i++) {
      const c = this.tile(i);
      g.ctx.drawImage(c, 0, 0, c.width, c.height, 0, (i * rowsPer - top) * g.cellH, c.width / g.dpr, c.height / g.dpr);
    }
  }

  // ---------- for the page ----------
  project(col, row) { return { x: col * this.grid.cellW, y: (row - this.scrollRows) * this.grid.cellH }; }
  toCell(px, py) { return [Math.round(px / this.grid.cellW), Math.round(py / this.grid.cellH + this.scrollRows)]; }
  starScreen(i) { const s = this.named[i]; return this.project(s.x, s.y); }
  drawTether(i, px, py, alpha) {
    const s = this.named[i];
    const [cx, cy] = this.toCell(px, py);
    this.tether = [Math.round(s.x), Math.round(s.y), cx, cy, alpha];
  }
}

customElements.define('ascii-scene', AsciiScene);
