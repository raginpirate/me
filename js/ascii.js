// <ascii-scene> — a night mountain drawn in type.
//
// A tall ASCII painting the browser scrolls through 1:1. Everything that
// lives (stars, the name, shooting stars, birds, flakes, leaves) is a
// particle on a spring or on a path; everything else is painted once.
// The page starts it with start(); until then it is an empty element.

import { Grid } from './grid.js';
import { buildWorld } from './world.js';
import { D } from './direction.js';
import { layoutName } from './asterism.js';
import { clamp, smooth, mulberry32, twinkle } from './util.js';

const mix = ([a, b], t) => a + (b - a) * t;

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
    // the page's one test for "cards stack under the scene", set in the stylesheet
    this.stack = getComputedStyle(document.documentElement).getPropertyValue('--stack').trim() === '1';
    g.size = this.stack ? D.type.stack : this.viewW < D.type.wideFrom ? D.type.mid : D.type.wide;
    g.resize(this.viewW, this.viewH);
    this.u = g.size / D.type.stack; // lights are measured in pixels at the stack type size

    this.screenRows = this.viewH / g.cellH;
    this.cols = g.cols;
    this.rows = Math.ceil(L.screens * this.screenRows) + 2;
    this.world = buildWorld(this.cols, this.rows, this.screenRows, D, P);
    this.tileRows = Math.ceil(this.screenRows);
    this.tiles = new Map(); this.bare = new Set();
    this.maxScroll = (L.screens - 1) * this.screenRows;
    this.aspect = g.cellW / g.cellH; // a column is this many rows wide
    const rnd = mulberry32(2026);

    // page height follows the world, in pixels, so the scroll range does not
    // move when a browser bar comes and goes
    document.documentElement.style.setProperty('--world-height', `${Math.round(this.rows * g.cellH)}px`);

    // field stars: everywhere above the mountain, three tiers
    this.field = [];
    const star = (x, y, dimShare, midShare) => {
      const u = rnd();
      const tier = u < dimShare ? 0 : u < midShare ? 1 : 2;
      const ch = tier === 0 ? (rnd() < 0.2 ? '·' : '.') : tier === 1 ? (rnd() < 0.15 ? '+' : '*') : '✦';
      this.field.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, tier, ch, phase: rnd() * 6.28 });
    };
    const skyRows = Math.floor(L.summit * this.screenRows);
    const count = Math.floor((this.cols * skyRows) / 58);
    for (let i = 0; i < count; i++) {
      const x = rnd() * this.cols, y = rnd() * (skyRows + 20);
      if (y > this.world.peak[Math.floor(x)]) continue;
      star(x, y, 0.7, 0.94);
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
    // half of the name's stars were always there; the rest twinkle in
    const seeded = mulberry32(31);
    this.nameSeeds = this.nameStars.map(() => seeded());

    // the stops: when each card is open, where a glide rests, where its light is
    const S = L.screens - 1, last = this.rows - this.screenRows;
    const toT = (centre) => clamp((centre - 0.5) / S, 0, 1);                       // viewport centre in screens → scroll fraction
    const restRow = (centre) => clamp((centre - 0.5) * this.screenRows, 0, last);  // → the scroll position, in rows
    const mode = this.stack ? 'stack' : 'side';
    this.fade = D.fade / S;
    this.stops = D.stops.map((d, n) => {
      const s = { id: d.id, n, band: null, snap: 0, glow: 0, target: null, dots: [] };
      if (d.at) {
        const [screen, across] = d.at;
        s.x = s.hx = Math.round(across * this.cols); s.y = s.hy = Math.round(screen * this.screenRows); s.vx = s.vy = 0;
        s.side = across > 0.5 ? 'left' : 'right'; // the card goes on the other side from its light
        s.band = [toT(screen + D.band[mode][0]), toT(screen + D.band[mode][1])];
        s.snap = restRow(screen + D.rest[mode]);
      } else if (d.until) s.band = [0, toT(d.until)];
      else s.snap = restRow(d.rest);
      if (n === D.stops.length - 1) { s.band[1] = 1; s.snap = last; }
      return s;
    });
    this.lights = this.stops.filter((s) => s.side);
    this.hollow();

    // headlamps: a walk down the face between the route rows
    this.placeLamps(this.lampCount);

    // static props for reduced motion
    this.movers = []; this.resting = []; this.count = { bird: 0, flake: 0, leaf: 0 };
    if (this.reduced.matches) {
      for (let i = 0; i < 40; i++) this.movers.push(this.spawnFlake(rnd() * this.cols, (L.flakesFrom + rnd() * (L.leavesFrom - L.flakesFrom)) * this.screenRows, rnd));
      for (let i = 0; i < 40; i++) { const f = this.spawnFlake(rnd() * this.cols, (L.leavesFrom + rnd() * (L.groundFrom - L.leavesFrom)) * this.screenRows, rnd); this.toLeaf(f, rnd); this.movers.push(f); }
      for (let i = 0; i < 5; i++) this.movers.push(this.spawnBird(rnd() * this.cols, (L.birds[0] + rnd() * (L.birds[1] - L.birds[0])) * this.screenRows, rnd() < 0.5 ? 1 : -1, rnd));
    }
    this.nextShoot = 1.5 + rnd() * 2; this.nextBird = 1; this.flakeAcc = 0; this.leafAcc = 0;
    this.dirty = true; this.told = undefined;
    this.dispatchEvent(new CustomEvent('built'));
  }

  // a light on the mountain sits in a small hollow, so it reads against the rock and the trees
  hollow() {
    const g = this.grid, [inner, outer] = D.light.hollow, rnd = mulberry32(5);
    const rx = Math.ceil(outer * this.u / g.cellW), ry = Math.ceil(outer * this.u / g.cellH);
    for (const s of this.lights) {
      for (let r = s.hy - ry; r <= s.hy + ry; r++) for (let c = s.hx - rx; c <= s.hx + rx; c++) {
        if (!this.world.cells[r]?.[c]) continue;
        const d = Math.hypot((c - s.hx) * g.cellW, (r - s.hy) * g.cellH) / this.u;
        if (d < inner || rnd() > (d - inner) / (outer - inner)) this.world.cells[r][c] = null;
      }
    }
  }

  placeLamps(n) {
    const L = D.layout, w = this.world;
    this.lampCount = n;
    this.lamps = [];
    this.dirty = true;
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
  // Shooting stars are points in front of a camera. The camera sits at the
  // origin looking down +Z; the screen plane is at Z = F (pixels), centred
  // on the viewport. A point (X, Y, Z) lands at (X, Y) * F / Z from the
  // centre, and its glyph is drawn F / Z times the base size.
  get focal() { return this.viewW; }
  spawnShooting(rnd) {
    const L = D.layout, top = this.scrollRows, rows = this.screenRows, g = this.grid;
    const F = this.focal;
    const cxPx = this.viewW / 2, cyPx = (top + rows / 2) * g.cellH; // the centre, in world pixels
    const bandTop = L.shooting[0] * rows;
    // a direction with real depth: at least 40% of the motion is along Z
    const toward = rnd() < 0.65;
    // approaching ones come more head-on, so they grow in place before sliding past
    const zc = (toward ? 0.72 + rnd() * 0.22 : 0.55 + rnd() * 0.3) * (toward ? -1 : 1);
    const lat = Math.sqrt(1 - zc * zc), ang = rnd() * Math.PI * 2;
    const dir = [lat * Math.cos(ang), lat * Math.sin(ang) * 0.6 + lat * 0.35, zc]; // a little downward bias
    const speed = (1.1 + rnd() * 0.8) * F;                                           // per second, in world pixels
    let Z, sx, sy;
    if (toward) {
      // born deep in the field, somewhere inside the view, as a speck
      Z = (2.2 + rnd() * 1.4) * F;
      sx = 4 + rnd() * (this.cols - 8); sy = Math.max(bandTop, top + 2 + rnd() * rows * 0.6);
    } else {
      // born near, off an edge, flying away toward the vanishing point
      Z = (0.55 + rnd() * 0.35) * F;
      if (top - 3 >= bandTop && rnd() < 0.6) { sx = rnd() * this.cols; sy = top - 3; }
      else { sx = rnd() < 0.5 ? -5 : this.cols + 5; sy = Math.max(bandTop, top + 2 + rnd() * rows * 0.45); }
      // aim inward so it crosses the view on its way out
      dir[0] = (cxPx - sx * g.cellW) / F * 0.6 + (rnd() - 0.5) * 0.3;
      dir[1] = Math.abs(dir[1]) * 0.6 + (cyPx - sy * g.cellH) / F * 0.4;
    }
    const X = (sx * g.cellW - cxPx) * Z / F, Y = (sy * g.cellH - cyPx) * Z / F;
    const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const p = { kind: 'shoot', X, Y, Z, vX: speed * dir[0] / n, vY: speed * dir[1] / n, vZ: speed * dir[2] / n, cxPx, cyPx, x: sx, y: sy, life: 6, age: 0, hist: [] };
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
  spawnBird(x, y, dir, rnd) {
    return { kind: 'bird', x, y, vx: dir * 7, baseY: y, phase: rnd() * 6.28, age: 0, life: 14 };
  }
  toBird(p, rnd) {
    // it keeps flying the way the shooting star was heading
    p.kind = 'bird'; p.hist = null; p.vx = (p.vX < 0 ? -1 : 1) * 7; p.baseY = p.y; p.phase = rnd() * 6.28; p.age = 0; p.life = 14; p.morph = 0.4;
  }
  spawnFlake(x, y, rnd) {
    const u = rnd();
    const ch = u < 0.5 ? '*' : u < 0.85 ? '.' : '+';
    return { kind: 'flake', x, y, vx: 0, ch, far: ch === '.', phase: rnd() * 6.28, age: 0, life: 40, wasSky: y < this.world.peak[clamp(Math.floor(x), 0, this.cols - 1)] };
  }
  toLeaf(p, rnd) {
    p.kind = 'leaf'; p.color = rnd() < 0.5 ? this.P.leaf : this.P.leafOlive; p.frame = Math.floor(rnd() * 3); p.phase = rnd() * 6.28; p.age = 0; p.life = 60;
    p.restRow = this.world.groundRow + 1 + Math.floor(rnd() * (this.rows - this.world.groundRow - 8));
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
    this.scrollRows = this.scrollTarget;
    const rawVel = (this.scrollRows - prev) / dt;
    this.scrollVel += (rawVel - this.scrollVel) * Math.min(1, dt * 12);
    this.t = this.maxScroll > 0 ? clamp(this.scrollRows / this.maxScroll, 0, 1) : 0;
    const top = this.scrollRows, rows = this.screenRows, bottom = top + rows;
    const centre = top + rows / 2;
    const shove = reduced ? 0 : -0.9 * this.scrollVel;

    // `active`: something on screen is moving, so this frame must be drawn.
    // Set by anything below that moves.
    let active = this.dirty || this.scrollRows !== prev || Math.abs(this.scrollVel) > 0.05;
    this.dirty = false;

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
    const spring = (p, [stiff, zeta, maxDisp, pushR, pushMax, shoveK]) => {
      const [px, py] = push(p, pushR, pushMax);
      const tx = p.hx + px, ty = p.hy + py;
      // the push is quick, the return is slow
      const omega = px || py ? stiff * 2.2 : stiff;
      p.vx += (-omega * omega * (p.x - tx) - 2 * zeta * omega * p.vx) * dt;
      p.vy += (-omega * omega * (p.y - ty) - 2 * zeta * omega * p.vy + shove * shoveK) * dt;
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
      if (inView(s, 6)) spring(s, D.spring.light);
      const on = this.presence(s);
      if (Math.abs(on - s.glow) > 0.003) active = true;
      s.glow += (on - s.glow) * Math.min(1, dt * 5);
      if (s.glow > 0.02 && inView(s, 4)) litInView = true;
      // the tether to its card, while the card is open. The page says where
      // the card is (target, in viewport pixels).
      if (on >= 0.02 && s.target && inView(s, rows)) this.tether(s, s.target[0] / g.cellW - 0.5, s.target[1] / g.cellH - 0.5 + top, spring);
      else s.dots.length = 0;
    }

    // --- spawn and update the living things ---
    if (!reduced) this.spawn(dt, rnd, top, bottom, centre);
    const keep = [], count = { bird: 0, flake: 0, leaf: 0 };
    for (const p of this.movers) {
      p.age += dt;
      if (p.kind === 'shoot') {
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
        if (p.y >= L.birds[0] * rows) this.toBird(p, rnd);
        else if (!(p.age < p.life && p.x > -20 && p.x < this.cols + 20 && p.Z > 0.28 * F && p.Z < 4.2 * F)) continue;
      } else if (p.kind === 'bird') {
        p.morph = Math.max(0, (p.morph || 0) - dt);
        const [px, py] = push(p, ...D.push.bird);
        p.baseY += 1.0 * dt + shove * 0.5 * dt;
        p.y = p.baseY + Math.sin(time * 2 + p.phase) * 1.0 + py;
        p.x += p.vx * dt + px * dt * 3;
        if (p.y >= L.flakesFrom * rows) {
          // a bird that reaches the snow becomes three flakes
          for (let i = 0; i < 3; i++) { const f = this.spawnFlake(p.x + (i - 1), p.y, rnd); f.vx = (rnd() - 0.5) * 2; keep.push(f); count.flake++; }
          continue;
        }
        if (!(p.age < p.life && p.x > -6 && p.x < this.cols + 6 && inView(p, rows))) continue;
        count.bird++;
      } else if (!p.rest) {
        // a flake, or a leaf still falling
        const [px, py] = push(p, ...D.push.fall);
        const [speed, sway] = D.fall[p.kind];
        p.x += (Math.sin(time * 2.1 + p.phase) * sway + (p.vx || 0) + px * 2) * dt;
        p.y += (speed + shove * 0.5 + py * 2) * dt;
        p.vx = (p.vx || 0) * (1 - dt * 0.8);
        if (p.kind === 'flake') {
          if (p.y >= L.leavesFrom * rows) this.toLeaf(p, rnd);
          else if (p.wasSky && p.y >= w.peak[clamp(Math.floor(p.x), 0, this.cols - 1)]) { p.landed = (p.landed || 0) + dt; if (p.landed > 0.5) continue; }
        } else if (p.y >= p.restRow) {
          // a leaf comes to rest; only the newest two hundred stay
          p.rest = true; p.y = p.restRow; this.resting.push(p);
          if (this.resting.length > 200) this.resting.shift().gone = true;
        }
        if (!(p.age < p.life && p.y < this.rows)) continue;
        if (!p.rest) count[p.kind]++;
      } else if (p.gone) continue;
      if (!p.rest && inView(p, 2)) active = true;
      keep.push(p);
    }
    this.movers = keep; this.count = count;

    // the name twinkles in all at once over three seconds
    const reveal = this.reveal = reduced ? 1 : clamp((time - 0.4) / 3, 0, 1);
    if (reveal < 1) active = true;

    // tell the page where we are, when that changes
    if (this.t !== this.told) { this.told = this.t; this.dispatchEvent(new CustomEvent('moved')); }

    // --- is there anything new to draw? ---
    // If only slow twinkles are alive, every other frame will do. If nothing
    // is, the last frame stands, and the spare time paints the next screen
    // of mountain ahead of the scroll.
    const skyVisible = top < L.summit * rows + 10;
    const lampsVisible = this.lamps.length > 0 && bottom > L.route[0] * rows - 2 && top < L.route[1] * rows + 2;
    const ambient = !reduced && (skyVisible || litInView || lampsVisible);
    this.tick = (this.tick || 0) + 1;
    if (!active && !(ambient && this.tick % 2 === 0)) { this.warm(top); return; }

    // --- draw ---
    g.clear(this.t > 0.86 ? P.skyBase : P.sky);
    this.paint(top);

    // field stars
    if (skyVisible) {
      const [floor, rate] = D.twinkle.field;
      for (const s of this.field) {
        if (!inView(s)) continue;
        let ch = s.ch, a = 1;
        // a third of the sky twinkles, each on its own rate, and the bright
        // ones also blink between glyphs
        if (!reduced && s.phase < 2.1) {
          a = twinkle(time, s.phase * 7, floor, rate + s.phase);
          if (s.tier === 2 && Math.sin(time * 1.7 + s.phase * 5) < -0.2) ch = '*';
        } else if (!reduced && s.tier === 2 && Math.sin(time * 1.7 + s.phase) < -0.3) ch = '*';
        g.put(ch, s.tier === 0 ? P.dim : s.tier === 1 ? P.star : P.starBright, s.x, s.y - top, a);
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

    // the lights, one for every stop with something to read. Each is one
    // object placed in pixels, not cells (a cell is twice as tall as it is
    // wide): a soft bloom of the glyph itself, a ring of dots at one even
    // pitch, and the star centred on its own ink. At rest: bloom and four
    // dots. Lit: the four brighten, the corners and four outer points fill
    // in, the star grows and warms.
    const A = D.light, u = this.u, pitch = A.pitch * u;
    for (const s of this.lights) {
      if (!inView(s, 4)) continue;
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

    // headlamps on the route, one per merged commit
    if (lampsVisible) {
      const sweep = smooth(L.route[0] - 0.3, L.route[1], centre / rows);
      this.lamps.forEach((l, i) => {
        if (l.y < top - 2 || l.y > bottom + 2) return;
        const order = (i + 0.5) / this.lamps.length;
        const lit = smooth(order - 0.1, order + 0.02, sweep * 1.08);
        const pulse = reduced ? 1 : twinkle(time, l.phase, ...D.twinkle.lamp);
        g.put('o', P.ember, l.x, l.y - top, (0.35 + 0.65 * lit) * pulse);
        if (lit > 0.5) for (const dx of [-1, 1]) g.put('·', P.ember, l.x + dx, l.y - top, 0.5 * lit * pulse);
      });
    }

    // the living things
    for (const p of this.movers) {
      if (!inView(p, 2)) continue;
      const y = p.y - top;
      if (p.kind === 'shoot') this.drawShooting(p, top);
      else if (p.kind === 'bird') {
        // a shooting star is a single mark for a moment before it is a bird
        const f = p.morph > 0.25 ? ' v ' : G.bird[Math.floor(time * 6 + p.phase) % G.bird.length];
        for (let i = 0; i < f.length; i++) g.put(f[i], P.bird, p.x - 1 + i, y);
      } else if (p.kind === 'flake') g.put(p.ch, p.far ? P.dim : P.snow, p.x, y);
      else g.put(p.rest ? ',' : G.leaves[(p.frame + Math.floor(time * 3)) % 3], p.color, p.x, y);
    }

    // the tethers
    for (const s of this.lights) {
      const level = Math.min(1, 0.95 * this.presence(s));
      for (const p of s.dots) if (p.a) g.put('·', P.thread, p.x, p.y - top, p.a * level);
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

  // A card's tether: the same dots, drawn by hand. It wanders a little off
  // the straight path, the dots are unevenly spaced and unevenly bright,
  // and the odd one is missing. The pattern belongs to the stop and is
  // measured out from its light, so it holds still while the page scrolls
  // and the far end simply grows or shrinks. It starts clear of the halo.
  //
  // Each dot is a star on a spring, the same spring as the sky's: its place
  // on the tether is its home, and a swipe or a pointer pushes it off and
  // lets it settle back. This lays the dots out and moves them; the frame
  // draws them.
  tether(s, bx, by, spring) {
    const g = this.grid, T = D.tether, u = this.u, dots = s.dots;
    const dx = bx - s.x, dy = by - s.y;
    const px = dx * g.cellW, py = dy * g.cellH, len = Math.hypot(px, py);
    let k = 0;
    if (len >= 1) {
      const nx = -py / len / g.cellW, ny = px / len / g.cellH; // one pixel sideways, in cells
      const rnd = mulberry32(40 + s.n);
      const [[far1, quick1], [far2, quick2]] = T.wander, p1 = rnd() * 6.28, p2 = rnd() * 6.28;
      for (let d = (D.light.clear + 2) * u; d < len - 3 * u; k++) {
        const f = d / len, ease = Math.sin(Math.PI * f); // the wander dies out at both ends
        const w = (Math.sin(d / u * quick1 + p1) * far1 + Math.sin(d / u * quick2 + p2) * far2) * ease * u;
        const hx = s.x + dx * f + nx * w, hy = s.y + dy * f + ny * w;
        const p = dots[k] || (dots[k] = { x: hx, y: hy, hx, hy, vx: 0, vy: 0, a: 0 });
        // its home moves as the page scrolls; it keeps whatever push it is carrying
        p.x += hx - p.hx; p.y += hy - p.hy; p.hx = hx; p.hy = hy;
        p.a = rnd() > T.miss ? mix(T.alpha, rnd()) : 0; // a missed dot keeps its place in the pattern
        if (p.a) spring(p, D.spring.star);
        d += mix(T.step, rnd()) * u;
      }
    }
    dots.length = k;
  }
  // a thread dot's brightness: it flickers up over the reveal, then keeps a faint twinkle for good
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
    const born = clamp(p.age / 0.5, 0, 1);
    g.ink(D.glyphs.shootHead, P.starBright, p.px, p.py - topPx, base * clamp(headK, 0.35, 3.6), clamp(headK * 1.15, 0.1, 1) * born);
    // the tail follows the real path through space; spacing is one glyph at each point's own scale
    let acc = 0, k = 0;
    for (let i = p.hist.length - 2; i >= 0 && k < tail.length; i--) {
      const [X1, Y1, Z1] = p.hist[i + 1], [X0, Y0, Z0] = p.hist[i];
      const k1 = F / Z1, k0 = F / Z0;
      const x1 = p.cxPx + X1 * k1, y1 = p.cyPx + Y1 * k1, x0 = p.cxPx + X0 * k0, y0 = p.cyPx + Y0 * k0;
      acc += Math.hypot(x1 - x0, y1 - y0);
      while (acc >= (k + 1) * base * 0.9 * Math.max(0.5, k0) && k < tail.length) {
        g.ink(tail[k], P.star, x0, y0 - topPx, base * clamp(k0, 0.35, 3.2), (k < 2 ? 0.9 : k < 4 ? 0.55 : 0.35) * clamp(k0 * 1.15, 0.1, 1) * born);
        k++;
      }
    }
  }

  spawn(dt, rnd, top, bottom, centre) {
    const L = D.layout, W = D.spawn, rows = this.screenRows;
    const cs = centre / rows; // viewport centre in screens
    // shooting stars
    if (cs > L.shooting[0] && cs < L.shooting[1]) {
      this.nextShoot -= dt;
      if (this.nextShoot <= 0) { this.movers.push(this.spawnShooting(rnd)); this.nextShoot = W.shoot[0] + rnd() * W.shoot[1]; }
    }
    // birds from the edges
    if (bottom > L.birds[0] * rows && top < L.birds[1] * rows) {
      this.nextBird -= dt;
      if (this.nextBird <= 0 && this.count.bird < W.bird[1]) {
        const dir = rnd() < 0.5 ? 1 : -1;
        const y = clamp(top + rnd() * rows * 0.6, L.birds[0] * rows, L.birds[1] * rows - 2);
        this.movers.push(this.spawnBird(dir > 0 ? -3 : this.cols + 3, y, dir, rnd));
        this.nextBird = W.bird[0];
      }
    }
    // flakes across the width
    if (bottom > L.flakesFrom * rows && top < L.leavesFrom * rows) {
      this.flakeAcc += dt * W.flake[0];
      while (this.flakeAcc >= 1 && this.count.flake < W.flake[1]) {
        this.flakeAcc -= 1;
        this.movers.push(this.spawnFlake(rnd() * this.cols, Math.max(L.flakesFrom * rows, top - 1), rnd));
      }
      if (this.flakeAcc > 1) this.flakeAcc = 0;
    }
    // leaves through the trees
    if (bottom > L.leavesFrom * rows && top < L.groundFrom * rows) {
      this.leafAcc += dt * W.leaf[0];
      while (this.leafAcc >= 1 && this.count.leaf < W.leaf[1]) {
        this.leafAcc -= 1;
        const f = this.spawnFlake(rnd() * this.cols, Math.max(L.leavesFrom * rows, top - 1), rnd);
        this.toLeaf(f, rnd); this.movers.push(f);
      }
      if (this.leafAcc > 1) this.leafAcc = 0;
    }
  }

  // ---------- the static painting, cached in tiles of one screen ----------
  // A tile with nothing in it (most of the sky) is never allocated or drawn.
  tile(index) {
    if (this.bare.has(index)) return null;
    let t = this.tiles.get(index);
    if (t) { t.used = performance.now(); return t.canvas; }
    const g = this.grid, rowsPer = this.tileRows;
    const r0 = index * rowsPer, r1 = Math.min(this.rows, r0 + rowsPer);
    let any = false;
    for (let r = r0; r < r1 && !any; r++) any = this.world.cells[r].some(Boolean);
    if (!any) { this.bare.add(index); return null; }
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = Math.ceil(rowsPer * g.cellH * g.dpr);
    const x = c.getContext('2d');
    x.scale(g.dpr, g.dpr);
    for (let r = r0; r < r1; r++) {
      const row = this.world.cells[r];
      for (let col = 0; col < this.cols; col++) { const cell = row[col]; if (cell) g.put(cell[0], cell[1], col, r - r0, cell[2] ?? 1, x); }
    }
    this.tiles.set(index, { canvas: c, used: performance.now() });
    if (this.tiles.size > 4) {
      let oldest = null;
      for (const [k, v] of this.tiles) if (oldest === null || v.used < this.tiles.get(oldest).used) oldest = k;
      this.tiles.delete(oldest);
    }
    return c;
  }
  span(top) { return [Math.max(0, Math.floor(top / this.tileRows)), Math.min(Math.ceil(this.rows / this.tileRows) - 1, Math.floor((top + this.screenRows + 1) / this.tileRows))]; }
  paint(top) {
    const [first, last] = this.span(top);
    for (let i = first; i <= last; i++) { const c = this.tile(i); if (c) this.grid.blit(c, (i * this.tileRows - top) * this.grid.cellH); }
  }
  // paint one neighbouring screen ahead of time, so scrolling into it does not hitch
  warm(top) {
    const [first, last] = this.span(top), n = Math.ceil(this.rows / this.tileRows);
    for (const i of [last + 1, first - 1]) if (i >= 0 && i < n && !this.bare.has(i) && !this.tiles.has(i)) { this.tile(i); return; }
  }

  // ---------- for the page ----------
  // where a stop's light is on screen, in viewport pixels
  where(s) { return [(s.x + 0.5) * this.grid.cellW, (s.y - this.scrollRows + 0.5) * this.grid.cellH]; }
}

customElements.define('ascii-scene', AsciiScene);
