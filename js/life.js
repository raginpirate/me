// What lives on the way down, in the order you meet it: snow under the
// clouds, a far flock now and then, and in the forest falling leaves, an
// owl that goes from tree top to tree top, and squirrels.
//
// Size is distance here too: the owl and the squirrels are the size of the
// tree they are at, and change size on the way from one to the next; a
// flock is small and faint by how far off it is.
//
// The owl and the squirrels are small drawings made of a few glyphs at
// different sizes. A part is [glyph, across, down, size, colour]: across
// and down from the drawing's middle, and size, all in units of the type
// size where it stands.

import { clamp, smooth, mulberry32 } from './util.js';
import { D } from './direction.js';

const OWL = [['(', -0.55, 0.1, 1.4, 'snow'], [')', 0.55, 0.1, 1.4, 'snow'], ['v', 0, 0.1, 0.5, 'snow'], ['^', -0.45, -0.8, 0.6, 'snow'], ['^', 0.45, -0.8, 0.6, 'snow'], ['"', 0, 0.85, 0.7, 'dim']];
const EYES = [['o', -0.25, -0.25, 0.75, 'ember'], ['o', 0.25, -0.25, 0.75, 'ember']], SHUT = [['-', -0.25, -0.2, 0.7, 'ember'], ['-', 0.25, -0.2, 0.7, 'ember']];
const WINGS = [                                             // up, level, down
  [['\\', -1.15, -0.5, 1.4, 'snow'], ['/', 1.15, -0.5, 1.4, 'snow']],
  [['-', -1.2, -0.05, 1.4, 'snow'], ['-', 1.2, -0.05, 1.4, 'snow']],
  [['/', -1.15, 0.4, 1.4, 'snow'], ['\\', 1.15, 0.4, 1.4, 'snow']],
];
const SIT = [['S', -0.8, -0.3, 1.6, 'leaf'], ['o', 0, 0.1, 1.25, 'leaf'], ['o', 0.6, -0.4, 0.8, 'leaf'], ["'", 0.55, -0.9, 0.6, 'leaf']];   // tail, body, head, ear: facing right
const RUN = [['~', -1.2, -0.1, 1.5, 'leaf'], ['o', -0.2, 0, 1.1, 'leaf'], ['o', 0.45, -0.1, 0.9, 'leaf'], ["'", 0.45, -0.55, 0.6, 'leaf']];

export class Life {
  constructor(sc) {
    this.sc = sc;
    const rnd = this.rnd = mulberry32(31), S = sc.screenRows, L = D.layout, P = sc.P;
    // snow lives in the world, between the cloud base and the upper forest, at three depths.
    // k is a depth: how large a flake is and how fast it passes, against the page.
    this.z0 = L.snow[0] * S; this.z1 = L.snow[1] * S;
    this.tiers = [{ k: 0.72, ch: '.', size: 0.9, a: 0.9, fall: 1.2, color: 'dim' }, { k: 1, size: 1, a: 0.8, fall: 2.3, color: 'snow' }, { k: 1.4, ch: '*', size: 1.5, a: 0.95, fall: 3.6, color: 'snow' }];
    this.flakes = Array.from({ length: Math.round(sc.cols * (this.z1 - this.z0) / 44) }, () => {
      const u = rnd(), tier = u < 0.42 ? 0 : u < 0.93 ? 1 : 2;
      return { x: rnd(), y: this.z0 + rnd() * (this.z1 - this.z0), tier, ch: this.tiers[tier].ch || (rnd() < 0.7 ? '*' : '+'), phase: rnd() * 6.28 };
    });
    // Leaves, from where the broadleaves begin to the ground: a standing
    // field like the snow, at three depths, thicker the further down. rank: a
    // leaf is there only where the fall is thick enough for it, so the fall
    // thickens leaf by leaf. They show in the dark too, brightest in your light.
    this.l0 = (L.forest - 0.25) * S; this.l1 = sc.groundRow;
    this.depths = [{ k: 0.8, size: 0.85, a: 0.75, fall: 1.3 }, { k: 1.1, size: 1.1, a: 0.95, fall: 1.9 }, { k: 1.5, size: 1.6, a: 1, fall: 2.6 }];
    this.fall = Array.from({ length: Math.round(sc.cols * (this.l1 - this.l0) / 40) }, () => {
      const u = rnd(), v = rnd();
      return { x: rnd(), y: this.l0 + rnd() * (this.l1 - this.l0), tier: u < 0.4 ? 0 : u < 0.86 ? 1 : 2, rank: rnd(), phase: rnd() * 6.28, frame: Math.floor(rnd() * 3), color: v < 0.5 ? P.leaf : P.leafOlive };
    });
    this.flock = null; this.nextFlock = 2.5;
    this.owl = { state: 'away', wait: 1, x: 0, y: 0, s: 1, dir: 1 };
    this.squirrels = [0, 1].map((i) => ({ state: 'away', wait: 0.5 + i * 3, side: i ? 1 : -1, x: 0, y: 0, s: 1, dir: 1 }));
  }

