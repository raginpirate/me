// What lives on the way down, in the order you meet it: snow under the
// clouds, a far flock now and then, and in the forest falling leaves, an
// owl, and once in a while a squirrel.
//
// The snow and the leaves are standing fields in the world: they are
// falling there whether you are there or not, so they are already falling
// when you arrive. The owl lives in the world too. It has a tree, and it is
// on that tree until it flies to another: it does not come and go.
//
// Size is distance here as everywhere: the owl and the squirrel are the
// size of the tree they are at, and change size on the way from one to the
// next; a flock is small and faint by how far off it is.
//
// The owl and the squirrel are small drawings made of a few glyphs at
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
const CLIMB = [['S', -0.1, 1.0, 1.4, 'leaf'], ['o', 0, 0.15, 1.15, 'leaf'], ['o', 0.05, -0.55, 0.85, 'leaf'], ["'", 0.3, -1.0, 0.6, 'leaf']];   // on a trunk, head up

export class Life {
  constructor(sc) {
    this.sc = sc;
    const rnd = this.rnd = mulberry32(31), S = sc.screenRows, L = D.layout, P = sc.P;
    // Snow, between the cloud base and the upper forest, at three depths in the camera's world.
    this.z0 = L.snow[0] * S; this.z1 = L.snow[1] * S;
    this.tiers = [{ k: 0.72, ch: '.', a: 0.9, fall: 1.2, color: 'dim' }, { k: 1, a: 0.8, fall: 2.3, color: 'snow' }, { k: 1.4, ch: '*', a: 0.95, fall: 3.6, color: 'snow' }];
    this.flakes = Array.from({ length: Math.round(sc.cols * (this.z1 - this.z0) / 44) }, () => {
      const u = rnd(), tier = u < 0.42 ? 0 : u < 0.93 ? 1 : 2;
      return { x: rnd(), y: this.z0 + rnd() * (this.z1 - this.z0), tier, ch: this.tiers[tier].ch || (rnd() < 0.7 ? '*' : '+'), phase: rnd() * 6.28 };
    });
    // Leaves, from where the broadleaves begin to the ground, at three
    // depths, thicker the further down. rank: a leaf is there only where
    // the fall is thick enough for it, so the fall thickens leaf by leaf.
    this.l0 = (L.forest - 0.25) * S; this.l1 = sc.groundRow;
    this.depths = [{ k: 0.8, a: 0.75, fall: 1.3 }, { k: 1.1, a: 0.95, fall: 1.9 }, { k: 1.5, a: 1, fall: 2.6 }];
    this.fall = Array.from({ length: Math.round(sc.cols * (this.l1 - this.l0) / 40) }, () => {
      const u = rnd(), v = rnd();
      return { x: rnd(), y: this.l0 + rnd() * (this.l1 - this.l0), tier: u < 0.4 ? 0 : u < 0.86 ? 1 : 2, rank: rnd(), phase: rnd() * 6.28, frame: Math.floor(rnd() * 3), color: v < 0.42 ? P.leaf : v < 0.72 ? P.birchLeaf : P.leafOlive };
    });
    this.flock = null; this.nextFlock = 2.5;
    this.owl = { state: 'none', on: null, met: false, x: 0, y: 0, s: 1, wait: 0, gone: 0 };
    this.squirrel = { state: 'away', wait: 3 + rnd() * 3, side: 1, x: 0, y: 0, s: 1, dir: 1 };
  }

  // how thick the snow is at a height
  snowAt(y) { return smooth(this.z0, this.z0 + this.sc.screenRows * 0.22, y) * (1 - smooth(D.layout.treeline * this.sc.screenRows, this.z1, y)); }
  // how thick the leaf fall is at a height: a few where the first broadleaves are, all of them a screen and a half lower
  leavesAt(y) { const S = this.sc.screenRows; return 0.12 + 0.88 * smooth(this.l0 + 0.2 * S, this.l0 + 1.6 * S, y); }
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