  // how thick the snow is at a height
  snowAt(y) { return smooth(this.z0, this.z0 + this.sc.screenRows * 0.22, y) * (1 - smooth(D.layout.treeline * this.sc.screenRows, this.z1, y)); }
  // is anything alive on screen: then the scene must keep drawing
  get showing() { const c = this.sc.centre, L = D.layout; return c > L.snow[0] - 0.6 && c < L.ground + 0.6; }

  update(dt) {
    const sc = this.sc, g = sc.grid, S = sc.screenRows, t = sc.time, rnd = this.rnd, pick = (a) => a[Math.floor(rnd() * a.length)], L = D.layout, W = g.w, H = g.h;
    const wind = this.wind = 1.3 * Math.sin(t * 0.21) + 0.5 * Math.sin(t * 0.67 + 1.3);

    // --- snow ---
    for (const f of this.flakes) {
      const T = this.tiers[f.tier];
      f.y += T.fall * dt;
      f.x += (wind * T.k + Math.sin(t * 1.9 + f.phase) * 0.5 * (f.tier + 1)) * dt / sc.cols;
      if (f.y > this.z1) { f.y = this.z0; f.x = rnd(); }
      f.x -= Math.floor(f.x);
    }

    // trees a creature can use, only worked out where the forest is
    const inWood = sc.centre > L.forest - 0.3 && sc.centre < L.ground + 0.2;
    const trees = this.trees = inWood ? sc.massif.perches() : [];
    const find = (id) => trees.find((q) => q.id === id);

    // --- leaves: they flutter, so a leaf falls in fits and slides from side to side ---
    for (const f of this.fall) {
      const T = this.depths[f.tier];
      f.y += T.fall * (0.6 + 0.4 * Math.sin(t * 3 + f.phase)) * dt;
      f.x += (Math.sin(t * 2.1 + f.phase) * 1.6 + wind * 0.6) * T.k * dt / sc.cols;
      if (f.y > this.l1) { f.y = this.l0; f.x = rnd(); }
      f.x -= Math.floor(f.x);
    }

    // --- a flock, far off, once in a while, below the clouds ---
    this.nextFlock -= dt;
    if (!this.flock && this.nextFlock <= 0 && sc.centre > L.deck[1] - 0.05 && sc.centre < L.ground - 1.5) {
      const dir = rnd() < 0.5 ? 1 : -1, n = 7 + Math.floor(rnd() * 7), k = 0.3, far = 0.45 + rnd() * 0.3, birds = [{ dx: 0, dy: 0, ph: rnd() * 6.28 }];
      for (let i = 1; i < n; i++) { const j = Math.ceil(i / 2), side = i % 2 ? 1 : -0.8; birds.push({ dx: -dir * (j * 2.1 + (rnd() - 0.5) * 0.9) * far, dy: (side * j * (0.5 + rnd() * 0.12) + (rnd() - 0.5) * 0.3) * far, ph: rnd() * 6.28 }); }
      const len = (Math.ceil(n / 2) * 2.1 + 3) * g.cellW;
      this.flock = { x: dir > 0 ? -20 : W + 20, y: sc.centreRow + ((0.18 + rnd() * 0.4) * H - H / 2) / (g.cellH * k), k, far, dir, len, birds, v: Math.max(34, W / 20) * (0.5 + far), drift: (rnd() - 0.5) * 0.5 };
      this.nextFlock = 15 + rnd() * 10;
    }
    if (this.flock) { const f = this.flock; f.x += f.dir * f.v * dt; f.y += f.drift * dt; if (f.dir > 0 ? f.x - f.len > W + 20 : f.x + f.len < -20) this.flock = null; }

    // --- the owl: tree top to tree top, following you down. It never jumps:
    // it flies in from off the screen once, and from then on it keeps with
    // you: when its tree is about to leave the screen it goes, unhurried, to
    // one well inside it, the nearest the middle. ---
    const O = this.owl, tops = trees.filter((q) => q.top > H * 0.1 && q.top < H * 0.82 && q.x > 30 && q.x < W - 30);
    const middle = (not) => { const band = tops.filter((o) => o.id !== not && o.top > H * 0.28 && o.top < H * 0.7 && o.x > W * 0.15 && o.x < W * 0.85); if (!band.length) return null; band.sort((a, b) => Math.hypot(a.x - W / 2, a.top - H * 0.45) - Math.hypot(b.x - W / 2, b.top - H * 0.45)); return pick(band.slice(0, 4)); };
    const fly = (to, q) => { O.from = [O.x, O.y]; O.s0 = O.s; O.to = to; O.aim = q ? q.id : null; O.u = 0; O.dur = clamp(Math.hypot(to[0] - O.x, to[1] - O.y) / (9 * g.cellW), 1.3, 3.0); O.arc = (1.5 + rnd() * 2.5) * g.cellH; O.state = 'fly'; };
    const perch = (q) => [q.x, q.top - 0.8 * g.size * q.s];
    if (O.state === 'away') {
      O.wait -= dt;
      if (O.wait <= 0 && tops.length > 2) { const q = pick(tops); O.x = rnd() < 0.5 ? -40 : W + 40; O.y = q.top - (4 + rnd() * 8) * g.cellH; O.s = q.s * 0.4; fly(perch(q), q); }
    } else if (O.state === 'fly') {
      const q = O.aim !== null ? find(O.aim) : null;
      // the page carries its tree off while it is on its way: it turns to one that will stay on the screen
      if (q && O.u < 0.8 && (q.top < H * 0.1 || q.top > H * 0.9)) { const o = middle(q.id); if (o) { fly(perch(o), o); } }
      if (q && O.aim === q.id) O.to = perch(q);
      else if (O.aim !== null && !find(O.aim)) { const o = middle(O.aim); if (o) fly(perch(o), o); else { O.aim = null; O.to = [O.x < W / 2 ? -60 : W + 60, O.y - 3 * g.cellH]; } }   // its tree has gone: another, or off the screen
      O.u = Math.min(1, O.u + dt / O.dur);
      const e = smooth(0, 1, O.u);
      O.s = O.s0 + ((q ? q.s : O.s0 * 0.4) - O.s0) * e;   // it grows as it comes nearer and shrinks as it goes off
      O.dir = O.to[0] >= O.from[0] ? 1 : -1;
      O.x = O.from[0] + (O.to[0] - O.from[0]) * e; O.y = O.from[1] + (O.to[1] - O.from[1]) * e - Math.sin(Math.PI * e) * O.arc;
      if (O.u >= 1) { if (O.aim !== null) { O.state = 'perch'; O.on = O.aim; O.wait = 4 + rnd() * 5; } else { O.state = 'away'; O.wait = 1.5 + rnd() * 2; } }
    } else {
      const q = find(O.on);
      O.wait -= dt;
      if (q) { [O.x, O.y] = perch(q); O.s = q.s; }
      const leaving = !q || O.y < H * 0.14 || O.y > H * 0.88 || O.x < W * 0.04 || O.x > W * 0.96;
      if (leaving) { const o = middle(O.on); if (o) fly(perch(o), o); else if (!q || O.y < 0 || O.y > H) fly([O.x < W / 2 ? -60 : W + 60, O.y - 4 * g.cellH], null); }
      else if (O.wait <= 0) {
        // only restless: a short hop to a tree near by
        const next = tops.filter((o) => o.id !== O.on && Math.abs(o.x - O.x) > 5 * g.cellW && Math.hypot(o.x - O.x, o.top - O.y) < Math.max(W, H) * 0.4 && o.top > H * 0.2 && o.top < H * 0.75);
        if (next.length) { const o = pick(next); fly(perch(o), o); } else O.wait = 1;
      }
    }

    // --- squirrels: each keeps to the ridge it is on, going from the foot of
    // one tree to the next in quick hops. One comes out from behind a tree,
    // and is gone when its tree is. ---
    const feet = trees.filter((q) => q.y > H * 0.2 && q.y < H * 0.95 && q.x > 20 && q.x < W - 20);
    const foot = (q, side) => [q.x + side * 1.3 * g.size * q.s, q.y - 0.5 * g.size * q.s];
    for (const Q of this.squirrels) {
      const gone = () => { Q.state = 'away'; Q.wait = 1 + rnd() * 3; };
      if (Q.state === 'away') {
        Q.wait -= dt;
        if (Q.wait <= 0 && feet.length > 3 && sc.centre > L.forest + 0.3) { const q = pick(feet); Q.on = q.id; Q.lobe = q.lobe; [Q.x, Q.y] = foot(q, Q.side); Q.s = q.s; Q.dir = Q.side; Q.born = 0; Q.state = 'sit'; Q.wait = 0.8 + rnd() * 2; }
      } else if (Q.state === 'hop') {
        const q = find(Q.aim);
        if (!q) { gone(); continue; }
        Q.to = foot(q, Q.side);
        Q.u = Math.min(1, Q.u + dt / Q.dur); Q.s = Q.s0 + (q.s - Q.s0) * Q.u;
        Q.dir = Q.to[0] >= Q.from[0] ? 1 : -1;
        const hops = Math.max(1, Math.round(Math.abs(Q.to[0] - Q.from[0]) / (5 * g.cellW)));
        Q.x = Q.from[0] + (Q.to[0] - Q.from[0]) * Q.u; Q.y = Q.from[1] + (Q.to[1] - Q.from[1]) * Q.u - Math.abs(Math.sin(Q.u * Math.PI * hops)) * 0.7 * g.cellH * Q.s;
        if (Q.u >= 1) { Q.state = 'sit'; Q.on = Q.aim; Q.wait = 0.6 + rnd() * 2.4; }
      } else {
        const q = find(Q.on);
        Q.born += dt; Q.wait -= dt;
        if (!q || q.y < H * 0.08) { gone(); continue; }
        [Q.x, Q.y] = foot(q, Q.side); Q.s = q.s;
        if (Q.wait <= 0) {
          // only to a tree on the same ridge: it does not jump the gap between two
          const near = feet.filter((o) => o.lobe === Q.lobe && o.id !== Q.on && Math.abs(o.x - q.x) > 3 * g.cellW && Math.abs(o.x - q.x) < 16 * g.cellW && Math.abs(o.y - q.y) < 7 * g.cellH);
          if (near.length) { const o = pick(near); Q.from = [Q.x, Q.y]; Q.s0 = Q.s; Q.aim = o.id; Q.u = 0; Q.dur = clamp(Math.abs(o.x - Q.x) / (26 * g.cellW), 0.22, 1.1); Q.state = 'hop'; } else Q.wait = 0.6;
        }
      }
    }
  }

  // one drawing, its middle at (x, y), u pixels to the unit, facing dir
  sprite(parts, x, y, u, dir = 1, a = 1) {
    const g = this.sc.grid, P = this.sc.P;
    for (const [ch, dx, dy, k, color] of parts) g.ink(dir < 0 && ch === '/' ? '\\' : dir < 0 && ch === '\\' ? '/' : ch, P[color], x + dx * u * dir, y + dy * u, k * u, a);
  }

  // behind the mountain: the furthest snow, the flock
  behind() {
    const sc = this.sc, g = sc.grid, P = sc.P, t = sc.time, H = g.h;
    this.snow(0);
    const f = this.flock;
    if (f) for (const b of f.birds) {
      const y = H / 2 + (f.y - sc.centreRow) * g.cellH * f.k + (b.dy * (1 + 0.08 * Math.sin(t * 0.7 + b.ph)) + 0.3 * Math.sin(t * 1.1 + b.ph)) * g.cellH;
      g.ink(Math.sin(t * 5.5 + b.ph) > 0.1 ? 'v' : '-', P.bird, f.x + b.dx * g.cellW, y, g.size * f.far, 0.3 + 0.45 * f.far);   // the further off, the smaller and fainter
    }
  }
  snow(tier) {
    const sc = this.sc, g = sc.grid, T = this.tiers[tier], H = g.h;
    for (const f of this.flakes) {
      if (f.tier !== tier) continue;
      const y = H / 2 + (f.y - sc.centreRow) * g.cellH * T.k;
      if (y < -10 || y > H + 10) continue;
      g.ink(f.ch, sc.P[T.color], f.x * (g.w + 20) - 10, y, g.size * T.size, T.a * this.snowAt(f.y));
    }
  }