    // --- leaves: they flutter, so a leaf falls in fits and slides from side to side ---
    for (const f of this.fall) {
      const T = this.depths[f.tier];
      f.y += T.fall * (0.6 + 0.4 * Math.sin(t * 3 + f.phase)) * dt;
      f.x += (Math.sin(t * 2.1 + f.phase) * 1.6 + wind * 0.6) * T.k * dt / sc.cols;
      if (f.y > this.l1) { f.y = this.l0; f.x = rnd(); }
      f.x -= Math.floor(f.x);
    }

    // trees a creature can use, only worked out where the forest is
    const inWood = sc.centre > L.forest - 0.8 && sc.centre < L.ground + 0.2;
    const trees = this.trees = inWood ? sc.massif.perches() : [];
    const find = (id) => trees.find((q) => q.id === id);

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

    // --- the owl. It keeps to the forest proper, below the snow. Its tree
    // is a place in the world. When the tree goes out of your sight, up or
    // down, the owl goes to one you can see, from where it was. When there
    // is none to go to, as in the snow above the forest, it stays where it
    // is, and is there when you come back. ---
    const O = this.owl, home = L.forest * S, going = Math.sign(Math.round(sc.scrollVel));   // which way the page is going
    const perch = (q) => [q.x, q.top - 0.4 * g.size * q.size];
    const roosts = trees.filter((q) => q.row >= home && q.top > H * 0.1 && q.top < H * 0.8 && q.x > 30 && q.x < W - 30);
    // where each tree will have been carried to by the time it could get there: the page is still moving
    const T = 1.3, rows = clamp(sc.scrollVel * T, -S * 0.45, S * 0.45), cols = sc.cam.slide(sc.cam.y + rows) - sc.cam.x;
    const then = (o) => [o.x - cols * g.cellW * o.near, o.top - rows * g.cellH * o.near];
    // the trees of the forest that will be well on the screen then, and the one of some trees that will be nearest its middle
    const ahead = (not) => trees.filter((o) => { if (o.row < home || o.id === not) return false; const [x, y] = then(o); return x > W * 0.12 && x < W * 0.88 && y > H * 0.14 && y < H * 0.74; });
    const middle = (list) => { const off = (q) => { const [x, y] = then(q); return Math.hypot(x - W / 2, (y - H * 0.42) * 0.8); }; return list.reduce((p, q) => off(q) < off(p) ? q : p); };
    // off to a tree: from where it is, or if that is off the screen, from the edge of the screen on that side
    const fly = (o) => {
      O.from = [clamp(O.x, -40, W + 40), clamp(O.y, -40, H + 40)]; O.s0 = O.s; O.aim = o.id; O.u = 0;
      O.dur = clamp(Math.hypot(o.x - O.from[0], o.top - O.from[1]) / (18 * g.cellW), 0.7, 2.2); O.arc = (1.5 + rnd() * 2.5) * g.cellH; O.state = 'fly';
    };
    if (O.state === 'none') {
      // it has always been there: it is given its first tree before that tree comes into view
      const id = sc.massif.roost(home + 0.2 * S);
      if (id !== null) { O.on = id; O.state = 'perch'; O.wait = 4 + rnd() * 5; }
    } else if (O.state === 'perch') {
      const q = sc.massif.tree(O.on);
      [O.x, O.y] = perch(q); O.s = q.size;
      // Has its tree gone from you, or is it about to? Off the top or the bottom of the screen (sooner on the side
      // the page is carrying it to), out of sight behind something, or off to a side. But not when you are on your
      // way to it: then it waits for you where it is.
      const above = q.top < H * (going > 0 ? 0.16 : 0.05), below = q.top > H * (going < 0 ? 0.8 : 0.93);
      const lost = (above && going >= 0) || (below && going <= 0) || (!above && !below && (!q.seen || q.x < 10 || q.x > W - 10));
      if (!lost && !above && !below) O.met = true;   // until you have come to it once, it waits where it is
      O.gone = lost ? O.gone + dt : 0; O.wait = above || below ? Math.max(O.wait, 4) : O.wait - dt;   // when you come back to it, it sits a while
      const others = roosts.filter((o) => o.id !== O.on), to = lost && O.met && O.gone > (going ? 0.15 : 1.2) ? ahead(O.on) : [];
      if (to.length) fly(middle(to));   // it has to follow you
      else if (!lost && !above && !below && O.wait <= 0 && others.length) {
        // only restless: a short hop, to a tree that will still be on the screen
        const still = others.filter((q) => { const [x, y] = then(q); return x > W * 0.1 && x < W * 0.9 && y > H * 0.12 && y < H * 0.8; }), near = still.filter((q) => Math.hypot(q.x - O.x, q.top - O.y) < Math.max(W, H) * 0.45);
        fly(pick(near.length ? near : still.length ? still : others));
      }
    } else {
      // the page can carry its tree off while it is on its way there: then it turns to one that will be on the screen
      const [ax, ay] = then(sc.massif.tree(O.aim)), turn = O.u < 0.75 && (ay < H * 0.05 || ay > H * 0.88 || ax < 0 || ax > W) ? ahead(O.aim) : [];
      if (turn.length) fly(middle(turn));
      const q = sc.massif.tree(O.aim), to = perch(q);
      O.u = Math.min(1, O.u + dt / O.dur);
      const e = smooth(0, 1, O.u);
      O.s = O.s0 + (q.size - O.s0) * e;   // it is the size of things where it is going by the time it gets there
      O.dir = to[0] >= O.from[0] ? 1 : -1;
      O.x = O.from[0] + (to[0] - O.from[0]) * e; O.y = O.from[1] + (to[1] - O.from[1]) * e - Math.sin(Math.PI * e) * O.arc;
      if (O.u >= 1) { O.state = 'perch'; O.on = O.aim; O.wait = 6 + rnd() * 9; O.gone = 0; }
    }