  // how thick the leaf fall is at a height: a few where the first broadleaves are, all of them a screen and a half lower
  leavesAt(y) { const S = this.sc.screenRows; return 0.12 + 0.88 * smooth(this.l0 + 0.2 * S, this.l0 + 1.6 * S, y); }
  // The leaves are drawn after the mountain has been put out round your
  // light, so the whole fall shows: brightest in the light (at x, y, from r0
  // out to r1), and still there in the dark.
  drawLeaves(x, y, r0, r1) {
    const sc = this.sc, g = sc.grid, t = sc.time, H = g.h, G = D.glyphs.leaves;
    for (const f of this.fall) {
      const T = this.depths[f.tier], py = H / 2 + (f.y - sc.centreRow) * g.cellH * T.k;
      if (py < -10 || py > H + 10 || f.rank > this.leavesAt(f.y)) continue;
      const px = f.x * (g.w + 20) - 10, lit = 1 - smooth(r0, r1, Math.hypot(px - x, py - y));
      // it comes to rest on the ground: gone over its last rows
      g.ink(G[(f.frame + Math.floor(t * 3 + f.phase)) % 3], f.color, px, py, g.size * T.size, T.a * (0.5 + 0.5 * lit) * smooth(this.l0, this.l0 + 6, f.y) * (1 - smooth(this.l1 - 3, this.l1, f.y)));
    }
  }

  // in front of it: the nearer snow, the owl, the squirrels
  front() {
    const sc = this.sc, g = sc.grid, t = sc.time, H = g.h;
    this.snow(1); this.snow(2);
    const O = this.owl;
    if (O.state !== 'away') {
      const u = g.size * Math.min(O.s, 1.8) * 1.0, blink = (t * 0.31 + 0.2) % 1 > 0.96;
      if (O.state === 'fly') this.sprite(WINGS[[0, 1, 2, 1][Math.floor(t * 9) % 4]], O.x, O.y, u);
      this.sprite(O.state === 'fly' ? OWL.slice(0, 5) : OWL, O.x, O.y, u);
      this.sprite(blink ? SHUT : EYES, O.x, O.y, u);
    }
    for (const Q of this.squirrels) {
      if (Q.state === 'away' || sc.massif.hidden(Q.x, Q.y, Q.lobe)) continue;   // not there, or behind something nearer
      const grow = Q.state === 'sit' ? Math.min(1, Q.born * 4) : 1, u = g.size * Q.s * 0.58 * (0.5 + 0.5 * grow);
      if (Q.state === 'hop') this.sprite(RUN, Q.x, Q.y, u, Q.dir);
      else { const flick = Math.sin(t * 7 + Q.side) > 0.82 ? 0.14 : 0; this.sprite([[SIT[0][0], SIT[0][1], SIT[0][2] - flick, SIT[0][3] + flick, 'leaf'], ...SIT.slice(1)], Q.x, Q.y, u, Q.dir, grow); }
    }
  }
}