    // --- a squirrel, seldom. It comes down a trunk or out from behind one,
    // sits, goes to a tree or two near by on the same ridge in quick hops,
    // then runs up a trunk and is gone for a good while. ---
    const Q = this.squirrel;
    const feet = trees.filter((q) => q.y > H * 0.2 && q.y < H * 0.95 && q.x > 20 && q.x < W - 20);
    const foot = (q, side) => [q.x + side * 1.3 * g.size * q.size, q.y - 0.5 * g.size * q.size];
    const trunk = (q, side, u) => [q.x + side * 0.45 * g.size * q.size, q.y - 0.5 * g.size * q.size - u * Math.max(q.y - q.bole, 0.5 * (q.y - q.top))];   // u: how far up, to where the leaves take it
    const gone = () => { Q.state = 'away'; Q.wait = 10 + rnd() * 12; };
    if (Q.state === 'away') {
      Q.wait -= dt;
      if (Q.wait <= 0 && feet.length > 3 && sc.centre > L.forest + 0.3) {
        // at a tree in your light, if there is one, where it can be seen
        const [lx, ly, , reach] = sc.lampAt || [W / 2, H / 2, 0, H], lit = feet.filter((o) => Math.hypot(o.x - lx, o.y - ly) < reach * 0.7), q = pick(lit.length ? lit : feet);
        Q.on = q.id; Q.sheet = q.sheet; Q.side = rnd() < 0.5 ? 1 : -1; Q.dir = Q.side; Q.s = q.size; Q.todo = 1 + Math.floor(rnd() * 3); Q.wait = 0.8 + rnd() * 2;
        if (rnd() < 0.5) { Q.state = 'down'; Q.u = 1; } else { Q.state = 'sit'; Q.born = 0; }
        [Q.x, Q.y] = Q.state === 'down' ? trunk(q, Q.side, 1) : foot(q, Q.side);
      }
    } else {
      const q = find(Q.state === 'hop' ? Q.aim : Q.on);
      if (!q || q.y < H * 0.08) gone();
      else if (Q.state === 'hop') {
        Q.to = foot(q, Q.side);
        Q.u = Math.min(1, Q.u + dt / Q.dur); Q.s = Q.s0 + (q.size - Q.s0) * Q.u;
        Q.dir = Q.to[0] >= Q.from[0] ? 1 : -1;
        const hops = Math.max(1, Math.round(Math.abs(Q.to[0] - Q.from[0]) / (5 * g.cellW)));
        Q.x = Q.from[0] + (Q.to[0] - Q.from[0]) * Q.u; Q.y = Q.from[1] + (Q.to[1] - Q.from[1]) * Q.u - Math.abs(Math.sin(Q.u * Math.PI * hops)) * 0.7 * g.cellH * Q.s;
        if (Q.u >= 1) { Q.state = 'sit'; Q.born = 1; Q.on = Q.aim; Q.wait = 0.6 + rnd() * 2.4; }
      } else if (Q.state === 'up' || Q.state === 'down') {
        // up or down the trunk in little rushes
        const rush = Math.sin(t * 8 + 1) > -0.35 ? 1 : 0.15;
        Q.u = clamp(Q.u + (Q.state === 'up' ? 1 : -1) * rush * dt / 0.9, 0, 1); Q.s = q.size;
        [Q.x, Q.y] = trunk(q, Q.side, Q.u);
        if (Q.state === 'up' && Q.u >= 1) gone();
        else if (Q.state === 'down' && Q.u <= 0) { Q.state = 'sit'; Q.born = 1; Q.wait = 0.8 + rnd() * 2; }
      } else {
        Q.born += dt; Q.wait -= dt;
        [Q.x, Q.y] = foot(q, Q.side); Q.s = q.size;
        if (Q.wait <= 0) {
          // only to a tree on the same ridge: it does not jump the gap between two
          const near = Q.todo > 0 ? feet.filter((o) => o.sheet === Q.sheet && o.id !== Q.on && Math.abs(o.x - q.x) > 3 * g.cellW && Math.abs(o.x - q.x) < 16 * g.cellW && Math.abs(o.y - q.y) < 7 * g.cellH) : [];
          if (near.length) { const o = pick(near); Q.todo--; Q.from = [Q.x, Q.y]; Q.s0 = Q.s; Q.aim = o.id; Q.u = 0; Q.dur = clamp(Math.abs(o.x - Q.x) / (26 * g.cellW), 0.22, 1.1); Q.state = 'hop'; }
          else { Q.state = 'up'; Q.u = 0; }
        }
      }
    }
  }

  // one drawing, its middle at (x, y), u pixels to the unit, facing dir; up: -1 turns it head down
  sprite(parts, x, y, u, dir = 1, a = 1, up = 1) {
    const g = this.sc.grid, P = this.sc.P;
    for (const [ch, dx, dy, k, color] of parts) g.ink(dir < 0 && ch === '/' ? '\\' : dir < 0 && ch === '\\' ? '/' : ch, P[color], x + dx * u * dir, y + dy * u * up, k * u, a);
  }

  // A fall of things is as wide as the screen and goes round: where one of
  // them is across the screen, at depth z, as the camera slides.
  across(x, z) { const g = this.sc.grid, wide = g.w + 20, v = (x * wide - this.sc.cam.drift(z)) % wide; return (v < 0 ? v + wide : v) - 10; }

  // behind the mountain: the furthest snow, the flock
  behind() {
    const sc = this.sc, g = sc.grid, cam = sc.cam, P = sc.P, t = sc.time;
    this.snow(0);
    const f = this.flock;
    if (f) for (const b of f.birds) {
      const y = cam.py(f.y, f.k) + (b.dy * (1 + 0.08 * Math.sin(t * 0.7 + b.ph)) + 0.3 * Math.sin(t * 1.1 + b.ph)) * g.cellH;
      g.ink(Math.sin(t * 5.5 + b.ph) > 0.1 ? 'v' : '-', P.bird, f.x + b.dx * g.cellW, y, g.size * f.far, 0.3 + 0.45 * f.far);   // the further off, the smaller and fainter
    }
  }
  snow(tier) {
    const sc = this.sc, g = sc.grid, cam = sc.cam, T = this.tiers[tier], H = g.h, size = g.size * cam.size(T.k) * (tier === 2 ? 1.1 : 1);
    for (const f of this.flakes) {
      if (f.tier !== tier) continue;
      const y = cam.py(f.y, T.k);
      if (y < -10 || y > H + 10) continue;
      g.ink(f.ch, sc.P[T.color], this.across(f.x, T.k), y, size, T.a * this.snowAt(f.y));
    }
  }
  // The leaves are drawn after the mountain has been put out round your
  // light, so the whole fall shows: brightest in the light (at x, y, from r0
  // out to r1), and still there in the dark.
  leaves(x, y, r0, r1) {
    const sc = this.sc, g = sc.grid, cam = sc.cam, t = sc.time, H = g.h, G = D.glyphs.leaves;
    for (const f of this.fall) {
      const T = this.depths[f.tier], py = cam.py(f.y, T.k);
      if (py < -10 || py > H + 10 || f.rank > this.leavesAt(f.y)) continue;
      const px = this.across(f.x, T.k), lit = 1 - smooth(r0, r1, Math.hypot(px - x, py - y));
      // it comes to rest on the ground: gone over its last rows
      g.ink(G[(f.frame + Math.floor(t * 3 + f.phase)) % 3], f.color, px, py, g.size * cam.size(T.k), T.a * (0.5 + 0.5 * lit) * smooth(this.l0, this.l0 + 6, f.y) * (1 - smooth(this.l1 - 3, this.l1, f.y)));
    }
  }

  // in front of it: the nearer snow, the owl, the squirrel
  front() {
    const sc = this.sc, g = sc.grid, t = sc.time, H = g.h;
    this.snow(1); this.snow(2);
    const O = this.owl;
    if (O.state !== 'none' && O.y > -60 && O.y < H + 60) {
      const u = g.size * O.s * 0.45, blink = (t * 0.31 + 0.2) % 1 > 0.96;
      if (O.state === 'fly') this.sprite(WINGS[[0, 1, 2, 1][Math.floor(t * 9) % 4]], O.x, O.y, u);
      this.sprite(O.state === 'fly' ? OWL.slice(0, 5) : OWL, O.x, O.y, u);
      this.sprite(blink ? SHUT : EYES, O.x, O.y, u);
    }
    const Q = this.squirrel;
    if (Q.state !== 'away' && !sc.massif.hidden(Q.x, Q.y, Q.sheet)) {   // there, and not behind something nearer
      const grow = Q.state === 'sit' ? Math.min(1, Q.born * 4) : 1, u = g.size * Q.s * 0.58 * (0.5 + 0.5 * grow);
      if (Q.state === 'hop') this.sprite(RUN, Q.x, Q.y, u, Q.dir);
      // on a trunk: it goes into the leaves at the top and comes out of them
      else if (Q.state === 'up' || Q.state === 'down') this.sprite(CLIMB, Q.x, Q.y, u, Q.side, 1 - smooth(0.78, 1, Q.u), Q.state === 'up' ? 1 : -1);
      else { const flick = Math.sin(t * 7 + Q.side) > 0.82 ? 0.14 : 0; this.sprite([[SIT[0][0], SIT[0][1], SIT[0][2] - flick, SIT[0][3] + flick, 'leaf'], ...SIT.slice(1)], Q.x, Q.y, u, Q.dir, grow); }
    }
  }
}
